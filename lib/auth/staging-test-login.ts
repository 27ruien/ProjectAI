export const STAGING_TEST_LOGIN_PATH =
  "/tool/projectai-staging/api/auth/sign-in/staging-test";
export const STAGING_TEST_LOGIN_ORIGIN = "https://gridworks.cn";
export const STAGING_TEST_LOGIN_IDENTITY = "admin" as const;

export type StagingTestLoginDecision =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "STAGING_TEST_LOGIN_DISABLED"
        | "STAGING_TEST_LOGIN_REQUEST_INVALID";
    };

function normalizedBasePath(value: string | undefined): string {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized ? `/${normalized}` : "";
}

function firstHeaderValue(value: string | null): string {
  return value?.split(",", 1)[0]?.trim().toLowerCase() ?? "";
}

function configuredTrustedOrigins(): Set<string> {
  return new Set(
    (process.env.AUTH_TRUSTED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isStagingTestLoginEnabled(): boolean {
  const explicitlyEnabled = process.env.ALLOW_STAGING_TEST_LOGIN === "true";
  const environment = (process.env.NEXT_PUBLIC_APP_ENV || "")
    .trim()
    .toLowerCase();
  if (environment === "production" && explicitlyEnabled) {
    throw new Error("STAGING_TEST_LOGIN_PRODUCTION_FORBIDDEN");
  }
  if (!explicitlyEnabled || environment !== "staging") return false;

  return (
    process.env.AUTH_PROVIDER?.trim().toLowerCase() === "mock-wecom" &&
    process.env.ALLOW_MOCK_WECOM_AUTH === "true" &&
    normalizedBasePath(process.env.NEXT_PUBLIC_BASE_PATH) ===
      "/tool/projectai-staging" &&
    process.env.BETTER_AUTH_URL?.trim() ===
      `${STAGING_TEST_LOGIN_ORIGIN}/tool/projectai-staging/api/auth` &&
    configuredTrustedOrigins().has(STAGING_TEST_LOGIN_ORIGIN)
  );
}

export function validateStagingTestLoginRequest(
  request: Request,
): StagingTestLoginDecision {
  try {
    if (!isStagingTestLoginEnabled()) {
      return { allowed: false, code: "STAGING_TEST_LOGIN_DISABLED" };
    }
  } catch {
    return { allowed: false, code: "STAGING_TEST_LOGIN_DISABLED" };
  }

  const requestUrl = new URL(request.url);
  const expectedHost = new URL(STAGING_TEST_LOGIN_ORIGIN).host;
  const host = firstHeaderValue(request.headers.get("host"));
  const forwardedHost = firstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProto = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const origin = request.headers.get("origin")?.trim() ?? "";

  if (
    request.method !== "POST" ||
    requestUrl.pathname !== STAGING_TEST_LOGIN_PATH ||
    origin !== STAGING_TEST_LOGIN_ORIGIN ||
    host !== expectedHost ||
    (forwardedHost && forwardedHost !== expectedHost) ||
    (forwardedProto && forwardedProto !== "https") ||
    (Boolean(forwardedHost) !== Boolean(forwardedProto))
  ) {
    return {
      allowed: false,
      code: "STAGING_TEST_LOGIN_REQUEST_INVALID",
    };
  }

  return { allowed: true };
}
