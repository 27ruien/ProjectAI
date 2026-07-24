import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function firstHeaderValue(value: string | null): string {
  return value?.split(",", 1)[0]?.trim().toLowerCase() ?? "";
}

function configuredHttpsHost(): string | null {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? url.host.toLowerCase() : null;
  } catch {
    return "__invalid_auth_host__";
  }
}

function configuredBasePath(): string {
  const normalized = process.env.NEXT_PUBLIC_BASE_PATH?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized ? `/${normalized}` : "";
}

function debugIdentityRedirect(request: NextRequest): NextResponse | null {
  const requestUrl = new URL(request.url);
  if (
    request.method !== "GET" ||
    requestUrl.searchParams.get("debug") !== "admin"
  ) {
    return null;
  }

  const basePath = configuredBasePath();
  const pathname = requestUrl.pathname;
  const loginPath = `${basePath}/login`;
  if (pathname === loginPath) return null;
  if (basePath && pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;

  const returnTo = pathname.slice(basePath.length) || "/daily-report";
  if (returnTo.startsWith("/api/") || returnTo.startsWith("/_next/") || /\/[^/]+\.[^/]+$/u.test(returnTo)) {
    return null;
  }

  const target = new URL(requestUrl);
  target.pathname = loginPath;
  target.search = "";
  target.searchParams.set("debug", "admin");
  target.searchParams.set("returnTo", returnTo === "/" ? "/daily-report" : returnTo);
  return NextResponse.redirect(target);
}

export function proxy(request: NextRequest) {
  const debugRedirect = debugIdentityRedirect(request);
  const expectedHost = configuredHttpsHost();
  if (!expectedHost) return debugRedirect ?? NextResponse.next();

  const host = firstHeaderValue(request.headers.get("host"));
  const forwardedHost = firstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProto = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );

  if (forwardedHost || forwardedProto) {
    if (
      host !== expectedHost ||
      (forwardedHost && forwardedHost !== expectedHost) ||
      forwardedProto !== "https"
    ) {
      return new NextResponse(null, { status: 404 });
    }
    return debugRedirect ?? NextResponse.next();
  }

  const directHosts = new Set([
    expectedHost,
    "127.0.0.1:3000",
    "127.0.0.1:3101",
    "localhost:3000",
    "projectai-staging:3000",
  ]);
  if (!directHosts.has(host)) return new NextResponse(null, { status: 404 });
  return debugRedirect ?? NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
