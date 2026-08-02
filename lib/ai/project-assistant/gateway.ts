import { PROJECT_ASSISTANT_PRIMARY_MODEL, type AiRuntimeConfig } from "./config";
import { AiProviderError, ProjectAssistantError } from "./errors";
import { FakeProjectAssistantProvider } from "./fake-provider";
import type {
  ProjectAssistantProvider,
  ProjectAssistantProviderPurpose,
  ProjectAssistantProviderResult,
} from "./provider-types";
import { QwenProjectAssistantProvider } from "./qwen-provider";

export type AiGatewayResult = {
  provider: "qwen" | "fake";
  requestedModel: string;
  actualModel: string;
  fallbackUsed: boolean;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
};

export type ProjectAssistantGatewayInput = {
  systemPrompt: string;
  userPrompt: string;
  purpose: ProjectAssistantProviderPurpose;
  /** Resolved server-side scenario binding; never accepted directly from UI. */
  model?: string;
  /** Server-controlled model capability check; never accepted from the browser. */
  forceJsonObject?: boolean;
  /** Stored server-side per model; never accepted from the browser. */
  disableThinkingForJson?: boolean;
};

function responseFormatForPurpose(
  purpose: ProjectAssistantProviderPurpose,
): "text" | "json_object" {
  return [
    "requirement_extraction",
    "requirement_repair",
    "requirement_document",
    "requirement_document_repair",
    "requirement_overview",
    "action_generation",
    "risk_generation",
    "weekly_report",
    "timesheet_generation",
    "timesheet_repair",
  ].includes(purpose)
    ? "json_object"
    : "text";
}

function controlledProviderFailure(error: unknown): ProjectAssistantError {
  if (error instanceof ProjectAssistantError) return error;
  if (error instanceof AiProviderError) {
    if (error.code === "TIMEOUT") {
      return new ProjectAssistantError(
        503,
        "AI_PROVIDER_TIMEOUT",
        "AI 服务响应超时，请稍后重试",
      );
    }
    if (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN") {
      return new ProjectAssistantError(
        403,
        "MODEL_UNAUTHORIZED",
        "当前密钥无权调用此模型，请检查模型授权后重试",
      );
    }
    if (error.code === "NOT_FOUND") {
      return new ProjectAssistantError(
        404,
        "MODEL_NOT_FOUND",
        "当前模型不存在或当前工作区不可用",
      );
    }
    if (error.code === "RATE_LIMITED") {
      return new ProjectAssistantError(
        429,
        "MODEL_RATE_LIMITED",
        "当前模型请求过于频繁，请稍后重试",
      );
    }
    if (error.code === "BAD_REQUEST" || error.code === "INVALID_RESPONSE") {
      return new ProjectAssistantError(
        400,
        "MODEL_REQUEST_INVALID",
        "当前模型请求参数或返回格式无效",
      );
    }
  }
  return new ProjectAssistantError(
    503,
    "AI_PROVIDER_UNAVAILABLE",
    "AI 服务暂时不可用，请稍后重试",
  );
}

export class ProjectAssistantGateway {
  constructor(
    private readonly config: AiRuntimeConfig,
    private readonly provider: ProjectAssistantProvider,
    private readonly sleep: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
  ) {}

  async generate(
    input: ProjectAssistantGatewayInput,
  ): Promise<AiGatewayResult> {
    let lastRetryableError: AiProviderError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const model = input.model ?? PROJECT_ASSISTANT_PRIMARY_MODEL;
        return this.result(await this.invoke(model, input), model, false);
      } catch (error) {
        if (!(error instanceof AiProviderError) || !error.retryable) {
          throw controlledProviderFailure(error);
        }
        lastRetryableError = error;
        if (attempt < 2) await this.sleep((attempt + 1) * 1_000);
      }
    }
    throw controlledProviderFailure(
      lastRetryableError ?? new AiProviderError("SERVER_ERROR", true),
    );
  }

  private async invoke(
    model: string,
    input: ProjectAssistantGatewayInput,
  ): Promise<ProjectAssistantProviderResult> {
    const result = await this.provider.generate({
      model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      purpose: input.purpose,
      responseFormat: input.forceJsonObject ? "json_object" : responseFormatForPurpose(input.purpose),
      disableThinkingForJson: input.disableThinkingForJson ?? true,
      timeoutMs: this.config.timeoutMs,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    });
    if (result.actualModel !== model) {
      throw new AiProviderError("INVALID_RESPONSE", false);
    }
    return result;
  }

  private result(
    providerResult: ProjectAssistantProviderResult,
    requestedModel: string,
    fallbackUsed: boolean,
  ): AiGatewayResult {
    return {
      provider: this.provider.provider,
      requestedModel,
      actualModel: providerResult.actualModel,
      fallbackUsed,
      text: providerResult.text,
      inputTokens: providerResult.inputTokens,
      outputTokens: providerResult.outputTokens,
      totalTokens: providerResult.totalTokens,
      providerRequestId: providerResult.providerRequestId,
      latencyMs: providerResult.latencyMs,
    };
  }
}

export function createProjectAssistantGateway(
  config: AiRuntimeConfig,
  options: { apiKey?: string } = {},
): ProjectAssistantGateway {
  const provider =
    config.provider === "fake"
      ? new FakeProjectAssistantProvider()
      : new QwenProjectAssistantProvider(
          config.qwenBaseUrl!,
          fetch,
          options.apiKey ? async () => options.apiKey! : undefined,
        );
  return new ProjectAssistantGateway(
    config,
    provider,
    config.provider === "fake" ? async () => undefined : undefined,
  );
}
