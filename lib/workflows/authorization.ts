import { and, eq, sql } from "drizzle-orm";
import { requireProjectRole } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
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
      sql`${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now()`,
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
        sql`${workflowRunSource.expiresAt} is null or ${workflowRunSource.expiresAt} > now()`,
      ));
    if (validSources.length !== sources.length) {
      throw new WorkflowError(409, "WORKFLOW_SOURCE_ACCESS_REVOKED", "工作流来源不再是当前有效版本");
    }
  });
}
