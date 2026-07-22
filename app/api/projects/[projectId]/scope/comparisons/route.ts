import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { compareScope } from "@/lib/project-management/requirements";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

const schema = z.object({ baselineVersionId: z.string().min(1).max(200), candidateVersionId: z.string().min(1).max(200) }).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "Scope 对比参数无效" } }, { status: 400 });
    return jsonResponse(await compareScope({ principal, projectId, ...parsed.data, requestHeaders: request.headers }), { status: 201 });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
