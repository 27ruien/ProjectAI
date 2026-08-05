import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { projectAssistantErrorResponse, setGeneralAssistantThreadModel } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ threadId: string }> };
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = z.object({ generationModelId: z.string().min(1).max(200).nullable() }).strict().safeParse(await request.json());
    if (!parsed.success) return jsonResponse({ error: { code: "AI_INVALID_REQUEST", message: "模型选择无效" } }, { status: 400 });
    await setGeneralAssistantThreadModel({ principal, threadId: (await context.params).threadId, generationModelId: parsed.data.generationModelId, requestHeaders: request.headers });
    return jsonResponse({ ok: true });
  } catch (error) { return projectAssistantErrorResponse(error); }
}
