import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { archiveGeneralAssistantThread, projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ threadId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await archiveGeneralAssistantThread({ principal, threadId, requestHeaders: request.headers });
    return jsonResponse({ archived: true });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
