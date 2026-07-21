import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";
import { ProjectManagementError } from "./errors";

export function projectManagementErrorResponse(error: unknown): Response {
  if (error instanceof ProjectManagementError || error instanceof ProjectAssistantError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return authorizationErrorResponse(error);
}
