import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { reviewScopeDiff } from "@/lib/project-management/requirements";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

const schema = z.object({ status: z.enum(["confirmed", "dismissed"]), note: z.string().trim().max(2_000).optional().default("") }).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string; itemId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, itemId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "Scope 审核参数无效" } }, { status: 400 });
    return jsonResponse({ item: await reviewScopeDiff({ principal, projectId, itemId, ...parsed.data, requestHeaders: request.headers }) });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
