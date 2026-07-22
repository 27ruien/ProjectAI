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
  updateDocumentMetadata,
} from "@/lib/files/document-service";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { serializeProjectDocument } from "@/lib/files/serialization";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";

type DocumentRouteContext = {
  params: Promise<{ projectId: string; documentId: string }>;
};

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(240).optional(),
    visibility: z
      .enum(["private", "organization_shared", "department_shared", "restricted"])
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

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
    const [
      versions,
      downloadScope,
      versionScope,
      archiveScope,
      permissionScope,
    ] = await Promise.all([
      listProjectDocumentVersions(document.projectId, documentId),
      listAuthorizedDocumentScope({ principal, projectId, permission: "download" }),
      listAuthorizedDocumentScope({
        principal,
        projectId,
        permission: "manage_versions",
      }),
      listAuthorizedDocumentScope({ principal, projectId, permission: "archive" }),
      listAuthorizedDocumentScope({
        principal,
        projectId,
        permission: "manage_permissions",
      }),
    ]);
    const has = (scope: { documentId: string }[]) =>
      scope.some((item) => item.documentId === documentId);
    return jsonResponse({
      document: await serializeProjectDocument(
        document,
        principal,
        authorizedProject.projectRole,
        versions.find((version) => version.isCurrent) ?? null,
        {
          download: has(downloadScope),
          manageVersions: has(versionScope),
          archive: has(archiveScope),
          managePermissions: has(permissionScope),
        },
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
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new FileOperationError(400, "INVALID_REQUEST", "资料信息无效");
    }
    const authorizedProject = await requireProjectRole(
      principal,
      projectId,
      parsed.data.visibility === undefined
        ? documentRoles.upload
        : documentRoles.manage,
      request.headers,
    );
    await requireProjectDocumentResource(
      principal,
      projectId,
      documentId,
      request.headers,
      parsed.data.visibility === undefined
        ? "edit_metadata"
        : "manage_permissions",
    );
    const document = await updateDocumentMetadata({
      principal,
      projectId,
      documentId,
      ...parsed.data,
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
