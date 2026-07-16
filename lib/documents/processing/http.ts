import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { FileOperationError, fileErrorResponse } from "@/lib/files/errors";
import { KnowledgeSearchError } from "./search-service";

export function documentProcessingErrorResponse(error: unknown): Response {
  if (error instanceof KnowledgeSearchError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof FileOperationError) return fileErrorResponse(error);
  return authorizationErrorResponse(error);
}
