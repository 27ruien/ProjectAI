import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  idempotencyKey,
  validateProjectAiWindowMessage,
  validateSyncPayload,
  type SyncPayload,
} from "../extensions/wecom-timesheet/src/shared/protocol";
import {
  acceptReplay,
  applyDeferredControl,
  cancelBatch,
  createBatch,
  deriveBatchStatus,
  nextPendingItem,
  pauseBatch,
  recoverInterruptedBatch,
  resolveUnknownItem,
  resumeBatch,
  updateItem,
} from "../extensions/wecom-timesheet/src/shared/state-machine";
import { createLogEntry } from "../extensions/wecom-timesheet/src/shared/logging";
import { validateSelectorConfig } from "../extensions/wecom-timesheet/src/shared/selector-config";
import { createSerialExecutor } from "../extensions/wecom-timesheet/src/shared/serial";

const payload: SyncPayload = {
  version: 1,
  request_id: "11111111-1111-4111-8111-111111111111",
  sync_batch_id: "22222222-2222-4222-8222-222222222222",
  date: "2026-07-22",
  source: "project-ai",
  confirmed_at: "2026-07-22T10:00:00+08:00",
  draft_version: 1,
  dry_run: true,
  tasks: [
    {
      id: "task-001",
      description: "完成 EARN 页面登录及 H5 回流逻辑确认",
      project: { id: "project-001", name: "CHAGEE Valley Fair Campaign" },
      submitter: { id: null, name: null, source: "authenticated-user" },
      regularHours: 1,
      overtimeHours: 0,
      category: { id: "communication", name: "项目沟通" },
      status: { id: null, name: "已完成" },
      urgency: null,
      progress: 100,
    },
  ],
};

describe("WeCom extension trust and recovery contracts", () => {
  it("keeps the manual UAT example aligned with the strict current protocol", async () => {
    const example = JSON.parse(await readFile("examples/uat-timesheet-payload.json", "utf8"));
    const result = validateSyncPayload(example);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.dry_run, true);
    assert.equal(result.value.tasks.length, 1);
    assert.equal(result.value.tasks[0].category.name, "项目执行");
    assert.equal(result.value.tasks[0].urgency?.name, "重要");
  });

  it("strictly validates the shared payload schema", () => {
    assert.equal(validateSyncPayload(payload).ok, true);
    assert.equal(validateSyncPayload({ ...payload, unexpected: true }).ok, false);
    assert.equal(validateSyncPayload({ ...payload, confirmed_at: null }).ok, false);
    assert.equal(validateSyncPayload({ ...payload, date: "2026-02-31" }).ok, false);
  });

  it("normalizes legacy hours without inventing overtime or overwriting category", () => {
    const legacy = {
      ...payload,
      tasks: [{
        id: "task-legacy",
        description: "旧版虚构任务",
        project: { id: "project-001", name: "CHAGEE Valley Fair Campaign" },
        hours: 1.25,
        category: { id: "review", name: "评审验收" },
        status: { id: "completed", name: "已完成" },
      }],
    };
    const result = validateSyncPayload(legacy);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.tasks[0].regularHours, 1.25);
    assert.equal(result.value.tasks[0].overtimeHours, null);
    assert.equal(result.value.tasks[0].category.name, "评审验收");
    assert.deepEqual(result.value.tasks[0].submitter, {
      id: null,
      name: null,
      source: "authenticated-user",
    });
  });

  it("rejects invalid regular/overtime totals and forged submitters", () => {
    assert.equal(validateSyncPayload({
      ...payload,
      tasks: [{ ...payload.tasks[0], regularHours: 20, overtimeHours: 5 }],
    }).ok, false);
    assert.equal(validateSyncPayload({
      ...payload,
      tasks: [{ ...payload.tasks[0], submitter: { id: "other", name: "其他人", source: "authenticated-user" } }],
    }).ok, false);
  });

  it("rejects a forged origin and iframe message", () => {
    const data = { source: "project-ai", type: "PROJECT_AI_SYNC_TIMESHEET", version: 1, requestId: payload.request_id, payload };
    assert.equal(validateProjectAiWindowMessage({ data, eventOrigin: "https://evil.invalid", currentOrigin: "https://gridworks.cn", isTopFrame: true, allowedOrigins: ["https://gridworks.cn"] }).ok, false);
    assert.equal(validateProjectAiWindowMessage({ data, eventOrigin: "https://gridworks.cn", currentOrigin: "https://gridworks.cn", isTopFrame: false, allowedOrigins: ["https://gridworks.cn"] }).ok, false);
  });

  it("rejects an invalid postMessage request id", () => {
    const result = validateProjectAiWindowMessage({ data: { source: "project-ai", type: "PROJECT_AI_SYNC_TIMESHEET", version: 1, requestId: "wrong", payload }, eventOrigin: "https://gridworks.cn", currentOrigin: "https://gridworks.cn", isTopFrame: true, allowedOrigins: ["https://gridworks.cn"] });
    assert.equal(result.ok, false);
  });

  it("allows opening the board only from the trusted top-level ProjectAI origin", () => {
    const data = { source: "project-ai", type: "PROJECT_AI_OPEN_WECOM_BOARD", version: 1 };
    assert.equal(validateProjectAiWindowMessage({ data, eventOrigin: "https://gridworks.cn", currentOrigin: "https://gridworks.cn", isTopFrame: true, allowedOrigins: ["https://gridworks.cn"] }).ok, true);
    assert.equal(validateProjectAiWindowMessage({ data, eventOrigin: "https://evil.invalid", currentOrigin: "https://gridworks.cn", isTopFrame: true, allowedOrigins: ["https://gridworks.cn"] }).ok, false);
  });

  it("uses sync batch plus task id as the idempotency key", () => {
    assert.equal(idempotencyKey(payload.sync_batch_id, "task-001"), `${payload.sync_batch_id}:task-001`);
  });

  it("accepts exact replay but rejects changed replay", () => {
    const batch = createBatch(payload);
    assert.equal(acceptReplay(batch, payload), "same");
    assert.equal(acceptReplay(batch, { ...payload, dry_run: false }), "conflict");
    const reordered: SyncPayload = {
      tasks: payload.tasks,
      dry_run: payload.dry_run,
      draft_version: payload.draft_version,
      confirmed_at: payload.confirmed_at,
      source: payload.source,
      date: payload.date,
      sync_batch_id: payload.sync_batch_id,
      request_id: payload.request_id,
      version: payload.version,
    };
    assert.equal(acceptReplay(batch, reordered), "same");
  });

  it("supports pause, resume, and cancel", () => {
    const batch = createBatch(payload);
    assert.equal(pauseBatch(batch).status, "paused");
    assert.equal(resumeBatch(pauseBatch(batch)).status, "ready");
    const cancelled = cancelBatch(batch);
    assert.equal(cancelled.items[0].status, "cancelled");
    assert.throws(() => resumeBatch(cancelled), /TERMINAL_BATCH_CANNOT_RESUME/);
  });

  it("defers cancel while one item may be saving and preserves unknown for review", () => {
    const running = updateItem(createBatch(payload), "task-001", { status: "running" });
    const requested = applyDeferredControl(running, "cancel");
    assert.equal(requested.status, "paused");
    assert.equal(requested.items[0].status, "running");
    const unknown = updateItem(running, "task-001", { status: "unknown" });
    const cancelledAfterUnknown = applyDeferredControl(unknown, "cancel");
    assert.equal(cancelledAfterUnknown.status, "paused");
    assert.equal(cancelledAfterUnknown.items[0].status, "unknown");
  });

  it("turns interrupted running work into unknown and never auto-selects it", () => {
    const running = updateItem(createBatch(payload), "task-001", { status: "running" });
    const recovered = recoverInterruptedBatch(running);
    assert.equal(recovered.status, "paused");
    assert.equal(recovered.items[0].status, "unknown");
    assert.equal(nextPendingItem(recovered), null);
    assert.throws(() => resumeBatch(recovered), /UNKNOWN_ITEM_REQUIRES_REVIEW/);
  });

  it("requeues a login-blocked item only after explicit resume", () => {
    const waiting = updateItem(createBatch(payload), "task-001", {
      status: "waiting_for_login",
      errorCode: "LOGIN_REQUIRED",
      errorMessage: "等待用户手动登录",
    });
    const waitingBatch = { ...waiting, status: "waiting_for_login" as const };
    assert.equal(nextPendingItem(waitingBatch), null);
    const resumed = resumeBatch(waitingBatch);
    assert.equal(resumed.status, "ready");
    assert.equal(resumed.items[0].status, "pending");
    assert.equal(resumed.items[0].errorCode, null);
    assert.equal(nextPendingItem(resumed)?.taskId, "task-001");
  });

  it("requires explicit manual reconciliation before an unknown item can progress", () => {
    const running = updateItem(createBatch(payload), "task-001", { status: "running" });
    const recovered = recoverInterruptedBatch(running);
    const saved = resolveUnknownItem(recovered, "task-001", "saved");
    assert.equal(saved.status, "completed");
    assert.equal(saved.items[0].status, "saved");
    const failed = resolveUnknownItem(recovered, "task-001", "failed");
    assert.equal(failed.status, "paused");
    assert.equal(failed.items[0].status, "failed");
    assert.equal(deriveBatchStatus(failed), "paused");
    assert.equal(resumeBatch(failed).status, "ready");
  });

  it("never rolls a saved item back", () => {
    const saved = updateItem(createBatch(payload), "task-001", { status: "saved" });
    assert.throws(() => updateItem(saved, "task-001", { status: "failed" }), /SYNC_ITEM_ALREADY_SAVED/);
  });

  it("retries only the failed item and permanently skips an already saved item", () => {
    const twoTaskPayload: SyncPayload = {
      ...payload,
      tasks: [
        payload.tasks[0],
        { ...payload.tasks[0], id: "task-002", description: "完成第二条虚构工时任务" },
      ],
    };
    const savedFirst = updateItem(createBatch(twoTaskPayload), "task-001", { status: "saved" });
    const failedSecond = updateItem(savedFirst, "task-002", {
      status: "failed",
      errorCode: "ITEM_SAVE_FAILED",
    });
    const resumed = resumeBatch(failedSecond);
    assert.equal(resumed.items[0].status, "saved");
    assert.equal(resumed.items[1].status, "failed");
    assert.equal(nextPendingItem(resumed)?.taskId, "task-002");
  });

  it("redacts sensitive logs and URLs", () => {
    const entry = createLogEntry({ level: "error", code: "test", batchId: payload.sync_batch_id, taskId: "task-001", details: { cookie: "secret", note: "token=abc https://private.invalid/path" } });
    assert.equal("cookie" in entry.details, false);
    assert.doesNotMatch(String(entry.details.note), /abc|private\.invalid/);
  });

  it("requires explicit confirmation before clearing records by contract", async () => {
    const storageSource = await import("node:fs/promises").then((fs) => fs.readFile("extensions/wecom-timesheet/src/shared/storage.ts", "utf8"));
    assert.match(storageSource, /CLEAR_CONFIRMATION_REQUIRED/);
  });

  it("rejects selector configs that attempt to include final submit", () => {
    const result = validateSelectorConfig({ finalSubmit: "button" });
    assert.deepEqual(result, { ok: false, code: "FINAL_SUBMIT_SELECTOR_FORBIDDEN" });
  });

  it("rejects executable, event-handler, broad, and malformed selector config", async () => {
    const raw = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile("extensions/wecom-timesheet/static/selector-config.example.json", "utf8"),
      ),
    ) as Record<string, string>;
    assert.equal(validateSelectorConfig(raw).ok, true);
    assert.deepEqual(
      validateSelectorConfig({ ...raw, boardReady: "a[href='javascript:alert(1)']" }),
      { ok: false, code: "SELECTOR_CONFIG_UNSAFE" },
    );
    assert.deepEqual(
      validateSelectorConfig({ ...raw, itemSaveButton: "button[onclick]" }),
      { ok: false, code: "SELECTOR_CONFIG_UNSAFE" },
    );
    assert.deepEqual(validateSelectorConfig({ ...raw, taskForm: "body" }), {
      ok: false,
      code: "SELECTOR_CONFIG_UNSAFE",
    });
    assert.deepEqual(validateSelectorConfig({ ...raw, taskForm: "form[data-id='x'" }), {
      ok: false,
      code: "SELECTOR_CONFIG_UNSAFE",
    });
  });

  it("serializes concurrent service-worker state mutations", async () => {
    const run = createSerialExecutor();
    let active = 0;
    let maximumActive = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((value) =>
        run(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          order.push(value);
          active -= 1;
        }),
      ),
    );
    assert.equal(maximumActive, 1);
    assert.deepEqual(order, [1, 2, 3]);
  });
});
