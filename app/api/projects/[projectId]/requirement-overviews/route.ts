import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { createRequirementOverview, listRequirementOverviews } from "@/lib/focused-mvp/requirement-overview";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) {
  try { const { projectId } = await context.params; const principal = await requireApiPrincipal(request.headers); return jsonResponse({ overviews: await listRequirementOverviews({ principal, projectId, requestHeaders: request.headers }) }); }
  catch (error) { return projectManagementErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try { requireTrustedMutationRequest(request); const { projectId } = await context.params; const principal = await requireApiPrincipal(request.headers); const overview = await createRequirementOverview({ principal, projectId, payload: await request.json(), requestHeaders: request.headers }); return jsonResponse({ overview }, { status: 201 }); }
  catch (error) { return projectManagementErrorResponse(error); }
}
