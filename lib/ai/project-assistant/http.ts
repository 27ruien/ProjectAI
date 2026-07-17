import {
  authorizationErrorResponse,
  jsonResponse,
} from "@/lib/auth/http";
import { ProjectAssistantError } from "./errors";

export function projectAssistantErrorResponse(error: unknown): Response {
  if (error instanceof ProjectAssistantError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  try {
    return authorizationErrorResponse(error);
  } catch {
    return jsonResponse(
      {
        error: {
          code: "AI_EXECUTION_FAILED",
          message: "AI 回答暂时不可用，请稍后重试",
        },
      },
      { status: 503 },
    );
  }
}
