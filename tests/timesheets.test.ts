import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkLogRecord } from "../lib/db/schema";
import {
  assertSyncBatchTransition,
  assertSyncItemTransition,
  buildTimesheetPrompts,
  combineTimesheetGatewayResults,
  normalizeGeneratedOutput,
  validateGeneratedTimesheetText,
  withTotalHoursWarning,
  type GeneratedContext,
} from "../lib/timesheets/service";
import { TimesheetError } from "../lib/timesheets/errors";

const now = new Date("2026-07-22T02:30:00.000Z");

function record(input: Partial<WorkLogRecord> & { id: string; rawText: string }): WorkLogRecord {
  return {
    id: input.id,
    organizationId: "org-legacy-default",
    userId: "timesheet-user",
    recordDate: "2026-07-22",
    recordedAt: now,
    rawText: input.rawText,
    source: "manual",
    projectId: input.projectId ?? "project-001",
    projectHint: input.projectHint ?? "CHAGEE",
    hoursHint: input.hoursHint ?? null,
    statusHint: input.statusHint ?? null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

function context(records: WorkLogRecord[]): GeneratedContext {
  return {
    organizationId: "org-legacy-default",
    reportDate: "2026-07-22",
    records,
    projects: [
      { id: "project-001", name: "CHAGEE Valley Fair Campaign", stage: "delivery", aliases: ["CHAGEE", "Valley Fair"] },
      { id: "project-002", name: "Fictional Delivery Project", stage: "planning", aliases: ["FDP"] },
    ],
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [
      {
        description: "完成 EARN 页面登录及 H5 回流逻辑确认",
        project_id: "project-001",
        hours: 1,
        category_id: "communication",
        status: "completed",
        source_record_ids: ["record-001"],
        confidence: { description: 0.95, project: 1, hours: 0.9, category: 0.9, status: 0.9 },
        needs_review: false,
        review_fields: [],
        ...overrides,
      },
    ],
    warnings: [],
    unresolved_record_ids: [],
  };
}

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => error instanceof TimesheetError && error.code === code);
}

describe("daily timesheet AI trust boundary", () => {
  it("rejects invalid calendar dates", async () => {
    const { timesheetDateSchema } = await import("../lib/timesheets/contracts");
    assert.equal(timesheetDateSchema.safeParse("2026-02-31").success, false);
    assert.equal(timesheetDateSchema.safeParse("2026-02-28").success, true);
  });

  it("keeps terminal batch and item states immutable", () => {
    expectCode(() => assertSyncBatchTransition("synced", "running"), "SYNC_BATCH_TERMINAL");
    expectCode(() => assertSyncItemTransition("saved", "failed"), "SYNC_ITEM_ALREADY_SAVED");
    expectCode(
      () => assertSyncItemTransition("unknown", "running"),
      "SYNC_ITEM_UNKNOWN_REVIEW_REQUIRED",
    );
    assert.doesNotThrow(() =>
      assertSyncItemTransition("unknown", "saved", {
        externalReference: "manual-reconciliation",
      }),
    );
  });

  it("accounts for both model calls when one controlled repair is required", () => {
    const base = {
      provider: "fake" as const,
      requestedModel: "model-primary",
      actualModel: "model-primary",
      fallbackUsed: false,
      text: "invalid",
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      providerRequestId: "request-1",
      latencyMs: 100,
    };
    const combined = combineTimesheetGatewayResults(base, {
      ...base,
      actualModel: "model-fallback",
      fallbackUsed: true,
      text: "valid",
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      providerRequestId: "request-2",
      latencyMs: 150,
    });
    assert.deepEqual(
      {
        inputTokens: combined.inputTokens,
        outputTokens: combined.outputTokens,
        totalTokens: combined.totalTokens,
        latencyMs: combined.latencyMs,
        text: combined.text,
        fallbackUsed: combined.fallbackUsed,
      },
      {
        inputTokens: 50,
        outputTokens: 25,
        totalTokens: 75,
        latencyMs: 250,
        text: "valid",
        fallbackUsed: true,
      },
    );
  });

  it("accepts one record with explicit project, duration, and completed status", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE，确认 EARN 跳转逻辑，1 小时，已完成", hoursHint: "1", statusHint: "completed" })];
    const result = normalizeGeneratedOutput(output(), context(records), 0.85);
    assert.equal(result.tasks[0].project_id, "project-001");
    assert.equal(result.tasks[0].hours, 1);
  });

  it("keeps hours empty when the record has no duration", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE，确认 EARN 跳转逻辑，进行中" })];
    const result = normalizeGeneratedOutput(output({ hours: null, status: "in_progress" }), context(records), 0.85);
    assert.equal(result.tasks[0].hours, null);
    assert.ok(result.tasks[0].review_fields.includes("hours"));
  });

  it("marks approximate duration as review-required", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE，沟通需求，大约一小时", hoursHint: "1" })];
    const result = normalizeGeneratedOutput(output({ status: "in_progress", confidence: { description: 0.95, project: 1, hours: 0.7, category: 0.9, status: 0.9 } }), context(records), 0.85);
    assert.ok(result.tasks[0].review_fields.includes("hours"));
  });

  it("rejects merging records from different projects", () => {
    const records = [
      record({ id: "record-001", rawText: "项目一沟通 1 小时", hoursHint: "1", projectId: "project-001" }),
      record({ id: "record-002", rawText: "项目二沟通 1 小时", hoursHint: "1", projectId: "project-002" }),
    ];
    expectCode(
      () => normalizeGeneratedOutput(output({ source_record_ids: ["record-001", "record-002"], hours: 2, status: "in_progress" }), context(records), 0.85),
      "AI_CROSS_PROJECT_MERGE",
    );
  });

  it("instructs the model not to merge different deliverables", () => {
    const prompts = buildTimesheetPrompts({ today_records: [] });
    assert.match(prompts.systemPrompt, /不同项目、交付物或状态必须分开/);
  });

  it("conservatively rejects AI merging same-project records before human review", () => {
    const records = [
      record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" }),
      record({ id: "record-002", rawText: "CHAGEE 整理验收清单，1 小时", hoursHint: "1" }),
    ];
    expectCode(
      () => normalizeGeneratedOutput(
        output({ source_record_ids: ["record-001", "record-002"], hours: 2 }),
        context(records),
        0.85,
      ),
      "AI_MULTI_SOURCE_MERGE_REJECTED",
    );
  });

  it("rejects converting planned work into completed", () => {
    const records = [record({ id: "record-001", rawText: "准备做 EARN 页面联调，约 1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output(), context(records), 0.85), "AI_COMPLETION_CONTRADICTS_SOURCE");
  });

  it("rejects converting work under discussion into completed", () => {
    const records = [record({ id: "record-001", rawText: "EARN 跳转方案讨论中，约 1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output(), context(records), 0.85), "AI_COMPLETION_CONTRADICTS_SOURCE");
  });

  it("accepts an authorized alias resolved to the catalog project id", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", projectHint: "CHAGEE", hoursHint: "1" })];
    assert.equal(normalizeGeneratedOutput(output(), context(records), 0.85).tasks[0].project_id, "project-001");
  });

  it("rejects an unauthorized project", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output({ project_id: "project-secret" }), context(records), 0.85), "AI_PROJECT_NOT_AUTHORIZED");
  });

  it("rejects a model-created category", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output({ category_id: "invented" }), context(records), 0.85), "AI_CATEGORY_INVALID");
  });

  it("rejects invalid JSON", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(() => validateGeneratedTimesheetText("not-json", context(records)), "AI_OUTPUT_INVALID");
  });

  it("rejects incomplete schema", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput({ tasks: [] }, context(records), 0.85), "AI_OUTPUT_INVALID");
  });

  it("rejects illegal task hours", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，99 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output({ hours: 99 }), context(records), 0.85), "AI_OUTPUT_INVALID");
  });

  it("does not instruct the model to pad total hours", () => {
    const prompts = buildTimesheetPrompts({ today_records: [] });
    assert.match(prompts.systemPrompt, /不得为了凑满八小时补齐/);
  });

  it("warns about abnormal total hours without changing the model value", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 明确记录 17 小时", hoursHint: "17" })];
    const normalized = normalizeGeneratedOutput(
      output({ hours: 17, status: "in_progress" }),
      context(records),
      0.85,
    );
    const result = withTotalHoursWarning(normalized);
    assert.equal(result.tasks[0].hours, 17);
    assert.match(result.warnings[0], /^TOTAL_HOURS:17/);
  });

  it("marks every AI task for human review", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    assert.equal(normalizeGeneratedOutput(output(), context(records), 0.85).tasks[0].needs_review, true);
  });

  it("adds low-confidence project, category, and status fields", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    const result = normalizeGeneratedOutput(
      output({ confidence: { description: 0.95, project: 0.6, hours: 0.9, category: 0.7, status: 0.8 } }),
      context(records),
      0.85,
    );
    assert.deepEqual([...result.tasks[0].review_fields].sort(), ["category", "project", "status"]);
  });

  it("rejects source records outside the current user and date selection", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(() => normalizeGeneratedOutput(output({ source_record_ids: ["record-other"] }), context(records), 0.85), "AI_SOURCE_RECORD_INVALID");
  });

  it("rejects a source record that silently disappears from the result", () => {
    const records = [
      record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" }),
      record({ id: "record-002", rawText: "CHAGEE 整理会议记录，1 小时", hoursHint: "1" }),
    ];
    expectCode(() => normalizeGeneratedOutput(output(), context(records), 0.85), "AI_SOURCE_RECORD_OMITTED");
  });

  it("rejects a source record listed as both used and unresolved", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转，1 小时", hoursHint: "1" })];
    expectCode(
      () => normalizeGeneratedOutput({ ...output(), unresolved_record_ids: ["record-001"] }, context(records), 0.85),
      "AI_SOURCE_RECORD_CONFLICT",
    );
  });

  it("rejects model-supplied hours without source evidence", () => {
    const records = [record({ id: "record-001", rawText: "CHAGEE 确认跳转" })];
    expectCode(() => normalizeGeneratedOutput(output({ status: "in_progress" }), context(records), 0.85), "AI_HOURS_WITHOUT_EVIDENCE");
  });
});
