import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { loginByApi } from "./support/auth";
import { appPath } from "./support/app-url";

const projectA = { id: "project-001", name: "北美旗舰店 AI 互动活动" };
const projectB = { id: "project-002", name: "品牌官网重构" };
const projectC = { id: "project-003", name: "会员系统升级" };
const projectD = { id: "project-004", name: "其他部门隔离验证项目" };

async function reviewScreenshot(page: Page, name: string) {
  if (process.env.PLAYWRIGHT_REVIEW_ARTIFACTS !== "1") return;
  await mkdir("review-artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `review-artifacts/screenshots/${name}`,
    fullPage: true,
  });
}

function projectRows(payload: unknown): Array<{ id?: string; name?: string }> {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const value = payload as { projects?: unknown; data?: unknown };
    if (Array.isArray(value.projects)) return value.projects;
    if (Array.isArray(value.data)) return value.data;
  }
  return [];
}

test.describe("未认证访问与 Session 生命周期", () => {
  test.use({ authenticatedAs: null });

  test("未认证访问工作台和项目深层路由都会回到登录页", async ({ page }) => {
    await page.goto(appPath("/dashboard"));
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
    await reviewScreenshot(page, "login.png");

    await page.goto(appPath(`/projects/${projectA.id}/overview`));
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });

  test("登录页支持可访问表单和密码显示切换", async ({ page }) => {
    await page.goto(appPath("/login"));
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "显示密码" }).click();
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "登录", exact: true })).toBeDisabled();
  });

  test("登录后刷新保持 Session，退出后旧 Session 不再访问受保护页面", async ({ page }) => {
    // Credentials are exchanged in an isolated API context so traces, videos,
    // screenshots, and the HTML report cannot contain a Seed password.
    await loginByApi(page, "managerA");
    await page.goto(appPath("/dashboard"));
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("main").first()).toBeVisible();

    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.getByRole("menuitem", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);

    await page.goto(appPath("/dashboard"));
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
    await page.waitForLoadState("networkidle");
  });
});

test.describe("system_admin 项目范围", () => {
  test.use({ authenticatedAs: "admin" });

  test("管理员工作台可见且服务端返回全部 Seed 项目", async ({ page }) => {
    await page.goto(appPath("/dashboard"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("main").first()).toBeVisible();
    await reviewScreenshot(page, "dashboard-admin.png");

    const response = await page.request.get(appPath("/api/projects"));
    expect(response.status()).toBe(200);
    const ids = new Set(projectRows(await response.json()).map((project) => project.id));
    expect(ids).toEqual(
      new Set([projectA.id, projectB.id, projectC.id, projectD.id]),
    );
  });
});

test.describe("Manager A 项目隔离", () => {
  test.use({ authenticatedAs: "managerA" });

  test("项目列表只展示项目 A", async ({ page }) => {
    await page.goto(appPath("/projects"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(projectA.name, { exact: true })).toBeVisible();
    await expect(page.getByText(projectB.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(projectC.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(projectD.name, { exact: true })).toHaveCount(0);
    await reviewScreenshot(page, "projects-manager-a.png");

    const response = await page.request.get(appPath("/api/projects"));
    expect(response.status()).toBe(200);
    const ids = new Set(projectRows(await response.json()).map((project) => project.id));
    expect(ids.has(projectA.id)).toBeTruthy();
    expect(ids.has(projectB.id)).toBeFalsy();
    expect(ids.has(projectC.id)).toBeFalsy();
    expect(ids.has(projectD.id)).toBeFalsy();
  });

  test("项目 A 概览经过服务端授权后可读", async ({ page }) => {
    await page.goto(appPath(`/projects/${projectA.id}/overview`));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(projectA.name, { exact: true }).first()).toBeVisible();
    await reviewScreenshot(page, "project-a-overview.png");
  });

  test("修改 URL 或 API projectId 都不能访问项目 B", async ({ page, runtimeMonitor }) => {
    const apiResponse = await page.request.get(appPath(`/api/projects/${projectB.id}`));
    expect(apiResponse.status()).toBe(404);

    const deniedPath = appPath(`/projects/${projectB.id}/overview`);
    runtimeMonitor.allowConsoleErrorOnce({
      message: "Failed to load resource: the server responded with a status of 404 (Not Found)",
      pathname: deniedPath,
    });
    const response = await page.goto(appPath(`/projects/${projectB.id}/overview`));
    if (!response) throw new Error("Cross-project navigation did not produce a document response.");
    expect(response.status()).toBe(404);
    await expect(page.getByText(projectB.name, { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(/404|不存在|未找到|无法访问|无权/);
    await reviewScreenshot(page, "project-access-denied.png");
  });
});

test.describe("Viewer A 只读边界", () => {
  test.use({ authenticatedAs: "viewerA" });

  test("Viewer 可读项目 A，但 UI 和服务端均拒绝写操作", async ({ page }) => {
    await page.goto(appPath(`/projects/${projectA.id}/overview`));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(projectA.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/只读/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "创建项目" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /编辑项目|保存修改|审核通过|修改后通过/ })).toHaveCount(0);
    await reviewScreenshot(page, "viewer-readonly.png");

    const readResponse = await page.request.get(appPath(`/api/projects/${projectA.id}`));
    expect(readResponse.status()).toBe(200);
    const payload = await readResponse.json();
    const currentName = payload?.project?.name || payload?.name || projectA.name;
    const writeResponse = await page.request.patch(appPath(`/api/projects/${projectA.id}`), {
      data: { name: currentName },
    });
    expect([403, 404]).toContain(writeResponse.status());

    const createResponse = await page.request.post(appPath("/api/projects"), {
      data: {
        name: "Viewer unauthorized create sentinel",
        clientName: "CI authorization check",
        description: "This request must be rejected before persistence.",
      },
    });
    expect([403, 404]).toContain(createResponse.status());
  });
});
