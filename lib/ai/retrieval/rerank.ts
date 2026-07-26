import { z } from "zod";
import type { ProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";

const resultSchema = z.object({ ranking: z.array(z.string().min(1).max(200)).max(30) }).strict();

export async function rerankAuthorizedCandidates<T extends { chunkId: string; value: { content: string } }>(input: {
  query: string;
  candidates: T[];
  gateway?: ProjectAssistantGateway;
}): Promise<{ candidates: T[]; fallbackReason: string | null; latencyMs: number }> {
  if (!input.gateway || input.candidates.length < 2) return { candidates: input.candidates, fallbackReason: input.gateway ? null : "RERANK_NOT_CONFIGURED", latencyMs: 0 };
  const started = performance.now();
  try {
    const result = await input.gateway.generate({
      purpose: "rerank",
      systemPrompt: "你是受控检索重排器。只能对输入候选按与问题的相关性排序；不得新增、删除或改写候选。只输出 JSON：ranking。",
      userPrompt: JSON.stringify({ query: input.query, candidates: input.candidates.map((candidate) => ({ chunkId: candidate.chunkId, content: candidate.value.content.slice(0, 1_500) })) }),
    });
    const parsed = resultSchema.safeParse(JSON.parse(result.text));
    const allowed = new Set(input.candidates.map((candidate) => candidate.chunkId));
    if (!parsed.success || parsed.data.ranking.length !== input.candidates.length || new Set(parsed.data.ranking).size !== input.candidates.length || parsed.data.ranking.some((id) => !allowed.has(id))) {
      return { candidates: input.candidates, fallbackReason: "RERANK_RESULT_INVALID", latencyMs: Math.max(0, Math.round(performance.now() - started)) };
    }
    const byId = new Map(input.candidates.map((candidate) => [candidate.chunkId, candidate]));
    return { candidates: parsed.data.ranking.map((id) => byId.get(id)!), fallbackReason: null, latencyMs: Math.max(0, Math.round(performance.now() - started)) };
  } catch {
    return { candidates: input.candidates, fallbackReason: "RERANK_UNAVAILABLE", latencyMs: Math.max(0, Math.round(performance.now() - started)) };
  }
}
