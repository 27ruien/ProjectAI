import { z } from "zod";
import type { ProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";

const rewriteSchema = z.object({
  normalizedQuery: z.string().trim().min(2).max(2_000),
  rewrittenQueries: z.array(z.string().trim().min(2).max(500)).max(3),
  intent: z.enum(["fact_lookup", "cross_document_synthesis", "table_lookup", "timeline", "risk", "knowledge_question"]),
  keywords: z.array(z.string().trim().min(1).max(80)).max(12),
}).strict();

export type ProcessedQuery = z.infer<typeof rewriteSchema> & {
  originalQuery: string;
  language: "zh" | "en" | "mixed";
  rewriteUsed: boolean;
  fallbackReason: string | null;
};

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function language(value: string): ProcessedQuery["language"] {
  const zh = /[\u3400-\u9fff]/.test(value);
  const en = /[A-Za-z]/.test(value);
  return zh && en ? "mixed" : zh ? "zh" : "en";
}

function deterministicKeywords(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,40}/gu) ?? [])].slice(0, 12);
}

export function requiresQueryRewrite(value: string): boolean {
  const query = normalize(value);
  return query.length >= 80 || /(?:以及|同时|分别|对比|综合|归纳|为什么|影响|and|compare|across|synthesi)/i.test(query);
}

export async function processBoundedQuery(input: { query: string; gateway?: ProjectAssistantGateway }): Promise<ProcessedQuery> {
  const originalQuery = normalize(input.query);
  const fallback: ProcessedQuery = {
    originalQuery,
    normalizedQuery: originalQuery,
    rewrittenQueries: [originalQuery],
    intent: "knowledge_question",
    keywords: deterministicKeywords(originalQuery),
    language: language(originalQuery),
    rewriteUsed: false,
    fallbackReason: null,
  };
  if (!input.gateway || !requiresQueryRewrite(originalQuery)) return fallback;
  try {
    const result = await input.gateway.generate({
      purpose: "query_rewrite",
      systemPrompt: "你是受控项目知识查询理解器。只改写用户问题，不回答问题，不添加事实，不接收资料。输出严格 JSON：normalizedQuery, rewrittenQueries, intent, keywords。最多 3 个改写。",
      userPrompt: `<current_question_json>${JSON.stringify(originalQuery)}</current_question_json>`,
    });
    const parsed = rewriteSchema.safeParse(JSON.parse(result.text));
    if (!parsed.success) return { ...fallback, fallbackReason: "QUERY_REWRITE_INVALID" };
    const rewrittenQueries = [...new Set([parsed.data.normalizedQuery, ...parsed.data.rewrittenQueries].map(normalize))].filter((item) => item.length >= 2).slice(0, 3);
    return { ...parsed.data, originalQuery, rewrittenQueries, language: language(originalQuery), rewriteUsed: true, fallbackReason: null };
  } catch {
    return { ...fallback, fallbackReason: "QUERY_REWRITE_UNAVAILABLE" };
  }
}
