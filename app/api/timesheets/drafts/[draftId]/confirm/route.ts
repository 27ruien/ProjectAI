import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { confirmTimesheetDraftSchema } from "@/lib/timesheets/contracts";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { confirmDailyDraft } from "@/lib/timesheets/service";

const schema = confirmTimesheetDraftSchema.extend({
  organizationId: z.string().min(1).max(200),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { draftId } = await context.params;
    const body = await parseTimesheetRequest(request, schema);
    return jsonResponse({
      draft: await confirmDailyDraft({
        principal,
        organizationId: body.organizationId,
        draftId,
        expectedVersion: body.expectedVersion,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
