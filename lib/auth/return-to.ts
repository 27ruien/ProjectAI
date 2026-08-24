export const DEFAULT_APP_RETURN_TO = "/projects";

const retiredRoutes = new Set([
  "/daily-report",
  "/ai-workflows",
  "/weekly-reports",
]);

function isAllowedPathname(pathname: string): boolean {
  return pathname === "/projects"
    || pathname === "/projects/new"
    || /^\/projects\/[^/]+\/(knowledge|members)$/u.test(pathname)
    || pathname === "/organization"
    || pathname === "/organization/structure"
    || pathname === "/organization/members"
    || pathname === "/settings";
}

/**
 * Keeps post-login navigation inside the retained product surface.  Project
 * authorization still happens on the destination route; this only prevents
 * stale or malformed return targets from becoming a 404 after login.
 */
export function safeAppReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_APP_RETURN_TO;
  }

  try {
    const parsed = new URL(value, "https://project-ai-os.local");
    if (parsed.origin !== "https://project-ai-os.local") return DEFAULT_APP_RETURN_TO;
    if (retiredRoutes.has(parsed.pathname) || !isAllowedPathname(parsed.pathname)) {
      return DEFAULT_APP_RETURN_TO;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_APP_RETURN_TO;
  }
}
