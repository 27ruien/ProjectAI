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

export function proxy(request: NextRequest) {
  const expectedHost = configuredHttpsHost();
  if (!expectedHost) return NextResponse.next();

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
    return NextResponse.next();
  }

  const directHosts = new Set([
    expectedHost,
    "127.0.0.1:3000",
    "127.0.0.1:3101",
    "localhost:3000",
    "projectai-staging:3000",
  ]);
  return directHosts.has(host)
    ? NextResponse.next()
    : new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: "/:path*",
};
