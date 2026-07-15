import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  requireProjectAccess,
  requireProjectRole,
} from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  countProjectDocumentsByStatus,
  listProjectDocuments,
  listProjectDocumentVersions,
} from "@/lib/db/repositories/document-repository";
import { maxUploadBytes, allowedUploadExtensions } from "@/lib/files/config";
import { documentRoles, uploadDocument } from "@/lib/files/document-service";
import { FileOperationError } from "@/lib/files/errors";
import {
  fileRouteErrorResponse,
  idempotencyKeyFrom,
  readUploadForm,
} from "@/lib/files/http";
import {
  serializeDocumentList,
  serializeDocumentVersion,
  serializeProjectDocument,
} from "@/lib/files/serialization";

type DocumentsRouteContext = { params: Promise<{ projectId: string }> };

export async function GET(
  request: Request,
  context: DocumentsRouteContext,
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectAccess(
      principal,
      projectId,
      request.headers,
    );
    const status = new URL(request.url).searchParams.get("status") || "active";
    if (status !== "active" && status !== "archived") {
      throw new FileOperationError(400, "INVALID_REQUEST", "资料状态筛选无效");
    }
    const [documents, counts] = await Promise.all([
      listProjectDocuments(projectId, status),
      countProjectDocumentsByStatus(projectId),
    ]);
    const admin = principal.user.systemRole === "system_admin";
    const canUpload =
      admin ||
      authorizedProject.projectRole === "project_manager" ||
      authorizedProject.projectRole === "project_member";
    return jsonResponse({
      documents: await serializeDocumentList(
        documents,
        principal,
        authorizedProject.projectRole,
      ),
      counts: { active: counts.active, archived: counts.archived },
      uploadPolicy: {
        maxBytes: maxUploadBytes(),
        allowedExtensions: [...allowedUploadExtensions()],
      },
      permissions: { canUpload },
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: DocumentsRouteContext,
): Promise<Response> {
  let principal: AuthenticatedPrincipal | null = null;
  let authorizedProject:
    | Awaited<ReturnType<typeof requireProjectRole>>
    | null = null;
  let projectId = "";
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    ({ projectId } = await context.params);
    principal = await requireApiPrincipal(request.headers);
    authorizedProject = await requireProjectRole(
      principal,
      projectId,
      documentRoles.upload,
      request.headers,
    );
    const { file, displayName } = await readUploadForm(request);
    const result = await uploadDocument({
      principal,
      projectId,
      requestHeaders: request.headers,
      idempotencyKey: idempotencyKeyFrom(request),
      file,
      displayName,
    });
    const versions = await listProjectDocumentVersions(projectId, result.document.id);
    const current = versions.find((version) => version.isCurrent) ?? null;
    const status = result.replayed
      ? result.version.storageStatus === "pending"
        ? 202
        : 200
      : 201;
    return jsonResponse(
      {
        document: await serializeProjectDocument(
          result.document,
          principal,
          authorizedProject.projectRole,
          current,
        ),
        version: serializeDocumentVersion(
          result.version,
          principal.user.displayName,
        ),
        replayed: result.replayed,
        uploadStatus: result.version.storageStatus,
      },
      { status },
    );
  } catch (error) {
    if (
      error instanceof FileOperationError &&
      principal &&
      authorizedProject &&
      projectId &&
      [
        "FILE_TOO_LARGE",
        "UNSUPPORTED_FILE_TYPE",
        "FILE_SIGNATURE_MISMATCH",
        "INVALID_OFFICE_CONTAINER",
      ].includes(error.code)
    ) {
      await writeAuditEvent({
        actorUserId: principal.user.id,
        projectId,
        eventType: "document_upload_failed",
        entityType: "project_document",
        result: "failed",
        metadata: { failureCode: error.code },
        ...getRequestAuditContext(request.headers),
      });
    }
    return fileRouteErrorResponse(error);
  }
}
