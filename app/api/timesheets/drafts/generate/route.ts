import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { generateTimesheetSchema } from "@/lib/timesheets/contracts";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { generateDailyTimesheet } from "@/lib/timesheets/service";

export async function POST(request: Request) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const body = await parseTimesheetRequest(request, generateTimesheetSchema);
    return jsonResponse(
      {
        draft: await generateDailyTimesheet({
          principal,
          ...body,
          requestHeaders: request.headers,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
