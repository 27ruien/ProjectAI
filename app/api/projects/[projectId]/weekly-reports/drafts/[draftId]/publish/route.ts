import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import {
  publishWeeklyReport,
  weeklySectionsSchema,
} from "@/lib/project-management/work-management";

const schema = z.object({ sections: weeklySectionsSchema.optional() }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; draftId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, draftId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "周报内容无效" } },
        { status: 400 },
      );
    return jsonResponse(
      {
        version: await publishWeeklyReport({
          principal,
          projectId,
          draftId,
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
