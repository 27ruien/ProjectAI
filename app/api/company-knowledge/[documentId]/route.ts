import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { companyCategories, updateCompanyKnowledge } from "@/lib/focused-mvp/company-knowledge";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

type Context = { params: Promise<{ documentId: string }> };

const patchSchema = z.object({
  lifecycleStatus: z.enum(["draft", "published", "expired", "archived"]).optional(),
  category: z.enum(companyCategories).optional(),
  audience: z.enum(["organization", "department", "admin"]).optional(),
  departmentId: z.string().min(1).max(200).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { documentId } = await context.params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "公司资料变更无效" } }, { status: 400 });
    }
    const updated = await updateCompanyKnowledge({ principal, documentId, ...parsed.data });
    return jsonResponse({ documentId: updated.documentId, lifecycleStatus: updated.lifecycleStatus });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
