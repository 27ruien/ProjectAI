import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { reviewWorkflowRun } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

const schema = z.object({ decision: z.enum(["request_changes", "approve", "publish"]), note: z.string().max(2_000).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string; runId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: { code: "WORKFLOW_REVIEW_INVALID", message: "审核参数无效" } }, { status: 400 });
    await reviewWorkflowRun({ principal, projectId, runId, ...parsed.data, requestHeaders: request.headers });
    return jsonResponse({ ok: true });
  } catch (error) { return workflowErrorResponse(error); }
}
