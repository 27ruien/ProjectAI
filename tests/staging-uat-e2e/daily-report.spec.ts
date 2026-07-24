import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sanitizePlaywrightTrace } from "../../scripts/uat/sanitize-playwright-trace.mjs";
import { actorCredentials } from "../e2e/support/auth";
import { appPath } from "../e2e/support/app-url";

const marker = "[ProjectAI-STAGING-UAT]";
const organizationId = "uat-org-projectai-v1";
const authorizedProjectId = "uat-project-wecom-v1";
const evidenceDirectory = path.resolve("test-results/staging-uat/evidence");
const rawTracePath = path.resolve("test-results/staging-uat/raw/staging-daily-report-trace.zip");
const sanitizedTracePath = path.join(evidenceDirectory, "staging-daily-report-trace.sanitized.zip");

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function capture(page: Page, name: string) {
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  await page.screenshot({ path: path.join(evidenceDirectory, name), fullPage: true });
}

async function login(page: Page, actor: "uatManager" | "uatRestricted") {
  const credentials = actorCredentials(actor);
  await page.goto(appPath("/login"));
  await page.getByRole("textbox", { name: "邮箱" }).fill(credentials.email);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${appPath("/dashboard")}$`));
}

function tasks(page: Page) {
  return page.locator("article").filter({ has: page.getByText(/^任务 \d+ ·/) });
}

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function startSanitizedTrace(context: BrowserContext, password: string) {
  const cookies = await context.cookies();
  const secrets = [password, ...cookies.flatMap((cookie) => [cookie.value, `${cookie.name}=${cookie.value}`])];
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  return secrets;
}

test("Staging Project Manager completes the rendered daily-report flow and Restricted User is isolated", async ({
  browser,
}) => {
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(rawTracePath), { recursive: true, mode: 0o700 });
  const manager = actorCredentials("uatManager");
  const managerContext = await browser.newContext();
  const page = await managerContext.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const confirmResponses: Array<{ status: number; url: string }> = [];
  let confirmRequestCount = 0;
  let traceStarted = false;
  let traceSecrets: string[] = [];
  let draftId = "";
  let draftVersion = 0;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/timesheets\/drafts\/[^/]+\/confirm$/u.test(request.url())) {
      confirmRequestCount += 1;
    }
  });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && /\/api\/timesheets\/drafts\/[^/]+\/confirm$/u.test(response.url())) {
      confirmResponses.push({
        status: response.status(),
        url: new URL(response.url()).pathname.replace(/\/drafts\/[^/]+\//u, "/drafts/[REDACTED]/"),
      });
    }
  });

  try {
    await test.step("login, Session persistence, logout, and login again", async () => {
      await page.goto(appPath("/login"));
      await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
      await capture(page, "01-staging-login.png");
      await page.getByRole("textbox", { name: "邮箱" }).fill(manager.email);
      await page.locator('input[name="password"]').fill(manager.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${appPath("/dashboard")}$`));
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${appPath("/dashboard")}$`));
      await page.getByRole("button", { name: "账户菜单" }).click();
      await page.getByRole("menuitem", { name: "退出登录" }).click();
      await expect(page).toHaveURL(/\/login(?:\?|$)/u);
      await login(page, "uatManager");
      traceSecrets = await startSanitizedTrace(managerContext, manager.password);
      traceStarted = true;
    });

    const primaryNote = `${marker} 完成 Staging 日报流程验收，耗时 1 小时，已完成。`;
    const editedNote = `${primaryNote} 已通过真实 Staging UI 编辑。`;
    const temporaryNote = `${marker} 临时删除验证记录。`;

    await test.step("create, persist, edit, and delete Staging work logs", async () => {
      await page.goto(appPath("/daily-report"));
      await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
      await expect(page.getByTestId("ai-mode")).toContainText(/真实 AI 人工 UAT|Mock AI 流程测试/u);
      const section = page.getByTestId("work-log-section");
      await expect(section.getByRole("heading", { name: "今日随记" })).toBeVisible();
      await expect(section).toContainText("今天还没有随记");
      await capture(page, "02-staging-empty-work-logs.png");

      await section.getByRole("textbox", { name: "随记内容（必填）" }).fill(primaryNote);
      await section.getByRole("combobox", { name: "项目（可选）" }).selectOption(authorizedProjectId);
      const createResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith(appPath("/api/timesheets/work-logs")),
      );
      await section.getByRole("button", { name: "保存随记" }).click();
      await expect(page.getByTestId("work-log-state")).toHaveAttribute("data-state", /submitting|success/u);
      expect((await createResponse).status()).toBe(201);
      await expect(page.getByRole("status")).toContainText("随记已保存");
      await expect(section.getByText(primaryNote, { exact: true })).toBeVisible();
      await capture(page, "03-staging-work-log-created.png");
      await page.reload();
      await expect(section.getByText(primaryNote, { exact: true })).toBeVisible();

      const primaryRow = section.locator("article").filter({ hasText: primaryNote });
      await primaryRow.getByRole("button", { name: "编辑" }).click();
      await primaryRow.getByRole("textbox").fill(editedNote);
      await primaryRow.getByRole("button", { name: "保存", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("随记已更新");

      await section.getByRole("textbox", { name: "随记内容（必填）" }).fill(temporaryNote);
      await section.getByRole("combobox", { name: "项目（可选）" }).selectOption(authorizedProjectId);
      await section.getByRole("button", { name: "保存随记" }).click();
      await expect(section.getByText(temporaryNote, { exact: true })).toBeVisible();
      const temporaryRow = section.locator("article").filter({ hasText: temporaryNote });
      page.once("dialog", (dialog) => dialog.accept());
      await temporaryRow.getByRole("button", { name: "删除随记" }).click();
      await expect(page.getByRole("status")).toContainText("随记已删除");
      await page.reload();
      await expect(section.getByText(temporaryNote, { exact: true })).toHaveCount(0);
      await expect(section.getByText(editedNote, { exact: true })).toBeVisible();
    });

    await test.step("generate a source-bound AI draft and validate required fields", async () => {
      const generateResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith(appPath("/api/timesheets/drafts/generate")),
        { timeout: 60_000 },
      );
      await page.getByRole("button", { name: "AI 整理今日工时" }).click();
      await expect(page.getByTestId("ai-generate")).toHaveAttribute("data-state", "submitting");
      expect((await generateResponse).status()).toBe(201);
      await expect(page.getByRole("status")).toContainText("AI 工时草稿已生成");
      await expect(tasks(page)).toHaveCount(1);
      const card = tasks(page).first();
      await expect(card).toContainText(editedNote);
      await expect(card.locator('select[data-task-field="project"]')).toHaveValue(authorizedProjectId);
      await expect(card.getByRole("option", { name: "ProjectAI Restricted Staging UAT" })).toHaveCount(0);
      await expect(card.locator('input[data-task-field="regularHours"]')).toHaveValue("1");
      await expect(card.locator('input[data-task-field="overtimeHours"]')).toHaveValue("0");
      await expect(page.getByTestId("draft-status")).toContainText("needs_review");
      await capture(page, "04-staging-ai-draft.png");

      const description = card.locator('textarea[data-task-field="description"]');
      const originalDescription = await description.inputValue();
      await description.fill("");
      await page.getByRole("button", { name: "确认本次工时" }).click();
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "validation_error");
      await expect(card.getByText("请填写任务详情")).toBeVisible();
      await capture(page, "05-staging-required-field-error.png");
      await description.fill(originalDescription.startsWith(marker) ? originalDescription : `${marker} ${originalDescription}`);
      const category = card.locator('select[data-task-field="category"]');
      if (!(await category.inputValue())) await category.selectOption("execution");
      const status = card.locator('select[data-task-field="status"]');
      if (!(await status.inputValue())) await status.selectOption("completed");
      await expect(card.getByText("请填写任务详情")).toHaveCount(0);
    });

    await test.step("confirm exactly once, persist, export, modify, and reconfirm", async () => {
      let releaseConfirm!: () => void;
      let confirmReached!: () => void;
      const release = new Promise<void>((resolve) => { releaseConfirm = resolve; });
      const reached = new Promise<void>((resolve) => { confirmReached = resolve; });
      let initialConfirmationRequestCount = 0;
      const routeHandler = async (route: Route) => {
        if (route.request().method() !== "POST") return route.continue();
        initialConfirmationRequestCount += 1;
        confirmReached();
        await release;
        await route.continue();
      };
      await page.route("**/api/timesheets/drafts/*/confirm", routeHandler);
      const firstConfirmation = page.waitForResponse(
        (response) => response.request().method() === "POST" && /\/api\/timesheets\/drafts\/[^/]+\/confirm$/u.test(response.url()),
      );
      await page.getByRole("button", { name: "确认本次工时" }).click();
      await reached;
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "submitting");
      await expect(page.getByRole("button", { name: "正在确认…" })).toBeDisabled();
      releaseConfirm();
      expect((await firstConfirmation).status()).toBe(200);
      await page.unroute("**/api/timesheets/drafts/*/confirm", routeHandler);
      expect(initialConfirmationRequestCount).toBe(1);
      expect(confirmRequestCount).toBe(1);
      await expect(page.getByTestId("confirmation-state")).toHaveAttribute("data-state", "success");
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
      await capture(page, "06-staging-confirmed.png");
      await page.reload();
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
      await capture(page, "07-staging-confirmed-after-refresh.png");

      await managerContext.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: "https://gridworks.cn",
      });
      await page.getByRole("button", { name: "复制 JSON" }).click();
      await expect(page.getByRole("status")).toContainText("已从服务端重新校验并复制确认版 JSON");
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "下载 JSON" }).click(),
      ]);
      expect(await download.failure()).toBeNull();
      await download.delete();

      const draftEnvelope = await (
        await page.request.get(`${appPath("/api/timesheets/drafts")}?organizationId=${organizationId}&date=${todayInShanghai()}`)
      ).json() as { draft: { id: string; version: number } };
      draftId = draftEnvelope.draft.id;
      draftVersion = draftEnvelope.draft.version;

      await page.getByRole("button", { name: "修改本次工时" }).click();
      await tasks(page).first().getByRole("spinbutton", { name: /^任务进度/ }).fill("100");
      await page.getByRole("button", { name: "保存修改" }).click();
      await expect(page.getByTestId("draft-status")).toContainText("needs_review");
      await page.getByRole("button", { name: "确认本次工时" }).click();
      await expect(page.getByTestId("draft-status")).toContainText("confirmed");
      expect(confirmRequestCount).toBe(2);
      expect(confirmResponses).toEqual([
        { status: 200, url: "/drafts/[REDACTED]/confirm" },
        { status: 200, url: "/drafts/[REDACTED]/confirm" },
      ]);
    });

    await managerContext.tracing.stop({ path: rawTracePath });
    traceStarted = false;
    await sanitizePlaywrightTrace({
      inputPath: rawTracePath,
      outputPath: sanitizedTracePath,
      secretValues: traceSecrets,
    });

    await test.step("Restricted User cannot access the manager project or daily report", async () => {
      const restrictedContext = await browser.newContext();
      const restrictedPage = await restrictedContext.newPage();
      const restrictedConsoleErrors: string[] = [];
      const restrictedPageErrors: string[] = [];
      restrictedPage.on("console", (message) => {
        if (message.type() === "error") restrictedConsoleErrors.push(message.text());
      });
      restrictedPage.on("pageerror", (error) => restrictedPageErrors.push(error.message));
      await login(restrictedPage, "uatRestricted");
      await restrictedPage.goto(appPath("/daily-report"));
      await expect(restrictedPage.getByRole("heading", { name: "工作日报" })).toBeVisible();
      await expect(restrictedPage.getByTestId("work-log-section").locator("article")).toHaveCount(0);
      await expect(restrictedPage.getByRole("option", { name: "ProjectAI WeCom Staging UAT" })).toHaveCount(0);
      await expect(restrictedPage.getByText(marker, { exact: false })).toHaveCount(0);
      expect((await restrictedPage.request.get(appPath(`/api/projects/${authorizedProjectId}`))).status()).toBe(404);
      expect((await restrictedPage.request.get(appPath(`/api/timesheets/drafts/${draftId}/export?organizationId=${organizationId}`))).status()).toBe(404);
      expect((await restrictedPage.request.post(appPath(`/api/timesheets/drafts/${draftId}/confirm`), {
        data: { organizationId, expectedVersion: draftVersion },
        headers: { origin: "https://gridworks.cn" },
      })).status()).toBe(404);
      expect((await restrictedPage.request.post(appPath("/api/timesheets/sync-batches"), {
        data: { organizationId, draftId, expectedVersion: draftVersion, requestId: crypto.randomUUID(), dryRun: true },
        headers: { origin: "https://gridworks.cn" },
      })).status()).toBe(404);
      await capture(restrictedPage, "08-staging-restricted-user.png");
      expect(restrictedConsoleErrors).toEqual([]);
      expect(restrictedPageErrors).toEqual([]);
      await restrictedContext.close();
    });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await writeFile(
      path.join(evidenceDirectory, "staging-daily-report-evidence.json"),
      `${JSON.stringify({
        result: "PASS",
        environment: "staging",
        target: "https://gridworks.cn/tool/projectai-staging/",
        testDataMarker: marker,
        consoleErrorCount: consoleErrors.length,
        pageErrorCount: pageErrors.length,
        initialConfirmationRequestCount: 1,
        reconfirmationRequestCount: confirmRequestCount - 1,
        totalConfirmationRequestCount: confirmRequestCount,
        confirmationResponses: confirmResponses,
        restrictedUser: "PASS",
        trace: path.basename(sanitizedTracePath),
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } finally {
    if (traceStarted) {
      await managerContext.tracing.stop({ path: rawTracePath }).catch(() => undefined);
      if (await exists(rawTracePath)) {
        await sanitizePlaywrightTrace({
          inputPath: rawTracePath,
          outputPath: sanitizedTracePath,
          secretValues: traceSecrets,
        }).catch(() => undefined);
      }
    }
    await managerContext.close();
  }
});
