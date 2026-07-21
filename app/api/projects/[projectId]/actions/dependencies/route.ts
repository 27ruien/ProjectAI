import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import { addActionDependency } from "@/lib/project-management/work-management";

const schema = z
  .object({
    actionItemId: z.string().min(1).max(200),
    dependsOnActionItemId: z.string().min(1).max(200),
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
        { error: { code: "INVALID_REQUEST", message: "依赖参数无效" } },
        { status: 400 },
      );
    return jsonResponse(
      {
        dependency: await addActionDependency({
          principal,
          projectId,
          ...parsed.data,
          requestHeaders: request.headers,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
