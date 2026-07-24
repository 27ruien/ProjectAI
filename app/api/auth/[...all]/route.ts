import { and, eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth/config";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { getAuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb } from "@/lib/db/client";
import { session } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  findUserById,
  updateLastLoginAt,
} from "@/lib/db/repositories/user-repository";
import {
  isLegacyCredentialAuthEnabled,
  isMockWeComAuthEnabled,
} from "@/lib/auth/providers";

function isRoute(request: Request, suffix: string): boolean {
  return new URL(request.url).pathname.endsWith(`/api/auth${suffix}`);
}

function copyResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") headers.append(name, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  return headers;
}

function safeAuthJson(
  data: unknown,
  response: Response,
  status = response.status,
): Response {
  return jsonResponse(data, {
    status,
    headers: copyResponseHeaders(response),
  });
}

function noStoreAuthResponse(response: Response): Response {
  const headers = copyResponseHeaders(response);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unsupportedAuthRoute(): Response {
  return jsonResponse(
    { error: { code: "NOT_FOUND", message: "认证端点不存在" } },
    {
      status: 404,
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}

function expiredLoginHeaders(response: Response): Headers {
  const headers = copyResponseHeaders(response);
  headers.delete("set-cookie");
  for (const setCookie of response.headers.getSetCookie()) {
    const [cookiePair, ...attributes] = setCookie.split(";");
    const cookieName = cookiePair.split("=", 1)[0]?.trim();
    if (!cookieName) continue;
    const retainedAttributes = attributes.filter(
      (attribute) => !/^\s*(?:max-age|expires)=/i.test(attribute),
    );
    headers.append(
      "set-cookie",
      `${cookieName}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT;${retainedAttributes.join(";")}`,
    );
  }
  return headers;
}

function expiredRequestSessionHeaders(
  request: Request,
  response: Response,
): Headers {
  const headers = expiredLoginHeaders(response);
  const basePath = `/${(process.env.NEXT_PUBLIC_BASE_PATH || "")
    .replace(/^\/+|\/+$/g, "")}`.replace(/^\/$/, "/");
  const secure = ["staging", "production"].includes(
    (process.env.NEXT_PUBLIC_APP_ENV || "").toLowerCase(),
  );
  const cookieNames = (request.headers.get("cookie") || "")
    .split(";")
    .map((cookie) => cookie.split("=", 1)[0]?.trim())
    .filter(
      (name): name is string =>
        Boolean(name) &&
        /\.(?:session_token|session_data|dont_remember)$/.test(name),
    );
  for (const cookieName of new Set(cookieNames)) {
    headers.append(
      "set-cookie",
      `${cookieName}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${basePath}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
  }
  return headers;
}

async function auditFailedLogin(request: Request, response: Response): Promise<void> {
  const context = getRequestAuditContext(request.headers);
  await writeAuditEvent({
    eventType: "login_failed",
    entityType: "session",
    result: response.status === 429 ? "denied" : "failed",
    metadata: {
      reason: response.status === 429 ? "rate_limited" : "invalid_credentials",
    },
    ...context,
  });
}

async function finalizeSuccessfulLogin(
  request: Request,
  response: Response,
): Promise<Response> {
  const payload = (await response.clone().json()) as {
    token?: string;
    user?: { id?: string };
  };
  const token = payload.token;
  const userId = payload.user?.id;
  if (!token || !userId) {
    return jsonResponse(
      { error: { code: "AUTH_UNAVAILABLE", message: "暂时无法完成登录" } },
      { status: 503, headers: expiredLoginHeaders(response) },
    );
  }

  try {
    const requestContext = getRequestAuditContext(request.headers);
    await getDb().transaction(async (tx) => {
      const [createdSession] = await tx
        .select()
        .from(session)
        .where(and(eq(session.token, token), eq(session.userId, userId)))
        .limit(1);
      if (!createdSession) {
        throw new Error("The authenticated Session was not persisted.");
      }
      await updateLastLoginAt(userId, tx);
      await writeAuditEvent(
        {
          actorUserId: userId,
          eventType: "login_succeeded",
          entityType: "session",
          entityId: createdSession.id,
          result: "succeeded",
          ...requestContext,
        },
        tx,
      );
    });
  } catch {
    await getDb().delete(session).where(eq(session.token, token)).catch(() => undefined);
    return jsonResponse(
      { error: { code: "AUTH_UNAVAILABLE", message: "暂时无法完成登录" } },
      { status: 503, headers: expiredLoginHeaders(response) },
    );
  }

  // Better Auth's credential endpoint includes the raw Session token in its
  // JSON payload. The browser only needs the HttpOnly cookie, so expose the
  // smallest possible response and retain the library's Set-Cookie headers.
  return safeAuthJson({ authenticated: true }, response);
}

async function sanitizeSessionLookup(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!response.ok) return noStoreAuthResponse(response);
  const payload = (await response.clone().json()) as
    | {
        session?: {
          id?: string;
          createdAt?: string;
          expiresAt?: string;
          lastSeenAt?: string;
        };
        user?: { id?: string; email?: string; displayName?: string; systemRole?: string };
      }
    | null;
  if (!payload?.user?.id || !payload.session?.id) {
    return jsonResponse(null, {
      status: response.status,
      headers: expiredRequestSessionHeaders(request, response),
    });
  }

  const currentUser = await findUserById(payload.user.id);
  if (!currentUser || currentUser.status !== "active") {
    await getDb().transaction(async (tx) => {
      await tx.delete(session).where(eq(session.userId, payload.user!.id!));
      await writeAuditEvent(
        {
          actorUserId: currentUser?.id ?? null,
          eventType: "disabled_session_revoked",
          entityType: "user",
          entityId: payload.user!.id!,
          result: "denied",
          metadata: { reason: "identity_not_active" },
          ...getRequestAuditContext(request.headers),
        },
        tx,
      );
    });
    return jsonResponse(null, {
      status: response.status,
      headers: expiredRequestSessionHeaders(request, response),
    });
  }

  return safeAuthJson(
    {
      session: {
        id: payload.session.id,
        createdAt: payload.session.createdAt,
        expiresAt: payload.session.expiresAt,
        lastSeenAt: payload.session.lastSeenAt,
      },
      user: {
        id: currentUser.id,
        email: currentUser.email,
        displayName: currentUser.displayName,
        systemRole: currentUser.systemRole,
        productRole: currentUser.productRole,
      },
    },
    response,
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isRoute(request, "/get-session")) return unsupportedAuthRoute();
  const response = await getAuth().handler(request);
  return sanitizeSessionLookup(request, response);
}

export async function POST(request: Request): Promise<Response> {
  const isCredentialLogin = isRoute(request, "/sign-in/email");
  const isMockLogin = isRoute(request, "/sign-in/mock-wecom");
  const isLogin = isCredentialLogin || isMockLogin;
  const isLogout = isRoute(request, "/sign-out");

  // Expose only the configured identity-provider login and logout endpoints.
  // Better Auth also ships account/session-management endpoints
  // whose response contracts can contain raw Session tokens, so they stay
  // unreachable until each one has an explicit, sanitized product contract.
  if (!isLogin && !isLogout) return unsupportedAuthRoute();
  if (isCredentialLogin && !isLegacyCredentialAuthEnabled()) {
    return unsupportedAuthRoute();
  }
  if (isMockLogin && !isMockWeComAuthEnabled()) {
    return unsupportedAuthRoute();
  }

  try {
    requireTrustedMutationRequest(request);
  } catch (error) {
    return authorizationErrorResponse(error);
  }

  if (isLogout) {
    const principal = await getAuthenticatedPrincipal(request.headers);
    if (principal) {
      const requestContext = getRequestAuditContext(request.headers);
      await getDb().transaction(async (tx) => {
        await tx
          .delete(session)
          .where(
            and(
              eq(session.id, principal.sessionId),
              eq(session.userId, principal.user.id),
            ),
          );
        await writeAuditEvent(
          {
            actorUserId: principal.user.id,
            eventType: "logout",
            entityType: "session",
            entityId: principal.sessionId,
            result: "succeeded",
            ...requestContext,
          },
          tx,
        );
      });
    }
    return noStoreAuthResponse(await getAuth().handler(request));
  }

  const response = await getAuth().handler(request);
  if (isLogin && !response.ok) {
    await auditFailedLogin(request, response);
    const headers = new Headers();
    const retryAfter =
      response.headers.get("retry-after") ?? response.headers.get("x-retry-after");
    if (retryAfter) headers.set("retry-after", retryAfter);
    return jsonResponse(
      {
        error: {
          code:
            response.status === 429
              ? "RATE_LIMITED"
              : isMockLogin
                ? "MOCK_WECOM_SIGN_IN_FAILED"
                : "INVALID_CREDENTIALS",
          message:
            response.status === 429
              ? "登录尝试过多，请稍后再试"
              : isMockLogin
                ? "企业微信测试身份登录失败"
                : "邮箱或密码不正确",
        },
      },
      { status: response.status === 429 ? 429 : 401, headers },
    );
  }
  if (isLogin) return finalizeSuccessfulLogin(request, response);
  return unsupportedAuthRoute();
}
