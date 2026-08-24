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
  tokenUsageEstimated: boolean;
  providerRequestId: string | null;
  latencyMs: number;
  /** Provider responses do not currently include a trustworthy price. */
  costUsdMicros?: number | null;
};

export class AiGatewayObservedError extends ProjectAssistantError {
  constructor(public readonly observation: AiGatewayResult) {
    super(
      400,
      "MODEL_REQUEST_INVALID",
      "当前模型返回了与请求不一致的模型标识",
    );
    this.name = "AiGatewayObservedError";
  }
}

export type ProjectAssistantGatewayInput = {
  systemPrompt: string;
  userPrompt: string;
  purpose: ProjectAssistantProviderPurpose;
  /** Optional server-resolved model override; never accepted directly from UI. */
  model?: string;
  /** Server-controlled model capability check; never accepted from the browser. */
  forceJsonObject?: boolean;
  /** Stored server-side per model; never accepted from the browser. */
  disableThinkingForJson?: boolean;
  /** Server-controlled retry policy. Unknown-side-effect workflows use one attempt. */
  maxAttempts?: 1 | 2 | 3;
};

function responseFormatForPurpose(): "text" | "json_object" {
  return "text";
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
    const maxAttempts = input.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const model = input.model ?? PROJECT_ASSISTANT_PRIMARY_MODEL;
        const result = this.result(await this.invoke(model, input), model, false, input);
        if (result.actualModel !== model) throw new AiGatewayObservedError(result);
        return result;
      } catch (error) {
        if (!(error instanceof AiProviderError) || !error.retryable) {
          throw controlledProviderFailure(error);
        }
        lastRetryableError = error;
        if (attempt < maxAttempts - 1)
          await this.sleep((attempt + 1) * 1_000);
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
      responseFormat: input.forceJsonObject ? "json_object" : responseFormatForPurpose(),
      disableThinkingForJson: input.disableThinkingForJson ?? true,
      timeoutMs: this.config.timeoutMs,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    });
    return result;
  }

  private result(
    providerResult: ProjectAssistantProviderResult,
    requestedModel: string,
    fallbackUsed: boolean,
    input: ProjectAssistantGatewayInput,
  ): AiGatewayResult {
    const tokenUsageEstimated = providerResult.inputTokens === null || providerResult.outputTokens === null;
    const inputTokens = providerResult.inputTokens ?? Math.max(1, Math.ceil((input.systemPrompt.length + input.userPrompt.length) / 3));
    const outputTokens = providerResult.outputTokens ?? Math.max(1, Math.ceil(providerResult.text.length / 3));
    return {
      provider: this.provider.provider,
      requestedModel,
      actualModel: providerResult.actualModel,
      fallbackUsed,
      text: providerResult.text,
      inputTokens,
      outputTokens,
      totalTokens: providerResult.totalTokens ?? inputTokens + outputTokens,
      tokenUsageEstimated,
      providerRequestId: providerResult.providerRequestId,
      latencyMs: providerResult.latencyMs,
      // Fake calls are known to have zero external cost. DashScope does not
      // return price data, so real calls remain explicitly unknown.
      costUsdMicros: this.provider.provider === "fake" ? 0 : null,
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
