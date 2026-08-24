import { requireProjectRole } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  knowledgeServiceErrorResponse,
  provisionProjectDataset,
} from "@/lib/knowledge-slim";
import { serializeAuthorizedProject } from "@/lib/projects/serialization";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorized = await requireProjectRole(
      principal,
      projectId,
      ["project_manager"],
      request.headers,
    );
    const updated = await provisionProjectDataset({
      projectId,
      actorUserId: principal.user.id,
    });
    return jsonResponse({
      project: serializeAuthorizedProject(
        { ...updated, projectRole: authorized.projectRole },
        principal,
      ),
    });
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
