import { jsonResponse } from "@/lib/auth/http";
import { AuthorizationError } from "@/lib/auth/session";
import { ProjectAssistantError } from "@/lib/ai/project-assistant/errors";
import { ProductMapError } from "./service";

export function productMapErrorResponse(error: unknown): Response {
  if (error instanceof ProductMapError || error instanceof AuthorizationError || error instanceof ProjectAssistantError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return jsonResponse({ error: { code: "PRODUCT_MAP_UNAVAILABLE", message: "Product Map 暂时不可用，请稍后重试" } }, { status: 503 });
}
