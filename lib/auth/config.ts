import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDb } from "@/lib/db/client";
import { betterAuthSchema } from "@/lib/db/schema";
import { findUserById } from "@/lib/db/repositories/user-repository";

const AUTH_PATH = "/api/auth";

function normalizeBasePath(value: string | undefined): string {
  const normalized = value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized ? `/${normalized}` : "";
}

function requireAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function getAuthBaseUrl(basePath: string): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const localOrigin = process.env.AUTH_LOCAL_ORIGIN?.trim() || "http://127.0.0.1:3000";
  return `${localOrigin.replace(/\/+$/, "")}${basePath}${AUTH_PATH}`;
}

function getTrustedOrigins(authBaseUrl: string): string[] {
  const configured = (process.env.AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const authOrigin = new URL(authBaseUrl).origin;
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.toLowerCase();
  if (environment === "staging" || environment === "production") {
    return Array.from(new Set([authOrigin, ...configured]));
  }
  return Array.from(
    new Set([
      authOrigin,
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      ...configured,
    ]),
  );
}

function getLoginRateLimitMax(): number {
  if (process.env.NEXT_PUBLIC_APP_ENV?.toLowerCase() !== "test") return 10;
  const configured = Number(process.env.AUTH_TEST_LOGIN_RATE_LIMIT_MAX);
  return Number.isInteger(configured) && configured >= 10 && configured <= 1_000
    ? configured
    : 10;
}

export function getTrustedAuthOrigins(): string[] {
  const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return getTrustedOrigins(getAuthBaseUrl(appBasePath));
}

function createAuth() {
  const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  const authBaseUrl = getAuthBaseUrl(appBasePath);
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.toLowerCase() || "development";
  const secureCookies = environment === "staging" || environment === "production";
  const cookiePrefix =
    process.env.AUTH_COOKIE_PREFIX?.trim() ||
    (appBasePath
      ? `projectai_${appBasePath.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`
      : "projectai_local");

  return betterAuth({
    appName: "Project AI OS",
    logger: { level: "error", disableColors: true },
    secret: requireAuthSecret(),
    baseURL: authBaseUrl,
    basePath: AUTH_PATH,
    trustedOrigins: getTrustedAuthOrigins(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: betterAuthSchema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    user: {
      fields: { name: "displayName" },
      additionalFields: {
        systemRole: {
          type: ["system_admin", "standard_user"],
          required: false,
          defaultValue: "standard_user",
          input: false,
        },
        status: {
          type: ["active", "disabled"],
          required: false,
          defaultValue: "active",
          input: false,
        },
        lastLoginAt: {
          type: "date",
          required: false,
          input: false,
        },
      },
    },
    session: {
      fields: { updatedAt: "lastSeenAt" },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 15,
      cookieCache: { enabled: false },
      freshAge: 60 * 60 * 12,
    },
    account: {
      fields: { password: "passwordHash" },
      accountLinking: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: getLoginRateLimitMax() },
      },
    },
    advanced: {
      useSecureCookies: secureCookies,
      trustedProxyHeaders: false,
      ipAddress: {
        ipAddressHeaders: ["x-real-ip"],
      },
      cookiePrefix,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: appBasePath || "/",
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (newSession) => {
            const currentUser = await findUserById(newSession.userId);
            return currentUser?.status === "active";
          },
        },
      },
    },
  });
}

export type ProjectAuth = ReturnType<typeof createAuth>;

let authInstance: ProjectAuth | undefined;

export function getAuth(): ProjectAuth {
  authInstance ??= createAuth();
  return authInstance;
}

export function resetAuthForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("resetAuthForTests is only available in NODE_ENV=test.");
  }
  authInstance = undefined;
}
