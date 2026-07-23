import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";

function origin(): string {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  return new URL(configured || `http://127.0.0.1:${port}`).origin;
}

async function reviewScreenshot(page: Page, name: string) {
  if (process.env.PLAYWRIGHT_REVIEW_ARTIFACTS !== "1") return;
  await mkdir("review-artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `review-artifacts/screenshots/${name}`,
    fullPage: true,
    animations: "disabled",
  });
}

test("项目经理从随记生成、审核并确认个人日报", async ({ page }) => {
  const uniqueText = `虚构日报 E2E ${Date.now()}：完成 EARN 页面跳转确认`;
  let recordId: string | undefined;
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  try {
    const notes = page.locator("section").filter({
      has: page.getByRole("heading", { name: "今日随记" }),
    });
    await notes.getByRole("textbox", { name: "随记内容（必填）" }).fill(uniqueText);
    await notes.getByRole("combobox", { name: "项目（可选）" }).selectOption({ index: 1 });
    await notes.getByRole("button", { name: "保存随记", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("随记已保存");

    const query = new URLSearchParams({
      organizationId: "org-legacy-default",
      date: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    });
    const recordsResponse = await page.request.get(
      appPath(`/api/timesheets/work-logs?${query}`),
    );
    expect(recordsResponse.ok()).toBeTruthy();
    const recordsPayload = (await recordsResponse.json()) as {
      records: Array<{ id: string; rawText: string }>;
    };
    recordId = recordsPayload.records.find((record) => record.rawText === uniqueText)?.id;
    expect(recordId).toBeTruthy();

    await page.getByRole("button", { name: "AI 整理今日工时" }).click();
    await expect(page.getByRole("status")).toContainText("AI 工时草稿已生成");
    const taskCard = page.locator("article").filter({ hasText: "任务 1" });
    await taskCard.getByRole("spinbutton", { name: /^正常工时/ }).fill("1");
    await taskCard.getByRole("spinbutton", { name: /^加班工时/ }).fill("0");
    await taskCard.getByRole("button", { name: "标记已审核" }).click();
    await page.getByRole("button", { name: "确认工时" }).click();
    await expect(page.getByRole("status")).toContainText("工时已由你人工确认");
    await expect(page.getByRole("button", { name: "复制 JSON" })).toBeEnabled();
    await expect(page.getByText("扩展未安装或未连接")).toBeVisible();
    await expect(page.getByRole("button", { name: "同步到企业微信" })).toBeDisabled();
    await reviewScreenshot(page, "daily-report-confirmed.png");
  } finally {
    if (recordId) {
      await page.request.delete(
        appPath(`/api/timesheets/work-logs/${encodeURIComponent(recordId)}?organizationId=org-legacy-default`),
        { headers: { origin: origin() } },
      );
    }
  }
});

test.describe("未登录日报 API", () => {
  test.use({ authenticatedAs: null });

  test("拒绝读取日报数据", async ({ page }) => {
    const response = await page.request.get(
      appPath("/api/timesheets/work-logs?organizationId=org-legacy-default&date=2026-07-22"),
    );
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
