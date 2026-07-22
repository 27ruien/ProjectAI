import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { unmountProjectKnowledgeSource } from "@/lib/knowledge/management";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; sourceId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, sourceId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      source: await unmountProjectKnowledgeSource({
        principal,
        projectId,
        sourceId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
