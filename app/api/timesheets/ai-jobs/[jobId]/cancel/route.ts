import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { cancelTimesheetAiJob } from "@/lib/timesheets/ai-jobs";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";

const inputSchema = z.object({ organizationId: z.string().trim().min(1).max(200) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const body = await parseTimesheetRequest(request, inputSchema);
    const { jobId } = await context.params;
    return jsonResponse({
      job: await cancelTimesheetAiJob({
        principal,
        organizationId: body.organizationId,
        jobId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
