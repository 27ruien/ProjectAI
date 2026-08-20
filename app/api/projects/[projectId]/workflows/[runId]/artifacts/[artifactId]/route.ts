import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { productMapErrorResponse } from "@/lib/product-map/http";
import { editProductMapArtifact, publishProductMapArtifact, reviewProductMapArtifact } from "@/lib/product-map/service";

type Context = { params: Promise<{ projectId: string; runId: string; artifactId: string }> };
const actionSchema = z.object({ action: z.enum(["edit", "review", "publish"]), decision: z.enum(["approve", "reject"]).optional(), expectedVersion: z.number().int().positive().optional(), content: z.unknown().optional() }).strict();

export async function PATCH(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, runId, artifactId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "PRODUCT_MAP_ARTIFACT_ACTION_INVALID", message: "产品结构操作无效" } }, { status: 400 });
    if (parsed.data.action === "review") {
      if (!parsed.data.decision) return jsonResponse({ error: { code: "PRODUCT_MAP_REVIEW_DECISION_REQUIRED", message: "审核决定不能为空" } }, { status: 400 });
      return jsonResponse(await reviewProductMapArtifact({ principal, projectId, runId, artifactId, decision: parsed.data.decision, requestHeaders: request.headers }));
    }
    if (parsed.data.action === "publish") return jsonResponse(await publishProductMapArtifact({ principal, projectId, runId, artifactId, requestHeaders: request.headers }));
    if (parsed.data.expectedVersion === undefined || parsed.data.content === undefined) return jsonResponse({ error: { code: "PRODUCT_MAP_VERSION_REQUIRED", message: "编辑需要版本号和内容" } }, { status: 400 });
    return jsonResponse(await editProductMapArtifact({ principal, projectId, runId, artifactId, expectedVersion: parsed.data.expectedVersion, content: parsed.data.content, requestHeaders: request.headers }));
  } catch (error) { return productMapErrorResponse(error); }
}
