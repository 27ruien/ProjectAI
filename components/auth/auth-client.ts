import { APP_BASE_PATH, withBasePath } from "@/lib/base-path";
import { DEFAULT_APP_RETURN_TO, safeAppReturnTo } from "@/lib/auth/return-to";

const DEFAULT_RETURN_TO = DEFAULT_APP_RETURN_TO;

function withoutBasePath(path: string): string {
  if (!APP_BASE_PATH) return path;
  if (path === APP_BASE_PATH) return DEFAULT_RETURN_TO;
  return path.startsWith(`${APP_BASE_PATH}/`)
    ? path.slice(APP_BASE_PATH.length)
    : path;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  return safeAppReturnTo(withoutBasePath(value));
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

export async function signInToStagingTestEnvironment(): Promise<void> {
  const response = await fetch(
    withBasePath("/api/auth/sign-in/staging-test"),
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) throw new Error("STAGING_TEST_SIGN_IN_FAILED");
  await response.text();
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<void> {
  const response = await fetch(withBasePath("/api/auth/sign-in/email"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      rememberMe: true,
    }),
  });
  if (!response.ok) throw new Error("CREDENTIAL_SIGN_IN_FAILED");
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
