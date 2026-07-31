import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  deleteGeneralAssistantThread,
  getGeneralAssistantThread,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ threadId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      thread: await getGeneralAssistantThread({ principal, threadId, requestHeaders: request.headers }),
    });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await deleteGeneralAssistantThread({ principal, threadId, requestHeaders: request.headers });
    return new Response(null, { status: 204 });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
