import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { workLogUpdateSchema } from "@/lib/timesheets/contracts";
import { TimesheetError } from "@/lib/timesheets/errors";
import { parseTimesheetRequest, timesheetErrorResponse } from "@/lib/timesheets/http";
import { deleteWorkLog, updateWorkLog } from "@/lib/timesheets/service";

const updateSchema = z
  .object({ organizationId: z.string().min(1).max(200), changes: workLogUpdateSchema })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { recordId } = await context.params;
    const body = await parseTimesheetRequest(request, updateSchema);
    return jsonResponse({
      record: await updateWorkLog({
        principal,
        organizationId: body.organizationId,
        recordId,
        values: body.changes,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ recordId: string }> },
) {
  try {
    requireTrustedMutationRequest(request, { allowedMediaTypes: [] });
    const principal = await requireApiPrincipal(request.headers);
    const { recordId } = await context.params;
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) throw new TimesheetError(422, "INVALID_REQUEST", "组织无效");
    return jsonResponse(
      await deleteWorkLog({
        principal,
        organizationId,
        recordId,
        requestHeaders: request.headers,
      }),
    );
  } catch (error) {
    return timesheetErrorResponse(error);
  }
}
