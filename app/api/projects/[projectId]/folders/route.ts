import { z } from "zod";
import { requireTrustedMutationRequest, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { createProjectFolder, listProjectFolders } from "@/lib/files/folder-service";
import { FileOperationError } from "@/lib/files/errors";

type Context = { params: Promise<{ projectId: string }> };

const createSchema = z
  .object({
    name: z.string().min(1).max(240),
    knowledgeSpaceId: z.string().min(1).max(200),
    parentFolderId: z.string().min(1).max(200).nullable().default(null),
  })
  .strict();

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      folders: await listProjectFolders({ principal, projectId, requestHeaders: request.headers }),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) throw new FileOperationError(400, "INVALID_REQUEST", "文件夹信息无效");
    const created = await createProjectFolder({
      principal,
      projectId,
      ...parsed.data,
      requestHeaders: request.headers,
    });
    const folder = (await listProjectFolders({ principal, projectId, requestHeaders: request.headers }))
      .find((item) => item.id === created.id);
    if (!folder) throw new Error("Created project folder was not readable");
    return jsonResponse({ folder }, { status: 201 });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
