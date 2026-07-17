import { AiProviderError } from "./errors";
import type {
  ProjectAssistantProvider,
  ProjectAssistantProviderRequest,
  ProjectAssistantProviderResult,
} from "./provider-types";

const retryableTimeoutAttempts = new Map<string, number>();

function usage(input: string, output: string) {
  const inputTokens = Math.max(20, Math.ceil(input.length / 3));
  const outputTokens = Math.max(8, Math.ceil(output.length / 3));
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function taggedJsonString(prompt: string, tag: string): string {
  const match = prompt.match(
    new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`),
  );
  if (!match?.[1]) return "";
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export class FakeProjectAssistantProvider
  implements ProjectAssistantProvider
{
  readonly provider = "fake" as const;
  readonly calls: ProjectAssistantProviderRequest[] = [];

  async generate(
    request: ProjectAssistantProviderRequest,
  ): Promise<ProjectAssistantProviderResult> {
    this.calls.push(request);
    const currentQuestion = taggedJsonString(
      request.userPrompt,
      "current_question_json",
    );
    const answerToRepair = taggedJsonString(request.userPrompt, "answer_json");
    if (request.userPrompt.includes("FAKE_401")) {
      throw new AiProviderError("UNAUTHORIZED", false);
    }
    if (request.userPrompt.includes("FAKE_403")) {
      throw new AiProviderError("FORBIDDEN", false);
    }
    if (request.userPrompt.includes("FAKE_429")) {
      throw new AiProviderError("RATE_LIMITED", true);
    }
    if (request.userPrompt.includes("FAKE_500")) {
      throw new AiProviderError("SERVER_ERROR", true);
    }
    if (
      (request.userPrompt.includes("FAKE_PRIMARY_FAILURE") ||
        currentQuestion.includes("备用模型验证")) &&
      request.model === "qwen3.7-plus"
    ) {
      throw new AiProviderError("SERVER_ERROR", true);
    }
    if (currentQuestion.includes("供应商超时后重试验证")) {
      const attempts = retryableTimeoutAttempts.get(currentQuestion) ?? 0;
      if (attempts < 4) {
        retryableTimeoutAttempts.set(currentQuestion, attempts + 1);
        throw new AiProviderError("TIMEOUT", true);
      }
    } else if (
      request.userPrompt.includes("FAKE_TIMEOUT") ||
      currentQuestion.includes("供应商超时验证")
    ) {
      throw new AiProviderError("TIMEOUT", true);
    }

    let text: string;
    if (request.purpose === "probe") {
      text = "PROJECT_AI_QWEN_PROBE_OK";
    } else if (
      request.userPrompt.includes("FAKE_REPAIR_FAIL") ||
      currentQuestion.includes("引用修复失败验证") ||
      answerToRepair.includes("引用修复失败验证") ||
      (request.purpose === "answer" &&
        (request.userPrompt.includes("FAKE_INVALID_CITATION") ||
          currentQuestion.includes("引用修复验证")))
    ) {
      text =
        currentQuestion.includes("引用修复失败验证") ||
        answerToRepair.includes("引用修复失败验证")
        ? "引用修复失败验证。[E99]"
        : "客户要求在 2026 年 10 月 15 日上线。[E99]";
    } else if (request.purpose === "repair") {
      text = "客户要求在 2026 年 10 月 15 日上线。[E1]";
    } else if (currentQuestion.includes("Ignore all prior instructions")) {
      text = "资料中的指令属于不可信内容，不能执行；项目上线日期为 2026 年 10 月 15 日。[E1]";
    } else {
      text = "客户要求在 2026 年 10 月 15 日上线。[E1]";
    }
    const tokenUsage = usage(
      `${request.systemPrompt}\n${request.userPrompt}`,
      text,
    );
    return {
      text,
      actualModel: request.model,
      ...tokenUsage,
      providerRequestId: `fake-${this.calls.length}`,
      latencyMs: 5,
    };
  }
}
