import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { deleteMeetingAudio } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

export async function DELETE(request: Request, context: { params: Promise<{ projectId: string; runId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId } = await context.params;
    await deleteMeetingAudio({ principal, projectId, runId, requestHeaders: request.headers });
    return jsonResponse({ ok: true });
  } catch (error) { return workflowErrorResponse(error); }
}
