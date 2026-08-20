import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { productMapErrorResponse } from "@/lib/product-map/http";
import { cancelProductMapRun, continueLimitedEvidence, getProductMapRun, resumeProductMapRun, retryProductMapRun, scheduleProductMapRunInApp } from "@/lib/product-map/service";

type Context = { params: Promise<{ projectId: string; runId: string }> };
const actionSchema = z.object({ action: z.enum(["cancel", "retry", "continue", "resume"]), limitedEvidence: z.boolean().optional() }).strict();

export async function GET(request: Request, context: Context) {
  try {
    const { projectId, runId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const result = await getProductMapRun({ principal, projectId, runId, requestHeaders: request.headers });
    return jsonResponse(result);
  } catch (error) { return productMapErrorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, runId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "PRODUCT_MAP_ACTION_INVALID", message: "Product Map 操作无效" } }, { status: 400 });
    if (parsed.data.action === "cancel") return jsonResponse(await cancelProductMapRun({ principal, projectId, runId, requestHeaders: request.headers }));
    if (parsed.data.action === "resume") {
      const result = await resumeProductMapRun({ principal, projectId, runId, requestHeaders: request.headers });
      scheduleProductMapRunInApp({ runId, projectId });
      return jsonResponse(result);
    }
    if (parsed.data.action === "retry") {
      const result = await retryProductMapRun({ principal, projectId, runId, requestHeaders: request.headers });
      scheduleProductMapRunInApp({ runId, projectId });
      return jsonResponse(result);
    }
    const result = await continueLimitedEvidence({ principal, projectId, runId, limitedEvidence: parsed.data.limitedEvidence === true, requestHeaders: request.headers });
    scheduleProductMapRunInApp({ runId, projectId });
    return jsonResponse(result);
  } catch (error) { return productMapErrorResponse(error); }
}
