import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { askAcrossProjects, knowledgeServiceErrorResponse } from "@/lib/knowledge-slim";

const inputSchema = z
  .object({
    question: z.string().trim().min(2).max(2_000),
    projectIds: z.array(z.string().min(1).max(200)).max(30).optional(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success || (parsed.data.projectIds && new Set(parsed.data.projectIds).size !== parsed.data.projectIds.length)) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查问题和项目范围" } },
        { status: 400 },
      );
    }
    return jsonResponse(await askAcrossProjects({
      principal,
      question: parsed.data.question,
      selectedProjectIds: parsed.data.projectIds,
    }));
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
