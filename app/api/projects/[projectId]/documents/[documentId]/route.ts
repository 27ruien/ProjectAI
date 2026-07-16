import { z } from "zod";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { requireProjectDocumentResource } from "@/lib/files/authorization";
import {
  documentRoles,
  updateDocumentDisplayName,
} from "@/lib/files/document-service";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { serializeProjectDocument } from "@/lib/files/serialization";

type DocumentRouteContext = {
  params: Promise<{ projectId: string; documentId: string }>;
};

const patchSchema = z
  .object({ displayName: z.string().trim().min(1).max(240) })
  .strict();

export async function GET(
  request: Request,
  context: DocumentRouteContext,
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
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: DocumentRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
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
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new FileOperationError(400, "INVALID_REQUEST", "资料名称无效");
    }
    const document = await updateDocumentDisplayName({
      principal,
      projectId,
      documentId,
      displayName: parsed.data.displayName,
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
    if (error instanceof SyntaxError) {
      return fileRouteErrorResponse(
        new FileOperationError(400, "INVALID_REQUEST", "请求格式无效"),
      );
    }
    return fileRouteErrorResponse(error);
  }
}
