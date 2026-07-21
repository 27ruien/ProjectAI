import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import { bulkUpdateActionStatus } from "@/lib/project-management/work-management";

const schema = z
  .object({
    actionItemIds: z.array(z.string().min(1).max(200)).min(1).max(100),
    status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "批量 Action 参数无效" } },
        { status: 400 },
      );
    return jsonResponse({
      actions: await bulkUpdateActionStatus({
        principal,
        projectId,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
