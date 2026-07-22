import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { extractRequirementDrafts } from "@/lib/project-management/requirements";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

const schema = z.object({
  documentIds: z.array(z.string().min(1).max(200)).min(1).max(20),
  idempotencyKey: z.string().min(16).max(80),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "需求提取参数无效" } }, { status: 400 });
    const result = await extractRequirementDrafts({ principal, projectId, ...parsed.data, requestHeaders: request.headers });
    return jsonResponse(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
