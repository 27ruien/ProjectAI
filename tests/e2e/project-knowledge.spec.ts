import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";

test("项目知识问答展示可追溯来源并打开来源详情", async ({ page }) => {
  await page.goto(appPath("/projects"));
  await page.waitForLoadState("networkidle");

  const projectRow = page.getByRole("row").filter({ hasText: "北美旗舰店 AI 互动活动" });
  await expect(projectRow).toBeVisible();
  await projectRow.click();
  await expect(page).toHaveURL(/\/projects\/project-001\/overview$/);
  await page.waitForLoadState("networkidle");

  await page.getByRole("link", { name: "项目知识", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/project-001\/knowledge$/);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "项目知识", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "当前有效 Scope 是哪一个版本？", exact: true }).click();
  await expect(page.getByText(/当前有效 Scope 是 v1\.3/)).toBeVisible();
  await expect(page.getByText(/有效版本 北美旗舰店项目 Scope v1\.3 · v1\.3/)).toBeVisible();

  const citation = page.getByRole("article").filter({ hasText: "北美旗舰店项目 Scope v1.3" }).first();
  await expect(citation).toContainText("3.2 交付范围");
  await expect(citation).toContainText("第 8 页");
  await expect(citation).toContainText("当前有效");

  await citation.getByRole("button", { name: "展开来源引用" }).click();
  const sourceDetail = page.getByRole("dialog", { name: /来源详情/ });
  await expect(sourceDetail).toBeVisible();
  await expect(sourceDetail).toContainText("北美旗舰店项目 Scope v1.3");
  await expect(sourceDetail).toContainText("3.2 交付范围");
  await expect(sourceDetail).toContainText("互动体验首期支持英语与西班牙语");
});
