import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  createGeneralAssistantThread,
  listGeneralAssistantThreads,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      threads: await listGeneralAssistantThreads({ principal, requestHeaders: request.headers }),
    });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      thread: await createGeneralAssistantThread({ principal, requestHeaders: request.headers }),
    }, { status: 201 });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
