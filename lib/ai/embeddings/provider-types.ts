export type EmbeddingProviderRequest = {
  model: string;
  dimensions: number;
  inputs: string[];
  timeoutMs: number;
};

export type EmbeddingProviderResult = {
  vectors: number[][];
  actualModel: string;
  inputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
};

export interface EmbeddingProvider {
  readonly provider: "qwen" | "fake";
  embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult>;
}
