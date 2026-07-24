export type FileErrorCode =
  | "INVALID_REQUEST"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "INVALID_OFFICE_CONTAINER"
  | "UPLOAD_ALREADY_EXISTS"
  | "UPLOAD_FAILED"
  | "DOCUMENT_NOT_FOUND"
  | "KNOWLEDGE_SPACE_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_AVAILABLE"
  | "DOCUMENT_ARCHIVED"
  | "TEMPORARY_DOCUMENT_EXPIRED"
  | "STORAGE_UNAVAILABLE";

export class FileOperationError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 413 | 415 | 503,
    public readonly code: FileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FileOperationError";
  }
}

export function fileErrorResponse(error: FileOperationError): Response {
  return new Response(
    JSON.stringify({ error: { code: error.code, message: error.message } }),
    {
      status: error.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
