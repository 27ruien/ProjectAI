import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import type {
  ProjectDocumentRecord,
  ProjectDocumentVersionRecord,
} from "@/lib/db/schema";
import type { KnowledgePermission } from "@/lib/db/schema";
import {
  findAuthorizedDocument,
  findAuthorizedDocumentVersion,
} from "@/lib/knowledge/authorization";
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
  permission: KnowledgePermission = "view",
): Promise<ProjectDocumentRecord> {
  const authorized = await findAuthorizedDocument({
    principal,
    projectId,
    documentId,
    permission,
  });
  if (!authorized) {
    await auditDenied(principal, projectId, documentId, requestHeaders);
    throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
  }
  return authorized.document;
}

export async function requireProjectDocumentVersionResource(
  principal: AuthenticatedPrincipal,
  projectId: string,
  documentId: string,
  versionId: string,
  requestHeaders: Headers,
  permission: KnowledgePermission = "view",
): Promise<{
  document: ProjectDocumentRecord;
  version: ProjectDocumentVersionRecord;
}> {
  const authorized = await findAuthorizedDocumentVersion({
    principal,
    projectId,
    documentId,
    versionId,
    permission,
  });
  if (!authorized) {
    await auditDenied(principal, projectId, versionId, requestHeaders);
    throw new FileOperationError(404, "VERSION_NOT_FOUND", "文件版本不存在");
  }
  return { document: authorized.document, version: authorized.version };
}
