import { requireApiPrincipal } from "@/lib/auth/session";
import { getRequirementOverviewMarkdown } from "@/lib/focused-mvp/requirement-overview";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
type Context = { params: Promise<{ projectId: string; overviewId: string }> };
export async function GET(request: Request, context: Context) {
  try { const { projectId, overviewId } = await context.params; const principal = await requireApiPrincipal(request.headers); const overview = await getRequirementOverviewMarkdown({ principal, projectId, overviewId, requestHeaders: request.headers }); return new Response(overview.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="requirement-overview-v${overview.versionNumber}.md"`, "cache-control": "no-store" } }); }
  catch (error) { return projectManagementErrorResponse(error); }
}
