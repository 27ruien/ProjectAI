import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { createDepartment } from "@/lib/knowledge/management";

const schema = z
  .object({
    name: z.string().trim().min(2).max(200),
    code: z.string().trim().min(2).max(80),
    description: z.string().trim().max(2000).optional().default(""),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { organizationId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "部门信息无效" } },
        { status: 400 },
      );
    }
    return jsonResponse(
      {
        department: await createDepartment({
          principal,
          organizationId,
          ...parsed.data,
          requestHeaders: request.headers,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
