import { requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  findProjectDocument,
  findProjectDocumentVersion,
} from "@/lib/db/repositories/document-repository";
import { latestEmbeddingJobForVersion } from "@/lib/db/repositories/embedding-repository";
import { latestSuccessfulIngestionJobForVersion } from "@/lib/db/repositories/ingestion-repository";
import { FileOperationError } from "@/lib/files/errors";
import { ensureEmbeddingJob } from "./jobs";
import { getEmbeddingRuntimeConfig } from "./config";

export async function retryDocumentEmbedding(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  versionId: string;
  requestHeaders: Headers;
}) {
  if (!getEmbeddingRuntimeConfig().enabled) {
    throw new FileOperationError(
      503,
      "VERSION_NOT_AVAILABLE",
      "向量化服务当前未启用",
    );
  }
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const document = await findProjectDocument(
      input.projectId,
      input.documentId,
      tx,
      { lockForUpdate: true },
    );
    if (!document) {
      throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
    }
    if (document.status === "archived") {
      throw new FileOperationError(409, "DOCUMENT_ARCHIVED", "请先恢复归档资料");
    }
    const version = await findProjectDocumentVersion(
      input.projectId,
      input.documentId,
      input.versionId,
      tx,
      { lockForUpdate: true },
    );
    if (!version || version.storageStatus !== "stored") {
      throw new FileOperationError(
        409,
        "VERSION_NOT_AVAILABLE",
        "该文件版本当前不可重新向量化",
      );
    }
    const ingestion = await latestSuccessfulIngestionJobForVersion(
      input.projectId,
      input.documentId,
      input.versionId,
      tx,
    );
    if (!ingestion) {
      throw new FileOperationError(
        409,
        "VERSION_NOT_AVAILABLE",
        "请先完成文件解析",
      );
    }
    const current = await latestEmbeddingJobForVersion(
      input.projectId,
      input.documentId,
      input.versionId,
      tx,
    );
    if (current?.failureCode === "PROVIDER_RESULT_UNKNOWN") {
      throw new FileOperationError(
        409,
        "EMBEDDING_RESULT_UNKNOWN",
        "向量化结果需要管理员复核，不能自动重试",
      );
    }
    if (current && ["pending", "running", "succeeded"].includes(current.status)) {
      return current;
    }
    return ensureEmbeddingJob({
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: input.versionId,
      createdBy: input.principal.user.id,
      reason: "manual_retry",
      db: tx,
    });
  });
}
