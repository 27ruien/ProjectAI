import { requireProjectRole } from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { requireProjectDocumentVersionResource } from "@/lib/files/authorization";
import {
  documentRoles,
  setCurrentDocumentVersion,
} from "@/lib/files/document-service";
import { fileRouteErrorResponse } from "@/lib/files/http";
import {
  serializeDocumentVersion,
  serializeProjectDocument,
} from "@/lib/files/serialization";

type CurrentRouteContext = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

export async function POST(
  request: Request,
  context: CurrentRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId, versionId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectRole(
      principal,
      projectId,
      documentRoles.manage,
      request.headers,
    );
    const { document } = await requireProjectDocumentVersionResource(
      principal,
      projectId,
      documentId,
      versionId,
      request.headers,
    );
    const version = await setCurrentDocumentVersion({
      principal,
      projectId,
      documentId,
      versionId,
      requestHeaders: request.headers,
    });
    const versions = await listProjectDocumentVersions(projectId, documentId);
    return jsonResponse({
      document: await serializeProjectDocument(
        { ...document, updatedAt: new Date() },
        principal,
        authorizedProject.projectRole,
        versions.find((item) => item.isCurrent) ?? null,
      ),
      version: serializeDocumentVersion(version, principal.user.displayName),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
