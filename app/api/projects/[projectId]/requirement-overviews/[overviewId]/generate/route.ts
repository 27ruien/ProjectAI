import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { generateRequirementOverviewCandidates } from "@/lib/focused-mvp/requirement-overview";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
type Context = { params: Promise<{ projectId: string; overviewId: string }> };
export async function POST(request: Request, context: Context) {
  try { requireTrustedMutationRequest(request); const { projectId, overviewId } = await context.params; const principal = await requireApiPrincipal(request.headers); const run = await generateRequirementOverviewCandidates({ principal, projectId, overviewId, payload: await request.json(), requestHeaders: request.headers }); return jsonResponse({ run }); }
  catch (error) { return projectManagementErrorResponse(error); }
}
