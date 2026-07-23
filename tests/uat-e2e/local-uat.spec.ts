import { expect, test } from "@playwright/test";
import { actorCredentials, loginByApi, logoutByApi } from "../e2e/support/auth";
import { appPath } from "../e2e/support/app-url";

const organizationId = "uat-org-projectai-v1";
const authorizedProjectId = "uat-project-wecom-v1";
const restrictedProjectId = "uat-project-restricted-v1";

function todayInShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

test("UAT Project Manager uses the real login form, persists a Session, logs out, and logs in again", async ({ page }) => {
  const credentials = actorCredentials("uatManager");
  await page.goto(appPath("/login"));
  await page.getByRole("textbox", { name: "邮箱" }).fill(credentials.email);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${appPath("/dashboard")}$`));

  const session = await page.request.get(appPath("/api/auth/get-session"));
  expect(session.ok()).toBeTruthy();
  await expect(session.json()).resolves.toMatchObject({
    user: { id: "uat-user-manager-v1", email: credentials.email },
    session: { id: expect.any(String) },
  });

  await logoutByApi(page);
  const signedOut = await page.request.get(appPath("/api/auth/get-session"));
  expect(await signedOut.json()).toBeNull();
  await loginByApi(page, "uatManager");
  const signedInAgain = await page.request.get(appPath("/api/auth/get-session"));
  await expect(signedInAgain.json()).resolves.toMatchObject({ user: { id: "uat-user-manager-v1" } });
});

test("UAT project ACL and restricted-user timesheet boundaries are enforced by API", async ({ browser }) => {
  const managerPage = await browser.newPage();
  await loginByApi(managerPage, "uatManager");
  const projects = await managerPage.request.get(appPath("/api/projects"));
  expect(projects.status()).toBe(200);
  const projectPayload = await projects.json() as { projects: Array<{ id: string }> };
  expect(projectPayload.projects.map((item) => item.id)).toEqual([authorizedProjectId]);
  expect((await managerPage.request.get(appPath(`/api/projects/${restrictedProjectId}`))).status()).toBe(404);

  const query = new URLSearchParams({ organizationId, date: todayInShanghai() });
  const records = await managerPage.request.get(appPath(`/api/timesheets/work-logs?${query}`));
  expect(records.status()).toBe(200);
  const recordsPayload = await records.json() as { records: Array<{ id: string }> };
  expect(recordsPayload.records).toHaveLength(3);
  const managerRecordId = recordsPayload.records[0].id;

  const restrictedPage = await browser.newPage();
  await loginByApi(restrictedPage, "uatRestricted");
  const restrictedRecords = await restrictedPage.request.get(appPath(`/api/timesheets/work-logs?${query}`));
  expect(restrictedRecords.status()).toBe(200);
  await expect(restrictedRecords.json()).resolves.toEqual({ records: [] });
  expect((await restrictedPage.request.get(appPath(`/api/projects/${authorizedProjectId}`))).status()).toBe(404);
  expect((await restrictedPage.request.patch(appPath(`/api/timesheets/work-logs/${managerRecordId}`), {
    data: { organizationId, changes: { rawText: "[UAT] unauthorized mutation" } },
    headers: { origin: "http://127.0.0.1:3300" },
  })).status()).toBe(404);
  expect((await restrictedPage.request.delete(appPath(`/api/timesheets/work-logs/${managerRecordId}?organizationId=${organizationId}`), {
    headers: { origin: "http://127.0.0.1:3300" },
  })).status()).toBe(404);
  await managerPage.close();
  await restrictedPage.close();
});

test("UAT Project Manager completes work-log CRUD, AI review, confirmation, JSON export, and confirmation invalidation", async ({ page }) => {
  await loginByApi(page, "uatManager");
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await expect(page.getByRole("option", { name: "ProjectAI WeCom UAT" })).toBeAttached();
  await expect(page.getByRole("option", { name: "ProjectAI Restricted UAT" })).toHaveCount(0);

  const temporary = `[UAT] 临时 CRUD 验收 ${Date.now()}`;
  const notes = page.locator("section").filter({ has: page.getByRole("heading", { name: "今日随记" }) });
  await notes.getByPlaceholder(/例如：/).fill(temporary);
  await notes.locator("select").first().selectOption(authorizedProjectId);
  await notes.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("随记已保存");
  const temporaryRow = notes.locator("article").filter({ hasText: temporary });
  await temporaryRow.getByRole("button", { name: "编辑" }).click();
  await temporaryRow.locator("textarea").fill(`${temporary} 已编辑`);
  await temporaryRow.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("随记已更新");
  const editedRow = notes.locator("article").filter({ hasText: `${temporary} 已编辑` });
  page.once("dialog", (dialog) => dialog.accept());
  await editedRow.getByRole("button", { name: "删除随记" }).click();
  await expect(page.getByRole("status")).toContainText("随记已删除");

  await page.getByRole("button", { name: "AI 整理今日工时" }).click();
  await expect(page.getByRole("status")).toContainText("AI 工时草稿已生成");
  const taskCards = page.locator("article").filter({ has: page.getByText(/^任务 \d+$/) });
  expect(await taskCards.count()).toBeGreaterThanOrEqual(3);
  await expect(taskCards.locator("select").filter({ has: page.getByRole("option", { name: "ProjectAI Restricted UAT" }) })).toHaveCount(0);
  await expect(page.getByText(/需确认：/).first()).toBeVisible();

  const statusValues: string[] = [];
  for (let index = 0; index < await taskCards.count(); index += 1) {
    const card = taskCards.nth(index);
    const selects = card.locator("select");
    const project = selects.nth(0);
    if (!(await project.inputValue())) await project.selectOption(authorizedProjectId);
    const regular = card.getByRole("spinbutton", { name: /^正常工时/ });
    if (!(await regular.inputValue())) await regular.fill("0.25");
    const overtime = card.getByRole("spinbutton", { name: /^加班工时/ });
    if (!(await overtime.inputValue())) await overtime.fill("0");
    const category = selects.nth(1);
    if (!(await category.inputValue())) await category.selectOption("execution");
    const status = selects.nth(2);
    statusValues.push(await status.inputValue());
    if (!(await status.inputValue())) await status.selectOption("pending");
    await card.getByRole("button", { name: /标记已审核|已人工审核/ }).click();
  }
  expect(statusValues).toContain("in_progress");
  expect(statusValues).toContain("pending");

  const beforeSplitCount = await taskCards.count();
  const differentStatusIndex = statusValues.findIndex((value) => value !== statusValues[0]);
  expect(differentStatusIndex).toBeGreaterThan(0);
  await taskCards.nth(0).locator('input[type="checkbox"]').check();
  await taskCards.nth(differentStatusIndex).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "合并所选" }).click();
  await expect(page.getByRole("status")).toContainText("只有项目、分类和状态完全一致的任务可以合并");
  await taskCards.nth(0).locator('input[type="checkbox"]').uncheck();
  await taskCards.nth(differentStatusIndex).locator('input[type="checkbox"]').uncheck();

  await taskCards.first().getByRole("button", { name: "拆分" }).click();
  await expect(taskCards).toHaveCount(beforeSplitCount + 1);
  await taskCards.nth(0).getByRole("button", { name: "标记已审核" }).click();
  await taskCards.nth(1).getByRole("button", { name: "标记已审核" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await taskCards.nth(0).locator('input[type="checkbox"]').check();
  await taskCards.nth(1).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "合并所选" }).click();
  await expect(taskCards).toHaveCount(beforeSplitCount);
  await taskCards.last().getByRole("button", { name: "标记已审核" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await page.getByRole("button", { name: "确认工时" }).click();
  await expect(page.getByRole("status")).toContainText("工时已由你人工确认");
  await expect(page.getByRole("button", { name: "复制 JSON" })).toBeEnabled();

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.getByRole("button", { name: "复制 JSON" }).click();
  await expect(page.getByRole("status")).toContainText("已从服务端重新校验并复制确认版 JSON");
  const clipboardPayload = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as {
    tasks: Array<{ projectId: string }>;
  };
  expect(clipboardPayload.tasks.every((item) => item.projectId === authorizedProjectId)).toBeTruthy();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 JSON" }).click(),
  ]);
  expect(await download.failure()).toBeNull();
  await download.delete();

  const exportResponse = await page.request.get(appPath(`/api/timesheets/drafts?organizationId=${organizationId}&date=${todayInShanghai()}`));
  const draftEnvelope = await exportResponse.json() as { draft: { id: string; version: number } };
  const exported = await page.request.get(appPath(`/api/timesheets/drafts/${draftEnvelope.draft.id}/export?organizationId=${organizationId}`));
  expect(exported.status()).toBe(200);
  const json = await exported.json() as { tasks: Array<{ projectId: string; regularHours: number; overtimeHours: number }> };
  expect(json.tasks.every((item) => item.projectId === authorizedProjectId)).toBeTruthy();
  expect(json.tasks.every((item) => item.regularHours >= 0 && item.overtimeHours >= 0)).toBeTruthy();

  const firstCard = taskCards.first();
  await firstCard.getByRole("spinbutton", { name: /^任务进度/ }).fill("99");
  await expect(page.getByRole("button", { name: "复制 JSON" })).toBeDisabled();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(/Draft v\d+ · needs_review/)).toBeVisible();

  let current = await (await page.request.get(appPath(`/api/timesheets/drafts?organizationId=${organizationId}&date=${todayInShanghai()}`))).json() as {
    draft: { id: string; version: number };
  };
  const unconfirmedSync = await page.request.post(appPath("/api/timesheets/sync-batches"), {
    data: {
      organizationId,
      draftId: current.draft.id,
      expectedVersion: current.draft.version,
      requestId: crypto.randomUUID(),
      dryRun: true,
    },
    headers: { origin: "http://127.0.0.1:3300" },
  });
  expect(unconfirmedSync.status()).toBe(422);

  await firstCard.getByRole("button", { name: "标记已审核" }).click();
  await page.getByRole("button", { name: "确认工时" }).click();
  await expect(page.getByRole("status")).toContainText("工时已由你人工确认");
  current = await (await page.request.get(appPath(`/api/timesheets/drafts?organizationId=${organizationId}&date=${todayInShanghai()}`))).json() as {
    draft: { id: string; version: number };
  };
  const requestId = crypto.randomUUID();
  const batchRequest = {
    organizationId,
    draftId: current.draft.id,
    expectedVersion: current.draft.version,
    requestId,
    dryRun: true,
  };
  const created = await page.request.post(appPath("/api/timesheets/sync-batches"), {
    data: batchRequest,
    headers: { origin: "http://127.0.0.1:3300" },
  });
  expect(created.status()).toBe(201);
  const createdPayload = await created.json() as {
    batch: { syncBatchId: string; items: unknown[] };
    payload: { tasks: Array<{ project: { id: string }; category: { id: string }; urgency: unknown }> };
  };
  expect(createdPayload.payload.tasks.every((item) => item.project.id === authorizedProjectId)).toBeTruthy();
  expect(createdPayload.payload.tasks.every((item) => item.category.id === "execution" && item.urgency === null)).toBeTruthy();
  const replay = await page.request.post(appPath("/api/timesheets/sync-batches"), {
    data: batchRequest,
    headers: { origin: "http://127.0.0.1:3300" },
  });
  expect(replay.status()).toBe(201);
  const replayPayload = await replay.json() as { batch: { syncBatchId: string } };
  expect(replayPayload.batch.syncBatchId).toBe(createdPayload.batch.syncBatchId);
  const history = await page.request.get(appPath(`/api/timesheets/sync-batches?organizationId=${organizationId}`));
  expect(history.status()).toBe(200);
  const historyPayload = await history.json() as { batches: Array<{ syncBatchId: string }> };
  expect(historyPayload.batches.filter((batch) => batch.syncBatchId === createdPayload.batch.syncBatchId)).toHaveLength(1);

  const restrictedPage = await page.context().browser()!.newPage();
  await loginByApi(restrictedPage, "uatRestricted");
  expect((await restrictedPage.request.get(appPath(`/api/timesheets/drafts/${current.draft.id}/export?organizationId=${organizationId}`))).status()).toBe(404);
  expect((await restrictedPage.request.post(appPath(`/api/timesheets/drafts/${current.draft.id}/confirm`), {
    data: { organizationId, expectedVersion: current.draft.version },
    headers: { origin: "http://127.0.0.1:3300" },
  })).status()).toBe(404);
  expect((await restrictedPage.request.post(appPath("/api/timesheets/sync-batches"), {
    data: { ...batchRequest, requestId: crypto.randomUUID() },
    headers: { origin: "http://127.0.0.1:3300" },
  })).status()).toBe(404);
  await restrictedPage.close();
});

test("UAT Admin sees both explicitly assigned UAT projects without a Production role", async ({ page }) => {
  await loginByApi(page, "uatAdmin");
  const projects = await page.request.get(appPath("/api/projects"));
  expect(projects.status()).toBe(200);
  const payload = await projects.json() as { projects: Array<{ id: string }> };
  expect(payload.projects.map((item) => item.id).sort()).toEqual([
    authorizedProjectId,
    restrictedProjectId,
  ].sort());
  const session = await page.request.get(appPath("/api/auth/get-session"));
  await expect(session.json()).resolves.toMatchObject({
    user: { id: "uat-user-admin-v1", systemRole: "standard_user" },
  });
});
