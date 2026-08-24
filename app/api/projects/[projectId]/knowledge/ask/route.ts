import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { askProjectKnowledge, knowledgeServiceErrorResponse } from "@/lib/knowledge-slim";

type Context = { params: Promise<{ projectId: string }> };
const inputSchema = z.object({ question: z.string().trim().min(2).max(2_000) }).strict();

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const project = await requireProjectAccess(principal, projectId, request.headers);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请输入有效问题" } },
        { status: 400 },
      );
    }
    return jsonResponse(await askProjectKnowledge({
      principal,
      project,
      question: parsed.data.question,
    }));
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
