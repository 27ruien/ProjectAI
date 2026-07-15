import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { requireProjectDocumentResource } from "@/lib/files/authorization";
import { documentRoles, uploadDocument } from "@/lib/files/document-service";
import {
  fileRouteErrorResponse,
  idempotencyKeyFrom,
  readUploadForm,
} from "@/lib/files/http";
import {
  serializeDocumentVersion,
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
    const versions = await listProjectDocumentVersions(projectId, documentId);
    return jsonResponse({
      document: await serializeProjectDocument(
        document,
        principal,
        authorizedProject.projectRole,
        versions.find((version) => version.isCurrent) ?? null,
      ),
      versions: versions.map((version) => serializeDocumentVersion(version)),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: VersionsRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectRole(
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
        version: serializeDocumentVersion(
          result.version,
          principal.user.displayName,
        ),
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
    return fileRouteErrorResponse(error);
  }
}
