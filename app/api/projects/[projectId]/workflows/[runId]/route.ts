import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { cancelWorkflowRun, readWorkflowRun, retryWorkflowRun } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

const actionSchema = z.object({ action: z.enum(["cancel", "retry"]) }).strict();

export async function GET(request: Request, context: { params: Promise<{ projectId: string; runId: string }> }) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId } = await context.params;
    return jsonResponse(await readWorkflowRun({ principal, projectId, runId, requestHeaders: request.headers }));
  } catch (error) { return workflowErrorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; runId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: { code: "WORKFLOW_ACTION_INVALID", message: "工作流操作无效" } }, { status: 400 });
    if (parsed.data.action === "cancel") await cancelWorkflowRun({ principal, projectId, runId, requestHeaders: request.headers });
    else await retryWorkflowRun({ principal, projectId, runId, requestHeaders: request.headers });
    return jsonResponse({ ok: true });
  } catch (error) { return workflowErrorResponse(error); }
}
