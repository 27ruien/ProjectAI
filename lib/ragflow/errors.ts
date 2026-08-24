export type RagflowErrorCode =
  | "RAGFLOW_CONFIGURATION_INVALID"
  | "RAGFLOW_UNAUTHORIZED"
  | "RAGFLOW_NOT_FOUND"
  | "RAGFLOW_RATE_LIMITED"
  | "RAGFLOW_TIMEOUT"
  | "RAGFLOW_UNAVAILABLE"
  | "RAGFLOW_INVALID_RESPONSE"
  | "RAGFLOW_REQUEST_REJECTED";

export class RagflowError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: RagflowErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RagflowError";
  }
}

export function isRagflowError(error: unknown): error is RagflowError {
  return error instanceof RagflowError;
}
