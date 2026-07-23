import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  auditEvent,
  department,
  departmentMember,
  dailyTimesheetDraft,
  organization,
  organizationMember,
  project,
  projectMember,
  timesheetAiExecution,
  timesheetSyncBatch,
  timesheetSyncItem,
  timesheetTask,
  workLogRecord,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  confirmDailyDraft,
  createSyncBatch,
  createWorkLog,
  executeMockSyncBatch,
  exportDailyDraft,
  generateDailyTimesheet,
  getDailyDraft,
  listWorkLogs,
  listSyncBatches,
  updateDailyDraft,
  updateSyncBatch,
  updateWorkLog,
} from "../../lib/timesheets/service";
import { TimesheetError } from "../../lib/timesheets/errors";

const prefix = "timesheet-mvp-test-";
const projectId = `${prefix}project`;
const otherProjectId = `${prefix}other-project`;
const organizationId = `${prefix}organization`;
const departmentId = `${prefix}department`;
const headers = new Headers({
  origin: "http://127.0.0.1:3200",
  "user-agent": "projectai-timesheet-integration-test",
  "x-real-ip": "198.51.100.42",
});
const startedAt = new Date();
let manager: UserRecord;
let otherManager: UserRecord;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for timesheet integration tests.`);
  return value;
}

function principal(user: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `${prefix}${user.id}`, user };
}

function postgresDiagnostic(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown database error";
  if ("cause" in error && error.cause) return postgresDiagnostic(error.cause);
  const code = "code" in error && typeof error.code === "string" ? error.code : "unknown";
  const constraint =
    "constraint" in error && typeof error.constraint === "string"
      ? error.constraint
      : "unknown";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "database operation failed";
  return `PostgreSQL ${code} (${constraint}): ${message}`;
}

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof TimesheetError
        ? error.code === code
        : Boolean(
            error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === code,
          ),
  );
}

async function makeRecord(date: string, text: string) {
  return createWorkLog({
    principal: principal(manager),
    values: {
      organizationId,
      recordDate: date,
      recordedAt: `${date}T10:00:00+08:00`,
      rawText: text,
      source: "manual",
      projectId,
      hoursHint: 1,
      statusHint: "completed",
    },
    requestHeaders: headers,
  });
}

function reviewedTask(task: {
  id?: string;
  sourceRecordIds: string[];
}) {
  return {
    id: task.id,
    description: "完成虚构 EARN 页面跳转逻辑确认",
    projectId,
    regularHours: 1,
    overtimeHours: 0,
    categoryId: "communication",
    workStatus: "completed",
    urgency: null,
    progress: 100,
    confidence: { description: 1, project: 1, hours: 1, category: 1, status: 1 },
    needsReview: false,
    reviewFields: [] as [],
    sourceRecordIds: task.sourceRecordIds,
  };
}

describe("daily timesheet ownership, review, and sync integration", () => {
  before(async () => {
    process.env.PM_DAILY_REPORT_ENABLED = "true";
    process.env.WECOM_TIMESHEET_SYNC_ENABLED = "true";
    process.env.AI_PROVIDER = "fake";
    process.env.AI_ASSISTANT_ENABLED = "true";
    process.env.AI_REGION = "cn-beijing";
    process.env.AI_PROJECT_ASSISTANT_PROFILE_ID = "qwen-project-assistant-cn-v1";
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    const users = await Promise.all([
      findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
      findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
    ]);
    assert.ok(users[0] && users[1]);
    [manager, otherManager] = users as UserRecord[];
    await getDb().insert(organization).values({
      id: organizationId,
      name: "[TEST] Timesheet Organization",
      slug: `timesheet-mvp-${process.pid}`,
      createdBy: manager.id,
    });
    await getDb().insert(organizationMember).values([
      { id: `${prefix}org-manager`, organizationId, userId: manager.id, role: "organization_member", createdBy: manager.id },
      { id: `${prefix}org-other`, organizationId, userId: otherManager.id, role: "organization_member", createdBy: manager.id },
    ]);
    await getDb().insert(department).values({
      id: departmentId,
      organizationId,
      name: "[TEST] Timesheet Department",
      code: "TIMESHEET-MVP",
      createdBy: manager.id,
    });
    await getDb().insert(departmentMember).values([
      { id: `${prefix}dept-manager`, organizationId, departmentId, userId: manager.id, role: "department_member", createdBy: manager.id },
      { id: `${prefix}dept-other`, organizationId, departmentId, userId: otherManager.id, role: "department_member", createdBy: manager.id },
    ]);
    await getDb().insert(project).values([
      {
        id: projectId,
        organizationId,
        departmentId,
        name: "[TEST] Timesheet Project",
        clientName: "[TEST] Fictional Client",
        createdBy: manager.id,
      },
      {
        id: otherProjectId,
        organizationId,
        departmentId,
        name: "[TEST] Other Timesheet Project",
        clientName: "[TEST] Other Fictional Client",
        createdBy: manager.id,
      },
    ]);
    await getDb().insert(projectMember).values([
      {
        id: `${prefix}membership`,
        projectId,
        userId: manager.id,
        role: "project_manager",
        createdBy: manager.id,
      },
      {
        id: `${prefix}other-membership`,
        projectId: otherProjectId,
        userId: manager.id,
        role: "project_manager",
        createdBy: manager.id,
      },
    ]);
  });

  after(async () => {
    await getDb().transaction(async (tx) => {
      const drafts = await tx
        .select({ id: dailyTimesheetDraft.id })
        .from(dailyTimesheetDraft)
        .where(and(eq(dailyTimesheetDraft.organizationId, organizationId), eq(dailyTimesheetDraft.userId, manager.id)));
      const draftIds = drafts.map((draft) => draft.id);
      if (draftIds.length) {
        const batches = await tx
          .select({ id: timesheetSyncBatch.id })
          .from(timesheetSyncBatch)
          .where(inArray(timesheetSyncBatch.draftId, draftIds));
        if (batches.length) await tx.delete(timesheetSyncItem).where(inArray(timesheetSyncItem.batchId, batches.map((batch) => batch.id)));
        await tx.delete(timesheetSyncBatch).where(inArray(timesheetSyncBatch.draftId, draftIds));
        await tx.delete(timesheetTask).where(inArray(timesheetTask.draftId, draftIds));
      }
      await tx.delete(timesheetAiExecution).where(and(eq(timesheetAiExecution.organizationId, organizationId), eq(timesheetAiExecution.userId, manager.id)));
      await tx.delete(dailyTimesheetDraft).where(and(eq(dailyTimesheetDraft.organizationId, organizationId), eq(dailyTimesheetDraft.userId, manager.id)));
      await tx.delete(workLogRecord).where(and(eq(workLogRecord.organizationId, organizationId), eq(workLogRecord.userId, manager.id)));
      await tx.delete(auditEvent).where(
        and(
          gte(auditEvent.createdAt, startedAt),
          sql`(${auditEvent.eventType} like 'timesheet.%' or ${auditEvent.eventType} like 'work_log.%' or ${auditEvent.projectId} = ${projectId})`,
        ),
      );
      await tx.delete(projectMember).where(inArray(projectMember.projectId, [projectId, otherProjectId]));
      await tx.delete(project).where(inArray(project.id, [projectId, otherProjectId]));
      await tx.delete(departmentMember).where(eq(departmentMember.departmentId, departmentId));
      await tx.delete(organizationMember).where(eq(organizationMember.organizationId, organizationId));
      await tx.delete(department).where(eq(department.id, departmentId));
      await tx.delete(organization).where(eq(organization.id, organizationId));
    });
    await closeDatabasePool();
  });

  it("does not call the provider when there are no work records", async () => {
    const beforeCount = await getDb().select({ count: sql<number>`count(*)::int` }).from(timesheetAiExecution).where(eq(timesheetAiExecution.reportDate, "2026-07-20"));
    await expectCode(
      () => generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-20", timezone: "Asia/Shanghai", requestHeaders: headers }),
      "TIMESHEET_RECORDS_REQUIRED",
    );
    const afterCount = await getDb().select({ count: sql<number>`count(*)::int` }).from(timesheetAiExecution).where(eq(timesheetAiExecution.reportDate, "2026-07-20"));
    assert.equal(afterCount[0].count, beforeCount[0].count);
  });

  it("recovers a stale generation before starting a new one", async () => {
    const reportDate = "2026-07-19";
    await makeRecord(reportDate, "已完成虚构日报恢复验证，1 小时");
    const staleId = `${prefix}stale-ai`;
    try {
      await getDb().insert(timesheetAiExecution).values({
        id: staleId,
        executionId: staleId,
        organizationId,
        userId: manager.id,
        reportDate,
        skillId: "pm-daily-timesheet-generation",
        modelProfileId: "qwen-project-assistant-cn-v1",
        promptVersion: "pm-daily-report-v1",
        sourceSelectionDigest: "0".repeat(64),
        sourceCount: 1,
        status: "running",
        createdAt: new Date(Date.now() - 1_000_000),
      });
    } catch (error) {
      throw new Error(`Unable to seed stale timesheet execution: ${postgresDiagnostic(error)}`);
    }
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate, timezone: "Asia/Shanghai", requestHeaders: headers });
    assert.equal(generated.status, "needs_review");
    const [stale] = await getDb()
      .select({ status: timesheetAiExecution.status, failureCode: timesheetAiExecution.failureCode })
      .from(timesheetAiExecution)
      .where(eq(timesheetAiExecution.id, staleId));
    assert.deepEqual(stale, { status: "failed", failureCode: "AI_EXECUTION_STALE" });
  });

  it("keeps records and drafts private to their owner", async () => {
    const created = await makeRecord("2026-07-21", "已完成虚构 EARN 跳转确认，1 小时");
    assert.equal((await listWorkLogs({ principal: principal(manager), organizationId, reportDate: "2026-07-21", requestHeaders: headers })).records.length, 1);
    assert.equal((await listWorkLogs({ principal: principal(otherManager), organizationId, reportDate: "2026-07-21", requestHeaders: headers })).records.length, 0);
    await expectCode(
      () => updateWorkLog({ principal: principal(otherManager), organizationId, recordId: created.id, values: { rawText: "越权修改" }, requestHeaders: headers }),
      "NOT_FOUND",
    );
  });

  it("confirms the whole batch without a task-level review gate and enforces optimistic locking", async () => {
    await makeRecord("2026-07-22", "已完成虚构 EARN 页面跳转确认，1 小时");
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-22", timezone: "Asia/Shanghai", requestHeaders: headers });
    assert.equal(generated.status, "needs_review");
    assert.equal(generated.tasks[0].needsReview, true);
    await expectCode(
      () => createSyncBatch({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: generated.version, requestId: "33333333-3333-4333-8333-333333333333", dryRun: true, requestHeaders: headers }),
      "TIMESHEET_NOT_CONFIRMED",
    );
    await expectCode(
      () => exportDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, requestHeaders: headers }),
      "TIMESHEET_NOT_CONFIRMED",
    );
    await expectCode(
      () => updateDailyDraft({
        principal: principal(manager),
        organizationId,
        draftId: generated.id,
        expectedVersion: generated.version,
        tasks: [{ ...reviewedTask(generated.tasks[0]), projectId: otherProjectId }],
        requestHeaders: headers,
      }),
      "TASK_PROJECT_CONTRADICTS_SOURCE",
    );
    const updated = await updateDailyDraft({
      principal: principal(manager),
      organizationId,
      draftId: generated.id,
      expectedVersion: generated.version,
      tasks: [{
        ...reviewedTask(generated.tasks[0]),
        needsReview: true,
        reviewFields: ["description"],
      }],
      requestHeaders: headers,
    });
    await expectCode(
      () => updateDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: generated.version, tasks: [reviewedTask(generated.tasks[0])], requestHeaders: headers }),
      "TIMESHEET_VERSION_CONFLICT",
    );
    const confirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: updated.version, requestHeaders: headers });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.version, updated.version + 1);
    assert.equal((await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: confirmed.version, requestHeaders: headers })).status, "confirmed");
    await expectCode(
      () => exportDailyDraft({ principal: principal(otherManager), organizationId, draftId: generated.id, requestHeaders: headers }),
      "NOT_FOUND",
    );
    await expectCode(
      () => createSyncBatch({
        principal: principal(otherManager),
        organizationId,
        draftId: generated.id,
        expectedVersion: confirmed.version,
        requestId: "88888888-8888-4888-8888-888888888888",
        dryRun: true,
        requestHeaders: headers,
      }),
      "NOT_FOUND",
    );
    await assert.rejects(
      getDb().insert(timesheetAiExecution).values({
        id: `${prefix}forged-ai-owner`,
        executionId: `${prefix}forged-ai-owner`,
        organizationId,
        userId: otherManager.id,
        draftId: generated.id,
        reportDate: "2026-07-22",
        skillId: "pm-daily-timesheet-generation",
        modelProfileId: "qwen-project-assistant-cn-v1",
        promptVersion: "pm-daily-report-v1",
        sourceSelectionDigest: "0".repeat(64),
        sourceCount: 1,
        status: "failed",
      }),
      (error: unknown) =>
        postgresDiagnostic(error).includes(
          "AI execution owner does not match its draft",
        ),
    );
  });

  it("moves a modified confirmed draft back to review and rejects stale versions", async () => {
    await makeRecord("2026-07-18", "已完成虚构状态回退验证，1 小时，无加班");
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-18", timezone: "Asia/Shanghai", requestHeaders: headers });
    const reviewed = await updateDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: generated.version, tasks: [reviewedTask(generated.tasks[0])], requestHeaders: headers });
    const confirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: reviewed.id, expectedVersion: reviewed.version, requestHeaders: headers });
    const changed = await updateDailyDraft({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, tasks: [{ ...reviewedTask(confirmed.tasks[0]), description: "完成虚构状态回退验证并复核" }], requestHeaders: headers });
    assert.equal(changed.status, "needs_review");
    assert.equal(changed.confirmedAt, null);
    const [returnedAudit] = await getDb()
      .select({ eventType: auditEvent.eventType })
      .from(auditEvent)
      .where(and(eq(auditEvent.entityId, confirmed.id), eq(auditEvent.eventType, "timesheet.returned_to_draft")))
      .limit(1);
    assert.equal(returnedAudit?.eventType, "timesheet.returned_to_draft");
    await expectCode(
      () => updateDailyDraft({ principal: principal(manager), organizationId, draftId: changed.id, expectedVersion: confirmed.version, tasks: [reviewedTask(changed.tasks[0])], requestHeaders: headers }),
      "TIMESHEET_VERSION_CONFLICT",
    );
  });

  it("creates one idempotent batch, rejects an active duplicate, and persists results", async () => {
    const draft = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate: "2026-07-22", requestHeaders: headers })).draft;
    assert.ok(draft?.confirmedAt);
    const requestId = "44444444-4444-4444-8444-444444444444";
    const first = await createSyncBatch({ principal: principal(manager), organizationId, draftId: draft.id, expectedVersion: draft.version, requestId, dryRun: false, requestHeaders: headers });
    const replay = await createSyncBatch({ principal: principal(manager), organizationId, draftId: draft.id, expectedVersion: draft.version, requestId, dryRun: false, requestHeaders: headers });
    assert.equal(replay.batch.syncBatchId, first.batch.syncBatchId);
    await expectCode(
      () => createSyncBatch({ principal: principal(manager), organizationId, draftId: draft.id, expectedVersion: draft.version, requestId: "55555555-5555-4555-8555-555555555555", dryRun: false, requestHeaders: headers }),
      "TIMESHEET_SYNC_ACTIVE",
    );
    await expectCode(
      () => updateSyncBatch({
        principal: principal(manager),
        organizationId,
        syncBatchId: first.batch.syncBatchId,
        status: "synced",
        items: first.batch.items.map((item) => ({ taskId: item.taskId, status: "running", attemptCount: 1 })),
        requestHeaders: headers,
      }),
      "SYNC_TERMINAL_MISMATCH",
    );
    const completed = await updateSyncBatch({
      principal: principal(manager),
      organizationId,
      syncBatchId: first.batch.syncBatchId,
      status: "synced",
      items: first.batch.items.map((item) => ({ taskId: item.taskId, status: "saved", attemptCount: 1, externalReference: `record-${item.taskId}`, externalUrl: "https://mock-smartsheet.invalid/records/first", verified: true })),
      requestHeaders: headers,
    });
    assert.equal(completed.status, "synced");
    assert.equal(
      (await updateSyncBatch({
        principal: principal(manager),
        organizationId,
        syncBatchId: first.batch.syncBatchId,
        status: "synced",
        items: first.batch.items.map((item) => ({ taskId: item.taskId, status: "saved", attemptCount: 1, externalReference: `record-${item.taskId}`, externalUrl: "https://mock-smartsheet.invalid/records/first", verified: true })),
        requestHeaders: headers,
      })).status,
      "synced",
    );
    await expectCode(
      () => updateSyncBatch({
        principal: principal(manager),
        organizationId,
        syncBatchId: first.batch.syncBatchId,
        status: "running",
        items: first.batch.items.map((item) => ({ taskId: item.taskId, status: "saved", attemptCount: 1, externalReference: `record-${item.taskId}`, externalUrl: "https://mock-smartsheet.invalid/records/first", verified: true })),
        requestHeaders: headers,
      }),
      "SYNC_BATCH_TERMINAL",
    );
    const afterFirst = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate: "2026-07-22", requestHeaders: headers })).draft;
    assert.equal(afterFirst?.tasks.length, 0);
    assert.equal(afterFirst?.submittedTasks.length, 1);
    assert.equal(afterFirst?.submittedTasks[0].submissionStatus, "submitted");
    const secondRecord = await makeRecord("2026-07-22", "已完成第二批虚构项目复盘，1 小时");
    const secondGenerated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-22", timezone: "Asia/Shanghai", requestHeaders: headers });
    assert.deepEqual(secondGenerated.tasks[0].sourceRecordIds, [secondRecord.id]);
    assert.equal(secondGenerated.submittedTasks.length, 1);
    const secondUpdated = await updateDailyDraft({ principal: principal(manager), organizationId, draftId: secondGenerated.id, expectedVersion: secondGenerated.version, tasks: [reviewedTask(secondGenerated.tasks[0])], requestHeaders: headers });
    const secondConfirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: secondUpdated.id, expectedVersion: secondUpdated.version, requestHeaders: headers });
    const second = await createSyncBatch({ principal: principal(manager), organizationId, draftId: secondConfirmed.id, expectedVersion: secondConfirmed.version, requestId: "66666666-6666-4666-8666-666666666666", dryRun: false, requestHeaders: headers });
    assert.equal(second.payload.tasks.length, 1);
    assert.equal(second.payload.tasks[0].id, secondConfirmed.tasks[0].id);
    assert.notEqual(second.payload.tasks[0].id, first.payload.tasks[0].id);
    const oldReplay = await createSyncBatch({ principal: principal(manager), organizationId, draftId: secondConfirmed.id, expectedVersion: secondConfirmed.version, requestId, dryRun: false, requestHeaders: headers });
    assert.deepEqual(oldReplay.payload, first.payload);
    await updateSyncBatch({
      principal: principal(manager),
      organizationId,
      syncBatchId: second.batch.syncBatchId,
      status: "synced",
      items: second.batch.items.map((item) => ({ taskId: item.taskId, status: "saved", attemptCount: 1, externalReference: `record-${item.taskId}`, externalUrl: "https://mock-smartsheet.invalid/records/second", verified: true })),
      requestHeaders: headers,
    });
  });

  it("freezes submitted sources while allowing a later unprocessed work log", async () => {
    const [record] = await getDb()
      .select()
      .from(workLogRecord)
      .where(and(
        eq(workLogRecord.organizationId, organizationId),
        eq(workLogRecord.userId, manager.id),
        eq(workLogRecord.recordDate, "2026-07-22"),
      ))
      .limit(1);
    assert.ok(record);
    await expectCode(
      () => updateWorkLog({ principal: principal(manager), organizationId, recordId: record.id, values: { rawText: "不允许修改的已同步来源" }, requestHeaders: headers }),
      "WORK_LOG_ALREADY_SUBMITTED",
    );
    const workLogs = await listWorkLogs({ principal: principal(manager), organizationId, reportDate: "2026-07-22", requestHeaders: headers });
    assert.equal(workLogs.records.filter((item) => item.consumptionStatus === "submitted").length, 2);
    const newRecord = await makeRecord("2026-07-22", "已完成第三批虚构项目复盘，1 小时");
    const refreshed = await listWorkLogs({ principal: principal(manager), organizationId, reportDate: "2026-07-22", requestHeaders: headers });
    assert.equal(refreshed.records.find((item) => item.id === newRecord.id)?.consumptionStatus, "unprocessed");
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-22", timezone: "Asia/Shanghai", requestHeaders: headers });
    assert.deepEqual(generated.tasks[0].sourceRecordIds, [newRecord.id]);
    assert.equal(generated.submittedTasks.length, 2);
  });

  it("persists saved, failed, and unknown task outcomes independently", async () => {
    const reportDate = "2026-07-17";
    const source = await makeRecord(reportDate, "已完成虚构部分同步验证，3 小时");
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate, timezone: "Asia/Shanghai", requestHeaders: headers });
    const base = reviewedTask(generated.tasks[0]);
    const edited = await updateDailyDraft({
      principal: principal(manager),
      organizationId,
      draftId: generated.id,
      expectedVersion: generated.version,
      tasks: [
        { ...base, description: "虚构任务 A", regularHours: 1 },
        { ...base, id: undefined, description: "虚构任务 B", regularHours: 1 },
        { ...base, id: undefined, description: "虚构任务 C", regularHours: 1 },
      ],
      requestHeaders: headers,
    });
    const confirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: edited.id, expectedVersion: edited.version, requestHeaders: headers });
    const batch = await createSyncBatch({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, requestId: "12121212-1212-4212-8212-121212121212", dryRun: false, requestHeaders: headers });
    const [saved, failed, unknown] = batch.batch.items;
    const partialBatch = await updateSyncBatch({
      principal: principal(manager),
      organizationId,
      syncBatchId: batch.batch.syncBatchId,
      status: "partially_synced",
      items: [
        { taskId: saved.taskId, status: "saved", attemptCount: 1, externalReference: "mock-record-a", externalUrl: "https://mock-smartsheet.invalid/records/a", verified: true },
        { taskId: failed.taskId, status: "failed", attemptCount: 1, errorCode: "MOCK_SAVE_FAILED", errorMessage: "虚构失败" },
        { taskId: unknown.taskId, status: "unknown", attemptCount: 1, errorCode: "MOCK_RESULT_UNKNOWN", errorMessage: "虚构未知" },
      ],
      requestHeaders: headers,
    });
    const savedBeforeReconciliation = partialBatch.items.find((item) => item.taskId === saved.taskId);
    assert.ok(savedBeforeReconciliation?.savedAt);
    const partial = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate, requestHeaders: headers })).draft;
    assert.equal(partial?.submittedTasks.length, 1);
    assert.deepEqual(partial?.tasks.map((task) => task.submissionStatus).sort(), ["failed", "unknown"]);
    assert.equal((await listWorkLogs({ principal: principal(manager), organizationId, reportDate, requestHeaders: headers })).records[0].consumptionStatus, "included");
    await expectCode(
      () => updateWorkLog({ principal: principal(manager), organizationId, recordId: source.id, values: { rawText: "禁止改写已部分提交的来源" }, requestHeaders: headers }),
      "WORK_LOG_ALREADY_SUBMITTED",
    );
    const reconciled = await updateSyncBatch({
      principal: principal(manager),
      organizationId,
      syncBatchId: batch.batch.syncBatchId,
      status: "partially_synced",
      items: [
        { taskId: saved.taskId, status: "saved", attemptCount: 1, externalReference: "mock-record-a", externalUrl: "https://mock-smartsheet.invalid/records/a", verified: true },
        { taskId: failed.taskId, status: "failed", attemptCount: 1, errorCode: "MOCK_SAVE_FAILED", errorMessage: "虚构失败" },
        { taskId: unknown.taskId, status: "failed", attemptCount: 1, verified: false, errorCode: "MANUAL_RECONCILIATION_NOT_SAVED", errorMessage: "人工确认未保存" },
      ],
      requestHeaders: headers,
    });
    assert.equal(reconciled.status, "partially_synced");
    assert.deepEqual(
      reconciled.items.find((item) => item.taskId === saved.taskId),
      savedBeforeReconciliation,
    );
    const [resolvedAudit] = await getDb()
      .select({ eventType: auditEvent.eventType })
      .from(auditEvent)
      .where(and(eq(auditEvent.entityId, unknown.taskId), eq(auditEvent.eventType, "timesheet.unknown_resolved")))
      .limit(1);
    assert.equal(resolvedAudit?.eventType, "timesheet.unknown_resolved");
    const afterReconciliation = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate, requestHeaders: headers })).draft;
    assert.equal(afterReconciliation?.tasks.filter((task) => task.submissionStatus === "failed").length, 2);
  });

  it("runs the local Mock SmartSheet provider and retries only a fail-once item", async () => {
    process.env.WECOM_TIMESHEET_SYNC_PROVIDER = "mock_smartsheet";
    process.env.PROJECTAI_UAT_ENVIRONMENT = "local";
    try {
      const reportDate = "2026-07-16";
      await makeRecord(reportDate, "已完成虚构 Mock SmartSheet 验证，2 小时");
      const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate, timezone: "Asia/Shanghai", requestHeaders: headers });
      const base = reviewedTask(generated.tasks[0]);
      const edited = await updateDailyDraft({
        principal: principal(manager),
        organizationId,
        draftId: generated.id,
        expectedVersion: generated.version,
        tasks: [
          { ...base, description: "Mock 正常保存任务" },
          { ...base, id: undefined, description: "Mock 重试任务 [mock:fail-once]" },
        ],
        requestHeaders: headers,
      });
      const confirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: edited.id, expectedVersion: edited.version, requestHeaders: headers });
      const first = await createSyncBatch({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, requestId: "13131313-1313-4313-8313-131313131313", dryRun: false, requestHeaders: headers });
      const firstResult = await executeMockSyncBatch({ principal: principal(manager), organizationId, syncBatchId: first.batch.syncBatchId, requestHeaders: headers });
      assert.equal(firstResult.status, "partially_synced");
      assert.deepEqual(firstResult.items.map((item) => item.status).sort(), ["failed", "saved"]);
      const partial = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate, requestHeaders: headers })).draft;
      assert.equal(partial?.submittedTasks.length, 1);
      assert.equal(partial?.tasks[0].submissionStatus, "failed");
      const retry = await createSyncBatch({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, requestId: "14141414-1414-4414-8414-141414141414", dryRun: false, requestHeaders: headers });
      assert.equal(retry.payload.tasks.length, 1);
      const [retryAudit] = await getDb()
        .select({ eventType: auditEvent.eventType })
        .from(auditEvent)
        .where(and(eq(auditEvent.entityId, retry.payload.tasks[0].id), eq(auditEvent.eventType, "timesheet.task_retry_requested")))
        .limit(1);
      assert.equal(retryAudit?.eventType, "timesheet.task_retry_requested");
      const retryResult = await executeMockSyncBatch({ principal: principal(manager), organizationId, syncBatchId: retry.batch.syncBatchId, requestHeaders: headers });
      assert.equal(retryResult.status, "synced");
      const completed = (await getDailyDraft({ principal: principal(manager), organizationId, reportDate, requestHeaders: headers })).draft;
      assert.equal(completed?.tasks.length, 0);
      assert.equal(completed?.submittedTasks.length, 2);
      assert.ok(completed?.submittedTasks.every((task) => task.externalReference));
    } finally {
      delete process.env.WECOM_TIMESHEET_SYNC_PROVIDER;
      delete process.env.PROJECTAI_UAT_ENVIRONMENT;
    }
  });

  it("rejects sync after project access is lost", async () => {
    await makeRecord("2026-07-23", "已完成虚构项目复盘，1 小时");
    const generated = await generateDailyTimesheet({ principal: principal(manager), organizationId, reportDate: "2026-07-23", timezone: "Asia/Shanghai", requestHeaders: headers });
    const updated = await updateDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: generated.version, tasks: [reviewedTask(generated.tasks[0])], requestHeaders: headers });
    const confirmed = await confirmDailyDraft({ principal: principal(manager), organizationId, draftId: generated.id, expectedVersion: updated.version, requestHeaders: headers });
    const requestId = "77777777-7777-4777-8777-777777777777";
    const created = await createSyncBatch({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, requestId, dryRun: true, requestHeaders: headers });
    await getDb().delete(projectMember).where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, manager.id)));
    await expectCode(
      () => createSyncBatch({ principal: principal(manager), organizationId, draftId: confirmed.id, expectedVersion: confirmed.version, requestId, dryRun: true, requestHeaders: headers }),
      "NOT_FOUND",
    );
    await expectCode(
      () => updateSyncBatch({ principal: principal(manager), organizationId, syncBatchId: created.batch.syncBatchId, status: "cancelled", items: created.batch.items.map((item) => ({ taskId: item.taskId, status: "cancelled", attemptCount: 0 })), requestHeaders: headers }),
      "NOT_FOUND",
    );
    await expectCode(
      () => listSyncBatches({ principal: principal(manager), organizationId, requestHeaders: headers }),
      "NOT_FOUND",
    );
    await getDb().insert(projectMember).values({ id: `${prefix}membership-restored`, projectId, userId: manager.id, role: "project_manager", createdBy: manager.id });
  });

  it("enforces the server-side feature flag", async () => {
    process.env.PM_DAILY_REPORT_ENABLED = "false";
    await expectCode(
      () => listWorkLogs({ principal: principal(manager), organizationId, reportDate: "2026-07-22", requestHeaders: headers }),
      "TIMESHEET_FEATURE_DISABLED",
    );
    process.env.PM_DAILY_REPORT_ENABLED = "true";
    process.env.WECOM_TIMESHEET_SYNC_ENABLED = "false";
    await expectCode(
      () => listSyncBatches({ principal: principal(manager), organizationId, requestHeaders: headers }),
      "WECOM_SYNC_FEATURE_DISABLED",
    );
    process.env.WECOM_TIMESHEET_SYNC_ENABLED = "true";
  });
});
