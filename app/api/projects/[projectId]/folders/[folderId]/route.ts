import { z } from "zod";
import { requireTrustedMutationRequest, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { deleteProjectFolder, listProjectFolders, updateProjectFolder } from "@/lib/files/folder-service";

type Context = { params: Promise<{ projectId: string; folderId: string }> };
const updateSchema = z
  .object({
    name: z.string().min(1).max(240).optional(),
    parentFolderId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, folderId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) throw new FileOperationError(400, "INVALID_REQUEST", "文件夹信息无效");
    const updated = await updateProjectFolder({
      principal,
      projectId,
      folderId,
      ...parsed.data,
      requestHeaders: request.headers,
    });
    const folder = (await listProjectFolders({ principal, projectId, requestHeaders: request.headers }))
      .find((item) => item.id === updated.id);
    if (!folder) throw new Error("Updated project folder was not readable");
    return jsonResponse({ folder });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, folderId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await deleteProjectFolder({ principal, projectId, folderId, requestHeaders: request.headers });
    return new Response(null, { status: 204 });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
