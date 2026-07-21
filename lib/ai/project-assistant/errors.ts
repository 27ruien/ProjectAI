export type ProjectAssistantErrorCode =
  | "AI_ASSISTANT_DISABLED"
  | "AI_CONFIGURATION_INVALID"
  | "AI_MODEL_PROFILE_NOT_FOUND"
  | "AI_MODEL_PROFILE_DISABLED"
  | "AI_SECRET_NOT_CONFIGURED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_EXECUTION_FAILED"
  | "AI_CITATION_VALIDATION_FAILED"
  | "AI_RATE_LIMITED"
  | "AI_USER_DAILY_LIMIT_REACHED"
  | "AI_PROJECT_DAILY_LIMIT_REACHED"
  | "AI_CONCURRENCY_LIMIT_REACHED"
  | "AI_IDEMPOTENCY_CONFLICT"
  | "AI_INVALID_REQUEST"
  | "AI_SOURCE_NOT_FOUND"
  | "AI_THREAD_NOT_FOUND";

export class ProjectAssistantError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 429 | 502 | 503,
    public readonly code: ProjectAssistantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAssistantError";
  }
}

export type ProviderFailureCode =
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "BAD_REQUEST"
  | "INVALID_RESPONSE";

export class AiProviderError extends Error {
  constructor(
    public readonly code: ProviderFailureCode,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "AiProviderError";
  }
}
