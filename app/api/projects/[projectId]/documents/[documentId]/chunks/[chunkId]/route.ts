import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  KnowledgeChunkManagementError,
  mutateManagedKnowledgeChunk,
} from "@/lib/knowledge/chunk-management";

type Context = {
  params: Promise<{ projectId: string; documentId: string; chunkId: string }>;
};

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId, chunkId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(
      await mutateManagedKnowledgeChunk({
        principal,
        projectId,
        documentId,
        chunkId,
        requestHeaders: request.headers,
        body: await request.json(),
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
