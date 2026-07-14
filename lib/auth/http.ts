import { AuthorizationError } from "./session";
import { getTrustedAuthOrigins } from "./config";

class MutationRequestError extends Error {
  constructor(
    public readonly status: 403 | 415,
    public readonly code: "UNTRUSTED_ORIGIN" | "UNSUPPORTED_MEDIA_TYPE",
    message: string,
  ) {
    super(message);
    this.name = "MutationRequestError";
  }
}

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

export function requireTrustedMutationRequest(request: Request): void {
  const suppliedOrigin = request.headers.get("origin")?.trim() || "";
  const origin = normalizedOrigin(suppliedOrigin);
  const trustedOrigins = new Set(
    getTrustedAuthOrigins()
      .map(normalizedOrigin)
      .filter((value): value is string => Boolean(value)),
  );
  if (!origin || suppliedOrigin !== origin || !trustedOrigins.has(origin)) {
    throw new MutationRequestError(
      403,
      "UNTRUSTED_ORIGIN",
      "请求来源不受信任",
    );
  }

  if (["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) {
    const mediaType = (request.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (mediaType !== "application/json") {
      throw new MutationRequestError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "请求格式无效",
      );
    }
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function authorizationErrorResponse(error: unknown): Response {
  if (error instanceof MutationRequestError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof AuthorizationError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  throw error;
}
