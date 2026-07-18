export type EmbeddingFailureCode =
  | "BAD_REQUEST"
  | "CONFIGURATION_INVALID"
  | "DAILY_JOB_LIMIT_REACHED"
  | "DAILY_TOKEN_LIMIT_REACHED"
  | "FORBIDDEN"
  | "INPUT_LIMIT_EXCEEDED"
  | "INVALID_RESPONSE"
  | "NETWORK"
  | "PROVIDER_RESULT_UNKNOWN"
  | "RATE_LIMITED"
  | "SECRET_NOT_CONFIGURED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "SHUTDOWN_ABORTED"
  | "UNAUTHORIZED"
  | "WORKER_LEASE_LOST"
  | "WORKER_MAX_ATTEMPTS_REACHED";

export class EmbeddingPipelineError extends Error {
  providerAttemptCount = 0;

  constructor(
    public readonly code: EmbeddingFailureCode,
    public readonly retryable: boolean,
    message = "Embedding operation failed.",
    public readonly dispatchClassification:
      | "pre_dispatch"
      | "post_dispatch"
      | "explicit_http_rejection"
      | "successful_response" = "pre_dispatch",
  ) {
    super(message);
    this.name = "EmbeddingPipelineError";
  }
}

export class EmbeddingProviderError extends EmbeddingPipelineError {
  constructor(
    code: EmbeddingFailureCode,
    retryable: boolean,
    dispatchClassification:
      | "pre_dispatch"
      | "post_dispatch"
      | "explicit_http_rejection"
      | "successful_response" = "post_dispatch",
  ) {
    super(
      code,
      retryable,
      "Embedding provider request failed.",
      dispatchClassification,
    );
    this.name = "EmbeddingProviderError";
  }
}

export function controlledEmbeddingError(error: unknown): EmbeddingPipelineError {
  if (error instanceof EmbeddingPipelineError) return error;
  return new EmbeddingPipelineError("SERVER_ERROR", true);
}
