import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  askProjectAssistant,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

type MessagesRouteContext = {
  params: Promise<{ projectId: string; threadId: string }>;
};

export async function POST(
  request: Request,
  context: MessagesRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const result = await askProjectAssistant({
      principal,
      projectId,
      threadId,
      requestHeaders: request.headers,
      idempotencyKey: request.headers.get("idempotency-key"),
      body,
    });
    const status = ["reserved", "retrieving", "calling_provider", "validating"].includes(
      result.execution.status,
    )
      ? 202
      : 200;
    return jsonResponse(result, { status });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
