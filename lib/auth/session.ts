import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./config";
import { findUserById } from "@/lib/db/repositories/user-repository";
import type { SystemRole, UserRecord } from "@/lib/db/schema";
import type { ProductRole } from "./providers";

export type AuthenticatedPrincipal = {
  sessionId: string;
  user: UserRecord;
};

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/daily-report";
  }
  return value;
}

export async function getAuthenticatedPrincipal(
  requestHeaders: Headers,
): Promise<AuthenticatedPrincipal | null> {
  const authSession = await getAuth().api.getSession({ headers: requestHeaders });
  if (!authSession) return null;

  const currentUser = await findUserById(authSession.user.id);
  if (!currentUser || currentUser.status !== "active") return null;

  return { sessionId: authSession.session.id, user: currentUser };
}

export async function requireAuthenticatedUser(
  returnTo = "/dashboard",
): Promise<AuthenticatedPrincipal> {
  const requestHeaders = await nextHeaders();
  const principal = await getAuthenticatedPrincipal(requestHeaders);
  if (!principal) {
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`);
  }
  return principal;
}

export async function requireSystemAdmin(
  requestHeaders?: Headers,
): Promise<AuthenticatedPrincipal> {
  const principal = requestHeaders
    ? await getAuthenticatedPrincipal(requestHeaders)
    : await requireAuthenticatedUser();
  if (!principal || principal.user.productRole !== "super_admin") {
    throw new AuthorizationError(403, "FORBIDDEN", "无权执行此操作");
  }
  return principal;
}

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function requireApiPrincipal(
  requestHeaders: Headers,
): Promise<AuthenticatedPrincipal> {
  const principal = await getAuthenticatedPrincipal(requestHeaders);
  if (!principal) {
    throw new AuthorizationError(401, "UNAUTHENTICATED", "请先登录");
  }
  return principal;
}

export function isSystemAdmin(role: SystemRole): boolean {
  return role === "system_admin";
}

export function isProductAdmin(role: ProductRole): boolean {
  return role === "super_admin" || role === "admin";
}

export function isProductSuperAdmin(role: ProductRole): boolean {
  return role === "super_admin";
}
