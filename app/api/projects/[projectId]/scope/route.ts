import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { createScopeVersion, listScope } from "@/lib/project-management/requirements";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

const schema = z.object({
  name: z.string().trim().min(2).max(200),
  includedRequirementIds: z.array(z.string().min(1).max(200)).max(1_000).optional(),
  removalDeclarations: z.array(z.string().min(1).max(200)).max(1_000).optional(),
  ambiguousRequirementIds: z.array(z.string().min(1).max(200)).max(1_000).optional(),
  outOfScopeRequirementIds: z.array(z.string().min(1).max(200)).max(1_000).optional(),
}).strict();

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listScope({ principal, projectId, requestHeaders: request.headers }));
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "Scope 版本名称无效" } }, { status: 400 });
    return jsonResponse({ version: await createScopeVersion({ principal, projectId, ...parsed.data, requestHeaders: request.headers }) }, { status: 201 });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
