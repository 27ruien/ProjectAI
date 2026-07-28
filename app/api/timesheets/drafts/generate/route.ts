import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { generateTimesheetSchema } from "@/lib/timesheets/contracts";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { enqueueTimesheetAiJob } from "@/lib/timesheets/ai-jobs";

export async function POST(request: Request) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const body = await parseTimesheetRequest(request, generateTimesheetSchema);
    const result = await enqueueTimesheetAiJob({
      principal,
      ...body,
      requestHeaders: request.headers,
    });
    return jsonResponse(result, { status: result.created ? 202 : 200 });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
