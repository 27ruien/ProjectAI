import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { loadAssistantCitationPreview, projectAssistantErrorResponse, resolveGeneralChatProjectId } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ citationId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { citationId } = await context.params;
    const projectId = await resolveGeneralChatProjectId(principal);
    const citation = await loadAssistantCitationPreview({ principal, projectId, citationId, requestHeaders: request.headers, scope: "general" });
    return jsonResponse({ citation });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
