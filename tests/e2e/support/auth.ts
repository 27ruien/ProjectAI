import { expect, request as createApiRequestContext, type Page } from "@playwright/test";
import { appPath } from "./app-url";

export type TestActor =
  | "admin"
  | "managerA"
  | "managerB"
  | "memberA"
  | "viewerA"
  | "uatAdmin"
  | "uatManager"
  | "uatRestricted";

const actorEnvironment: Record<TestActor, { email: string; password: string }> = {
  admin: { email: "SEED_ADMIN_EMAIL", password: "SEED_ADMIN_PASSWORD" },
  managerA: { email: "SEED_MANAGER_A_EMAIL", password: "SEED_MANAGER_A_PASSWORD" },
  managerB: { email: "SEED_MANAGER_B_EMAIL", password: "SEED_MANAGER_B_PASSWORD" },
  memberA: { email: "SEED_MEMBER_A_EMAIL", password: "SEED_MEMBER_A_PASSWORD" },
  viewerA: { email: "SEED_VIEWER_A_EMAIL", password: "SEED_VIEWER_A_PASSWORD" },
  uatAdmin: { email: "UAT_ADMIN_EMAIL", password: "UAT_ADMIN_PASSWORD" },
  uatManager: { email: "UAT_MANAGER_EMAIL", password: "UAT_MANAGER_PASSWORD" },
  uatRestricted: { email: "UAT_RESTRICTED_EMAIL", password: "UAT_RESTRICTED_PASSWORD" },
};

export function actorCredentials(actor: TestActor) {
  const keys = actorEnvironment[actor];
  const email = process.env[keys.email]?.trim();
  const password = process.env[keys.password];
  if (!email || !password) {
    throw new Error(`E2E ${actor} credentials require ${keys.email} and ${keys.password}`);
  }
  return { email, password };
}

export async function loginByApi(page: Page, actor: TestActor) {
  const configuredTarget = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const localPort = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  const origin = new URL(configuredTarget || `http://127.0.0.1:${localPort}`).origin;
  const request = await createApiRequestContext.newContext({ baseURL: origin });
  try {
    // Keep credentials outside the traced browser context. Failure traces and
    // HTML reports must never contain test passwords or login request bodies.
    const response = await request.post(appPath("/api/auth/sign-in/email"), {
      data: actorCredentials(actor),
      headers: { origin },
    });
    expect(response.ok(), `${actor} 应能通过服务端认证 API 登录`).toBeTruthy();
    const storage = await request.storageState();
    await page.context().addCookies(storage.cookies);
  } finally {
    await request.dispose();
  }
}

export async function logoutByApi(page: Page) {
  const configuredTarget = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const localPort = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  const origin = new URL(configuredTarget || `http://127.0.0.1:${localPort}`).origin;
  const response = await page.request.post(appPath("/api/auth/sign-out"), {
    data: {},
    headers: { origin },
  });
  expect(response.ok(), "退出登录 API 应使 Session 失效").toBeTruthy();
}
