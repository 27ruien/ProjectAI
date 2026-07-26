import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { executeMockSyncBatch } from "@/lib/timesheets/service";

const schema = z.object({ organizationId: z.string().min(1).max(200) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ syncBatchId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { syncBatchId } = await context.params;
    const body = await parseTimesheetRequest(request, schema);
    return jsonResponse({
      batch: await executeMockSyncBatch({
        principal,
        organizationId: body.organizationId,
        syncBatchId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
