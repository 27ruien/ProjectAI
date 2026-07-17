export type EmbeddingFailureCode =
  | "BAD_REQUEST"
  | "CONFIGURATION_INVALID"
  | "DAILY_JOB_LIMIT_REACHED"
  | "DAILY_TOKEN_LIMIT_REACHED"
  | "FORBIDDEN"
  | "INPUT_LIMIT_EXCEEDED"
  | "INVALID_RESPONSE"
  | "NETWORK"
  | "RATE_LIMITED"
  | "SECRET_NOT_CONFIGURED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "WORKER_LEASE_LOST"
  | "WORKER_MAX_ATTEMPTS_REACHED";

export class EmbeddingPipelineError extends Error {
  providerAttemptCount = 0;

  constructor(
    public readonly code: EmbeddingFailureCode,
    public readonly retryable: boolean,
    message = "Embedding operation failed.",
  ) {
    super(message);
    this.name = "EmbeddingPipelineError";
  }
}

export class EmbeddingProviderError extends EmbeddingPipelineError {
  constructor(code: EmbeddingFailureCode, retryable: boolean) {
    super(code, retryable, "Embedding provider request failed.");
    this.name = "EmbeddingProviderError";
  }
}

export function controlledEmbeddingError(error: unknown): EmbeddingPipelineError {
  if (error instanceof EmbeddingPipelineError) return error;
  return new EmbeddingPipelineError("SERVER_ERROR", true);
}
