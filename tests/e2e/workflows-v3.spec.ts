import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";

test("AI 工作流只显示两个受控入口，并路由到正确流程", async ({ page }) => {
  await page.goto(appPath("/workflows"));
  await expect(page.getByRole("heading", { name: "AI 工作流", exact: true })).toBeVisible();
  const cards = page.locator("article");
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "搭建需求框架", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "提取会议纪要", exact: true })).toHaveCount(1);

  await cards.filter({ hasText: "搭建需求框架" }).getByRole("button", { name: /开始运行/ }).click();
  await expect(page.getByRole("heading", { name: /搭建需求框架/ })).toBeVisible();
  await expect(page.getByText("选择授权资料", { exact: true })).toBeVisible();

  await page.goto(appPath("/workflows"));
  await page.locator("article").filter({ hasText: "提取会议纪要" }).getByRole("button", { name: /开始运行/ }).click();
  await expect(page.getByRole("heading", { name: /提取会议纪要/ })).toBeVisible();
  await expect(page.getByText("上传会议录音或视频", { exact: true })).toBeVisible();
});
