import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";

test.describe("Project Manager 工作管理闭环", () => {
  test.use({ authenticatedAs: "managerA" });

  test("创建 Risk、发布周报、导出 Markdown 并查看审计", async ({ page }) => {
    const riskTitle = `E2E 虚构 Risk ${Date.now()}`;
    await page.goto(appPath("/projects/project-001/risks"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "风险管理" })).toBeVisible();

    const manualRisk = page.locator("section").filter({
      has: page.getByRole("heading", { name: "手工登记风险" }),
    });
    await manualRisk.getByPlaceholder("标题").fill(riskTitle);
    await manualRisk
      .getByPlaceholder("描述")
      .fill("用于验证第一阶段 Risk 的正式写入与审计。");
    await manualRisk.getByPlaceholder("缓解措施").fill("使用虚构回退方案");
    await manualRisk.getByPlaceholder("触发条件").fill("虚构指标超过阈值");
    await manualRisk.getByRole("button", { name: "创建正式 Risk" }).click();
    await expect(page.getByRole("status")).toContainText("Risk 已手工创建");
    await expect(page.getByText(riskTitle, { exact: true })).toBeVisible();

    await page.goto(appPath("/projects/project-001/reports"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "项目周报" })).toBeVisible();
    await page.getByRole("button", { name: "生成周报 Draft" }).click();
    await expect(page.getByRole("status")).toContainText("周报 Draft 已生成", {
      timeout: 20_000,
    });
    const draft = page
      .locator("article")
      .filter({ hasText: "待审核周报" })
      .first();
    await expect(draft).toBeVisible();
    await draft.getByRole("button", { name: "审核并发布" }).click();
    await expect(page.getByRole("status")).toContainText("周报已发布");
    await expect(page.getByText(/^v\d+$/).first()).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Markdown Export" }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^projectai-weekly-v\d+\.md$/);

    await page.goto(appPath("/projects/project-001/audit"));
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("heading", { name: "项目管理审计" }),
    ).toBeVisible();
    await expect(
      page.getByText("risk_created", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("weekly_report_published", { exact: true }).first(),
    ).toBeVisible();
  });
});

test.describe("Viewer 工作管理只读边界", () => {
  test.use({ authenticatedAs: "viewerA" });

  test("Viewer 可读正式数据但无写入、审核与审计能力", async ({ page }) => {
    await page.goto(appPath("/projects/project-001/actions"));
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: "创建正式 Action" }),
    ).toHaveCount(0);
    const actionStatuses = page.getByRole("combobox", {
      name: /^ACT-.* 状态$/,
    });
    for (let index = 0; index < (await actionStatuses.count()); index += 1) {
      await expect(actionStatuses.nth(index)).toBeDisabled();
    }

    await page.goto(appPath("/projects/project-001/risks"));
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: "创建正式 Risk" }),
    ).toHaveCount(0);
    const riskStatuses = page.getByRole("combobox", { name: /^RSK-.* 状态$/ });
    for (let index = 0; index < (await riskStatuses.count()); index += 1) {
      await expect(riskStatuses.nth(index)).toBeDisabled();
    }

    await page.goto(appPath("/projects/project-001/reports"));
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByRole("button", { name: "生成周报 Draft" }),
    ).toBeDisabled();
    await expect(page.getByRole("link", { name: "审计" })).toHaveCount(0);
    const auditResponse = await page.request.get(
      appPath("/api/projects/project-001/management-audits"),
    );
    expect(auditResponse.status()).toBe(403);
  });
});
