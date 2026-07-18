import { FakeEmbeddingProvider } from "./fake-provider";
import {
  EmbeddingPipelineError,
  EmbeddingProviderError,
  controlledEmbeddingError,
} from "./errors";
import type { EmbeddingRuntimeConfig } from "./config";
import type { EmbeddingProvider } from "./provider-types";
import { QwenEmbeddingProvider } from "./qwen-provider";

export type EmbeddingGatewayResult = {
  provider: "qwen" | "fake";
  requestedModel: string;
  actualModel: string;
  dimensions: number;
  vectors: number[][];
  inputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
  attemptCount: number;
};

export class EmbeddingGateway {
  constructor(
    private readonly config: EmbeddingRuntimeConfig,
    private readonly provider: EmbeddingProvider,
  ) {}

  async embed(
    inputs: string[],
    options: { signal?: AbortSignal; onProviderRequestStarted?: () => void } = {},
  ): Promise<EmbeddingGatewayResult> {
    const totalCharacters = inputs.reduce((total, input) => total + input.length, 0);
    if (
      inputs.length < 1 ||
      inputs.length > 10 ||
      inputs.length > this.config.batchSize ||
      inputs.some((input) => !input.trim()) ||
      totalCharacters > this.config.batchMaxCharacters
    ) {
      throw new EmbeddingPipelineError("INPUT_LIMIT_EXCEEDED", false);
    }

    try {
      const result = await this.provider.embed({
        model: this.config.model,
        dimensions: this.config.dimensions,
        inputs,
        timeoutMs: this.config.timeoutMs,
        signal: options.signal,
        onRequestStarted: options.onProviderRequestStarted,
      });
      if (
        result.actualModel !== this.config.model ||
        result.vectors.length !== inputs.length ||
        result.vectors.some(
          (vector) =>
            vector.length !== this.config.dimensions ||
            vector.some((value) => !Number.isFinite(value)),
        )
      ) {
        throw new EmbeddingProviderError("INVALID_RESPONSE", false);
      }
      return {
        provider: this.provider.provider,
        requestedModel: this.config.model,
        actualModel: result.actualModel,
        dimensions: this.config.dimensions,
        vectors: result.vectors,
        inputTokens: result.inputTokens,
        totalTokens: result.totalTokens,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
        attemptCount: 1,
      };
    } catch (error) {
      const controlled = controlledEmbeddingError(error);
      controlled.providerAttemptCount = 1;
      throw controlled;
    }
  }
}

export function createEmbeddingGateway(
  config: EmbeddingRuntimeConfig,
): EmbeddingGateway {
  if (config.provider === "qwen" && !config.qwenBaseUrl) {
    throw new EmbeddingPipelineError("CONFIGURATION_INVALID", false);
  }
  const provider =
    config.provider === "fake"
      ? new FakeEmbeddingProvider()
      : new QwenEmbeddingProvider(config.qwenBaseUrl!);
  return new EmbeddingGateway(config, provider);
}
