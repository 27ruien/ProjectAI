import { requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  findProjectDocument,
  findProjectDocumentVersion,
} from "@/lib/db/repositories/document-repository";
import type { DocumentIngestionJobRecord } from "@/lib/db/schema";
import { FileOperationError } from "@/lib/files/errors";
import { ensureIngestionJob } from "./jobs";

export async function reindexDocumentVersion(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  versionId: string;
  requestHeaders: Headers;
}): Promise<DocumentIngestionJobRecord> {
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
    if (!version) {
      throw new FileOperationError(404, "VERSION_NOT_FOUND", "文件版本不存在");
    }
    if (version.storageStatus !== "stored") {
      throw new FileOperationError(
        409,
        "VERSION_NOT_AVAILABLE",
        "该文件版本当前不可重新解析",
      );
    }
    return ensureIngestionJob({
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: input.versionId,
      createdBy: input.principal.user.id,
      reason: "reindex",
      forceNewGeneration: true,
      db: tx,
    });
  });
}
