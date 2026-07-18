export type EmbeddingProviderRequest = {
  model: string;
  dimensions: number;
  inputs: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onRequestStarted?: () => Promise<void>;
};

export type EmbeddingDispatchClassification =
  | "pre_dispatch"
  | "post_dispatch"
  | "explicit_http_rejection"
  | "successful_response";

export type EmbeddingProviderResult = {
  vectors: number[][];
  actualModel: string;
  inputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
  dispatchClassification: "successful_response";
};

export interface EmbeddingProvider {
  readonly provider: "qwen" | "fake";
  embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult>;
}
