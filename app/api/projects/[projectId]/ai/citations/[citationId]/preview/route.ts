import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { loadAssistantCitationPreview, projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ projectId: string; citationId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, citationId } = await context.params;
    const citation = await loadAssistantCitationPreview({ principal, projectId, citationId, requestHeaders: request.headers, scope: "project" });
    return jsonResponse({ citation });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
