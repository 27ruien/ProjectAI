import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { getLatestTimesheetAiJob } from "@/lib/timesheets/ai-jobs";
import { timesheetDateSchema } from "@/lib/timesheets/contracts";
import { TimesheetError } from "@/lib/timesheets/errors";
import { timesheetErrorResponse } from "@/lib/timesheets/http";

export async function GET(request: Request) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId")?.trim() || "";
    const parsedDate = timesheetDateSchema.safeParse(url.searchParams.get("date"));
    if (!organizationId || !parsedDate.success) {
      throw new TimesheetError(422, "INVALID_REQUEST", "组织或日期无效");
    }
    return jsonResponse({
      job: await getLatestTimesheetAiJob({
        principal,
        organizationId,
        reportDate: parsedDate.data,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
