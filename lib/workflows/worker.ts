import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  createProjectAssistantGateway,
  type AiGatewayResult,
} from "@/lib/ai/project-assistant/gateway";
import { requireAiAssistantEnabled } from "@/lib/ai/project-assistant/config";
import { getDb } from "@/lib/db/client";
import {
  documentChunk,
  projectDocument,
  transcriptSegment,
  transcriptSpeaker,
  workflowArtifact,
  workflowArtifactVersion,
  workflowExecution,
  workflowAudioJob,
  workflowRun,
  workflowRunSource,
} from "@/lib/db/schema";
import {
  artifactSchemas,
  describeArtifactSchemaFailure,
  normalizeRequirementsDocumentBatch,
  describeRequirementsBatchSchemaFailure,
  normalizeGa4MeasurementPlan,
  normalizeActionPlan,
  REQUIREMENT_ARTIFACT_KINDS,
  REQUIREMENTS_SECTION_TITLES,
  requirementsDocumentBatchSchema,
  validateGa4MeasurementIdGrounding,
  validateActionPlanDateGrounding,
  validateCitationLabels,
  type RequirementArtifactKind,
} from "./contracts";
import { renderArtifactMarkdown } from "./render";
import { createMeetingSummaryProvider } from "./meeting-summary-provider";
import { buildAudioProviderUrl } from "./audio-service";
import { createAudioTranscriptionProvider } from "./audio-provider";
import { WorkflowError } from "./errors";
import { buildArtifactPrompt, type WorkflowEvidence } from "./prompt";
import { artifactTitle } from "./service";

const ACTIVE = [
  "queued", "validating_sources", "parsing_sources", "extracting_facts",
  "identifying_gaps", "generating_overview", "generating_requirements",
  "generating_ga4", "generating_action_plan", "checking_consistency",
  "transcribing", "diarizing", "normalizing", "summarizing",
] as const;

type WorkerConfig = { pollMs: number; leaseSeconds: number; heartbeatFile: string };

function config(): WorkerConfig {
  const pollMs = Number(process.env.WORKFLOW_WORKER_POLL_MS || 1_000);
  const leaseSeconds = Number(process.env.WORKFLOW_WORKER_LEASE_SECONDS || 300);
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new Error("WORKFLOW_WORKER_POLL_MS_INVALID");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > 900) throw new Error("WORKFLOW_WORKER_LEASE_SECONDS_INVALID");
  return {
    pollMs,
    leaseSeconds,
    heartbeatFile: process.env.WORKFLOW_WORKER_HEARTBEAT_FILE?.trim() || "/tmp/projectai-workflow-worker-heartbeat",
  };
}

export async function claimWorkflowRun(workerId: string, workerConfig = config()) {
  return getDb().transaction(async (tx) => {
    const recoverableAudio = await tx.execute<{ id: string }>(sql`
      select distinct run.id
      from workflow_runs run
      join workflow_audio_jobs audio
        on audio.run_id = run.id and audio.project_id = run.project_id
      join workflow_executions execution
        on execution.run_id = run.id and execution.project_id = run.project_id
      where run.workflow_type = 'meeting_minutes'
        and run.status in (${sql.join(ACTIVE.map((status) => sql`${status}`), sql`, `)})
        and run.lease_expires_at <= now()
        and audio.provider_task_id is not null
        and execution.status = 'running'
        and execution.step = 2
    `);
    if (recoverableAudio.rows.length) {
      await tx.update(workflowExecution).set({
        status: "failed", failureCode: "WORKFLOW_LEASE_EXPIRED_RECOVERED", completedAt: new Date(),
      }).where(and(inArray(workflowExecution.runId, recoverableAudio.rows.map((item) => item.id)), eq(workflowExecution.status, "running")));
      await tx.update(workflowRun).set({
        leasedBy: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null,
        failureCode: "WORKFLOW_LEASE_EXPIRED_RECOVERED", nextAttemptAt: sql`now()`, updatedAt: sql`now()`,
      }).where(inArray(workflowRun.id, recoverableAudio.rows.map((item) => item.id)));
    }
    const uncertain = await tx.execute<{ id: string }>(sql`
      select distinct run.id
      from workflow_runs run
      join workflow_executions execution
        on execution.run_id = run.id and execution.project_id = run.project_id
      where run.status in (${sql.join(ACTIVE.map((status) => sql`${status}`), sql`, `)})
        and run.lease_expires_at <= now()
        and execution.status = 'running'
        and not exists (
          select 1 from workflow_audio_jobs audio
          where audio.run_id = run.id and audio.project_id = run.project_id
            and audio.provider_task_id is not null
            and execution.step = 2
        )
    `);
    if (uncertain.rows.length) {
      await tx.update(workflowExecution).set({
        status: "failed", failureCode: "WORKFLOW_PROVIDER_RESULT_UNKNOWN", completedAt: new Date(),
      }).where(and(inArray(workflowExecution.runId, uncertain.rows.map((item) => item.id)), eq(workflowExecution.status, "running")));
      await tx.update(workflowRun).set({
        status: "failed", failureCode: "WORKFLOW_PROVIDER_RESULT_UNKNOWN",
        leasedBy: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null,
        completedAt: new Date(), updatedAt: new Date(),
      }).where(inArray(workflowRun.id, uncertain.rows.map((item) => item.id)));
    }
    await tx.update(workflowRun).set({
      status: "queued", leasedBy: null, leaseToken: null, leaseExpiresAt: null,
      heartbeatAt: null, failureCode: "WORKFLOW_LEASE_EXPIRED", updatedAt: new Date(),
    }).where(and(
      inArray(workflowRun.status, [...ACTIVE]),
      sql`${workflowRun.status} <> 'queued'`,
      sql`${workflowRun.leaseExpiresAt} <= now()`,
      sql`not exists (select 1 from workflow_executions execution where execution.run_id = ${workflowRun.id} and execution.project_id = ${workflowRun.projectId} and execution.status = 'running')`,
    ));
    const candidate = await tx.execute<{ id: string }>(sql`
      select id from workflow_runs
      where status in (${sql.join(ACTIVE.map((status) => sql`${status}`), sql`, `)})
        and leased_by is null
        and cancellation_requested_at is null
        and next_attempt_at <= now()
      order by created_at asc, id asc
      for update skip locked
      limit 1
    `);
    const id = candidate.rows[0]?.id;
    if (!id) return null;
    const leaseToken = randomUUID();
    const [claimed] = await tx.update(workflowRun).set({
      status: sql`case when ${workflowRun.workflowType} = 'meeting_minutes' then case when ${workflowRun.status} = 'queued' then 'transcribing' else ${workflowRun.status} end else 'validating_sources' end`,
      currentStep: sql`case when ${workflowRun.workflowType} = 'meeting_minutes' then ${workflowRun.currentStep} else 1 end`,
      leasedBy: workerId, leaseToken,
      leaseExpiresAt: sql`now() + (${workerConfig.leaseSeconds} * interval '1 second')`,
      heartbeatAt: sql`now()`, updatedAt: sql`now()`, failureCode: null, failureStep: null,
    }).where(eq(workflowRun.id, id)).returning();
    return claimed;
  });
}

async function renew(runId: string, projectId: string, workerId: string, leaseToken: string, workerConfig: WorkerConfig) {
  const rows = await getDb().update(workflowRun).set({
    leaseExpiresAt: sql`now() + (${workerConfig.leaseSeconds} * interval '1 second')`,
    heartbeatAt: sql`now()`, updatedAt: sql`now()`,
  }).where(and(
    eq(workflowRun.id, runId), eq(workflowRun.projectId, projectId),
    eq(workflowRun.leasedBy, workerId), eq(workflowRun.leaseToken, leaseToken),
    inArray(workflowRun.status, [...ACTIVE]), sql`${workflowRun.leaseExpiresAt} > now()`,
  )).returning({ id: workflowRun.id });
  return rows.length === 1;
}

async function assertOwned(run: typeof workflowRun.$inferSelect) {
  const [current] = await getDb().select({
    cancellationRequestedAt: workflowRun.cancellationRequestedAt,
  }).from(workflowRun).where(and(
    eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId),
    eq(workflowRun.leasedBy, run.leasedBy!), eq(workflowRun.leaseToken, run.leaseToken!),
    sql`${workflowRun.leaseExpiresAt} > now()`,
  )).limit(1);
  if (!current) throw new WorkflowError(409, "WORKFLOW_LEASE_LOST", "工作流执行租约已失效");
  if (current.cancellationRequestedAt) {
    await getDb().update(workflowRun).set({
      status: "cancelled", leasedBy: null, leaseToken: null, leaseExpiresAt: null,
      heartbeatAt: null, completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
    throw new WorkflowError(409, "WORKFLOW_CANCELLED", "工作流已取消");
  }
}

async function evidenceForRun(run: typeof workflowRun.$inferSelect): Promise<WorkflowEvidence[]> {
  const rows = await getDb().select({
    source: workflowRunSource,
    documentName: projectDocument.displayName,
    chunkId: documentChunk.id,
    versionId: documentChunk.versionId,
    documentId: documentChunk.documentId,
    content: documentChunk.content,
    headingPath: documentChunk.headingPath,
    locator: documentChunk.sourceLocator,
  }).from(workflowRunSource)
    .innerJoin(projectDocument, and(eq(projectDocument.id, workflowRunSource.documentId), eq(projectDocument.projectId, workflowRunSource.sourceProjectId)))
    .innerJoin(documentChunk, and(
      eq(documentChunk.projectId, workflowRunSource.sourceProjectId),
      eq(documentChunk.documentId, workflowRunSource.documentId!),
      eq(documentChunk.versionId, workflowRunSource.documentVersionId!),
      eq(documentChunk.isEffective, true),
    ))
    .where(and(
      eq(workflowRunSource.runId, run.id), eq(workflowRunSource.projectId, run.projectId),
      eq(workflowRunSource.status, "ready"),
      sql`${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now()`,
    )).orderBy(asc(workflowRunSource.createdAt), asc(documentChunk.chunkIndex)).limit(20);
  if (!rows.length) throw new WorkflowError(422, "WORKFLOW_EVIDENCE_EMPTY", "授权资料没有可用的当前有效内容");
  return rows.map((row, index) => ({
    label: `E${index + 1}`,
    documentId: row.documentId,
    versionId: row.versionId,
    chunkId: row.chunkId,
    documentName: row.documentName,
    headingPath: row.headingPath,
    locator: row.locator,
    content: row.content.slice(0, 4_000),
  }));
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { return null; }
}

function sumUsage(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function collectLabels(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const child of value) collectLabels(child, output);
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "citations" || key === "sourceCitation") && typeof child === "string" && /^E\d+$/.test(child)) output.add(child);
      if ((key === "citations" || key === "segmentIds") && Array.isArray(child)) for (const label of child) if (typeof label === "string" && /^E\d+$/.test(label)) output.add(label);
      collectLabels(child, output);
    }
  }
  return output;
}

function statusForStep(step: number) {
  return ["validating_sources", "parsing_sources", "extracting_facts", "identifying_gaps", "generating_overview", "generating_requirements", "generating_ga4", "generating_action_plan", "checking_consistency", "checking_consistency"][step - 1]!;
}

async function beginStep(run: typeof workflowRun.$inferSelect, step: number, statusOverride?: string) {
  await assertOwned(run);
  const [last] = await getDb().select({ attempt: workflowExecution.attempt }).from(workflowExecution).where(and(eq(workflowExecution.runId, run.id), eq(workflowExecution.projectId, run.projectId), eq(workflowExecution.step, step))).orderBy(sql`${workflowExecution.attempt} desc`).limit(1);
  const executionId = randomUUID();
  await getDb().transaction(async (tx) => {
    const updated = await tx.update(workflowRun).set({ status: statusOverride ?? statusForStep(step), currentStep: step, updatedAt: new Date(), heartbeatAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!), sql`${workflowRun.leaseExpiresAt} > now()`)).returning({ id: workflowRun.id });
    if (updated.length !== 1) throw new WorkflowError(409, "WORKFLOW_LEASE_LOST", "工作流执行租约已失效");
    await tx.insert(workflowExecution).values({ id: executionId, runId: run.id, projectId: run.projectId, step, attempt: (last?.attempt ?? 0) + 1, status: "running" });
  });
  return executionId;
}

async function finishStep(run: typeof workflowRun.$inferSelect, executionId: string, result?: { provider?: string; actualModel?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null; resultDigest?: string }) {
  const updated = await getDb().update(workflowExecution).set({
    status: "succeeded", provider: result?.provider, actualModel: result?.actualModel,
    latencyMs: result?.latencyMs, inputTokens: result?.inputTokens, outputTokens: result?.outputTokens,
    resultDigest: result?.resultDigest ?? createHash("sha256").update(executionId).digest("hex"), completedAt: new Date(),
  }).where(and(eq(workflowExecution.id, executionId), eq(workflowExecution.projectId, run.projectId), eq(workflowExecution.status, "running"))).returning({ id: workflowExecution.id });
  if (updated.length !== 1) throw new WorkflowError(409, "WORKFLOW_EXECUTION_STATE_INVALID", "工作流步骤状态已变化");
}

async function generateArtifact(run: typeof workflowRun.$inferSelect, projectName: string, kind: RequirementArtifactKind, evidence: WorkflowEvidence[], step: number, force = false) {
  const [existing] = await getDb().select().from(workflowArtifact).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId), eq(workflowArtifact.artifactKind, kind))).limit(1);
  if (existing && !force) return;
  const executionId = await beginStep(run, step);
  const gateway = createProjectAssistantGateway(requireAiAssistantEnabled());
  const allowedLabels = new Set(evidence.map((item) => item.label));
  let result: AiGatewayResult;
  let content: Record<string, unknown>;
  if (kind === "requirements_document") {
    const sections: Array<{ number: number; title: string; body: string; classification: "fact" | "assumption" | "advice" | "pending"; citations: string[] }> = [];
    const acceptanceCriteria: string[] = [];
    let aggregate: AiGatewayResult | null = null;
    for (let offset = 0; offset < REQUIREMENTS_SECTION_TITLES.length; offset += 5) {
      const sectionNumbers = REQUIREMENTS_SECTION_TITLES.slice(offset, offset + 5).map((_, index) => offset + index + 1);
      const prompts = buildArtifactPrompt({ kind, projectName, evidence, requirementSectionNumbers: sectionNumbers });
      let batchResult = await gateway.generate({ ...prompts, purpose: "workflow_artifact" });
      let parsedBatch = requirementsDocumentBatchSchema.safeParse(
        normalizeRequirementsDocumentBatch(parseJson(batchResult.text)),
      );
      const batchFailureCode = () => {
        if (!parsedBatch.success) {
          return describeRequirementsBatchSchemaFailure(
            normalizeRequirementsDocumentBatch(parseJson(batchResult.text)),
          );
        }
        if (parsedBatch.data.sections.length !== sectionNumbers.length
          || !parsedBatch.data.sections.every((section, index) => section.number === sectionNumbers[index])) {
          return "WORKFLOW_REQUIREMENTS_BATCH_ORDER_INVALID";
        }
        if (!validateCitationLabels(parsedBatch.data, allowedLabels)) {
          return "WORKFLOW_REQUIREMENTS_BATCH_CITATION_SCOPE_INVALID";
        }
        if (parsedBatch.data.sections.some((section) => section.classification === "fact" && section.citations.length === 0)) {
          return "WORKFLOW_REQUIREMENTS_BATCH_FACT_CITATION_INVALID";
        }
        if (sectionNumbers.includes(26) && parsedBatch.data.acceptanceCriteria.length === 0) {
          return "WORKFLOW_REQUIREMENTS_BATCH_ACCEPTANCE_INVALID";
        }
        return null;
      };
      let failureCode = batchFailureCode();
      if (failureCode) {
        const repair = buildArtifactPrompt({
          kind,
          projectName,
          evidence,
          requirementSectionNumbers: sectionNumbers,
          previousOutput: batchResult.text,
          validationFailure: failureCode,
        });
        const repaired = await gateway.generate({ ...repair, purpose: "workflow_artifact_repair" });
        batchResult = {
          ...repaired,
          inputTokens: sumUsage(batchResult.inputTokens, repaired.inputTokens),
          outputTokens: sumUsage(batchResult.outputTokens, repaired.outputTokens),
          totalTokens: sumUsage(batchResult.totalTokens, repaired.totalTokens),
          latencyMs: batchResult.latencyMs + repaired.latencyMs,
        };
        parsedBatch = requirementsDocumentBatchSchema.safeParse(
          normalizeRequirementsDocumentBatch(parseJson(batchResult.text)),
        );
        failureCode = batchFailureCode();
      }
      if (failureCode) {
        await getDb().update(workflowExecution).set({ status: "failed", failureCode, completedAt: new Date() }).where(eq(workflowExecution.id, executionId));
        throw new WorkflowError(422, "WORKFLOW_AI_OUTPUT_INVALID", "AI 产物未通过分批结构或引用校验");
      }
      if (!parsedBatch.success) throw new WorkflowError(422, "WORKFLOW_AI_OUTPUT_INVALID", "AI 产物批次状态无效");
      sections.push(...parsedBatch.data.sections.map((section) => ({
        ...section,
        title: REQUIREMENTS_SECTION_TITLES[section.number - 1],
      })));
      acceptanceCriteria.push(...parsedBatch.data.acceptanceCriteria);
      aggregate = aggregate
        ? {
            ...batchResult,
            fallbackUsed: aggregate.fallbackUsed || batchResult.fallbackUsed,
            inputTokens: sumUsage(aggregate.inputTokens, batchResult.inputTokens),
            outputTokens: sumUsage(aggregate.outputTokens, batchResult.outputTokens),
            totalTokens: sumUsage(aggregate.totalTokens, batchResult.totalTokens),
            latencyMs: aggregate.latencyMs + batchResult.latencyMs,
          }
        : batchResult;
    }
    const parsed = artifactSchemas[kind].safeParse({
      sections,
      acceptanceCriteria: [...new Set(acceptanceCriteria)].slice(0, 100),
    });
    if (!aggregate || !parsed.success || !validateCitationLabels(parsed.data, allowedLabels)) {
      await getDb().update(workflowExecution).set({ status: "failed", failureCode: "WORKFLOW_AI_OUTPUT_INVALID", completedAt: new Date() }).where(eq(workflowExecution.id, executionId));
      throw new WorkflowError(422, "WORKFLOW_AI_OUTPUT_INVALID", "AI 需求文档未通过最终结构或引用校验");
    }
    result = aggregate;
    content = parsed.data as unknown as Record<string, unknown>;
  } else {
    const prompts = buildArtifactPrompt({ kind, projectName, evidence });
    const maxOutputTokens = ["ga4_measurement_plan", "action_plan"].includes(kind) ? 4_096 : undefined;
    result = await gateway.generate({ ...prompts, purpose: "workflow_artifact", maxOutputTokens });
    let normalized = kind === "ga4_measurement_plan"
      ? normalizeGa4MeasurementPlan(parseJson(result.text))
      : kind === "action_plan"
        ? normalizeActionPlan(parseJson(result.text))
        : parseJson(result.text);
    let parsed = artifactSchemas[kind].safeParse(normalized);
    const validationFailure = () => {
      if (!parsed.success) return describeArtifactSchemaFailure(kind, normalized);
      if (!validateCitationLabels(parsed.data, allowedLabels)) return "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID";
      if (kind === "ga4_measurement_plan" && !validateGa4MeasurementIdGrounding(parsed.data, evidence.map((item) => item.content))) {
        return "WORKFLOW_GA4_MEASUREMENT_ID_UNGROUNDED";
      }
      if (kind === "action_plan" && !validateActionPlanDateGrounding(parsed.data, evidence.map((item) => item.content))) {
        return "WORKFLOW_ACTION_DATE_UNGROUNDED";
      }
      return null;
    };
    let failureCode = validationFailure();
    if (failureCode) {
      const repair = buildArtifactPrompt({ kind, projectName, evidence, previousOutput: result.text, validationFailure: failureCode });
      const repaired = await gateway.generate({ ...repair, purpose: "workflow_artifact_repair", maxOutputTokens });
      result = {
        ...repaired,
        fallbackUsed: result.fallbackUsed || repaired.fallbackUsed,
        inputTokens: sumUsage(result.inputTokens, repaired.inputTokens),
        outputTokens: sumUsage(result.outputTokens, repaired.outputTokens),
        totalTokens: sumUsage(result.totalTokens, repaired.totalTokens),
        latencyMs: result.latencyMs + repaired.latencyMs,
      };
      normalized = kind === "ga4_measurement_plan"
        ? normalizeGa4MeasurementPlan(parseJson(result.text))
        : kind === "action_plan"
          ? normalizeActionPlan(parseJson(result.text))
          : parseJson(result.text);
      parsed = artifactSchemas[kind].safeParse(normalized);
      failureCode = validationFailure();
    }
    if (failureCode || !parsed.success) {
      await getDb().update(workflowExecution).set({ status: "failed", failureCode: failureCode ?? "WORKFLOW_AI_OUTPUT_INVALID", completedAt: new Date() }).where(eq(workflowExecution.id, executionId));
      throw new WorkflowError(422, "WORKFLOW_AI_OUTPUT_INVALID", "AI 产物未通过结构或引用校验");
    }
    content = parsed.data as unknown as Record<string, unknown>;
  }
  const markdown = renderArtifactMarkdown(kind, content);
  const contentDigest = createHash("sha256").update(JSON.stringify({ content, markdown })).digest("hex");
  const usedLabels = collectLabels(content);
  const sourceReferences = evidence.filter((item) => usedLabels.has(item.label)).map((item) => ({ documentId: item.documentId, versionId: item.versionId, chunkId: item.chunkId, locator: item.locator }));
  await getDb().transaction(async (tx) => {
    const artifactId = existing?.id ?? randomUUID();
    const version = (existing?.currentVersion ?? 0) + 1;
    if (!existing) await tx.insert(workflowArtifact).values({ id: artifactId, runId: run.id, projectId: run.projectId, artifactKind: kind, title: artifactTitle(kind), status: "awaiting_review", currentVersion: version, contentDigest });
    await tx.insert(workflowArtifactVersion).values({ id: randomUUID(), artifactId, projectId: run.projectId, version, content, markdown, sourceReferences, contentDigest, createdBy: run.creatorId });
    if (existing) await tx.update(workflowArtifact).set({ currentVersion: version, contentDigest, status: "awaiting_review", publishedDocumentId: null, publishedDocumentVersionId: null, publishedAt: null, updatedAt: new Date() }).where(and(eq(workflowArtifact.id, existing.id), eq(workflowArtifact.projectId, existing.projectId), eq(workflowArtifact.currentVersion, existing.currentVersion)));
  });
  await finishStep(run, executionId, { provider: result.provider, actualModel: result.actualModel, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, resultDigest: contentDigest });
}

async function insertMeetingArtifact(input: {
  run: typeof workflowRun.$inferSelect;
  kind: "meeting_transcript" | "meeting_minutes" | "meeting_actions";
  title: string;
  content: Record<string, unknown>;
  markdown: string;
}) {
  const [existing] = await getDb().select({ id: workflowArtifact.id }).from(workflowArtifact).where(and(
    eq(workflowArtifact.runId, input.run.id),
    eq(workflowArtifact.projectId, input.run.projectId),
    eq(workflowArtifact.artifactKind, input.kind),
  )).limit(1);
  if (existing) return;
  const contentDigest = createHash("sha256").update(JSON.stringify({ content: input.content, markdown: input.markdown })).digest("hex");
  await getDb().transaction(async (tx) => {
    const artifactId = randomUUID();
    await tx.insert(workflowArtifact).values({ id: artifactId, runId: input.run.id, projectId: input.run.projectId, artifactKind: input.kind, title: input.title, status: "awaiting_review", currentVersion: 1, contentDigest });
    await tx.insert(workflowArtifactVersion).values({ id: randomUUID(), artifactId, projectId: input.run.projectId, version: 1, content: input.content, markdown: input.markdown, sourceReferences: [], contentDigest, createdBy: input.run.creatorId });
  });
}

async function processMeetingRun(run: typeof workflowRun.$inferSelect) {
  const [job] = await getDb().select().from(workflowAudioJob).where(and(eq(workflowAudioJob.runId, run.id), eq(workflowAudioJob.projectId, run.projectId))).limit(1);
  const [source] = await getDb().select().from(workflowRunSource).where(and(eq(workflowRunSource.runId, run.id), eq(workflowRunSource.projectId, run.projectId), eq(workflowRunSource.sourceType, "audio"), eq(workflowRunSource.status, "ready"))).limit(1);
  if (!job || !source) throw new WorkflowError(422, "AUDIO_SOURCE_NOT_READY", "会议音视频尚未就绪");
  const provider = createAudioTranscriptionProvider();
  let taskId = job.providerTaskId;
  const transcriptionExecution = await beginStep(run, 2, "transcribing");
  if (!taskId) {
    await getDb().transaction(async (tx) => {
      await tx.update(workflowRun).set({ status: "transcribing", currentStep: 2, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
      await tx.update(workflowAudioJob).set({ status: "transcribing", updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
    });
    const submitted = await provider.submit(await buildAudioProviderUrl(run.id, source.id));
    taskId = submitted.taskId;
    await getDb().update(workflowAudioJob).set({ providerTaskId: taskId, providerTaskIdHash: createHash("sha256").update(taskId).digest("hex"), updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
  }
  const started = Date.now();
  const result = await provider.poll(taskId);
  if (result.status === "pending" || result.status === "running") {
    await finishStep(run, transcriptionExecution, {
      provider: provider.provider,
      actualModel: provider.model,
      latencyMs: Date.now() - started,
      resultDigest: createHash("sha256").update(`audio-poll:${result.status}`).digest("hex"),
    });
    await getDb().transaction(async (tx) => {
      await tx.update(workflowAudioJob).set({ status: "transcribing", updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
      await tx.update(workflowRun).set({
        status: "transcribing", currentStep: 2, leasedBy: null, leaseToken: null,
        leaseExpiresAt: null, heartbeatAt: null,
        nextAttemptAt: sql`now() + interval '10 seconds'`, updatedAt: new Date(),
      }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
    });
    return;
  }
  if (result.status === "failed") throw new WorkflowError(503, result.code, "会议转写失败");
  const speakerKeys = [...new Set(result.segments.map((segment) => segment.speakerKey))].sort();
  const existingSpeakers = await getDb().select().from(transcriptSpeaker).where(and(eq(transcriptSpeaker.runId, run.id), eq(transcriptSpeaker.projectId, run.projectId)));
  const existingByKey = new Map(existingSpeakers.map((speaker) => [speaker.speakerKey, speaker]));
  const speakers = speakerKeys.map((speakerKey, index) => ({
    id: existingByKey.get(speakerKey)?.id ?? randomUUID(),
    speakerKey,
    displayName: existingByKey.get(speakerKey)?.displayName ?? `Speaker ${index + 1}`,
  }));
  const newSpeakers = speakers.filter((speaker) => !existingByKey.has(speaker.speakerKey));
  const speakerByKey = new Map(speakers.map((speaker) => [speaker.speakerKey, speaker]));
  const segments = result.segments.map((segment, index) => ({
    id: randomUUID(), label: `S${index + 1}`, sequence: index + 1,
    startMs: segment.startMs, endMs: segment.endMs,
    speakerId: speakerByKey.get(segment.speakerKey)!.id,
    speakerName: speakerByKey.get(segment.speakerKey)!.displayName,
    text: segment.text, confidenceBps: segment.confidenceBps, language: segment.language,
  }));
  await getDb().transaction(async (tx) => {
    await tx.update(workflowRun).set({ status: "diarizing", currentStep: 3, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
    await tx.update(workflowAudioJob).set({ status: "diarizing", updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
    if (newSpeakers.length) await tx.insert(transcriptSpeaker).values(newSpeakers.map((speaker) => ({ ...speaker, runId: run.id, projectId: run.projectId })));
    await tx.insert(transcriptSegment).values(segments.map((segment) => ({
      id: segment.id, runId: run.id, projectId: run.projectId, sequence: segment.sequence,
      startMs: segment.startMs, endMs: segment.endMs, speakerId: segment.speakerId,
      text: segment.text, confidenceBps: segment.confidenceBps, language: segment.language,
      sourceDigest: createHash("sha256").update(`${source.sha256}:${segment.startMs}:${segment.endMs}:${segment.text}`).digest("hex"),
    }))).onConflictDoNothing({ target: [transcriptSegment.runId, transcriptSegment.sequence] });
    await tx.update(workflowAudioJob).set({ status: "normalizing", updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
  });
  await finishStep(run, transcriptionExecution, { provider: provider.provider, actualModel: provider.model, latencyMs: Date.now() - started, resultDigest: createHash("sha256").update(JSON.stringify(segments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, speakerName: segment.speakerName, text: segment.text })))).digest("hex") });
  const transcriptContent = { durationMs: result.durationMs, speakers, segments };
  await insertMeetingArtifact({ run, kind: "meeting_transcript", title: "完整会议转写", content: transcriptContent, markdown: renderArtifactMarkdown("meeting_transcript", transcriptContent) });
  await getDb().update(workflowRun).set({ status: "summarizing", currentStep: 5, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
  await getDb().update(workflowAudioJob).set({ status: "summarizing", updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
  const summaryExecution = await beginStep(run, 5, "summarizing");
  const summaryResult = await createMeetingSummaryProvider().summarize(segments.map((segment) => ({ id: segment.label, startMs: segment.startMs, endMs: segment.endMs, speaker: segment.speakerName, text: segment.text })));
  const summary = summaryResult.content;
  const meetingContent = summary as unknown as Record<string, unknown>;
  const actionsContent = { actions: summary.actions };
  await insertMeetingArtifact({ run, kind: "meeting_minutes", title: "会议纪要", content: meetingContent, markdown: renderArtifactMarkdown("meeting_minutes", meetingContent) });
  await insertMeetingArtifact({ run, kind: "meeting_actions", title: "会议待办", content: actionsContent, markdown: renderArtifactMarkdown("meeting_actions", actionsContent) });
  await finishStep(run, summaryExecution, { provider: summaryResult.provider, actualModel: summaryResult.actualModel, latencyMs: summaryResult.latencyMs, inputTokens: summaryResult.inputTokens, outputTokens: summaryResult.outputTokens, resultDigest: createHash("sha256").update(JSON.stringify(summary)).digest("hex") });
  await getDb().transaction(async (tx) => {
    await tx.update(workflowAudioJob).set({ status: "awaiting_review", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(workflowAudioJob.id, job.id), eq(workflowAudioJob.projectId, run.projectId)));
    await tx.update(workflowRun).set({ status: "awaiting_review", currentStep: 10, leasedBy: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
  });
}

export async function processWorkflowRun(run: typeof workflowRun.$inferSelect) {
  if (run.workflowType === "meeting_minutes") return processMeetingRun(run);
  if (run.workflowType !== "requirement_framework") throw new WorkflowError(422, "WORKFLOW_TYPE_NOT_SUPPORTED", "该工作流类型尚未接入当前执行器");
  const evidence = await evidenceForRun(run);
  if (run.regenerationArtifactKind) {
    const kind = run.regenerationArtifactKind as RequirementArtifactKind;
    const index = REQUIREMENT_ARTIFACT_KINDS.indexOf(kind);
    if (index < 0) throw new WorkflowError(422, "WORKFLOW_ARTIFACT_NOT_REGENERATABLE", "重新生成产物类型无效");
    const projectName = run.displayName.split(" · ")[0] || "当前项目";
    await generateArtifact(run, projectName, kind, evidence, index + 5, true);
    const consistencyExecution = await beginStep(run, 9);
    await finishStep(run, consistencyExecution, { resultDigest: createHash("sha256").update(`regenerated:${kind}`).digest("hex") });
    const reviewExecution = await beginStep(run, 10);
    await finishStep(run, reviewExecution);
    await getDb().update(workflowRun).set({ status: "awaiting_review", currentStep: 10, regenerationArtifactKind: null, leasedBy: null, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
    return;
  }
  for (let step = 1; step <= 4; step += 1) {
    const executionId = await beginStep(run, step);
    await finishStep(run, executionId, { resultDigest: createHash("sha256").update(JSON.stringify({ step, evidence: evidence.map((item) => item.label) })).digest("hex") });
  }
  const projectName = run.displayName.split(" · ")[0] || "当前项目";
  for (let index = 0; index < REQUIREMENT_ARTIFACT_KINDS.length; index += 1) {
    await generateArtifact(run, projectName, REQUIREMENT_ARTIFACT_KINDS[index], evidence, index + 5);
  }
  const consistencyExecution = await beginStep(run, 9);
  const artifacts = await getDb().select({ kind: workflowArtifact.artifactKind }).from(workflowArtifact).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId)));
  if (artifacts.length !== 4) throw new WorkflowError(422, "WORKFLOW_ARTIFACTS_INCOMPLETE", "工作流产物不完整");
  await finishStep(run, consistencyExecution, { resultDigest: createHash("sha256").update(JSON.stringify(artifacts)).digest("hex") });
  const reviewExecution = await beginStep(run, 10);
  await finishStep(run, reviewExecution);
  await getDb().update(workflowRun).set({
    status: "awaiting_review", currentStep: 10, leasedBy: null, leaseToken: null,
    leaseExpiresAt: null, heartbeatAt: null, updatedAt: new Date(),
  }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
}

async function wait(milliseconds: number, signal?: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export async function runWorkflowWorker(options: { once?: boolean; signal?: AbortSignal; workerId?: string } = {}) {
  const workerConfig = config();
  const workerId = options.workerId ?? `workflow-worker-${randomUUID()}`;
  await writeFile(workerConfig.heartbeatFile, `${Date.now()} ${workerId}\n`, { mode: 0o600 });
  do {
    if (options.signal?.aborted) break;
    const run = await claimWorkflowRun(workerId, workerConfig);
    if (!run) { if (options.once) break; await wait(workerConfig.pollMs, options.signal); continue; }
    const controller = new AbortController();
    const heartbeat = (async () => {
      while (!controller.signal.aborted) {
        await wait(workerConfig.leaseSeconds * 1_000 / 3, controller.signal);
        if (controller.signal.aborted) return;
        if (!await renew(run.id, run.projectId, workerId, run.leaseToken!, workerConfig)) { controller.abort(); return; }
        await writeFile(workerConfig.heartbeatFile, `${Date.now()} ${workerId}\n`, { mode: 0o600 });
      }
    })();
    try { await processWorkflowRun(run); }
    catch (error) {
      if (!(error instanceof WorkflowError) || !["WORKFLOW_CANCELLED", "WORKFLOW_LEASE_LOST"].includes(error.code)) {
        const failureCode = error instanceof WorkflowError ? error.code : "WORKFLOW_WORKER_FAILED";
        await getDb().transaction(async (tx) => {
          await tx.update(workflowExecution).set({
            status: "failed", failureCode, completedAt: new Date(),
          }).where(and(eq(workflowExecution.runId, run.id), eq(workflowExecution.projectId, run.projectId), eq(workflowExecution.status, "running")));
          await tx.update(workflowRun).set({
            status: "failed", failureCode,
            failureStep: sql`${workflowRun.currentStep}`, leasedBy: null, leaseToken: null, leaseExpiresAt: null,
            heartbeatAt: null, completedAt: new Date(), updatedAt: new Date(),
          }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId), eq(workflowRun.leaseToken, run.leaseToken!)));
          if (run.workflowType === "meeting_minutes") {
            await tx.update(workflowAudioJob).set({ status: "failed", failureCode, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(workflowAudioJob.runId, run.id), eq(workflowAudioJob.projectId, run.projectId)));
          }
        });
      }
    } finally { controller.abort(); await heartbeat; }
  } while (!options.once);
}
