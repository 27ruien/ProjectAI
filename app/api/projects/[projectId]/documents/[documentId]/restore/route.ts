import { requireProjectRole } from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { requireProjectDocumentResource } from "@/lib/files/authorization";
import { documentRoles, setDocumentArchived } from "@/lib/files/document-service";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { serializeProjectDocument } from "@/lib/files/serialization";

type RestoreRouteContext = {
  params: Promise<{ projectId: string; documentId: string }>;
};

export async function POST(
  request: Request,
  context: RestoreRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectRole(
      principal,
      projectId,
      documentRoles.manage,
      request.headers,
    );
    await requireProjectDocumentResource(
      principal,
      projectId,
      documentId,
      request.headers,
      "archive",
    );
    const document = await setDocumentArchived({
      principal,
      projectId,
      documentId,
      archived: false,
      requestHeaders: request.headers,
    });
    const versions = await listProjectDocumentVersions(projectId, documentId);
    return jsonResponse({
      document: await serializeProjectDocument(
        document,
        principal,
        authorizedProject.projectRole,
        versions.find((version) => version.isCurrent) ?? null,
      ),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
