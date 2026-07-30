import { requireApiPrincipal } from "@/lib/auth/session";
import { jsonResponse } from "@/lib/auth/http";
import { listWorkflowRuns } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

export async function GET(request: Request) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() || undefined;
    const runs = await listWorkflowRuns({ principal, projectId, limit: 50 });
    return jsonResponse({ runs });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
