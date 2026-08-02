import { jsonResponse } from "@/lib/auth/http";
import {
  loadAssistantHistoryCitationPreview,
  projectAssistantErrorResponse,
  resolveGeneralChatProjectId,
} from "@/lib/ai/project-assistant";
import { requireApiPrincipal } from "@/lib/auth/session";

type Context = { params: Promise<{ threadId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { threadId } = await context.params;
    const projectId = await resolveGeneralChatProjectId(principal);
    const history = await loadAssistantHistoryCitationPreview({
      principal,
      projectId,
      sourceThreadId: threadId,
      requestHeaders: request.headers,
      scope: "general",
    });
    return jsonResponse({ history });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
