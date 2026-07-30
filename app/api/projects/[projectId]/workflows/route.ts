import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { createRequirementFrameworkRun, listWorkflowRuns } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

const createSchema = z.object({
  workflowType: z.literal("requirement_framework"),
  documentIds: z.array(z.string().min(1).max(200)).min(1).max(20),
  idempotencyKey: z.string().min(16).max(200),
  temporaryWorkflowId: z.string().min(16).max(100).optional(),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { projectId } = await context.params;
    return jsonResponse({ runs: await listWorkflowRuns({ principal, projectId, limit: 50 }) });
  } catch (error) { return workflowErrorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId } = await context.params;
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: { code: "WORKFLOW_INPUT_INVALID", message: "工作流输入无效" } }, { status: 400 });
    const result = await createRequirementFrameworkRun({ principal, projectId, ...parsed.data, requestHeaders: request.headers });
    return jsonResponse(result, { status: result.created ? 202 : 200 });
  } catch (error) { return workflowErrorResponse(error); }
}
