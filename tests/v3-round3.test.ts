import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectAssistantGateway } from "../lib/ai/project-assistant/gateway";
import { PROJECT_ASSISTANT_SYSTEM_PROMPT } from "../lib/ai/project-assistant/grounding";
import { processBoundedQuery, requiresQueryRewrite } from "../lib/ai/retrieval/query-processing";
import { rerankAuthorizedCandidates } from "../lib/ai/retrieval/rerank";
import { createDeterministicChunks } from "../lib/documents/processing/chunker";
import { getDocumentProcessingConfig } from "../lib/documents/processing/config";

function gateway(text: string): ProjectAssistantGateway {
  return { generate: async () => ({ provider: "fake", requestedModel: "fake", actualModel: "fake", fallbackUsed: false, text, inputTokens: 1, outputTokens: 1, totalTokens: 2, providerRequestId: null, latencyMs: 1 }) } as unknown as ProjectAssistantGateway;
}

describe("V3 structured chunking", () => {
  it("binds every child chunk to a section parent, table header context, type, quality and keywords", () => {
    const config = { ...getDocumentProcessingConfig(), chunkTargetChars: 60, chunkOverlapChars: 10, chunkMinChars: 10 };
    const content = "任务 | Owner | 日期\n准备验收 | 项目经理 | TBD\n确认范围 | 客户 | TBD\n".repeat(4);
    const chunks = createDeterministicChunks([{ sectionType: "table", heading: "计划表", headingPath: ["项目", "计划表"], sourceLocator: { type: "markdown_section", headingPath: ["项目", "计划表"], lineStart: 1, lineEnd: 12 }, content }], config);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.every((chunk) => chunk.chunkType === "table" && chunk.parentContent.includes("任务 | Owner | 日期")), true);
    assert.equal(chunks.every((chunk) => chunk.parentContentSha256.length === 64 && chunk.parseQualityBps === 10_000 && chunk.keywords.length > 0), true);
  });
});

describe("V3 bounded query processing and authorized rerank", () => {
  it("rewrites only complex queries and bounds provider output", async () => {
    assert.equal(requiresQueryRewrite("上线日期是什么？"), false);
    assert.equal(requiresQueryRewrite("请综合需求文档以及会议纪要，分别说明上线依赖和风险"), true);
    const processed = await processBoundedQuery({ query: "请综合需求文档以及会议纪要，分别说明上线依赖和风险", gateway: gateway(JSON.stringify({ normalizedQuery: "上线依赖与风险", rewrittenQueries: ["上线依赖", "项目风险"], intent: "cross_document_synthesis", keywords: ["上线", "风险"] })) });
    assert.equal(processed.rewriteUsed, true);
    assert.deepEqual(processed.rewrittenQueries, ["上线依赖与风险", "上线依赖", "项目风险"]);
  });

  it("rejects rerank output that adds an unauthorized candidate and preserves weighted order", async () => {
    const candidates = [{ chunkId: "authorized-a", value: { content: "A" } }, { chunkId: "authorized-b", value: { content: "B" } }];
    const result = await rerankAuthorizedCandidates({ query: "测试", candidates, gateway: gateway(JSON.stringify({ ranking: ["authorized-a", "unauthorized-x"] })) });
    assert.equal(result.fallbackReason, "RERANK_RESULT_INVALID");
    assert.deepEqual(result.candidates, candidates);
  });

  it("keeps structured answer, inference and citation rules in the grounded prompt", () => {
    assert.match(PROJECT_ASSISTANT_SYSTEM_PROMPT, /确定事实/);
    assert.match(PROJECT_ASSISTANT_SYSTEM_PROMPT, /基于证据的推论/);
    assert.match(PROJECT_ASSISTANT_SYSTEM_PROMPT, /每个事实性结论必须/);
  });
});
