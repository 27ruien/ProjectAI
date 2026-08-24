import { requireProjectRole } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  knowledgeServiceErrorResponse,
  retryProjectKnowledgeDocument,
} from "@/lib/knowledge-slim";

type Context = { params: Promise<{ projectId: string; documentId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const project = await requireProjectRole(
      principal,
      projectId,
      ["project_manager", "project_member"],
      request.headers,
    );
    await retryProjectKnowledgeDocument({ project, documentId, actorUserId: principal.user.id });
    return jsonResponse({ status: "processing" });
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
