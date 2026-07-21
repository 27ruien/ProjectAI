import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import {
  actionFields,
  reviewActionDraft,
} from "@/lib/project-management/work-management";

const schema = z
  .object({
    decision: z.enum(["accept", "edit_accept", "reject"]),
    fields: actionFields.optional(),
    note: z.string().trim().max(2_000).default(""),
  })
  .strict()
  .refine((value) => value.decision !== "edit_accept" || Boolean(value.fields));

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; draftId: string }> },
) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, draftId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "Action 审核参数无效" } },
        { status: 400 },
      );
    return jsonResponse(
      await reviewActionDraft({
        principal,
        projectId,
        draftId,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
    );
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
