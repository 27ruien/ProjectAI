import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectManagementErrorResponse } from "@/lib/project-management/http";
import { listProjectManagementAudits } from "@/lib/project-management/work-management";
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) { try { const { projectId } = await context.params; const principal = await requireApiPrincipal(request.headers); return jsonResponse({ audits: await listProjectManagementAudits({ principal, projectId, requestHeaders: request.headers }) }); } catch (error) { return projectManagementErrorResponse(error); } }
