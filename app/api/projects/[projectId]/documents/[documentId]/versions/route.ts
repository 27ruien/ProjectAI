import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import {
  requireApiPrincipal,
  type AuthenticatedPrincipal,
} from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { requireProjectDocumentResource } from "@/lib/files/authorization";
import { documentRoles, uploadDocument } from "@/lib/files/document-service";
import { FileOperationError } from "@/lib/files/errors";
import {
  fileRouteErrorResponse,
  idempotencyKeyFrom,
  readUploadForm,
} from "@/lib/files/http";
import {
  serializeDocumentVersions,
  serializeProjectDocument,
} from "@/lib/files/serialization";

type VersionsRouteContext = {
  params: Promise<{ projectId: string; documentId: string }>;
};

export async function GET(
  request: Request,
  context: VersionsRouteContext,
): Promise<Response> {
  try {
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectAccess(
      principal,
      projectId,
      request.headers,
    );
    const document = await requireProjectDocumentResource(
      principal,
      projectId,
      documentId,
      request.headers,
    );
    const versions = await listProjectDocumentVersions(document.projectId, documentId);
    return jsonResponse({
      document: await serializeProjectDocument(
        document,
        principal,
        authorizedProject.projectRole,
        versions.find((version) => version.isCurrent) ?? null,
      ),
      versions: await serializeDocumentVersions(versions),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: VersionsRouteContext,
): Promise<Response> {
  let principal: AuthenticatedPrincipal | null = null;
  let authorizedProject:
    | Awaited<ReturnType<typeof requireProjectRole>>
    | null = null;
  let projectId = "";
  let documentId = "";
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    ({ projectId, documentId } = await context.params);
    principal = await requireApiPrincipal(request.headers);
    authorizedProject = await requireProjectRole(
      principal,
      projectId,
      documentRoles.upload,
      request.headers,
    );
    await requireProjectDocumentResource(
      principal,
      projectId,
      documentId,
      request.headers,
      "manage_versions",
    );
    const { file } = await readUploadForm(request);
    const result = await uploadDocument({
      principal,
      projectId,
      documentId,
      requestHeaders: request.headers,
      idempotencyKey: idempotencyKeyFrom(request),
      file,
      displayName: null,
    });
    const versions = await listProjectDocumentVersions(projectId, documentId);
    return jsonResponse(
      {
        document: await serializeProjectDocument(
          result.document,
          principal,
          authorizedProject.projectRole,
          versions.find((version) => version.isCurrent) ?? null,
        ),
        version: (
          await serializeDocumentVersions(
            [result.version],
            principal.user.displayName,
          )
        )[0],
        replayed: result.replayed,
        uploadStatus: result.version.storageStatus,
      },
      {
        status: result.replayed
          ? result.version.storageStatus === "pending"
            ? 202
            : 200
          : 201,
      },
    );
  } catch (error) {
    if (
      error instanceof FileOperationError &&
      principal &&
      authorizedProject &&
      projectId &&
      documentId &&
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
        entityId: documentId,
        result: "failed",
        metadata: { failureCode: error.code },
        ...getRequestAuditContext(request.headers),
      });
    }
    return fileRouteErrorResponse(error);
  }
}
