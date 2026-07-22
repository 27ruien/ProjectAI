import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import { generateRiskDrafts } from "@/lib/project-management/work-management";

const schema = z
  .object({
    requirementIds: z.array(z.string().min(1).max(200)).max(50).default([]),
    documentIds: z.array(z.string().min(1).max(200)).max(20).default([]),
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
        { error: { code: "INVALID_REQUEST", message: "Risk 来源无效" } },
        { status: 400 },
      );
    return jsonResponse(
      await generateRiskDrafts({
        principal,
        projectId,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
      { status: 201 },
    );
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
