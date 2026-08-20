import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { productMapErrorResponse } from "@/lib/product-map/http";
import { createProductMapRun, listProductMapRuns, listProductMapSkills, scheduleProductMapRunInApp } from "@/lib/product-map/service";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({ workflows: await listProductMapRuns({ principal, projectId, requestHeaders: request.headers }), skills: await listProductMapSkills({ principal, projectId }) });
  } catch (error) {
    return productMapErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const result = await createProductMapRun({ principal, projectId, request: await request.json(), requestHeaders: request.headers });
    if (["queued", "checking_sources", "indexing", "retrieving", "running"].includes(result.run.status)) {
      scheduleProductMapRunInApp({ runId: result.run.id, projectId });
    }
    return jsonResponse(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return productMapErrorResponse(error);
  }
}
