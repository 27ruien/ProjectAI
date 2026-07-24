import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { updateOrganizationMemberRole } from "@/lib/organization/service";

const schema = z.object({
  userId: z.string().min(1).max(200),
  productRole: z.enum(["super_admin", "admin", "member"]),
}).strict();

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "成员角色无效" } }, { status: 400 });
    }
    return jsonResponse({ member: await updateOrganizationMemberRole({
      principal,
      ...parsed.data,
      requestHeaders: request.headers,
    }) });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
