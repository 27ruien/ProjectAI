import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { createMeetingRun } from "@/lib/workflows/audio-service";
import { workflowErrorResponse } from "@/lib/workflows/http";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    const principal = await requireApiPrincipal(request.headers);
    const { projectId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    const idempotencyKey = form.get("idempotencyKey");
    if (!(file instanceof File) || typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      return jsonResponse({ error: { code: "AUDIO_UPLOAD_INVALID", message: "会议音视频上传参数无效" } }, { status: 400 });
    }
    const result = await createMeetingRun({ principal, projectId, file, idempotencyKey, requestHeaders: request.headers });
    return jsonResponse(result, { status: result.created ? 202 : 200 });
  } catch (error) { return workflowErrorResponse(error); }
}
