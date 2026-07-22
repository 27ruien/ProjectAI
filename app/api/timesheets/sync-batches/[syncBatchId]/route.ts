import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { updateSyncBatchSchema } from "@/lib/timesheets/contracts";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { updateSyncBatch } from "@/lib/timesheets/service";

const schema = updateSyncBatchSchema.extend({
  organizationId: z.string().min(1).max(200),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ syncBatchId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { syncBatchId } = await context.params;
    const body = await parseTimesheetRequest(request, schema);
    return jsonResponse({
      batch: await updateSyncBatch({
        principal,
        organizationId: body.organizationId,
        syncBatchId,
        status: body.status,
        items: body.items,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
