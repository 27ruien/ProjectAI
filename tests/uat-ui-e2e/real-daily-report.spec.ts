import { expect, test, type Page, type Route } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizePlaywrightTrace } from "../../scripts/uat/sanitize-playwright-trace.mjs";
import { actorCredentials } from "../e2e/support/auth";
import { appPath } from "../e2e/support/app-url";

const authorizedProjectId = "uat-project-wecom-v1";
const evidenceDirectory = path.resolve("test-results/uat-ui/evidence");
const rawTracePath = path.resolve("test-results/uat-ui/raw/local-uat-ui-trace.zip");
const sanitizedTracePath = path.join(evidenceDirectory, "local-uat-ui-trace.sanitized.zip");

async function waitForWorkLogs(page: Page, action: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (candidate) => candidate.url().includes("/api/timesheets/work-logs?") && candidate.status() === 200,
  );
  await action();
  await response;
}

async function createNote(page: Page, text: string) {
  const section = page.getByTestId("work-log-section");
  await section.getByRole("textbox", { name: "随记内容（必填）" }).fill(text);
  await section.getByRole("combobox", { name: "项目（可选）" }).selectOption(authorizedProjectId);
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith(appPath("/api/timesheets/work-logs")) && candidate.request().method() === "POST",
  );
  await section.getByRole("button", { name: "保存随记" }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("status")).toContainText("随记已保存");
  await expect(section.getByText(text, { exact: true })).toBeVisible();
}

function taskCards(page: Page) {
  return page.locator("article").filter({ has: page.getByText(/^任务 \d+ ·/) });
}

function confirmationRoute(page: Page) {
  return page.getByRole("button", { name: /确认本次工时|本次工时已确认/ });
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function capture(page: Page, fileName: string) {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  const dailyReport = page.getByTestId("daily-report-page");
  if (await dailyReport.count()) {
    await expect(dailyReport).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }
  await page.screenshot({ path: path.join(evidenceDirectory, fileName), fullPage: true });
}

test("real Local UAT UI completes the daily-report journey from an empty seed", async ({ page, context }) => {
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(rawTracePath), { recursive: true, mode: 0o700 });
  const credentials = actorCredentials("uatManager");
  const consoleErrors: string[] = [];
  const expectedFailureInjectionConsoleErrors: string[] = [];
  const confirmRequests: Array<{ path: string; status: number }> = [];
  let confirmedResponse: { status: string; version: number; confirmedAtPresent: boolean } | null = null;
  let traceSecretValues = [credentials.password];
  let traceStarted = false;
  let failureInjectionActive = false;

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (failureInjectionActive && /Failed to load resource:.*(?:401|403|409|422|500)/u.test(message.text())) {
      expectedFailureInjectionConsoleErrors.push(message.text());
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await test.step("login through the rendered form without tracing credentials", async () => {
      await page.goto(appPath("/login"));
      await capture(page, "01-login.png");
      await page.getByRole("textbox", { name: "邮箱" }).fill(credentials.email);
      await page.locator('input[name="password"]').fill(credentials.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${appPath("/dashboard")}$`));
      const cookies = await context.cookies();
      traceSecretValues = [
        credentials.password,
        ...cookies.flatMap((cookie) => [cookie.value, `${cookie.name}=${cookie.value}`]),
      ];
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      traceStarted = true;
    });

    await test.step("scenario 1: empty state and visible creation entry", async () => {
      await waitForWorkLogs(page, () => page.goto(appPath("/daily-report")));
      await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const section = page.getByTestId("work-log-section");
      await expect(section.getByRole("heading", { name: "今日随记" })).toBeVisible();
      await expect(section.getByRole("textbox", { name: "随记内容（必填）" })).toBeVisible();
      await expect(section.getByRole("button", { name: "保存随记" })).toBeVisible();
      await expect(section).toContainText("今天还没有随记");
      await expect(section.locator("article")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "AI 整理今日工时" })).toBeDisabled();
      await expect(page.getByTestId("ai-disabled-reason")).toContainText("请先添加至少一条今日随记");
      await capture(page, "02-empty-work-logs.png");
    });

    const noteA = "[UAT] 完成虚构 Local UAT 日报闭环，1 小时，已完成，进度 100%，无加班。";
    const editedNoteA = `${noteA} 已由用户界面编辑。`;
    const noteB = "[UAT] 临时随记 B，仅用于删除验证。";

    await test.step("scenario 2: create, persist, edit, and delete work logs only through UI", async () => {
      let releaseSave!: () => void;
      let saveReached!: () => void;
      const release = new Promise<void>((resolve) => { releaseSave = resolve; });
      const reached = new Promise<void>((resolve) => { saveReached = resolve; });
      const saveHandler = async (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        saveReached();
        await release;
        await route.continue();
      };
      await page.route("**/api/timesheets/work-logs", saveHandler);
      const section = page.getByTestId("work-log-section");
      await section.getByRole("textbox", { name: "随记内容（必填）" }).fill(noteA);
      await section.getByRole("combobox", { name: "项目（可选）" }).selectOption(authorizedProjectId);
      const saveResponse = page.waitForResponse(
        (candidate) => candidate.url().endsWith(appPath("/api/timesheets/work-logs")) && candidate.request().method() === "POST",
      );
      await section.getByRole("button", { name: "保存随记" }).click();
      await reached;
      await expect(page.getByTestId("work-log-state")).toHaveAttribute("data-state", "submitting");
      await expect(section.getByRole("button", { name: "保存中…" })).toBeDisabled();
      releaseSave();
      expect((await saveResponse).status()).toBe(201);
      await page.unroute("**/api/timesheets/work-logs", saveHandler);
      await expect(page.getByRole("status")).toContainText("随记已保存");
      await expect(section.getByText(noteA, { exact: true })).toBeVisible();
      await capture(page, "03-work-log-created.png");
      await waitForWorkLogs(page, () => page.reload());
      await expect(section.getByText(noteA, { exact: true })).toBeVisible();

      const row = section.locator("article").filter({ hasText: noteA });
      await row.getByRole("button", { name: "编辑" }).click();
      await row.getByRole("textbox").fill(editedNoteA);
      await row.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("随记已更新");
      await expect(section.getByText(editedNoteA, { exact: true })).toBeVisible();

      await createNote(page, noteB);
      const temporaryRow = section.locator("article").filter({ hasText: noteB });
      page.once("dialog", (dialog) => dialog.accept());
      await temporaryRow.getByRole("button", { name: "删除随记" }).click();
      await expect(page.getByRole("status")).toContainText("随记已删除");
      await expect(section.getByText(noteB, { exact: true })).toHaveCount(0);
      await waitForWorkLogs(page, () => page.reload());
      await expect(section.getByText(editedNoteA, { exact: true })).toBeVisible();
      await expect(section.getByText(noteB, { exact: true })).toHaveCount(0);
    });

    await test.step("scenario 3: generate an AI draft from the UI-created note", async () => {
      let releaseGenerate!: () => void;
      let generateReached!: () => void;
      const release = new Promise<void>((resolve) => { releaseGenerate = resolve; });
      const reached = new Promise<void>((resolve) => { generateReached = resolve; });
      const generateHandler = async (route: Route) => {
        generateReached();
        await release;
        await route.continue();
      };
      await page.route("**/api/timesheets/drafts/generate", generateHandler);
      const response = page.waitForResponse(
        (candidate) => candidate.url().endsWith(appPath("/api/timesheets/drafts/generate")) && candidate.request().method() === "POST",
      );
      await page.getByRole("button", { name: "AI 整理今日工时" }).click();
      await reached;
      await expect(page.getByTestId("ai-generate")).toHaveAttribute("data-state", "submitting");
      releaseGenerate();
      expect((await response).status()).toBe(201);
      await page.unroute("**/api/timesheets/drafts/generate", generateHandler);
      await expect(page.getByRole("status")).toContainText("AI 工时草稿已生成");
      await expect(taskCards(page)).toHaveCount(1);
      await expect(taskCards(page).first()).toContainText(editedNoteA);
      await expect(page.getByText("紧急重要度（可选）")).toBeVisible();
      await expect(page.getByPlaceholder("可选，当前不设置")).toBeDisabled();
      await capture(page, "04-ai-draft.png");
    });

    await test.step("scenario 4: show a specific field error and clear it after correction", async () => {
      const card = taskCards(page).first();
      const description = card.getByRole("textbox", { name: /任务详情（必填）/ });
      await description.fill("");
      await confirmationRoute(page).click();
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "validation_error");
      await expect(page.getByTestId("confirmation-errors")).toContainText("任务 1：请填写至少 2 个字的任务详情");
      await expect(page.getByTestId("draft-status")).not.toContainText("confirmed");
      await capture(page, "05-validation-error.png");

      await description.fill("[UAT] 虚构 Local UAT 日报闭环");
      const regularHours = card.getByRole("spinbutton", { name: /正常工时（必填）/ });
      if (!(await regularHours.inputValue())) await regularHours.fill("1");
      await card.getByRole("spinbutton", { name: /加班工时（必填/ }).fill("0");
      const selects = card.getByRole("combobox");
      if (!(await selects.nth(0).inputValue())) await selects.nth(0).selectOption(authorizedProjectId);
      if (!(await selects.nth(1).inputValue())) await selects.nth(1).selectOption("execution");
      if (!(await selects.nth(2).inputValue())) await selects.nth(2).selectOption("completed");
      await expect(page.getByTestId("confirmation-errors")).toHaveCount(0);
    });

    await test.step("scenario 5: confirm once, persist, copy, and download JSON", async () => {
      let releaseConfirm!: () => void;
      let confirmReached!: () => void;
      const release = new Promise<void>((resolve) => { releaseConfirm = resolve; });
      const reached = new Promise<void>((resolve) => { confirmReached = resolve; });
      let requestCount = 0;
      const routeHandler = async (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        requestCount += 1;
        confirmReached();
        await release;
        await route.continue();
      };
      await page.route("**/api/timesheets/drafts/*/confirm", routeHandler);
      const successfulResponse = page.waitForResponse(
        (candidate) => /\/api\/timesheets\/drafts\/[^/]+\/confirm$/u.test(new URL(candidate.url()).pathname) && candidate.request().method() === "POST",
      );
      await confirmationRoute(page).click();
      await reached;
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "submitting");
      await expect(page.getByRole("button", { name: "正在确认…" })).toBeDisabled();
      releaseConfirm();
      const response = await successfulResponse;
      expect(response.status()).toBe(200);
      confirmRequests.push({ path: new URL(response.url()).pathname.replace(/\/drafts\/[^/]+\//u, "/drafts/[REDACTED]/"), status: response.status() });
      const responseBody = await response.json() as { draft: { status: string; version: number; confirmedAt: string | null } };
      confirmedResponse = {
        status: responseBody.draft.status,
        version: responseBody.draft.version,
        confirmedAtPresent: Boolean(responseBody.draft.confirmedAt),
      };
      expect(confirmedResponse).toMatchObject({ status: "confirmed", confirmedAtPresent: true });
      await page.unroute("**/api/timesheets/drafts/*/confirm", routeHandler);
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "success");
      expect(requestCount).toBe(1);
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
      await expect(page.getByRole("button", { name: "本次工时已确认" })).toBeDisabled();
      await capture(page, "06-confirmed.png");

      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
      await page.getByRole("button", { name: "复制 JSON" }).click();
      await expect(page.getByRole("status")).toContainText("已从服务端重新校验并复制确认版 JSON");
      const clipboard = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as { status: string };
      expect(clipboard.status).toBe("confirmed");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "下载 JSON" }).click(),
      ]);
      expect(await download.failure()).toBeNull();
      await download.delete();

      await waitForWorkLogs(page, () => page.reload());
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "success");
      await capture(page, "07-confirmed-after-refresh.png");
    });

    await test.step("scenario 6: editing a confirmed draft returns it to review and allows reconfirmation", async () => {
      const card = taskCards(page).first();
      await page.getByRole("button", { name: "修改本次工时" }).click();
      await card.getByRole("spinbutton", { name: /任务进度（可选）/ }).fill("99");
      await expect(page.getByTestId("draft-status")).toContainText("needs_review");
      await confirmationRoute(page).click();
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "success");
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
    });

    await test.step("scenario 7: 401, 403, 409, 422, and 500 produce visible feedback", async () => {
      const card = taskCards(page).first();
      await page.getByRole("button", { name: "修改本次工时" }).click();
      await card.getByRole("spinbutton", { name: /任务进度（可选）/ }).fill("98");
      await page.getByRole("button", { name: "保存修改" }).click();
      await expect(page.getByRole("status")).toContainText("本次草稿修改已保存");
      await expect(page.getByTestId("draft-status")).toContainText("needs_review");

      const failures = [
        { status: 401, code: "UNAUTHENTICATED", response: "登录已失效" },
        { status: 403, code: "FORBIDDEN", response: "没有权限" },
        { status: 409, code: "TIMESHEET_VERSION_CONFLICT", response: "其他请求修改" },
        { status: 422, code: "TIMESHEET_REVIEW_REQUIRED", response: "请检查虚构必填字段" },
        { status: 500, code: "INTERNAL_ERROR", response: "服务暂时不可用" },
      ];
      failureInjectionActive = true;
      for (const failure of failures) {
        const handler = async (route: Route) => route.fulfill({
          status: failure.status,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: failure.code, message: failure.response } }),
        });
        await page.route("**/api/timesheets/drafts/*/confirm", handler);
        await confirmationRoute(page).click();
        await expect(page.getByRole("alert").first()).toContainText(failure.response);
        await expect(page.getByTestId("confirmation-state")).toHaveAttribute(
          "data-state",
          failure.status === 422
            ? "validation_error"
            : failure.status === 409
              ? "conflict_error"
              : "server_error",
        );
        await page.unroute("**/api/timesheets/drafts/*/confirm", handler);
      }
      failureInjectionActive = false;
      await confirmationRoute(page).click();
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "success");
    });

    expect(consoleErrors).toEqual([]);
    expect(expectedFailureInjectionConsoleErrors).toHaveLength(5);
    expect(confirmRequests).toHaveLength(1);
    await writeFile(
      path.join(evidenceDirectory, "local-uat-ui-evidence.json"),
      `${JSON.stringify({
        result: "PASS",
        testData: "synthetic-only",
        consoleErrorCount: consoleErrors.length,
        expectedFailureInjectionConsoleErrorCount: expectedFailureInjectionConsoleErrors.length,
        confirmRequests,
        confirmedResponse,
        trace: path.basename(sanitizedTracePath),
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } finally {
    if (traceStarted) {
      await context.tracing.stop({ path: rawTracePath }).catch(() => undefined);
      if (await exists(rawTracePath)) {
        await sanitizePlaywrightTrace({
          inputPath: rawTracePath,
          outputPath: sanitizedTracePath,
          secretValues: traceSecretValues,
        });
      }
    }
  }
});
