import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { KnowledgeManagementError } from "./errors";

export function knowledgeManagementErrorResponse(error: unknown): Response {
  if (error instanceof KnowledgeManagementError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return authorizationErrorResponse(error);
}
