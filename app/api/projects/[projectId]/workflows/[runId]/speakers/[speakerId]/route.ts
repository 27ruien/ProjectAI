import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { renameTranscriptSpeaker } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

const schema = z.object({ displayName: z.string().trim().min(1).max(160) }).strict();

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; runId: string; speakerId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId, speakerId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: { code: "SPEAKER_NAME_INVALID", message: "说话人名称无效" } }, { status: 400 });
    await renameTranscriptSpeaker({ principal, projectId, runId, speakerId, displayName: parsed.data.displayName, requestHeaders: request.headers });
    return jsonResponse({ ok: true });
  } catch (error) { return workflowErrorResponse(error); }
}
