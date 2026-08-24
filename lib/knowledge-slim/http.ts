import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";
import { isRagflowError } from "@/lib/ragflow";
import { KnowledgeServiceError } from "./errors";

export function knowledgeServiceErrorResponse(error: unknown): Response {
  if (error instanceof KnowledgeServiceError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (isRagflowError(error)) {
    const publicCode = error.code === "RAGFLOW_TIMEOUT"
      ? "KNOWLEDGE_SERVICE_TIMEOUT"
      : error.code === "RAGFLOW_RATE_LIMITED"
        ? "KNOWLEDGE_SERVICE_BUSY"
        : error.code === "RAGFLOW_CONFIGURATION_INVALID"
          ? "KNOWLEDGE_SERVICE_NOT_CONFIGURED"
          : "KNOWLEDGE_SERVICE_UNAVAILABLE";
    return jsonResponse(
      { error: { code: publicCode, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ProjectAssistantError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  try {
    return authorizationErrorResponse(error);
  } catch {
    console.error("knowledge_service_failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return jsonResponse(
      { error: { code: "KNOWLEDGE_SERVICE_FAILED", message: "知识服务暂时不可用" } },
      { status: 503 },
    );
  }
}
