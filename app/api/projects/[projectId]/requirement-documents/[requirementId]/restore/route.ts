import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { restoreRequirementVersion } from "@/lib/focused-mvp/requirement-documents";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string; requirementId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, requirementId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({ document: await restoreRequirementVersion({ principal, projectId, requirementId, requestHeaders: request.headers }) }, { status: 201 });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
