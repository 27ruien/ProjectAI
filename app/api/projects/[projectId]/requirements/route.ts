import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { listRequirements, updateFormalRequirement } from "@/lib/project-management/requirements";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

const patchSchema = z.object({
  requirementId: z.string().min(1).max(200),
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().min(2).max(8_000),
  type: z.enum(["functional", "non_functional", "business_rule", "constraint", "compliance"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["approved", "in_progress", "done", "cancelled"]),
  ownerUserId: z.string().min(1).max(200).nullable(),
  acceptanceCriteria: z.array(z.string().min(1).max(1_000)).max(20),
  assumptions: z.array(z.string().min(1).max(1_000)).max(20),
  openQuestions: z.array(z.string().min(1).max(1_000)).max(20),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listRequirements({ principal, projectId, requestHeaders: request.headers }));
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "需求字段无效" } }, { status: 400 });
    const { requirementId, ...fields } = parsed.data;
    return jsonResponse({ requirement: await updateFormalRequirement({ principal, projectId, requirementId, fields, requestHeaders: request.headers }) });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
