import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  archiveProjectAssistantThread,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

type ArchiveRouteContext = {
  params: Promise<{ projectId: string; threadId: string }>;
};

export async function POST(
  request: Request,
  context: ArchiveRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await archiveProjectAssistantThread({
      principal,
      projectId,
      threadId,
      requestHeaders: request.headers,
    });
    return jsonResponse({ archived: true });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
