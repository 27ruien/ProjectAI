import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  deleteRegisteredFixtureTimesheetRun,
  fixtureCleanupContextFromHeaders,
} from "@/lib/test-fixtures/service";
import { timesheetDateSchema } from "@/lib/timesheets/contracts";

const inputSchema = z
  .object({
    userId: z.string().trim().min(1).max(200),
    reportDate: timesheetDateSchema,
  })
  .strict();

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const fixture = fixtureCleanupContextFromHeaders(request.headers);
    const parsed = inputSchema.safeParse(await request.json());
    if (
      principal.user.productRole !== "super_admin" ||
      !fixture ||
      !parsed.success
    ) {
      throw new KnowledgeManagementError(
        404,
        "RESOURCE_NOT_FOUND",
        "页面不存在",
      );
    }
    return jsonResponse({
      deleted: await deleteRegisteredFixtureTimesheetRun({
        ...fixture,
        userId: parsed.data.userId,
        reportDate: parsed.data.reportDate,
      }),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
