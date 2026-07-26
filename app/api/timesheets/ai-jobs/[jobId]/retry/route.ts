import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { retryTimesheetAiJob } from "@/lib/timesheets/ai-jobs";
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
    const result = await retryTimesheetAiJob({
      principal,
      organizationId: body.organizationId,
      jobId,
      requestHeaders: request.headers,
    });
    return jsonResponse(result, { status: result.created ? 202 : 200 });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
