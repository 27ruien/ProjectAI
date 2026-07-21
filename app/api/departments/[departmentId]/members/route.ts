import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { upsertDepartmentMember } from "@/lib/knowledge/management";

const schema = z
  .object({
    userId: z.string().min(1).max(200),
    role: z.enum(["department_admin", "department_member"]),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ departmentId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { departmentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "成员信息无效" } },
        { status: 400 },
      );
    }
    return jsonResponse({
      membership: await upsertDepartmentMember({
        principal,
        departmentId,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
