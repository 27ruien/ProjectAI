import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { askGeneralAssistant, projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ threadId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { threadId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    let body: unknown = null;
    try { body = await request.json(); } catch { body = null; }
    const result = await askGeneralAssistant({
      principal,
      threadId,
      requestHeaders: request.headers,
      idempotencyKey: request.headers.get("idempotency-key"),
      body,
    });
    const status = ["reserved", "retrieving", "calling_provider", "validating"].includes(result.execution.status) ? 202 : 200;
    return jsonResponse(result, { status });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
