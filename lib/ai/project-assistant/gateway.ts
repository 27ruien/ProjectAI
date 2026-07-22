import {
  PROJECT_ASSISTANT_FALLBACK_MODEL,
  PROJECT_ASSISTANT_PRIMARY_MODEL,
  type AiRuntimeConfig,
} from "./config";
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
};

function responseFormatForPurpose(
  purpose: ProjectAssistantProviderPurpose,
): "text" | "json_object" {
  return [
    "requirement_extraction",
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
  if (error instanceof AiProviderError && error.code === "TIMEOUT") {
    return new ProjectAssistantError(
      503,
      "AI_PROVIDER_TIMEOUT",
      "AI 服务响应超时，请稍后重试",
    );
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
    let primaryFailure: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this.result(
          await this.invoke(PROJECT_ASSISTANT_PRIMARY_MODEL, input),
          false,
        );
      } catch (error) {
        primaryFailure = error;
        if (!(error instanceof AiProviderError) || !error.retryable) {
          throw controlledProviderFailure(error);
        }
        if (attempt < 2) await this.sleep((attempt + 1) * 1_000);
      }
    }

    try {
      return this.result(
        await this.invoke(PROJECT_ASSISTANT_FALLBACK_MODEL, input),
        true,
      );
    } catch (error) {
      throw controlledProviderFailure(error ?? primaryFailure);
    }
  }

  private invoke(
    model: string,
    input: ProjectAssistantGatewayInput,
  ): Promise<ProjectAssistantProviderResult> {
    return this.provider.generate({
      model,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      purpose: input.purpose,
      responseFormat: responseFormatForPurpose(input.purpose),
      timeoutMs: this.config.timeoutMs,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    });
  }

  private result(
    providerResult: ProjectAssistantProviderResult,
    fallbackUsed: boolean,
  ): AiGatewayResult {
    return {
      provider: this.provider.provider,
      requestedModel: PROJECT_ASSISTANT_PRIMARY_MODEL,
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
): ProjectAssistantGateway {
  const provider =
    config.provider === "fake"
      ? new FakeProjectAssistantProvider()
      : new QwenProjectAssistantProvider(config.qwenBaseUrl!);
  return new ProjectAssistantGateway(
    config,
    provider,
    config.provider === "fake" ? async () => undefined : undefined,
  );
}
