import { expect, test } from "./fixtures";
import { appPath, appStorageKey } from "./support/app-url";

const storageKey = appStorageKey("action-statuses");

test("Action 状态刷新后保持并清理测试状态", async ({ page }) => {
  await page.goto(appPath("/projects/project-001/actions"));
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Action Plan" })).toBeVisible();

  const status = page.getByRole("combobox", { name: "ACT-001 状态" });
  const originalStatus = await status.inputValue();
  const originalStoredValue = await page.evaluate((key) => window.localStorage.getItem(key), storageKey);
  expect(originalStatus).toBe("inProgress");

  try {
    await status.selectOption("completed");
    await expect(status).toHaveValue("completed");
    await expect(page.getByText("Action 状态已更新为「已完成」")).toBeVisible();
    await expect
      .poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "{}")?.["action-001"], storageKey))
      .toBe("completed");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("combobox", { name: "ACT-001 状态" })).toHaveValue("completed");
  } finally {
    await page.evaluate(
      ([key, original]) => {
        if (original === null) {
          window.localStorage.removeItem(key);
          return;
        }
        window.localStorage.setItem(key, original);
      },
      [storageKey, originalStoredValue] as const,
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
  }

  await expect(page.getByRole("combobox", { name: "ACT-001 状态" })).toHaveValue(originalStatus);
});
