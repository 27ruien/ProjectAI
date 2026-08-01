import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { generateRequirementOverviewMarkdown } from "@/lib/focused-mvp/requirement-overview";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
type Context = { params: Promise<{ projectId: string; overviewId: string }> };
export async function POST(request: Request, context: Context) {
  try { requireTrustedMutationRequest(request); const { projectId, overviewId } = await context.params; const principal = await requireApiPrincipal(request.headers); const overview = await generateRequirementOverviewMarkdown({ principal, projectId, overviewId, requestHeaders: request.headers }); return jsonResponse({ overview }); }
  catch (error) { return projectManagementErrorResponse(error); }
}
