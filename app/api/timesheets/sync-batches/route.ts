import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { createSyncBatchSchema } from "@/lib/timesheets/contracts";
import { TimesheetError } from "@/lib/timesheets/errors";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { createSyncBatch, listSyncBatches } from "@/lib/timesheets/service";

export async function GET(request: Request) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) throw new TimesheetError(422, "INVALID_REQUEST", "组织无效");
    return jsonResponse(
      await listSyncBatches({ principal, organizationId, requestHeaders: request.headers }),
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const body = await parseTimesheetRequest(request, createSyncBatchSchema);
    return jsonResponse(
      await createSyncBatch({
        principal,
        ...body,
        requestHeaders: request.headers,
      }),
      { status: 201 },
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
