import { createHash } from "node:crypto";
import { EmbeddingProviderError } from "./errors";
import type {
  EmbeddingProvider,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
} from "./provider-types";

const semanticReplacements: Array<[RegExp, string]> = [
  [/(上线|投产|启用|发布|go[ -]?live|launch|rollout|commence)/giu, " concept_launch "],
  [/(何时|什么时候|日期|时间|deadline|when|date|schedule)/giu, " concept_date "],
  [/(金额|费用|预算|成本|price|amount|budget|cost)/giu, " concept_amount "],
  [/(负责人|责任人|owner|responsible|assignee)/giu, " concept_owner "],
  [/(风险|隐患|阻塞|risk|blocker|issue)/giu, " concept_risk "],
  [/(范围|边界|scope|boundary)/giu, " concept_scope "],
  [/(审批|批准|同意|approval|approve|sign[ -]?off)/giu, " concept_approval "],
  [/(需求|要求|requirement|request|need)/giu, " concept_requirement "],
  [/(会议|纪要|meeting|minutes)/giu, " concept_meeting "],
  [/(部署|发布环境|deploy|deployment)/giu, " concept_deploy "],
  [/(切换|割接|cut[ -]?over)/giu, " concept_cutover "],
  [/(数据迁移|搬迁数据|data (?:move|migration)|migration)/giu, " concept_migration "],
  [/(登录|登入|login|sign[ -]?on)/giu, " concept_login "],
  [/(保留|保存|retention|retain)/giu, " concept_retention "],
  [/(故障|事故|outage|incident)/giu, " concept_incident "],
  [/(供应商|厂商|provider|vendor)/giu, " concept_vendor "],
  [/(客户|顾客|client|customer)/giu, " concept_customer "],
];

function normalizedSemanticText(text: string): string {
  let normalized = text.normalize("NFKC").toLocaleLowerCase();
  for (const [pattern, replacement] of semanticReplacements) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[^\p{L}\p{N}_]+/gu, " ").trim();
}

function deterministicVector(text: string, dimensions: number): number[] {
  const normalized = normalizedSemanticText(text);
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const compact = normalized.replace(/\s+/gu, "");
  const features = [
    ...tokens.map((value) => ({
      value: `token:${value}`,
      weight: value.startsWith("concept_") ? 10 : 3,
    })),
    ...Array.from(
      { length: Math.max(0, compact.length - 2) },
      (_, index) => ({
        value: `tri:${compact.slice(index, index + 3)}`,
        weight: 0.35,
      }),
    ),
  ];
  if (features.length === 0) features.push({ value: "empty", weight: 1 });
  const values = Array.from({ length: dimensions }, () => 0);
  for (const feature of features) {
    const digest = createHash("sha256").update(feature.value).digest();
    const index = (((digest[0] ?? 0) << 8) | (digest[1] ?? 0)) % dimensions;
    const sign = ((digest[2] ?? 0) & 1) === 0 ? 1 : -1;
    values[index] = (values[index] ?? 0) + sign * feature.weight;
  }
  const magnitude = Math.sqrt(
    values.reduce((total, value) => total + value * value, 0),
  );
  return values.map((value) => value / magnitude);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;

  async embed(
    request: EmbeddingProviderRequest,
  ): Promise<EmbeddingProviderResult> {
    const joined = request.inputs.join("\n");
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true, "pre_dispatch");
    }
    if (joined.includes("QUERY_EMBEDDING_PRE_DISPATCH_TEST")) {
      throw new EmbeddingProviderError(
        "CONFIGURATION_INVALID",
        false,
        "pre_dispatch",
      );
    }
    await request.onRequestStarted?.();
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true, "pre_dispatch");
    }
    if (joined.includes("QUERY_EMBEDDING_TIMEOUT_TEST")) {
      throw new EmbeddingProviderError("TIMEOUT", true, "post_dispatch");
    }
    const inputTokens = request.inputs.reduce(
      (total, input) => total + Math.max(1, input.trim().split(/\s+/u).length),
      0,
    );
    const digest = createHash("sha256")
      .update(request.inputs.join("\u0000"))
      .digest("hex")
      .slice(0, 24);
    const vectors = request.inputs.map((input) =>
        deterministicVector(input, request.dimensions),
      );
    if (joined.includes("QUERY_EMBEDDING_INVALID_TEST")) {
      vectors[0] = vectors[0]?.slice(1) ?? [];
    }
    const usageUnavailable = joined.includes("QUERY_EMBEDDING_USAGE_NULL_TEST");
    return {
      vectors,
      actualModel: request.model,
      inputTokens: usageUnavailable ? null : inputTokens,
      totalTokens: usageUnavailable ? null : inputTokens,
      providerRequestId: `fake-${digest}`,
      latencyMs: 0,
      dispatchClassification: "successful_response",
    };
  }
}
