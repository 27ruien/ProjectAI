import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { timesheetDateSchema } from "@/lib/timesheets/contracts";
import { TimesheetError } from "@/lib/timesheets/errors";
import { timesheetErrorResponse } from "@/lib/timesheets/http";
import { getDailyDraft, timesheetCatalog } from "@/lib/timesheets/service";

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
      ...(await getDailyDraft({
        principal,
        organizationId,
        reportDate: parsedDate.data,
        requestHeaders: request.headers,
      })),
      catalog: timesheetCatalog,
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
