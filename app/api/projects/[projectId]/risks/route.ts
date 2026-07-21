import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import {
  createManualRisk,
  listRisks,
  riskFields,
  updateRisk,
} from "@/lib/project-management/work-management";

const createSchema = z.object({ fields: riskFields }).strict();
const patchSchema = z
  .object({
    riskId: z.string().min(1).max(200),
    fields: riskFields,
    changeReason: z.string().trim().min(1).max(2_000),
  })
  .strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(
      await listRisks({
        principal,
        projectId,
        requestHeaders: request.headers,
      }),
    );
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "Risk 字段无效" } },
        { status: 400 },
      );
    return jsonResponse(
      {
        risk: await createManualRisk({
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "Risk 字段无效" } },
        { status: 400 },
      );
    return jsonResponse({
      risk: await updateRisk({
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
