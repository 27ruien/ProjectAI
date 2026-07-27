import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { listAuthorizedProjects } from "@/lib/db/repositories/project-repository";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import {
  documentIngestionJob,
  knowledgeSpace,
  projectDocument,
  projectDocumentVersion,
  workflowArtifact,
  workflowArtifactVersion,
  workflowDefinition,
  workflowExecution,
  workflowExport,
  workflowReview,
  workflowRun,
  workflowRunSource,
  transcriptSegment,
  transcriptSpeaker,
  workflowAudioJob,
} from "@/lib/db/schema";
import { includeTestFixturesInProductQueries } from "@/lib/test-fixtures/service";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { listUploadableKnowledgeSpaces } from "@/lib/knowledge/management";
import { uploadDocument } from "@/lib/files/document-service";
import {
  REQUIREMENT_ARTIFACT_KINDS,
  validateCitationLabels,
  workflowArtifactSchemas,
  type WorkflowArtifactKind,
  type RequirementArtifactKind,
  type WorkflowType,
} from "./contracts";
import { WorkflowError } from "./errors";
import { canonicalJsonDigest } from "./digest";
import { getObjectStorage } from "@/lib/files/object-storage";
import { renderArtifactMarkdown } from "./render";
import { isTrustedWorkflowModelProfile } from "./model-profiles";

const EDIT_ROLES = ["project_manager", "project_member"] as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function artifactDigest(content: Record<string, unknown>, markdown: string): string {
  return canonicalJsonDigest({ content, markdown });
}

function deterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function referenceLabels(
  references: Array<Record<string, unknown>>,
): Set<string> | null {
  const labels = references.map((reference) => reference.label);
  if (
    labels.some(
      (label) => typeof label !== "string" || !/^E[1-9][0-9]?$/.test(label),
    )
  ) {
    return null;
  }
  const unique = new Set(labels as string[]);
  return unique.size === labels.length ? unique : null;
}

function collectReferencedLabels(
  value: unknown,
  output = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectReferencedLabels(child, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        (key === "citations" || key === "sourceCitation") &&
        typeof child === "string" &&
        /^E[1-9][0-9]?$/.test(child)
      ) {
        output.add(child);
      }
      if (
        (key === "citations" || key === "segmentIds") &&
        Array.isArray(child)
      ) {
        for (const label of child) {
          if (typeof label === "string" && /^E[1-9][0-9]?$/.test(label)) {
            output.add(label);
          }
        }
      }
      collectReferencedLabels(child, output);
    }
  }
  return output;
}

type EvidenceReference = {
  label?: string;
  documentId: string;
  versionId: string;
  chunkId?: string;
  locator?: unknown;
};

function referenceIdentity(reference: EvidenceReference): string | null {
  const { documentId, versionId, chunkId } = reference;
  if (
    typeof documentId !== "string" ||
    typeof versionId !== "string" ||
    typeof chunkId !== "string"
  ) {
    return null;
  }
  return `${documentId}:${versionId}:${chunkId}`;
}

async function currentRunReferenceMap(input: {
  db: DatabaseExecutor;
  runId: string;
  projectId: string;
}): Promise<Map<string, EvidenceReference>> {
  const versions = await input.db
    .select({ sourceReferences: workflowArtifactVersion.sourceReferences })
    .from(workflowArtifact)
    .innerJoin(
      workflowArtifactVersion,
      and(
        eq(workflowArtifactVersion.artifactId, workflowArtifact.id),
        eq(workflowArtifactVersion.projectId, workflowArtifact.projectId),
        eq(workflowArtifactVersion.version, workflowArtifact.currentVersion),
      ),
    )
    .where(
      and(
        eq(workflowArtifact.runId, input.runId),
        eq(workflowArtifact.projectId, input.projectId),
      ),
    );
  const references = new Map<string, EvidenceReference>();
  const labelsByIdentity = new Map<string, string>();
  for (const version of versions) {
    for (const reference of version.sourceReferences) {
      const label = reference.label;
      const identity = referenceIdentity(reference);
      if (typeof label !== "string" || !/^E[1-9][0-9]?$/.test(label) || !identity) {
        throw new WorkflowError(409, "WORKFLOW_ARTIFACT_INTEGRITY_INVALID", "产物引用映射已失效，需要重新生成");
      }
      const existing = references.get(label);
      if (existing && referenceIdentity(existing) !== identity) {
        throw new WorkflowError(409, "WORKFLOW_ARTIFACT_INTEGRITY_INVALID", "产物引用标签存在冲突，需要重新生成");
      }
      const existingLabel = labelsByIdentity.get(identity);
      if (existingLabel && existingLabel !== label) {
        throw new WorkflowError(409, "WORKFLOW_ARTIFACT_INTEGRITY_INVALID", "产物来源存在重复引用标签，需要重新生成");
      }
      references.set(label, reference);
      labelsByIdentity.set(identity, label);
    }
  }
  return references;
}

function validateTranscriptLabels(
  content: Record<string, unknown>,
  allowedLabels: Set<string>,
): boolean {
  const segments = content.segments;
  return (
    Array.isArray(segments) &&
    segments.length === allowedLabels.size &&
    segments.every(
      (segment) =>
        segment !== null &&
        typeof segment === "object" &&
        "label" in segment &&
        typeof segment.label === "string" &&
        allowedLabels.has(segment.label),
    )
  );
}

export type WorkflowRunPayload = {
  id: string;
  projectId: string;
  organizationId: string;
  departmentId: string | null;
  workflowType: WorkflowType;
  displayName: string;
  creatorId: string;
  creatorName?: string;
  status: string;
  currentStep: number;
  version: number;
  modelProfileId: string;
  sourceCount: number;
  artifactCount: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  legacyReadOnly: boolean;
};

export type WorkflowArtifactPayload = {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  status: string;
  currentVersion: number;
  content: Record<string, unknown>;
  markdown: string;
  sourceReferences: Array<Record<string, unknown>>;
  contentDigest: string;
  updatedAt: string;
};

export async function listWorkflowRuns(input: {
  principal: AuthenticatedPrincipal;
  projectId?: string;
  limit?: number;
}): Promise<WorkflowRunPayload[]> {
  const authorized = await listAuthorizedProjects(
    input.principal.user.id,
    input.principal.user.productRole,
  );
  const projectIds = input.projectId
    ? authorized.filter((item) => item.id === input.projectId).map((item) => item.id)
    : authorized.map((item) => item.id);
  if (input.projectId && projectIds.length === 0) {
    throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
  }
  if (projectIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      run: workflowRun,
      sourceCount: sql<number>`(select count(*)::integer from workflow_run_sources source where source.run_id = ${workflowRun.id} and source.project_id = ${workflowRun.projectId})`,
      artifactCount: sql<number>`(select count(*)::integer from workflow_artifacts artifact where artifact.run_id = ${workflowRun.id} and artifact.project_id = ${workflowRun.projectId})`,
    })
    .from(workflowRun)
    .where(inArray(workflowRun.projectId, projectIds))
    .orderBy(desc(workflowRun.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 30, 1), 100));
  return rows.map(({ run, sourceCount, artifactCount }) => serializeRun(run, sourceCount, artifactCount));
}

function serializeRun(
  run: typeof workflowRun.$inferSelect,
  sourceCount = 0,
  artifactCount = 0,
): WorkflowRunPayload {
  return {
    id: run.id,
    projectId: run.projectId,
    organizationId: run.organizationId,
    departmentId: run.departmentId,
    workflowType: run.workflowType as WorkflowType,
    displayName: run.displayName,
    creatorId: run.creatorId,
    status: run.status,
    currentStep: run.currentStep,
    version: run.version,
    modelProfileId: run.modelProfileId,
    sourceCount,
    artifactCount,
    failureCode: run.failureCode,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: iso(run.completedAt),
    legacyReadOnly: Boolean(run.legacyRequirementRunId),
  };
}

type SourceRow = {
  document: typeof projectDocument.$inferSelect;
  version: typeof projectDocumentVersion.$inferSelect;
  spaceType: string;
  spaceId: string;
  sourceProjectId: string;
};

async function authorizedSources(input: {
  projectId: string;
  principal: AuthenticatedPrincipal;
  documentIds: string[];
  temporaryWorkflowId?: string;
  db: DatabaseExecutor;
}): Promise<SourceRow[]> {
  if (input.documentIds.length === 0 || input.documentIds.length > 20) {
    throw new WorkflowError(400, "WORKFLOW_SOURCE_REQUIRED", "请选择 1 至 20 份授权资料");
  }
  const uniqueIds = [...new Set(input.documentIds)];
  const authorized = await listAuthorizedDocumentScope({
    principal: input.principal,
    projectId: input.projectId,
    permission: "view",
    db: input.db,
  });
  const scopeByDocument = new Map(authorized.map((scope) => [scope.documentId, scope]));
  if (uniqueIds.some((documentId) => !scopeByDocument.has(documentId))) {
    throw new WorkflowError(404, "WORKFLOW_SOURCE_NOT_FOUND", "所选资料不可用或不在当前授权范围内");
  }
  const rows = await input.db
    .select({ document: projectDocument, version: projectDocumentVersion, spaceType: knowledgeSpace.type, spaceId: knowledgeSpace.id })
    .from(projectDocument)
    .innerJoin(projectDocumentVersion, and(
      eq(projectDocumentVersion.documentId, projectDocument.id),
      eq(projectDocumentVersion.projectId, projectDocument.projectId),
      eq(projectDocumentVersion.isCurrent, true),
      eq(projectDocumentVersion.storageStatus, "stored"),
    ))
    .innerJoin(knowledgeSpace, eq(knowledgeSpace.id, projectDocument.knowledgeSpaceId))
    .innerJoin(documentIngestionJob, and(
      eq(documentIngestionJob.projectId, projectDocument.projectId),
      eq(documentIngestionJob.documentId, projectDocument.id),
      eq(documentIngestionJob.versionId, projectDocumentVersion.id),
      eq(documentIngestionJob.status, "succeeded"),
    ))
    .where(and(
      eq(projectDocument.status, "active"),
      inArray(projectDocument.id, uniqueIds),
      sql`${projectDocument.workflowTemporary} = false or (${projectDocument.temporaryWorkflowId} = ${input.temporaryWorkflowId ?? ""} and ${projectDocument.temporaryExpiresAt} > now())`,
    ));
  const byId = new Map(rows.map((row) => [row.document.id, row]));
  if (byId.size !== uniqueIds.length) {
    throw new WorkflowError(404, "WORKFLOW_SOURCE_NOT_FOUND", "所选资料不可用或不在当前授权项目内");
  }
  if (!includeTestFixturesInProductQueries()) {
    const fixtureCheck = await input.db.execute<{ entity_id: string }>(sql`
      select entity_id from test_fixtures
      where is_test_fixture = true and entity_type = 'document'
        and entity_id in (${sql.join(uniqueIds.map((documentId) => sql`${documentId}`), sql`, `)})
      limit 1
    `);
    if (fixtureCheck.rows.length) throw new WorkflowError(404, "WORKFLOW_SOURCE_NOT_FOUND", "所选资料不可用或不在当前授权项目内");
  }
  return uniqueIds.map((id) => ({
    ...byId.get(id)!,
    spaceType: scopeByDocument.get(id)!.sourceScope,
    spaceId: scopeByDocument.get(id)!.knowledgeSpaceId,
    sourceProjectId: scopeByDocument.get(id)!.sourceProjectId,
  }));
}

export async function createRequirementFrameworkRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentIds: string[];
  idempotencyKey: string;
  temporaryWorkflowId?: string;
  requestHeaders: Headers;
}): Promise<{ run: WorkflowRunPayload; created: boolean }> {
  const idempotencyKeyHash = digest(input.idempotencyKey);
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.projectId}:${input.principal.user.id}:${idempotencyKeyHash}:workflow`}, 0))`);
    const target = await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders, { db: tx, lockForUpdate: true });
    if (!target.departmentId) throw new WorkflowError(422, "WORKFLOW_DEPARTMENT_REQUIRED", "项目必须归属有效部门后才能运行工作流");
    const [existing] = await tx.select().from(workflowRun).where(and(
      eq(workflowRun.projectId, input.projectId),
      eq(workflowRun.creatorId, input.principal.user.id),
      eq(workflowRun.idempotencyKeyHash, idempotencyKeyHash),
    )).limit(1);
    if (existing) return { run: serializeRun(existing), created: false };
    const sources = await authorizedSources({ ...input, db: tx });
    const [definition] = await tx.select().from(workflowDefinition).where(and(
      eq(workflowDefinition.workflowType, "requirement_framework"),
      eq(workflowDefinition.isActive, true),
    )).orderBy(desc(workflowDefinition.version)).limit(1);
    if (!definition) throw new WorkflowError(503, "WORKFLOW_DEFINITION_MISSING", "工作流定义尚未就绪");
    if (!isTrustedWorkflowModelProfile("requirement_framework", definition.modelProfileId)) {
      throw new WorkflowError(503, "WORKFLOW_MODEL_PROFILE_INVALID", "工作流模型配置无效");
    }
    const scope = {
      documentIds: sources.map((item) => item.document.id),
      knowledgeSpaceIds: [...new Set(sources.map((item) => item.spaceId))],
    };
    const runId = randomUUID();
    const now = new Date();
    const displayDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);
    const [created] = await tx.insert(workflowRun).values({
      id: runId,
      definitionId: definition.id,
      organizationId: target.organizationId,
      departmentId: target.departmentId,
      projectId: target.id,
      workflowType: "requirement_framework",
      creatorId: input.principal.user.id,
      displayName: `${target.name} · 需求框架 · ${displayDate}`,
      authorizedSourceScope: scope,
      sourceScopeDigest: digest(scope),
      modelProfileId: definition.modelProfileId,
      status: "queued",
      currentStep: 1,
      idempotencyKeyHash,
    }).returning();
    await tx.insert(workflowRunSource).values(sources.map((item) => ({
      id: randomUUID(),
      runId,
      projectId: target.id,
      sourceProjectId: item.sourceProjectId,
      sourceType: item.document.workflowTemporary
        ? "temporary_document"
        : item.spaceType === "organization"
          ? "organization_document"
          : item.spaceType === "department"
            ? "department_document"
            : "project_document",
      documentId: item.document.id,
      documentVersionId: item.version.id,
      displayName: item.document.displayName,
      mimeType: item.version.detectedMimeType,
      sizeBytes: Math.min(item.version.sizeBytes, 2_147_483_647),
      sha256: item.version.sha256,
      status: "ready",
      expiresAt: item.document.temporaryExpiresAt,
    })));
    await writeAuditEvent({
      actorUserId: input.principal.user.id,
      projectId: target.id,
      eventType: "workflow.run_queued",
      entityType: "workflow_run",
      entityId: runId,
      result: "succeeded",
      metadata: { workflowType: "requirement_framework", sourceCount: sources.length },
    }, tx);
    return { run: serializeRun(created, sources.length, 0), created: true };
  });
}

export async function readWorkflowRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders?: Headers;
}): Promise<{ run: WorkflowRunPayload; artifacts: WorkflowArtifactPayload[] }> {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const db = getDb();
  const [record] = await db.select().from(workflowRun).where(and(
    eq(workflowRun.id, input.runId),
    eq(workflowRun.projectId, input.projectId),
  )).limit(1);
  if (!record) throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
  const sources = await db.select({ id: workflowRunSource.id }).from(workflowRunSource).where(and(eq(workflowRunSource.runId, record.id), eq(workflowRunSource.projectId, record.projectId)));
  const artifacts = await db
    .select({ artifact: workflowArtifact, version: workflowArtifactVersion })
    .from(workflowArtifact)
    .innerJoin(workflowArtifactVersion, and(
      eq(workflowArtifactVersion.artifactId, workflowArtifact.id),
      eq(workflowArtifactVersion.projectId, workflowArtifact.projectId),
      eq(workflowArtifactVersion.version, workflowArtifact.currentVersion),
    ))
    .where(and(eq(workflowArtifact.runId, record.id), eq(workflowArtifact.projectId, record.projectId)))
    .orderBy(asc(workflowArtifact.createdAt));
  return {
    run: serializeRun(record, sources.length, artifacts.length),
    artifacts: artifacts.map(({ artifact, version }) => ({
      id: artifact.id,
      projectId: artifact.projectId,
      kind: artifact.artifactKind,
      title: artifact.title,
      status: artifact.status,
      currentVersion: artifact.currentVersion,
      content: version.content,
      markdown: version.markdown,
      sourceReferences: version.sourceReferences,
      contentDigest: version.contentDigest,
      updatedAt: artifact.updatedAt.toISOString(),
    })),
  };
}

export async function cancelWorkflowRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(and(
      eq(workflowRun.id, input.runId),
      eq(workflowRun.projectId, input.projectId),
    )).limit(1).for("update", { of: workflowRun });
    if (!run) throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
    if (["published", "cancelled", "legacy_read_only"].includes(run.status)) return;
    const cancelsImmediately = run.status === "queued" || !run.leaseToken;
    await tx.update(workflowRun).set(
      cancelsImmediately
      ? { status: "cancelled", cancellationRequestedAt: now, completedAt: now, updatedAt: now }
      : { cancellationRequestedAt: now, updatedAt: now },
    ).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId)));
    if (cancelsImmediately) {
      await tx.update(workflowExecution).set({
        status: "cancelled",
        failureCode: "WORKFLOW_CANCELLED",
        completedAt: now,
      }).where(and(
        eq(workflowExecution.runId, run.id),
        eq(workflowExecution.projectId, run.projectId),
        eq(workflowExecution.status, "running"),
      ));
    }
    if (run.workflowType === "meeting_minutes" && cancelsImmediately) {
      await tx.update(workflowAudioJob).set({ status: "cancelled", completedAt: now, updatedAt: now }).where(and(eq(workflowAudioJob.runId, run.id), eq(workflowAudioJob.projectId, run.projectId)));
    }
  });
}

export async function retryWorkflowRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders);
  await getDb().transaction(async (tx) => {
    const [current] = await tx.select({
      status: workflowRun.status,
      failureCode: workflowRun.failureCode,
    }).from(workflowRun).where(and(
      eq(workflowRun.id, input.runId),
      eq(workflowRun.projectId, input.projectId),
    )).limit(1).for("update", { of: workflowRun });
    if (!current || !["failed", "cancelled"].includes(current.status)) {
      throw new WorkflowError(409, "WORKFLOW_NOT_RETRYABLE", "当前工作流不能重试");
    }
    if (current.failureCode === "WORKFLOW_PROVIDER_RESULT_UNKNOWN") {
      throw new WorkflowError(
        409,
        "WORKFLOW_PROVIDER_RESULT_UNKNOWN",
        "Provider 结果未知，必须人工核对后创建新任务，不允许直接重放",
      );
    }
    const updated = await tx.update(workflowRun).set({
      status: "queued",
      failureCode: null,
      failureStep: null,
      cancellationRequestedAt: null,
      leasedBy: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      completedAt: null,
      nextAttemptAt: sql`now()`,
      updatedAt: new Date(),
      version: sql`${workflowRun.version} + 1`,
    }).where(and(
      eq(workflowRun.id, input.runId),
      eq(workflowRun.projectId, input.projectId),
      eq(workflowRun.status, current.status),
    )).returning({ id: workflowRun.id });
    if (updated.length !== 1) throw new WorkflowError(409, "WORKFLOW_NOT_RETRYABLE", "当前工作流不能重试");
  });
}

export async function saveArtifactVersion(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  artifactId: string;
  expectedVersion: number;
  content: Record<string, unknown>;
  requestHeaders: Headers;
}): Promise<number> {
  await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders);
  return getDb().transaction(async (tx) => {
    const [run] = await tx.select({ status: workflowRun.status }).from(workflowRun).where(and(
      eq(workflowRun.id, input.runId), eq(workflowRun.projectId, input.projectId),
    )).limit(1).for("update", { of: workflowRun });
    if (!run) throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
    if (run.status !== "awaiting_review") throw new WorkflowError(409, "WORKFLOW_EDIT_NOT_READY", "当前工作流不能编辑");
    const [artifact] = await tx.select().from(workflowArtifact).where(and(
      eq(workflowArtifact.id, input.artifactId),
      eq(workflowArtifact.projectId, input.projectId),
      eq(workflowArtifact.runId, input.runId),
    )).limit(1).for("update", { of: workflowArtifact });
    if (!artifact) throw new WorkflowError(404, "NOT_FOUND", "工作流产物不存在");
    if (artifact.currentVersion !== input.expectedVersion) throw new WorkflowError(409, "WORKFLOW_VERSION_CONFLICT", "产物已被其他用户更新，请刷新后重试");
    const [current] = await tx.select({ sourceReferences: workflowArtifactVersion.sourceReferences }).from(workflowArtifactVersion).where(and(
      eq(workflowArtifactVersion.artifactId, artifact.id),
      eq(workflowArtifactVersion.projectId, artifact.projectId),
      eq(workflowArtifactVersion.version, artifact.currentVersion),
    )).limit(1);
    if (!current) throw new WorkflowError(409, "WORKFLOW_ARTIFACT_INTEGRITY_INVALID", "产物版本已失效，需要重新生成");
    const schema = workflowArtifactSchemas[artifact.artifactKind as WorkflowArtifactKind];
    const parsed = schema?.safeParse(input.content);
    if (!parsed?.success) throw new WorkflowError(422, "WORKFLOW_ARTIFACT_SCHEMA_INVALID", "产物未通过结构校验");
    const content = parsed.data as Record<string, unknown>;
    let sourceReferences = current.sourceReferences;
    if (REQUIREMENT_ARTIFACT_KINDS.includes(artifact.artifactKind as RequirementArtifactKind)) {
      const referenceMap = await currentRunReferenceMap({ db: tx, runId: input.runId, projectId: input.projectId });
      const allowedLabels = new Set(referenceMap.keys());
      if (!validateCitationLabels(content, allowedLabels)) throw new WorkflowError(422, "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID", "产物引用不在已授权来源范围内");
      sourceReferences = [...collectReferencedLabels(content)].map((label) => referenceMap.get(label)!);
    } else {
      const segments = await tx.select({ sequence: transcriptSegment.sequence }).from(transcriptSegment).where(and(eq(transcriptSegment.runId, input.runId), eq(transcriptSegment.projectId, input.projectId)));
      const allowedLabels = new Set(segments.map((segment) => `S${segment.sequence}`));
      if (!validateCitationLabels(content, allowedLabels) || (artifact.artifactKind === "meeting_transcript" && !validateTranscriptLabels(content, allowedLabels))) {
        throw new WorkflowError(422, "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID", "会议产物引用了不存在的转写片段");
      }
    }
    const markdown = renderArtifactMarkdown(artifact.artifactKind as WorkflowArtifactKind, content);
    const nextVersion = artifact.currentVersion + 1;
    const contentDigest = artifactDigest(content, markdown);
    await tx.insert(workflowArtifactVersion).values({
      id: randomUUID(), artifactId: artifact.id, projectId: artifact.projectId,
      version: nextVersion, content, markdown,
      sourceReferences, contentDigest,
      createdBy: input.principal.user.id,
    });
    await tx.update(workflowArtifact).set({ currentVersion: nextVersion, contentDigest, status: "draft", updatedAt: new Date() }).where(and(eq(workflowArtifact.id, artifact.id), eq(workflowArtifact.projectId, artifact.projectId)));
    return nextVersion;
  });
}

export async function regenerateWorkflowArtifact(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  artifactId: string;
  expectedVersion: number;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders);
  await getDb().transaction(async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(and(eq(workflowRun.id, input.runId), eq(workflowRun.projectId, input.projectId))).limit(1).for("update", { of: workflowRun });
    if (!run) throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
    if (run.workflowType !== "requirement_framework" || run.status !== "awaiting_review") throw new WorkflowError(409, "WORKFLOW_REGENERATION_NOT_READY", "当前工作流不能重新生成产物");
    const [artifact] = await tx.select().from(workflowArtifact).where(and(eq(workflowArtifact.id, input.artifactId), eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId))).limit(1).for("update", { of: workflowArtifact });
    if (!artifact) throw new WorkflowError(404, "NOT_FOUND", "工作流产物不存在");
    if (!REQUIREMENT_ARTIFACT_KINDS.includes(artifact.artifactKind as RequirementArtifactKind)) throw new WorkflowError(422, "WORKFLOW_ARTIFACT_NOT_REGENERATABLE", "该产物不支持单独重新生成");
    if (artifact.currentVersion !== input.expectedVersion) throw new WorkflowError(409, "WORKFLOW_VERSION_CONFLICT", "产物已被其他用户更新，请刷新后重试");
    await tx.update(workflowArtifact).set({ status: "draft", updatedAt: new Date() }).where(and(eq(workflowArtifact.id, artifact.id), eq(workflowArtifact.projectId, artifact.projectId)));
    await tx.update(workflowRun).set({ status: "queued", regenerationArtifactKind: artifact.artifactKind, currentStep: 1, failureCode: null, nextAttemptAt: sql`now()`, updatedAt: new Date(), version: sql`${workflowRun.version} + 1` }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId)));
    await writeAuditEvent({ actorUserId: input.principal.user.id, projectId: input.projectId, eventType: "workflow.artifact_regeneration_queued", entityType: "workflow_artifact", entityId: artifact.id, result: "succeeded", metadata: { artifactKind: artifact.artifactKind, fromVersion: artifact.currentVersion }, ...getRequestAuditContext(input.requestHeaders) }, tx);
  });
}

type CurrentArtifact = {
  artifact: typeof workflowArtifact.$inferSelect;
  version: typeof workflowArtifactVersion.$inferSelect;
};

async function validateCurrentArtifacts(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  run: typeof workflowRun.$inferSelect;
  artifacts: CurrentArtifact[];
  db: DatabaseExecutor;
}): Promise<void> {
  const expected = input.run.workflowType === "requirement_framework" ? REQUIREMENT_ARTIFACT_KINDS.length : 3;
  if (input.artifacts.length !== expected) throw new WorkflowError(409, "WORKFLOW_ARTIFACTS_INCOMPLETE", "工作流产物不完整");
  const authorized = await listAuthorizedDocumentScope({ principal: input.principal, projectId: input.projectId, permission: "view", db: input.db });
  const authorizedDocumentIds = new Set(authorized.map((scope) => scope.documentId));
  const runSources = await input.db.select({ documentId: workflowRunSource.documentId, documentVersionId: workflowRunSource.documentVersionId, status: workflowRunSource.status }).from(workflowRunSource).where(and(eq(workflowRunSource.runId, input.run.id), eq(workflowRunSource.projectId, input.run.projectId)));
  const validSources = new Set(runSources.filter((source) => source.documentId && source.documentVersionId && source.status === "ready").map((source) => `${source.documentId}:${source.documentVersionId}`));
  const meetingSegments = input.run.workflowType === "meeting_minutes"
    ? await input.db.select({ sequence: transcriptSegment.sequence }).from(transcriptSegment).where(and(eq(transcriptSegment.runId, input.run.id), eq(transcriptSegment.projectId, input.run.projectId)))
    : [];
  const meetingLabels = new Set(meetingSegments.map((segment) => `S${segment.sequence}`));
  for (const { artifact, version } of input.artifacts) {
    const schema = workflowArtifactSchemas[artifact.artifactKind as WorkflowArtifactKind];
    const parsed = schema?.safeParse(version.content);
    if (!parsed?.success || artifactDigest(parsed.data as Record<string, unknown>, renderArtifactMarkdown(artifact.artifactKind as WorkflowArtifactKind, parsed.data as Record<string, unknown>)) !== artifact.contentDigest || artifact.contentDigest !== version.contentDigest) {
      throw new WorkflowError(409, "WORKFLOW_ARTIFACT_INTEGRITY_INVALID", "产物结构或摘要已失效，需要重新生成");
    }
    if (input.run.workflowType === "requirement_framework") {
      const allowedLabels = referenceLabels(version.sourceReferences);
      if (!allowedLabels || !validateCitationLabels(parsed.data, allowedLabels)) throw new WorkflowError(409, "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID", "产物引用不在已授权来源范围内，需要重新生成");
    } else if (!validateCitationLabels(parsed.data, meetingLabels) || (artifact.artifactKind === "meeting_transcript" && !validateTranscriptLabels(parsed.data as Record<string, unknown>, meetingLabels))) {
      throw new WorkflowError(409, "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID", "会议产物引用了不存在的转写片段");
    }
    for (const reference of version.sourceReferences) {
      if (!authorizedDocumentIds.has(reference.documentId) || !validSources.has(`${reference.documentId}:${reference.versionId}`)) {
        throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "产物引用的资料已撤权或失效，需要重新审核");
      }
    }
  }
}

export async function reviewWorkflowRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  decision: "request_changes" | "approve" | "publish";
  note?: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const db = getDb();
  const prepare = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(workflowRun).where(and(eq(workflowRun.id, input.runId), eq(workflowRun.projectId, input.projectId))).limit(1).for("update", { of: workflowRun });
    if (!run) throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
    if (run.status !== "awaiting_review") throw new WorkflowError(409, "WORKFLOW_REVIEW_NOT_READY", "工作流尚未进入审核阶段");
    const artifacts = await tx.select({ artifact: workflowArtifact, version: workflowArtifactVersion }).from(workflowArtifact).innerJoin(workflowArtifactVersion, and(eq(workflowArtifactVersion.artifactId, workflowArtifact.id), eq(workflowArtifactVersion.projectId, workflowArtifact.projectId), eq(workflowArtifactVersion.version, workflowArtifact.currentVersion))).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId))).orderBy(asc(workflowArtifact.createdAt));
    await validateCurrentArtifacts({ principal: input.principal, projectId: input.projectId, run, artifacts, db: tx });
    if (input.decision === "publish") {
      await tx.update(workflowRun).set({ status: "publishing", failureCode: null, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId)));
      return { run, artifacts, action: "publish" as const };
    }
    for (const { artifact } of artifacts) {
      await tx.insert(workflowReview).values({
        id: randomUUID(), artifactId: artifact.id, projectId: run.projectId,
        artifactVersion: artifact.currentVersion, reviewerId: input.principal.user.id,
        decision: input.decision, note: input.note?.slice(0, 2_000), snapshotDigest: artifact.contentDigest,
      });
    }
    if (input.decision === "request_changes") {
      await tx.update(workflowArtifact).set({ status: "draft", updatedAt: new Date() }).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId)));
      return { run, artifacts, action: "done" as const };
    }
    await tx.update(workflowArtifact).set({ status: "reviewed", updatedAt: new Date() }).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId)));
    return { run, artifacts, action: "done" as const };
  });
  if (prepare.action !== "publish") return;

  try {
    const spaces = await listUploadableKnowledgeSpaces({ principal: input.principal, projectId: input.projectId, requestHeaders: input.requestHeaders });
    const destination = spaces.find((space) => space.type === "project" && space.projectId === input.projectId);
    if (!destination) throw new WorkflowError(404, "WORKFLOW_PUBLISH_DESTINATION_MISSING", "当前项目没有可发布的项目知识空间");
    const uploaded = new Map<string, { documentId: string; versionId: string }>();
    for (const { artifact, version } of prepare.artifacts) {
      if (artifact.publishedDocumentId && artifact.publishedDocumentVersionId) {
        uploaded.set(artifact.id, { documentId: artifact.publishedDocumentId, versionId: artifact.publishedDocumentVersionId });
        continue;
      }
      const file = new File([version.markdown], `${artifact.title}.md`, { type: "text/markdown" });
      const result = await uploadDocument({
        principal: input.principal,
        projectId: input.projectId,
        requestHeaders: input.requestHeaders,
        idempotencyKey: deterministicUuid(`workflow-publish:${artifact.id}:v${artifact.currentVersion}:${artifact.contentDigest}`),
        file,
        displayName: `${prepare.run.displayName} · ${artifact.title}`,
        knowledgeSpaceId: destination.id,
      });
      uploaded.set(artifact.id, { documentId: result.document.id, versionId: result.version.id });
      await db.update(workflowArtifact).set({ publishedDocumentId: result.document.id, publishedDocumentVersionId: result.version.id, updatedAt: new Date() }).where(and(eq(workflowArtifact.id, artifact.id), eq(workflowArtifact.projectId, artifact.projectId), eq(workflowArtifact.currentVersion, artifact.currentVersion)));
    }
    await db.transaction(async (tx) => {
      const [run] = await tx.select().from(workflowRun).where(and(eq(workflowRun.id, prepare.run.id), eq(workflowRun.projectId, prepare.run.projectId))).limit(1).for("update", { of: workflowRun });
      if (!run || run.status !== "publishing") throw new WorkflowError(409, "WORKFLOW_PUBLISH_STATE_INVALID", "发布状态已变化");
      const current = await tx.select({ artifact: workflowArtifact, version: workflowArtifactVersion }).from(workflowArtifact).innerJoin(workflowArtifactVersion, and(eq(workflowArtifactVersion.artifactId, workflowArtifact.id), eq(workflowArtifactVersion.projectId, workflowArtifact.projectId), eq(workflowArtifactVersion.version, workflowArtifact.currentVersion))).where(and(eq(workflowArtifact.runId, run.id), eq(workflowArtifact.projectId, run.projectId)));
      await validateCurrentArtifacts({ principal: input.principal, projectId: input.projectId, run, artifacts: current, db: tx });
      for (const { artifact } of current) {
        const link = uploaded.get(artifact.id);
        if (!link) throw new WorkflowError(409, "WORKFLOW_PUBLISH_INCOMPLETE", "知识库发布未完整持久化");
        await tx.insert(workflowReview).values({ id: randomUUID(), artifactId: artifact.id, projectId: run.projectId, artifactVersion: artifact.currentVersion, reviewerId: input.principal.user.id, decision: "publish", note: input.note?.slice(0, 2_000), snapshotDigest: artifact.contentDigest });
        await tx.update(workflowArtifact).set({ status: "published", publishedDocumentId: link.documentId, publishedDocumentVersionId: link.versionId, publishedAt: new Date(), updatedAt: new Date() }).where(and(eq(workflowArtifact.id, artifact.id), eq(workflowArtifact.projectId, artifact.projectId)));
      }
      await tx.update(workflowRun).set({ status: "published", currentStep: 11, completedAt: new Date(), failureCode: null, updatedAt: new Date() }).where(and(eq(workflowRun.id, run.id), eq(workflowRun.projectId, run.projectId)));
      await writeAuditEvent({ actorUserId: input.principal.user.id, projectId: input.projectId, eventType: "workflow.published", entityType: "workflow_run", entityId: run.id, result: "succeeded", metadata: { workflowType: run.workflowType, artifactCount: current.length }, ...getRequestAuditContext(input.requestHeaders) }, tx);
    });
  } catch (error) {
    await db.update(workflowRun).set({ status: "awaiting_review", failureCode: "WORKFLOW_PUBLISH_FAILED", updatedAt: new Date() }).where(and(eq(workflowRun.id, input.runId), eq(workflowRun.projectId, input.projectId), eq(workflowRun.status, "publishing")));
    await writeAuditEvent({ actorUserId: input.principal.user.id, projectId: input.projectId, eventType: "workflow.publish_failed", entityType: "workflow_run", entityId: input.runId, result: "failed", metadata: { code: error instanceof WorkflowError ? error.code : "WORKFLOW_PUBLISH_FAILED" }, ...getRequestAuditContext(input.requestHeaders) });
    throw error;
  }
}

export async function recordWorkflowExport(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  artifactId: string;
  format: "md" | "docx" | "xlsx" | "txt";
  bytes: Uint8Array;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const [artifact] = await getDb().select().from(workflowArtifact).where(and(eq(workflowArtifact.id, input.artifactId), eq(workflowArtifact.projectId, input.projectId))).limit(1);
  if (!artifact) throw new WorkflowError(404, "NOT_FOUND", "工作流产物不存在");
  await getDb().insert(workflowExport).values({
    id: randomUUID(), artifactId: artifact.id, projectId: artifact.projectId,
    artifactVersion: artifact.currentVersion, format: input.format,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    sizeBytes: input.bytes.byteLength, createdBy: input.principal.user.id,
  });
}

export async function listRunExecutions(projectId: string, runId: string) {
  return getDb().select().from(workflowExecution).where(and(eq(workflowExecution.projectId, projectId), eq(workflowExecution.runId, runId))).orderBy(asc(workflowExecution.step), asc(workflowExecution.attempt));
}

function replaceSpeaker(value: unknown, previous: string, next: string): unknown {
  if (typeof value === "string") return value === previous ? next : value.replaceAll(previous, next);
  if (Array.isArray(value)) return value.map((item) => replaceSpeaker(item, previous, next));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceSpeaker(item, previous, next)]));
  return value;
}

export async function renameTranscriptSpeaker(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  speakerId: string;
  displayName: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, EDIT_ROLES, input.requestHeaders);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 160) throw new WorkflowError(400, "SPEAKER_NAME_INVALID", "说话人名称无效");
  await getDb().transaction(async (tx) => {
    const [speaker] = await tx.select().from(transcriptSpeaker).where(and(eq(transcriptSpeaker.id, input.speakerId), eq(transcriptSpeaker.runId, input.runId), eq(transcriptSpeaker.projectId, input.projectId))).limit(1).for("update", { of: transcriptSpeaker });
    if (!speaker) throw new WorkflowError(404, "NOT_FOUND", "说话人不存在");
    await tx.update(transcriptSpeaker).set({ displayName, confirmedByUser: true, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(and(eq(transcriptSpeaker.id, speaker.id), eq(transcriptSpeaker.projectId, speaker.projectId)));
    const artifacts = await tx.select({ artifact: workflowArtifact, version: workflowArtifactVersion }).from(workflowArtifact).innerJoin(workflowArtifactVersion, and(eq(workflowArtifactVersion.artifactId, workflowArtifact.id), eq(workflowArtifactVersion.projectId, workflowArtifact.projectId), eq(workflowArtifactVersion.version, workflowArtifact.currentVersion))).where(and(eq(workflowArtifact.runId, input.runId), eq(workflowArtifact.projectId, input.projectId)));
    for (const { artifact, version } of artifacts) {
      const content = replaceSpeaker(version.content, speaker.displayName, displayName) as Record<string, unknown>;
      const schema = workflowArtifactSchemas[artifact.artifactKind as WorkflowArtifactKind];
      const parsed = schema?.safeParse(content);
      if (!parsed?.success) throw new WorkflowError(422, "WORKFLOW_ARTIFACT_SCHEMA_INVALID", "说话人更新后的产物未通过结构校验");
      const markdown = renderArtifactMarkdown(artifact.artifactKind as WorkflowArtifactKind, content);
      const contentDigest = artifactDigest(content, markdown);
      const nextVersion = artifact.currentVersion + 1;
      await tx.insert(workflowArtifactVersion).values({ id: randomUUID(), artifactId: artifact.id, projectId: artifact.projectId, version: nextVersion, content, markdown, sourceReferences: version.sourceReferences, contentDigest, createdBy: input.principal.user.id });
      await tx.update(workflowArtifact).set({ currentVersion: nextVersion, contentDigest, status: "draft", updatedAt: new Date() }).where(and(eq(workflowArtifact.id, artifact.id), eq(workflowArtifact.projectId, artifact.projectId)));
    }
  });
}

export async function deleteMeetingAudio(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const source = await getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(workflowRunSource).where(and(
      eq(workflowRunSource.runId, input.runId),
      eq(workflowRunSource.projectId, input.projectId),
      eq(workflowRunSource.sourceType, "audio"),
    )).limit(1).for("update", { of: workflowRunSource });
    if (!locked) throw new WorkflowError(404, "NOT_FOUND", "会议音视频不存在");
    if (locked.status === "deleted") return null;
    const [job] = await tx.select({ status: workflowAudioJob.status }).from(workflowAudioJob).where(and(eq(workflowAudioJob.runId, input.runId), eq(workflowAudioJob.projectId, input.projectId))).limit(1);
    if (job && ["queued", "transcribing", "diarizing", "normalizing", "summarizing"].includes(job.status)) throw new WorkflowError(409, "AUDIO_DELETE_IN_PROGRESS", "会议任务运行期间不能删除原始音视频");
    if (!["ready", "deleting"].includes(locked.status)) {
      throw new WorkflowError(409, "AUDIO_DELETE_STATE_INVALID", "会议音视频当前不能删除");
    }
    if (locked.status === "ready") {
      const updated = await tx.update(workflowRunSource).set({ status: "deleting" }).where(and(
        eq(workflowRunSource.id, locked.id),
        eq(workflowRunSource.projectId, locked.projectId),
        eq(workflowRunSource.status, "ready"),
      )).returning({ id: workflowRunSource.id });
      if (updated.length !== 1) throw new WorkflowError(409, "AUDIO_DELETE_STATE_INVALID", "会议音视频状态已变化");
    }
    return locked;
  });
  if (!source) return;
  try {
    if (source.objectKey) await getObjectStorage().deleteObject(source.objectKey);
  } catch {
    await getDb().update(workflowRunSource).set({ status: "ready" }).where(and(
      eq(workflowRunSource.id, source.id),
      eq(workflowRunSource.projectId, source.projectId),
      eq(workflowRunSource.status, "deleting"),
    ));
    throw new WorkflowError(503, "AUDIO_DELETE_FAILED", "会议音视频删除失败，可安全重试");
  }
  await getDb().transaction(async (tx) => {
    const updated = await tx.update(workflowRunSource).set({ status: "deleted" }).where(and(
      eq(workflowRunSource.id, source.id),
      eq(workflowRunSource.projectId, source.projectId),
      eq(workflowRunSource.status, "deleting"),
    )).returning({ id: workflowRunSource.id });
    if (updated.length !== 1) throw new WorkflowError(409, "AUDIO_DELETE_STATE_INVALID", "会议音视频删除状态已变化");
    await writeAuditEvent({ actorUserId: input.principal.user.id, projectId: input.projectId, eventType: "workflow.audio_deleted", entityType: "workflow_run_source", entityId: source.id, result: "succeeded", metadata: { runId: input.runId, sizeBytes: source.sizeBytes, sha256: source.sha256 }, ...getRequestAuditContext(input.requestHeaders) }, tx);
  });
}

export function artifactTitle(kind: RequirementArtifactKind): string {
  if (kind === "project_overview") return "项目需求概览";
  if (kind === "requirements_document") return "需求文档";
  if (kind === "ga4_measurement_plan") return "GA4 埋点文档";
  return "Action Plan";
}
