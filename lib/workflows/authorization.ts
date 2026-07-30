import { and, eq, inArray, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { requireProjectRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { findUserById } from "@/lib/db/repositories/user-repository";
import {
  documentIngestionJob,
  projectDocument,
  projectDocumentVersion,
  workflowRun,
  workflowRunSource,
} from "@/lib/db/schema";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { WorkflowError } from "./errors";

const WORKFLOW_EDIT_ROLES = ["project_manager", "project_member"] as const;

type WorkflowRunRecord = typeof workflowRun.$inferSelect;

function runKey(runId: string, projectId: string): string {
  return `${projectId}:${runId}`;
}

function sourceIsLive(
  source: typeof workflowRunSource.$inferSelect,
  now: Date,
): boolean {
  return (
    source.status === "ready" &&
    (!source.expiresAt || source.expiresAt > now)
  );
}

export async function listReadableWorkflowRunIds(input: {
  principal: AuthenticatedPrincipal;
  runs: WorkflowRunRecord[];
  db?: DatabaseExecutor;
}): Promise<Set<string>> {
  const executor = input.db ?? getDb();
  const runs = [...new Map(input.runs.map((run) => [run.id, run])).values()];
  const readable = new Set<string>();
  if (runs.length === 0) return readable;

  const legacyRuns = runs.filter(
    (run) => run.status === "legacy_read_only" && run.legacyRequirementRunId,
  );
  for (const run of legacyRuns) readable.add(run.id);

  const currentRuns = runs.filter((run) => !run.legacyRequirementRunId);
  if (currentRuns.length === 0) return readable;
  const currentRunKeys = new Set(
    currentRuns.map((run) => runKey(run.id, run.projectId)),
  );
  const sources = await executor
    .select()
    .from(workflowRunSource)
    .where(inArray(workflowRunSource.runId, currentRuns.map((run) => run.id)));
  const sourcesByRun = new Map<string, Array<typeof workflowRunSource.$inferSelect>>();
  for (const source of sources) {
    const key = runKey(source.runId, source.projectId);
    if (!currentRunKeys.has(key)) continue;
    const existing = sourcesByRun.get(key) ?? [];
    existing.push(source);
    sourcesByRun.set(key, existing);
  }

  const requirementRuns = currentRuns.filter(
    (run) => run.workflowType === "requirement_framework",
  );
  const authorizedDocumentsByProject = new Map<string, Set<string>>();
  for (const projectId of new Set(requirementRuns.map((run) => run.projectId))) {
    const authorized = await listAuthorizedDocumentScope({
      principal: input.principal,
      projectId,
      permission: "view",
      db: executor,
    });
    authorizedDocumentsByProject.set(
      projectId,
      new Set(
        authorized.map(
          (scope) => `${scope.sourceProjectId}:${scope.documentId}`,
        ),
      ),
    );
  }

  const validDocumentSources = requirementRuns.length
    ? await executor
        .select({ id: workflowRunSource.id })
        .from(workflowRunSource)
        .innerJoin(
          projectDocument,
          and(
            eq(projectDocument.id, workflowRunSource.documentId),
            eq(projectDocument.projectId, workflowRunSource.sourceProjectId),
            eq(projectDocument.status, "active"),
          ),
        )
        .innerJoin(
          projectDocumentVersion,
          and(
            eq(projectDocumentVersion.id, workflowRunSource.documentVersionId),
            eq(projectDocumentVersion.documentId, workflowRunSource.documentId),
            eq(projectDocumentVersion.projectId, workflowRunSource.sourceProjectId),
            eq(projectDocumentVersion.isCurrent, true),
            eq(projectDocumentVersion.storageStatus, "stored"),
          ),
        )
        .innerJoin(
          documentIngestionJob,
          and(
            eq(documentIngestionJob.projectId, workflowRunSource.sourceProjectId),
            eq(documentIngestionJob.documentId, workflowRunSource.documentId),
            eq(documentIngestionJob.versionId, workflowRunSource.documentVersionId),
            eq(documentIngestionJob.status, "succeeded"),
          ),
        )
        .where(
          and(
            inArray(
              workflowRunSource.runId,
              requirementRuns.map((run) => run.id),
            ),
            eq(workflowRunSource.status, "ready"),
            sql`(${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now())`,
          ),
        )
    : [];
  const validDocumentSourceIds = new Set(
    validDocumentSources.map((source) => source.id),
  );
  const now = new Date();

  for (const run of currentRuns) {
    const runSources = sourcesByRun.get(runKey(run.id, run.projectId)) ?? [];
    if (run.workflowType === "meeting_minutes") {
      if (
        runSources.length === 1 &&
        sourceIsLive(runSources[0]!, now) &&
        runSources[0]!.sourceType === "audio" &&
        runSources[0]!.sourceProjectId === run.projectId &&
        Boolean(runSources[0]!.objectKey)
      ) {
        readable.add(run.id);
      }
      continue;
    }
    if (run.workflowType !== "requirement_framework" || runSources.length === 0) {
      continue;
    }
    const authorizedDocuments = authorizedDocumentsByProject.get(run.projectId);
    if (
      authorizedDocuments &&
      runSources.every(
        (source) =>
          sourceIsLive(source, now) &&
          Boolean(source.documentId) &&
          Boolean(source.documentVersionId) &&
          authorizedDocuments.has(
            `${source.sourceProjectId}:${source.documentId!}`,
          ) &&
          validDocumentSourceIds.has(source.id),
      )
    ) {
      readable.add(run.id);
    }
  }

  return readable;
}

export async function assertWorkflowRunReadAuthorization(input: {
  principal: AuthenticatedPrincipal;
  run: WorkflowRunRecord;
  db?: DatabaseExecutor;
}): Promise<void> {
  const readable = await listReadableWorkflowRunIds({
    principal: input.principal,
    runs: [input.run],
    db: input.db,
  });
  if (!readable.has(input.run.id)) {
    throw new WorkflowError(404, "NOT_FOUND", "工作流不存在");
  }
}

export async function assertWorkflowProviderAuthorization(
  run: typeof workflowRun.$inferSelect,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const actor = await findUserById(run.creatorId, tx);
    if (!actor || actor.status !== "active") {
      throw new WorkflowError(403, "WORKFLOW_SOURCE_ACCESS_REVOKED", "工作流创建者已停用或无权继续执行");
    }
    const principal = { sessionId: `workflow:${run.id}`, user: actor };
    let target;
    try {
      target = await requireProjectRole(
        principal,
        run.projectId,
        WORKFLOW_EDIT_ROLES,
        undefined,
        { db: tx, lockForUpdate: true },
      );
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      throw new WorkflowError(403, "WORKFLOW_SOURCE_ACCESS_REVOKED", "项目访问权已撤销，工作流已停止");
    }
    if (
      target.organizationId !== run.organizationId ||
      target.departmentId !== run.departmentId
    ) {
      throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "项目归属已变化，工作流已停止");
    }

    const sources = await tx.select().from(workflowRunSource).where(and(
      eq(workflowRunSource.runId, run.id),
      eq(workflowRunSource.projectId, run.projectId),
      eq(workflowRunSource.status, "ready"),
      sql`(${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now())`,
    ));
    if (run.workflowType === "meeting_minutes") {
      if (
        sources.length !== 1 ||
        sources[0]!.sourceType !== "audio" ||
        sources[0]!.sourceProjectId !== run.projectId ||
        !sources[0]!.objectKey
      ) {
        throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "会议音视频来源已失效");
      }
      return;
    }

    if (!sources.length || sources.some((source) => !source.documentId || !source.documentVersionId)) {
      throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "工作流来源已失效");
    }
    const authorized = await listAuthorizedDocumentScope({
      principal,
      projectId: run.projectId,
      permission: "view",
      db: tx,
    });
    const authorizedDocuments = new Set(
      authorized.map((scope) => `${scope.sourceProjectId}:${scope.documentId}`),
    );
    if (sources.some((source) => !authorizedDocuments.has(`${source.sourceProjectId}:${source.documentId}`))) {
      throw new WorkflowError(403, "WORKFLOW_SOURCE_ACCESS_REVOKED", "工作流来源访问权已撤销");
    }
    const validSources = await tx.select({ id: workflowRunSource.id })
      .from(workflowRunSource)
      .innerJoin(projectDocument, and(
        eq(projectDocument.id, workflowRunSource.documentId),
        eq(projectDocument.projectId, workflowRunSource.sourceProjectId),
        eq(projectDocument.status, "active"),
      ))
      .innerJoin(projectDocumentVersion, and(
        eq(projectDocumentVersion.id, workflowRunSource.documentVersionId),
        eq(projectDocumentVersion.documentId, workflowRunSource.documentId),
        eq(projectDocumentVersion.projectId, workflowRunSource.sourceProjectId),
        eq(projectDocumentVersion.isCurrent, true),
        eq(projectDocumentVersion.storageStatus, "stored"),
      ))
      .innerJoin(documentIngestionJob, and(
        eq(documentIngestionJob.projectId, workflowRunSource.sourceProjectId),
        eq(documentIngestionJob.documentId, workflowRunSource.documentId),
        eq(documentIngestionJob.versionId, workflowRunSource.documentVersionId),
        eq(documentIngestionJob.status, "succeeded"),
      ))
      .where(and(
        eq(workflowRunSource.runId, run.id),
        eq(workflowRunSource.projectId, run.projectId),
        eq(workflowRunSource.status, "ready"),
        sql`(${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now())`,
      ));
    if (validSources.length !== sources.length) {
      throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "工作流来源不再是当前有效版本");
    }
  });
}
