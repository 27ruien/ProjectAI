import { requireProjectRole } from "@/lib/auth/authorization";
import { requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  deleteProjectKnowledgeDocument,
  knowledgeServiceErrorResponse,
} from "@/lib/knowledge-slim";

type Context = { params: Promise<{ projectId: string; documentId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const project = await requireProjectRole(
      principal,
      projectId,
      ["project_manager"],
      request.headers,
    );
    await deleteProjectKnowledgeDocument({ project, documentId, actorUserId: principal.user.id });
    return new Response(null, { status: 204 });
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
