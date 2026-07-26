import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  KnowledgeChunkManagementError,
  listManagedKnowledgeChunks,
} from "@/lib/knowledge/chunk-management";

type Context = {
  params: Promise<{ projectId: string; documentId: string }>;
};

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(
      await listManagedKnowledgeChunks({
        principal,
        projectId,
        documentId,
        requestHeaders: request.headers,
      }),
    );
  } catch (error) {
    if (error instanceof KnowledgeChunkManagementError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    try {
      return authorizationErrorResponse(error);
    } catch {
      return jsonResponse(
        { error: { code: "CHUNK_MANAGEMENT_FAILED", message: "分块管理暂时不可用" } },
        { status: 503 },
      );
    }
  }
}
