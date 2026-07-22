import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import {
  generateWeeklyReport,
  listWeeklyReports,
} from "@/lib/project-management/work-management";

const schema = z
  .object({ periodStart: z.string(), periodEnd: z.string() })
  .strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(
      await listWeeklyReports({
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
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "周报周期无效" } },
        { status: 400 },
      );
    return jsonResponse(
      {
        draft: await generateWeeklyReport({
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
