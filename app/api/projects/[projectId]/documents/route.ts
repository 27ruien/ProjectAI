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
  countAuthorizedDocumentsByStatus,
  listAuthorizedDocuments,
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
  serializeDocumentVersions,
  serializeProjectDocument,
} from "@/lib/files/serialization";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { listUploadableKnowledgeSpaces } from "@/lib/knowledge/management";

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
    const [
      viewScope,
      downloadScope,
      versionScope,
      archiveScope,
      permissionScope,
    ] =
      await Promise.all([
        listAuthorizedDocumentScope({ principal, projectId, permission: "view" }),
        listAuthorizedDocumentScope({
          principal,
          projectId,
          permission: "download",
        }),
        listAuthorizedDocumentScope({
          principal,
          projectId,
          permission: "manage_versions",
        }),
        listAuthorizedDocumentScope({
          principal,
          projectId,
          permission: "archive",
        }),
        listAuthorizedDocumentScope({
          principal,
          projectId,
          permission: "manage_permissions",
        }),
      ]);
    const viewIds = viewScope.map((item) => item.documentId);
    const [documents, counts] = await Promise.all([
      listAuthorizedDocuments(viewIds, status),
      countAuthorizedDocumentsByStatus(viewIds),
    ]);
    const downloadIds = new Set(downloadScope.map((item) => item.documentId));
    const versionIds = new Set(versionScope.map((item) => item.documentId));
    const archiveIds = new Set(archiveScope.map((item) => item.documentId));
    const permissionIds = new Set(
      permissionScope.map((item) => item.documentId),
    );
    const admin = principal.user.systemRole === "system_admin";
    const canUpload =
      admin ||
      authorizedProject.projectRole === "project_manager" ||
      authorizedProject.projectRole === "project_member";
    const uploadDestinations = canUpload
      ? await listUploadableKnowledgeSpaces({
          principal,
          projectId,
          requestHeaders: request.headers,
        })
      : [];
    return jsonResponse({
      documents: await serializeDocumentList(
        documents,
        principal,
        authorizedProject.projectRole,
        new Map(
          viewIds.map((documentId) => [
            documentId,
            {
              download: downloadIds.has(documentId),
              manageVersions: versionIds.has(documentId),
              archive: archiveIds.has(documentId),
              managePermissions: permissionIds.has(documentId),
            },
          ]),
        ),
      ),
      counts: { active: counts.active, archived: counts.archived },
      uploadPolicy: {
        maxBytes: maxUploadBytes(),
        allowedExtensions: [...allowedUploadExtensions()],
      },
      permissions: { canUpload, uploadDestinations },
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
    const { file, displayName, knowledgeSpaceId } = await readUploadForm(request);
    const result = await uploadDocument({
      principal,
      projectId,
      requestHeaders: request.headers,
      idempotencyKey: idempotencyKeyFrom(request),
      file,
      displayName,
      knowledgeSpaceId,
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
        version: (
          await serializeDocumentVersions(
            [result.version],
            principal.user.displayName,
          )
        )[0],
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
