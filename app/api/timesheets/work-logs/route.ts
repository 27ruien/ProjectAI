import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { workLogInputSchema, timesheetDateSchema } from "@/lib/timesheets/contracts";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { createWorkLog, listWorkLogs } from "@/lib/timesheets/service";
import { TimesheetError } from "@/lib/timesheets/errors";

export async function GET(request: Request) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId")?.trim() || "";
    const parsedDate = timesheetDateSchema.safeParse(url.searchParams.get("date"));
    if (!organizationId || !parsedDate.success) {
      throw new TimesheetError(422, "INVALID_REQUEST", "组织或日期无效");
    }
    return jsonResponse(
      await listWorkLogs({
        principal,
        organizationId,
        reportDate: parsedDate.data,
        requestHeaders: request.headers,
      }),
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const values = await parseTimesheetRequest(request, workLogInputSchema);
    return jsonResponse(
      { record: await createWorkLog({ principal, values, requestHeaders: request.headers }) },
      { status: 201 },
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
