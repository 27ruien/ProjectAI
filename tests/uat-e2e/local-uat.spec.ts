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
  expect(recordsPayload.records).toHaveLength(0);
  const created = await managerPage.request.post(appPath("/api/timesheets/work-logs"), {
    data: {
      organizationId,
      recordDate: todayInShanghai(),
      recordedAt: new Date().toISOString(),
      rawText: "[UAT] API ACL boundary record",
      source: "manual",
      projectId: authorizedProjectId,
    },
    headers: { origin: "http://127.0.0.1:3300" },
  });
  expect(created.status()).toBe(201);
  const managerRecordId = (await created.json() as { record: { id: string } }).record.id;

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
  expect((await managerPage.request.delete(appPath(`/api/timesheets/work-logs/${managerRecordId}?organizationId=${organizationId}`), {
    headers: { origin: "http://127.0.0.1:3300" },
  })).status()).toBe(200);
  await managerPage.close();
  await restrictedPage.close();
});

test("UAT Project Manager completes work-log CRUD, AI review, confirmation, JSON export, and confirmation invalidation", async ({ page }) => {
  await loginByApi(page, "uatManager");
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await expect(page.getByText("当前使用 Mock AI，仅用于功能测试，不代表真实 AI 输出质量。")).toBeVisible();
  await expect(page.getByText(/虚构项目工作记录 [123]/)).toHaveCount(0);
  await expect(page.getByRole("option", { name: "ProjectAI WeCom UAT" })).toBeAttached();
  await expect(page.getByRole("option", { name: "ProjectAI Restricted UAT" })).toHaveCount(0);

  const temporary = `[UAT] 临时 CRUD 验收 ${Date.now()}`;
  const notes = page.locator("section").filter({ has: page.getByRole("heading", { name: "今日随记" }) });
  await notes.getByPlaceholder(/例如：/).fill(temporary);
  await notes.locator("select").first().selectOption(authorizedProjectId);
  await notes.getByRole("button", { name: "保存随记", exact: true }).click();
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

  for (const note of [
    "[UAT] 已完成虚构日报创建入口验收，1 小时，状态已完成。",
    "[UAT] 正在进行虚构日报字段验收，约 30 分钟，状态进行中。",
    "[UAT] 虚构日报持久化回归尚未开始。",
  ]) {
    await notes.getByPlaceholder(/例如：/).fill(note);
    await notes.locator("select").first().selectOption(authorizedProjectId);
    await notes.getByRole("button", { name: "保存随记", exact: true }).click();
    await expect(notes.getByText(note, { exact: true })).toBeVisible();
    await expect(page.getByTestId("work-log-state")).toHaveAttribute("data-state", "success");
  }

  await page.getByRole("button", { name: "AI 整理今日工时" }).click();
  await expect(page.getByRole("status")).toContainText("AI 工时草稿已生成");
  const taskCards = page.locator("article").filter({ has: page.getByText(/^任务 \d+ ·/) });
  expect(await taskCards.count()).toBeGreaterThanOrEqual(3);
  await expect(taskCards.locator("select").filter({ has: page.getByRole("option", { name: "ProjectAI Restricted UAT" }) })).toHaveCount(0);
  await expect(page.getByText(/低置信度提示/).first()).toBeVisible();

  const statusValues: string[] = [];
  for (let index = 0; index < await taskCards.count(); index += 1) {
    const card = taskCards.nth(index);
    const selects = card.locator("select");
    const project = selects.nth(0);
    if (!(await project.inputValue())) await project.selectOption(authorizedProjectId);
    const regular = card.getByRole("spinbutton", { name: /^正常工时/ });
    await regular.fill("2");
    const overtime = card.getByRole("spinbutton", { name: /^加班工时/ });
    if (!(await overtime.inputValue())) await overtime.fill("0");
    const category = selects.nth(1);
    if (!(await category.inputValue())) await category.selectOption("execution");
    const status = selects.nth(2);
    statusValues.push(await status.inputValue());
    if (!(await status.inputValue())) await status.selectOption("pending");
  }
  expect(statusValues).toContain("in_progress");
  expect(statusValues).toContain("pending");

  const beforeSplitCount = await taskCards.count();
  const differentStatusIndex = statusValues.findIndex((value) => value !== statusValues[0]);
  expect(differentStatusIndex).toBeGreaterThan(0);
  await taskCards.nth(0).locator('input[type="checkbox"]').check();
  await taskCards.nth(differentStatusIndex).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "合并所选" }).click();
  await expect(page.getByRole("alert")).toContainText("只有项目、分类和状态完全一致的任务可以合并");
  await taskCards.nth(0).locator('input[type="checkbox"]').uncheck();
  await taskCards.nth(differentStatusIndex).locator('input[type="checkbox"]').uncheck();

  await taskCards.first().getByRole("button", { name: "拆分" }).click();
  await expect(taskCards).toHaveCount(beforeSplitCount + 1);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toContainText("本次草稿修改已保存");
  await taskCards.nth(0).locator('input[type="checkbox"]').check();
  await taskCards.nth(1).locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "合并所选" }).click();
  await expect(taskCards).toHaveCount(beforeSplitCount);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toContainText("本次草稿修改已保存");
  await page.getByRole("button", { name: "确认本次工时" }).click();
  await expect(page.getByRole("status")).toContainText("本次工时已整批确认");
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
  await page.getByRole("button", { name: "修改本次工时" }).click();
  await firstCard.getByRole("spinbutton", { name: /^任务进度/ }).fill("99");
  await expect(page.getByRole("button", { name: "复制 JSON" })).toBeDisabled();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toContainText("本次草稿修改已保存");
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
  const unconfirmedSyncError = await unconfirmedSync.json() as { error?: { code?: string } };
  expect({ status: unconfirmedSync.status(), code: unconfirmedSyncError.error?.code }).toEqual({
    status: 422,
    code: "TIMESHEET_NOT_CONFIRMED",
  });

  await page.getByRole("button", { name: "确认本次工时" }).click();
  await expect(page.getByRole("status")).toContainText("本次工时已整批确认");
  await expect(page.getByTestId("daily-summary")).toContainText("待提交 6.00 h");
  await expect(page.getByText(/Mock SmartSheet Provider/)).toBeVisible();

  const dryRunResponse = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/execute-mock") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "同步到腾讯文档" }).click();
  expect((await dryRunResponse).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Mock SmartSheet 批次已完成：synced");
  await expect(taskCards).toHaveCount(beforeSplitCount);
  await expect(page.getByTestId("submitted-tasks")).toHaveCount(0);

  await page.getByRole("checkbox", { name: /Dry Run/ }).uncheck();
  const firstSaveRequest = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/timesheets/sync-batches") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "同步到腾讯文档" }).click();
  const firstSavePayload = await (await firstSaveRequest).json() as { payload: { tasks: Array<{ regularHours: number }> } };
  expect(firstSavePayload.payload.tasks.reduce((sum, task) => sum + task.regularHours, 0)).toBe(6);
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(beforeSplitCount);
  await expect(page.getByTestId("submitted-tasks")).toContainText("已提交至 Mock SmartSheet。该记录仅用于本地生命周期验收。");
  await expect(page.getByTestId("submitted-tasks").getByRole("link", { name: "查看 Mock 记录" })).toHaveCount(beforeSplitCount);
  await expect(taskCards).toHaveCount(0);
  await expect(page.getByTestId("daily-summary")).toContainText("待提交 0.00 h");
  await expect(page.getByTestId("daily-summary")).toContainText("已提交 6.00 h");

  const secondNote = "[UAT] 已完成第二批虚构日报任务，2 小时，状态已完成，无加班。";
  await notes.getByPlaceholder(/例如：/).fill(secondNote);
  await notes.locator("select").first().selectOption(authorizedProjectId);
  await notes.getByRole("button", { name: "保存随记", exact: true }).click();
  await expect(notes.getByText(secondNote, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "AI 整理今日工时" }).click();
  await expect(taskCards).toHaveCount(1);
  const secondCard = taskCards.first();
  await secondCard.getByRole("spinbutton", { name: /^正常工时/ }).fill("2");
  await secondCard.getByRole("spinbutton", { name: /^加班工时/ }).fill("0");
  const secondSelects = secondCard.locator("select");
  if (!(await secondSelects.nth(0).inputValue())) await secondSelects.nth(0).selectOption(authorizedProjectId);
  if (!(await secondSelects.nth(1).inputValue())) await secondSelects.nth(1).selectOption("execution");
  if (!(await secondSelects.nth(2).inputValue())) await secondSelects.nth(2).selectOption("completed");
  await page.getByRole("button", { name: "确认本次工时" }).click();
  await expect(page.getByTestId("draft-status")).toContainText("confirmed");
  await expect(page.getByRole("button", { name: "同步到腾讯文档" })).toBeEnabled();
  const secondSaveRequest = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/timesheets/sync-batches") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "同步到腾讯文档" }).click();
  const secondSavePayload = await (await secondSaveRequest).json() as { payload: { tasks: Array<{ regularHours: number; description: string }> } };
  expect(secondSavePayload.payload.tasks).toHaveLength(1);
  expect(secondSavePayload.payload.tasks[0]).toMatchObject({ regularHours: 2, description: secondNote });
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(beforeSplitCount + 1);
  await page.reload();
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(beforeSplitCount + 1);
  await expect(page.getByRole("button", { name: "本次工时已提交" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Dry Run/ }).uncheck();

  for (const note of [
    "[UAT] 已完成部分同步任务 A，1 小时，无加班。",
    "[UAT] 已完成部分同步任务 B，1 小时，无加班。",
    "[UAT] 已完成部分同步任务 C，1 小时，无加班。",
  ]) {
    await notes.getByPlaceholder(/例如：/).fill(note);
    await notes.locator("select").first().selectOption(authorizedProjectId);
    await notes.getByRole("button", { name: "保存随记", exact: true }).click();
  }
  await page.getByRole("button", { name: "AI 整理今日工时" }).click();
  await expect(taskCards).toHaveCount(3);
  const partialDescriptions = [
    "Mock 部分同步成功任务",
    "Mock 部分同步失败后重试任务 [mock:fail-once]",
    "Mock 部分同步未知任务 [mock:unknown]",
  ];
  for (let index = 0; index < 3; index += 1) {
    const card = taskCards.nth(index);
    await card.getByRole("textbox", { name: /任务详情/ }).fill(partialDescriptions[index]);
    await card.getByRole("spinbutton", { name: /^正常工时/ }).fill("1");
    await card.getByRole("spinbutton", { name: /^加班工时/ }).fill("0");
    const selects = card.locator("select");
    if (!(await selects.nth(0).inputValue())) await selects.nth(0).selectOption(authorizedProjectId);
    if (!(await selects.nth(1).inputValue())) await selects.nth(1).selectOption("execution");
    if (!(await selects.nth(2).inputValue())) await selects.nth(2).selectOption("completed");
  }
  await page.getByRole("button", { name: "确认本次工时" }).click();
  await expect(page.getByTestId("draft-status")).toContainText("confirmed");
  await expect(page.getByRole("button", { name: "同步到腾讯文档" })).toBeEnabled();
  const partialExecute = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/execute-mock") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "同步到腾讯文档" }).click();
  expect((await partialExecute).status()).toBe(200);
  await expect(page.getByRole("alert")).toContainText("partially_synced");
  await expect(taskCards).toHaveCount(2);
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(beforeSplitCount + 2);
  await expect(page.getByRole("button", { name: "重试失败项" })).toBeEnabled();

  await page.getByRole("button", { name: "重试失败项" }).click();
  await expect(taskCards).toHaveCount(1);
  await expect(taskCards.first()).toHaveAttribute("data-task-status", "unknown");
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(beforeSplitCount + 3);
  await expect(page.getByRole("button", { name: "同步到腾讯文档" })).toBeDisabled();
  await page.getByRole("button", { name: "人工确认已保存" }).click();
  await expect(taskCards).toHaveCount(0);
  const finalSubmittedCount = beforeSplitCount + 4;
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(finalSubmittedCount);
  await page.reload();
  await expect(page.getByTestId("submitted-tasks").locator("article")).toHaveCount(finalSubmittedCount);
  await expect(page.getByRole("button", { name: "本次工时已提交" })).toBeDisabled();

  current = await (await page.request.get(appPath(`/api/timesheets/drafts?organizationId=${organizationId}&date=${todayInShanghai()}`))).json() as {
    draft: { id: string; version: number };
  };
  const batchRequest = {
    organizationId,
    draftId: current.draft.id,
    expectedVersion: current.draft.version,
    requestId: crypto.randomUUID(),
    dryRun: false,
  };

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
