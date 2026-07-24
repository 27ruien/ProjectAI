import { requireApiPrincipal } from "@/lib/auth/session";
import { TimesheetError } from "@/lib/timesheets/errors";
import { timesheetErrorResponse } from "@/lib/timesheets/http";
import { exportDailyDraft } from "@/lib/timesheets/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { draftId } = await context.params;
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) throw new TimesheetError(422, "INVALID_REQUEST", "组织无效");
    const payload = await exportDailyDraft({
      principal,
      organizationId,
      draftId,
      requestHeaders: request.headers,
    });
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="projectai-timesheet-${payload.reportDate}.json"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
