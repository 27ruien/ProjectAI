import { expect, test } from "./fixtures";
import { loginByApi } from "./support/auth";
import { appPath } from "./support/app-url";

test("项目经理创建 Action、更新状态并在刷新后保持", async ({ page }) => {
  const title = `E2E 虚构 Action ${Date.now()}`;
  await page.goto(appPath("/projects/project-001/actions"));
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "Action Plan" }),
  ).toBeVisible();

  const membersResponse = await page.request.get(
    appPath("/api/projects/project-001/members"),
  );
  expect(membersResponse.ok()).toBeTruthy();
  const members = (await membersResponse.json()) as {
    members: Array<{ userId: string; role: string }>;
  };
  const member = members.members.find((item) => item.role === "project_member");
  expect(member).toBeTruthy();

  const manual = page.locator("section").filter({
    has: page.getByRole("heading", { name: "手工创建" }),
  });
  await manual.getByPlaceholder("标题").fill(title);
  await manual
    .getByPlaceholder("描述")
    .fill("用于验证第一阶段 Action 持久化与人工状态更新。");
  await manual.getByRole("combobox").first().selectOption(member!.userId);
  await page.getByRole("button", { name: "创建正式 Action" }).click();
  await expect(page.getByRole("status")).toContainText("Action 已手工创建");

  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();
  const code = (
    await row.locator("td").nth(1).locator("p").first().textContent()
  )?.trim();
  expect(code).toMatch(/^ACT-/);
  await row
    .getByRole("combobox", { name: `${code} 状态` })
    .selectOption("in_progress");
  await expect(page.getByRole("status")).toContainText("Action 状态已更新");

  await page.context().clearCookies();
  await loginByApi(page, "memberA");
  await page.goto(appPath("/projects/project-001/actions"));
  await page.waitForLoadState("networkidle");
  const persisted = page.getByRole("row").filter({ hasText: title });
  await expect(persisted).toBeVisible();
  const memberStatus = persisted.getByRole("combobox", {
    name: `${code} 状态`,
  });
  await expect(memberStatus).toBeEnabled();
  await expect(memberStatus).toHaveValue("in_progress");
  await memberStatus.selectOption("done");
  await expect(page.getByRole("status")).toContainText("Action 状态已更新");
  await page.reload();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: title })
      .getByRole("combobox", { name: `${code} 状态` }),
  ).toHaveValue("done");
});
