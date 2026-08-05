import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listAssistantContextOptions, projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

/** Safe selector data for #project and $document references. */
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listAssistantContextOptions(principal));
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
