import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requirementEditSchema, updateRequirementDocument } from "@/lib/focused-mvp/requirement-documents";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string; requirementId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, requirementId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = requirementEditSchema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "INVALID_REQUEST", message: "需求文档内容无效" } }, { status: 400 });
    const document = await updateRequirementDocument({ principal, projectId, requirementId, sections: parsed.data.sections, requestHeaders: request.headers });
    return jsonResponse({ document });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
