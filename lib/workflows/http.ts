import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";
import { WorkflowError } from "./errors";

export function workflowErrorResponse(error: unknown): Response {
  if (error instanceof WorkflowError || error instanceof ProjectAssistantError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return authorizationErrorResponse(error);
}
