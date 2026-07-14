import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";

test("需求提取失败重试后进入审核并修改后通过", async ({ page }) => {
  await page.goto(appPath("/workflows/requirement-extraction"));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "配置需求提取" })).toBeVisible();

  const mockDocument = page.getByRole("checkbox", {
    name: /北美旗舰店 AI 互动活动_当前需求说明\.docx/,
  });
  await expect(mockDocument).toBeChecked();
  await mockDocument.uncheck();
  await expect(mockDocument).not.toBeChecked();
  await mockDocument.check();

  await page.getByRole("button", { name: "开始执行" }).click();
  const workflow = page.getByRole("list", { name: "工作流执行步骤" });
  await expect(workflow.getByText("执行中").first()).toBeVisible({ timeout: 3_000 });

  await expect(page.getByText("执行遇到可恢复错误")).toBeVisible({ timeout: 15_000 });
  await expect(workflow.getByRole("listitem").filter({ hasText: "AI 提取需求" })).toContainText("需要重试");
  await page.getByRole("button", { name: "从此步骤重试" }).click();

  await expect(page.getByText("AI 处理完成，等待人工审核")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("审核任务 REV-240712 已创建")).toBeVisible();
  await page.getByRole("button", { name: /进入审核中心/ }).click();

  await expect(page).toHaveURL(/\/reviews$/);
  await expect(page.getByRole("heading", { name: "审核中心" })).toBeVisible();
  const reviewTask = page.getByRole("button").filter({ hasText: "客户需求确认稿 v1.3 · 需求提取" });
  await expect(reviewTask).toBeVisible();
  await reviewTask.click();

  const content = page.getByLabel("结构化内容");
  await expect(content).toBeVisible();
  await content.fill(`${await content.inputValue()}\n\nE2E 修改：补充失败重试后的验收描述。`);
  await page.getByLabel("审核备注").fill("E2E 审核：已核对来源，补充失败重试说明后通过。");
  await page.getByRole("button", { name: "修改后通过", exact: true }).click();

  await expect(page.getByText("修改后通过，已保留原始版本与差异记录")).toBeVisible();
  await page.getByRole("button", { name: "已通过", exact: true }).click();
  const approvedTask = page.getByRole("button").filter({ hasText: "客户需求确认稿 v1.3 · 需求提取" });
  await expect(approvedTask).toContainText("修改后通过");
});
