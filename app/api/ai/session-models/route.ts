import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listGeneralAssistantModels, projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({ models: await listGeneralAssistantModels({ principal }) });
  } catch (error) { return projectAssistantErrorResponse(error); }
}
