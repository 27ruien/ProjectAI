import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  getProjectAssistantThread,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

type ThreadRouteContext = {
  params: Promise<{ projectId: string; threadId: string }>;
};

export async function GET(
  request: Request,
  context: ThreadRouteContext,
): Promise<Response> {
  try {
    const { projectId, threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      thread: await getProjectAssistantThread({
        principal,
        projectId,
        threadId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
