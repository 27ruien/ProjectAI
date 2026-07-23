import { expect, test } from "@playwright/test";
import { loginByApi } from "../e2e/support/auth";
import { appPath } from "../e2e/support/app-url";

const organizationId = "uat-org-projectai-v1";

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test("the explicitly disabled UAT feature is blocked in both UI and API", async ({ page }) => {
  await loginByApi(page, "uatManager");
  const workLogsPath = appPath(`/api/timesheets/work-logs?organizationId=${organizationId}&date=${todayInShanghai()}`);
  if (process.env.UAT_FLAG_CASE === "daily-off") {
    expect((await page.request.get(workLogsPath)).status()).toBe(404);
    const response = await page.goto(appPath("/daily-report"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "工作日报" })).toHaveCount(0);
    return;
  }

  expect((await page.request.get(workLogsPath)).status()).toBe(200);
  expect((await page.request.get(appPath(`/api/timesheets/sync-batches?organizationId=${organizationId}`))).status()).toBe(404);
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await expect(page.getByText("企业微信同步 Feature Flag 当前关闭。")).toBeVisible();
  await expect(page.getByRole("button", { name: "同步到企业微信" })).toBeDisabled();
});
