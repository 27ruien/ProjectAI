import { APP_BASE_PATH, withBasePath } from "@/lib/base-path";

const DEFAULT_RETURN_TO = "/daily-report";

function withoutBasePath(path: string): string {
  if (!APP_BASE_PATH) return path;
  if (path === APP_BASE_PATH) return DEFAULT_RETURN_TO;
  return path.startsWith(`${APP_BASE_PATH}/`)
    ? path.slice(APP_BASE_PATH.length)
    : path;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_RETURN_TO;
  }

  try {
    const parsed = new URL(value, "https://project-ai-os.local");
    if (parsed.origin !== "https://project-ai-os.local") return DEFAULT_RETURN_TO;
    const normalized = withoutBasePath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.startsWith("/login")) {
      return DEFAULT_RETURN_TO;
    }
    return normalized;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}

export async function signInWithMockWeCom(input: {
  identity: "super-admin" | "admin" | "member";
  returnTo: string;
}): Promise<void> {
  const response = await fetch(withBasePath("/api/auth/sign-in/mock-wecom"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: input.identity }),
  });
  if (!response.ok) throw new Error("MOCK_WECOM_SIGN_IN_FAILED");
  await response.text();
}

export async function signOut(): Promise<void> {
  const response = await fetch(withBasePath("/api/auth/sign-out"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!response.ok) throw new Error("SIGN_OUT_FAILED");
  await response.text();
}

export function navigateToAppPath(path: string): void {
  window.location.assign(withBasePath(safeReturnTo(path)));
}

export function navigateToLogin(): void {
  window.location.assign(withBasePath("/login"));
}
