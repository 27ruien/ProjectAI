import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { regenerateWorkflowArtifact, saveArtifactVersion } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expectedVersion: z.number().int().positive(), content: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ action: z.literal("regenerate"), expectedVersion: z.number().int().positive() }).strict(),
]);

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; runId: string; artifactId: string }> }) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId, artifactId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonResponse({ error: { code: "WORKFLOW_ARTIFACT_INVALID", message: "产物内容无效" } }, { status: 400 });
    if (parsed.data.action === "regenerate") {
      await regenerateWorkflowArtifact({ principal, projectId, runId, artifactId, expectedVersion: parsed.data.expectedVersion, requestHeaders: request.headers });
      return jsonResponse({ queued: true });
    }
    const version = await saveArtifactVersion({ principal, projectId, runId, artifactId, expectedVersion: parsed.data.expectedVersion, content: parsed.data.content, requestHeaders: request.headers });
    return jsonResponse({ version });
  } catch (error) { return workflowErrorResponse(error); }
}
