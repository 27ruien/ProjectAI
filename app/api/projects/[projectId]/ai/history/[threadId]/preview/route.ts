import { jsonResponse } from "@/lib/auth/http";
import {
  loadAssistantHistoryCitationPreview,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";
import { requireApiPrincipal } from "@/lib/auth/session";

type Context = { params: Promise<{ projectId: string; threadId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, threadId } = await context.params;
    const history = await loadAssistantHistoryCitationPreview({
      principal,
      projectId,
      sourceThreadId: threadId,
      requestHeaders: request.headers,
      scope: "project",
    });
    return jsonResponse({ history });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
