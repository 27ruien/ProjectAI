import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listRequirementOverviewGenerationModels } from "@/lib/focused-mvp/requirement-overview";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const models = await listRequirementOverviewGenerationModels({ principal, projectId, requestHeaders: request.headers });
    return jsonResponse({ models });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
