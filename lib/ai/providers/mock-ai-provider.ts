import { AI_GATEWAY_DEFAULTS } from "@/config";
import type { TokenUsage } from "@/types";
import type {
  AIProviderAdapter,
  ProviderDocumentAnalysis,
  ProviderDocumentRequest,
  ProviderEmbeddingRequest,
  ProviderRequestContext,
  ProviderResult,
  ProviderStructuredRequest,
  ProviderTextRequest,
  ProviderToolRequest,
} from "./ai-provider";

export class MockAIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockAIProviderError";
  }
}

function estimateUsage(input: string, output: string): TokenUsage {
  const inputTokens = Math.max(24, Math.ceil(input.length * 0.72));
  const outputTokens = Math.max(16, Math.ceil(output.length * 0.76));
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class MockAIProvider implements AIProviderAdapter {
  private async simulate(context: ProviderRequestContext): Promise<number> {
    const configured = context.simulation?.latencyMs;
    const min = AI_GATEWAY_DEFAULTS.mockMinLatencyMs;
    const max = AI_GATEWAY_DEFAULTS.mockMaxLatencyMs;
    const latency = configured ?? min + (stableHash(context.executionId) % (max - min + 1));
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, latency));

    const shouldFail =
      context.simulation?.forceFailure === true ||
      context.attempt < (context.simulation?.failAttempts ?? 0);
    if (shouldFail) {
      throw new MockAIProviderError(
        context.simulation?.forceFailure
          ? "已按模拟配置触发供应商失败"
          : `第 ${context.attempt + 1} 次调用模拟超时`,
      );
    }
    return latency;
  }

  async generateText(
    request: ProviderTextRequest,
  ): Promise<ProviderResult<string>> {
    const latency = await this.simulate(request);
    const text = this.createText(request.skillId, request.prompt);
    return { data: text, usage: estimateUsage(request.prompt, text), latency };
  }

  async generateStructuredOutput<T>(
    request: ProviderStructuredRequest<T>,
  ): Promise<ProviderResult<T>> {
    const latency = await this.simulate(request);
    const serialized = JSON.stringify(request.mockData);
    return {
      data: request.mockData,
      usage: estimateUsage(`${request.schemaName}\n${request.prompt}`, serialized),
      latency,
    };
  }

  async generateEmbedding(
    request: ProviderEmbeddingRequest,
  ): Promise<ProviderResult<number[]>> {
    const latency = await this.simulate(request);
    const seed = stableHash(request.text);
    const data = Array.from({ length: request.dimensions }, (_, index) => {
      const value = Math.sin(seed + index * 31) * 0.5;
      return Number(value.toFixed(6));
    });
    return {
      data,
      usage: {
        inputTokens: Math.max(8, Math.ceil(request.text.length * 0.72)),
        outputTokens: 0,
        totalTokens: Math.max(8, Math.ceil(request.text.length * 0.72)),
      },
      latency,
    };
  }

  async analyzeDocument(
    request: ProviderDocumentRequest,
  ): Promise<ProviderResult<ProviderDocumentAnalysis>> {
    const latency = await this.simulate(request);
    const shortContent = request.content.replace(/\s+/g, " ").trim().slice(0, 120);
    const data = {
      summary: `${request.documentName} 已完成 Mock 解析。核心内容：${shortContent || "文档包含项目范围、约束和交付安排。"}`,
      extractedFacts: [
        "文档版本与来源日期已记录，可用于后续有效版本过滤。",
        "关键事实仍需项目经理审核后进入正式知识库。",
      ],
      extractedRequirements: request.skillId === "requirement-extraction"
        ? ["从文档中识别到可结构化的功能要求。", "从文档中识别到需要澄清的边界条件。"]
        : [],
    };
    return {
      data,
      usage: estimateUsage(request.content, JSON.stringify(data)),
      latency,
    };
  }

  async executeToolCall(
    request: ProviderToolRequest,
  ): Promise<ProviderResult<Record<string, unknown>>> {
    const latency = await this.simulate(request);
    const data = {
      ok: true,
      toolName: request.toolName,
      receivedArguments: request.arguments,
      note: "这是 Mock Tool Call，未执行任何外部写操作。",
    };
    return {
      data,
      usage: estimateUsage(JSON.stringify(request.arguments), JSON.stringify(data)),
      latency,
    };
  }

  private createText(skillId: string | undefined, prompt: string): string {
    const template: Record<string, string> = {
      "project-document-summary": "文档已归纳为项目背景、已确认事实、关键约束与待确认问题；所有结论均保留来源引用。",
      "requirement-extraction": "已生成结构化需求草稿，并完成重复、冲突与验收标准的初步检查，请进入审核中心确认。",
      "requirement-clarification": "建议优先确认适用范围、异常处理、验收数据口径与生效时间。",
      "requirement-deduplication": "已完成需求语义比对，发现潜在重复与规则冲突，结果尚未写入正式项目数据。",
      "scope-diff": "已完成 Scope 版本对比，输出新增、删除、修改、工期影响与上线风险建议。",
      "action-plan-extraction": "已生成包含负责人、截止日期、来源与阻塞关系的 Action Plan 草稿。",
      "meeting-summary": "会议摘要、已确认决策、新需求、Action Items、风险和待确认问题已完成提取。",
      "project-risk-analysis": "当前最大风险集中在关键依赖延迟，建议设定明确截止时间并准备替代方案。",
      "weekly-status-report": "本周关键进展、风险变化、待决策事项与下周计划已汇总为可审核周报。",
      "project-question-answering": "根据当前有效项目资料，已生成带来源引用的回答。",
    };
    return `${template[skillId ?? ""] ?? "Mock AI 已完成分析并生成可审核结果。"}\n\n问题摘要：${prompt.slice(0, 100)}`;
  }
}
