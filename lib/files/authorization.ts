import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import {
  findProjectDocument,
  findProjectDocumentVersion,
} from "@/lib/db/repositories/document-repository";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import type {
  ProjectDocumentRecord,
  ProjectDocumentVersionRecord,
} from "@/lib/db/schema";
import { FileOperationError } from "./errors";

async function auditDenied(
  principal: AuthenticatedPrincipal,
  projectId: string,
  entityId: string,
  requestHeaders: Headers,
): Promise<void> {
  await writeAuditEvent({
    actorUserId: principal.user.id,
    projectId,
    eventType: "document_access_denied",
    entityType: "project_document",
    entityId,
    result: "denied",
    metadata: { reason: "not_authorized_or_not_found" },
    ...getRequestAuditContext(requestHeaders),
  });
}

export async function requireProjectDocumentResource(
  principal: AuthenticatedPrincipal,
  projectId: string,
  documentId: string,
  requestHeaders: Headers,
): Promise<ProjectDocumentRecord> {
  const document = await findProjectDocument(projectId, documentId);
  if (!document) {
    await auditDenied(principal, projectId, documentId, requestHeaders);
    throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
  }
  return document;
}

export async function requireProjectDocumentVersionResource(
  principal: AuthenticatedPrincipal,
  projectId: string,
  documentId: string,
  versionId: string,
  requestHeaders: Headers,
): Promise<{
  document: ProjectDocumentRecord;
  version: ProjectDocumentVersionRecord;
}> {
  const document = await requireProjectDocumentResource(
    principal,
    projectId,
    documentId,
    requestHeaders,
  );
  const version = await findProjectDocumentVersion(
    projectId,
    documentId,
    versionId,
  );
  if (!version) {
    await auditDenied(principal, projectId, versionId, requestHeaders);
    throw new FileOperationError(404, "VERSION_NOT_FOUND", "文件版本不存在");
  }
  return { document, version };
}
