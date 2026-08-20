import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { productMapErrorResponse } from "@/lib/product-map/http";
import { attachProductMapSource, scheduleProductMapRunInApp } from "@/lib/product-map/service";

type Context = { params: Promise<{ projectId: string; runId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, runId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const body = await request.json() as { documentId?: unknown };
    if (typeof body.documentId !== "string" || !body.documentId.trim()) return jsonResponse({ error: { code: "PRODUCT_MAP_SOURCE_INVALID", message: "资料 ID 无效" } }, { status: 400 });
    const result = await attachProductMapSource({ principal, projectId, runId, documentId: body.documentId, requestHeaders: request.headers });
    if (["queued", "checking_sources", "indexing", "retrieving", "running"].includes(result.run.status)) scheduleProductMapRunInApp({ runId, projectId });
    return jsonResponse(result, { status: 201 });
  } catch (error) { return productMapErrorResponse(error); }
}
