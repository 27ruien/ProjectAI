import { createLogEntry } from "./shared/logging";
import { validateSyncPayload, type SyncPayload } from "./shared/protocol";
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
  type PersistedBatch,
} from "./shared/state-machine";
import { appendLog, loadBatches, loadConfig, saveBatch } from "./shared/storage";
import { createSerialExecutor } from "./shared/serial";

const processing = new Set<string>();
const requestedControls = new Map<string, "pause" | "cancel">();
const runRequestMutation = createSerialExecutor();
const LOCALLY_ACTIVE = new Set([
  "validating",
  "waiting_for_board",
  "waiting_for_login",
  "ready",
  "syncing",
  "paused",
]);

function apiStatus(batch: PersistedBatch): string {
  const status = deriveBatchStatus(batch);
  return {
    idle: "validating",
    validating: "validating",
    waiting_for_board: "waiting_for_board",
    waiting_for_login: "waiting_for_login",
    ready: "validating",
    syncing: "running",
    paused: "paused",
    completed: "synced",
    partially_completed: "partially_synced",
    failed: "failed",
    cancelled: "cancelled",
  }[status];
}

function statusMessage(batch: PersistedBatch, forcedType?: string) {
  const status = apiStatus(batch);
  const terminal = ["synced", "partially_synced", "failed", "cancelled"].includes(status);
  return {
    type:
      forcedType ??
      (status === "synced" || status === "partially_synced"
        ? "PROJECT_AI_SYNC_COMPLETED"
        : status === "failed"
          ? "PROJECT_AI_SYNC_FAILED"
          : status === "cancelled"
            ? "PROJECT_AI_SYNC_CANCELLED"
            : "PROJECT_AI_SYNC_PROGRESS"),
    request_id: batch.requestId,
    sync_batch_id: batch.syncBatchId,
    timestamp: new Date().toISOString(),
    status,
    terminal,
    items: batch.items.map((item) => ({
      taskId: item.taskId,
      status: item.status,
      attemptCount: item.attemptCount,
      externalReference: item.externalReference,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
    })),
  };
}

async function broadcast(batch: PersistedBatch, forcedType?: string): Promise<void> {
  const message = { kind: "STATUS_UPDATE", message: statusMessage(batch, forcedType) };
  await chrome.runtime.sendMessage(message).catch(() => undefined);
  const tabs = await chrome.tabs.query({
    url: __PROJECTAI_ALLOWED_ORIGINS__.map((origin) => `${origin}/*`),
  });
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => chrome.tabs.sendMessage(tab.id!, message).catch(() => undefined)),
  );
}

async function openConfiguredBoard(): Promise<{ ok: boolean; code?: string }> {
  const config = await loadConfig();
  const url = validBoardUrl(config.boardUrl);
  if (!url || !__WECOM_ALLOWED_ORIGIN__ || url.origin !== __WECOM_ALLOWED_ORIGIN__) {
    await chrome.runtime.openOptionsPage();
    return { ok: false, code: "BOARD_CONFIGURATION_REQUIRED" };
  }
  const tabs = await chrome.tabs.query({ url: [`${url.origin}/*`] });
  const existing = tabs.find((tab) => typeof tab.id === "number" && sameBoardPage(tab, url));
  if (typeof existing?.id === "number") {
    await chrome.tabs.update(existing.id, { active: true });
  } else {
    await chrome.tabs.create({ url: url.toString(), active: true });
  }
  return { ok: true };
}

function validBoardUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return null;
    return url;
  } catch {
    return null;
  }
}

function sameBoardPage(tab: ChromeTab, expected: URL): boolean {
  if (!tab.url) return false;
  try {
    const actual = new URL(tab.url);
    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.search === expected.search &&
      actual.hash === expected.hash
    );
  } catch {
    return false;
  }
}

function projectAiSender(sender: ChromeMessageSender): boolean {
  const raw = sender.url ?? sender.tab?.url;
  if (typeof sender.tab?.id !== "number" || !raw) return false;
  try {
    const url = new URL(raw);
    if (!__PROJECTAI_ALLOWED_ORIGINS__.includes(url.origin)) return false;
    return __MANUAL_ACTUAL_SYNC_ALLOWED__
      ? url.pathname === "/projectai.html"
      : url.pathname.startsWith("/tool/projectai/") ||
          url.pathname.startsWith("/tool/projectai-staging/");
  } catch {
    return false;
  }
}

function popupSender(sender: ChromeMessageSender): boolean {
  if (!sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.pathname === "/popup.html";
  } catch {
    return false;
  }
}

function waitForTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (changedTabId: number, changeInfo: { status?: string }) => {
      if (changedTabId !== tabId || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeout);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("BOARD_LOAD_TIMEOUT"));
    }, 20_000);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

async function boardTab(batch: PersistedBatch): Promise<{ batch: PersistedBatch; tabId: number | null }> {
  const config = await loadConfig();
  const url = validBoardUrl(config.boardUrl);
  if (!url) {
    const updated = { ...batch, status: "waiting_for_board" as const, updatedAt: new Date().toISOString() };
    await saveBatch(updated);
    await chrome.runtime.openOptionsPage();
    return { batch: updated, tabId: null };
  }
  if (!__WECOM_ALLOWED_ORIGIN__ || url.origin !== __WECOM_ALLOWED_ORIGIN__) {
    const updated = { ...batch, status: "waiting_for_board" as const, updatedAt: new Date().toISOString() };
    await appendLog(createLogEntry({ level: "warning", code: "WECOM_ORIGIN_NOT_BUILT", batchId: batch.syncBatchId, taskId: null }));
    await saveBatch(updated);
    await chrome.runtime.openOptionsPage();
    return { batch: updated, tabId: null };
  }
  const tabs = await chrome.tabs.query({ url: [`${url.origin}/*`] });
  let tab = tabs.find(
    (candidate) => typeof candidate.id === "number" && sameBoardPage(candidate, url),
  );
  if (!tab) tab = await chrome.tabs.create({ url: url.toString(), active: true });
  if (typeof tab.id !== "number") throw new Error("BOARD_TAB_UNAVAILABLE");
  await waitForTab(tab.id);
  try {
    const diagnostic = await chrome.tabs.sendMessage<{ loaded?: boolean }>(tab.id, {
      kind: "GET_PAGE_DIAGNOSTICS",
    });
    if (!diagnostic?.loaded) throw new Error("WECOM_CONTENT_SCRIPT_UNAVAILABLE");
  } catch {
    throw new Error("WECOM_CONTENT_SCRIPT_UNAVAILABLE");
  }
  return { batch, tabId: tab.id };
}

async function diagnostics() {
  const config = await loadConfig();
  const url = validBoardUrl(config.boardUrl);
  if (!url || url.origin !== __WECOM_ALLOWED_ORIGIN__) {
    return { pageDetected: false, contentScriptLoaded: false, origin: __WECOM_ALLOWED_ORIGIN__ || null, worksheet: null, view: null };
  }
  const tabs = await chrome.tabs.query({ url: [`${url.origin}/*`] });
  const tab = tabs.find((candidate) => typeof candidate.id === "number" && sameBoardPage(candidate, url));
  if (typeof tab?.id !== "number") {
    return { pageDetected: false, contentScriptLoaded: false, origin: url.origin, worksheet: null, view: null };
  }
  try {
    const page = await chrome.tabs.sendMessage<{ loaded?: boolean; origin?: string; worksheet?: string | null; view?: string | null }>(tab.id, {
      kind: "GET_PAGE_DIAGNOSTICS",
    });
    return {
      pageDetected: true,
      contentScriptLoaded: page?.loaded === true,
      origin: page?.origin === url.origin ? page.origin : url.origin,
      worksheet: typeof page?.worksheet === "string" ? page.worksheet.slice(0, 80) : null,
      view: typeof page?.view === "string" ? page.view.slice(0, 80) : null,
    };
  } catch {
    return { pageDetected: true, contentScriptLoaded: false, origin: url.origin, worksheet: null, view: null };
  }
}

async function processBatch(initial: PersistedBatch): Promise<void> {
  if (processing.has(initial.syncBatchId)) return;
  processing.add(initial.syncBatchId);
  let batch = initial;
  try {
    const board = await boardTab(batch);
    batch = board.batch;
    if (board.tabId === null) {
      await broadcast(batch);
      return;
    }
    const beforeExecutionControl = requestedControls.get(batch.syncBatchId);
    if (beforeExecutionControl) {
      batch = applyDeferredControl(batch, beforeExecutionControl);
      requestedControls.delete(batch.syncBatchId);
      await saveBatch(batch);
      await broadcast(batch);
      return;
    }
    batch = { ...batch, status: "ready", updatedAt: new Date().toISOString() };
    await saveBatch(batch);
    await broadcast(batch);
    while (true) {
      const item = nextPendingItem(batch);
      if (!item) break;
      const task = batch.payload.tasks.find((candidate) => candidate.id === item.taskId);
      if (!task) throw new Error("TASK_PAYLOAD_MISSING");
      batch = updateItem(batch, item.taskId, {
        status: "running",
        attemptCount: item.attemptCount + 1,
        errorCode: null,
        errorMessage: null,
      });
      batch = { ...batch, status: "syncing" };
      await saveBatch(batch);
      await broadcast(batch);
      const result = await chrome.tabs.sendMessage<{
        status?: string;
        code?: string;
        message?: string;
        externalReference?: string | null;
      }>(board.tabId, { kind: "EXECUTE_TASK", task, dryRun: batch.payload.dry_run });
      if (result?.status === "waiting_for_login") {
        batch = updateItem(batch, item.taskId, {
          status: "waiting_for_login",
          errorCode: "LOGIN_REQUIRED",
          errorMessage: "等待用户手动登录",
        });
        batch = { ...batch, status: "waiting_for_login" };
        await saveBatch(batch);
        await broadcast(batch);
        return;
      }
      if (result?.status === "saved" || result?.status === "validated") {
        batch = updateItem(batch, item.taskId, {
          status: "saved",
          externalReference: result.externalReference ?? (result.status === "validated" ? "dry-run-validated" : null),
          errorCode: null,
          errorMessage: null,
        });
        const deferred = requestedControls.get(batch.syncBatchId);
        if (deferred) {
          batch = applyDeferredControl(batch, deferred);
          requestedControls.delete(batch.syncBatchId);
          await saveBatch(batch);
          await broadcast(batch);
          return;
        }
        await saveBatch(batch);
        await broadcast(batch);
        continue;
      }
      if (result?.status === "unknown") {
        batch = updateItem(batch, item.taskId, {
          status: "unknown",
          errorCode: result.code ?? "SAVE_RESULT_UNKNOWN",
          errorMessage: result.message ?? "保存结果未知",
        });
        batch = pauseBatch(batch);
      } else {
        batch = updateItem(batch, item.taskId, {
          status: "failed",
          errorCode: result?.code ?? "ITEM_FAILED",
          errorMessage: result?.message ?? "单条任务同步失败",
        });
        batch = pauseBatch(batch);
      }
      await saveBatch(batch);
      await broadcast(batch);
      return;
    }
    batch = { ...batch, status: deriveBatchStatus(batch), updatedAt: new Date().toISOString() };
    await saveBatch(batch);
    await broadcast(batch);
  } catch (error) {
    const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, "_").slice(0, 80) : "BATCH_FAILED";
    batch = { ...batch, status: "paused", updatedAt: new Date().toISOString() };
    await saveBatch(batch);
    await appendLog(createLogEntry({ level: "error", code, batchId: batch.syncBatchId, taskId: null }));
    await broadcast(batch);
  } finally {
    processing.delete(initial.syncBatchId);
  }
}

async function startSync(
  payloadValue: unknown,
  allowActualSync: boolean,
): Promise<{ ok: boolean; code?: string }> {
  const validated = validateSyncPayload(payloadValue);
  if (!validated.ok) return { ok: false, code: validated.code };
  const payload: SyncPayload = validated.value;
  if (!allowActualSync && !payload.dry_run) {
    return { ok: false, code: "MANUAL_ACTUAL_SYNC_FORBIDDEN" };
  }
  const batches = await loadBatches();
  const existing = batches[payload.sync_batch_id];
  if (existing) {
    if (acceptReplay(existing, payload) === "conflict") return { ok: false, code: "SYNC_BATCH_REPLAY_CONFLICT" };
    await broadcast(existing, "PROJECT_AI_SYNC_ACCEPTED");
    if (["validating", "waiting_for_board", "waiting_for_login", "ready", "syncing"].includes(existing.status)) {
      void processBatch(existing);
    }
    return { ok: true };
  }
  const otherActive = Object.values(batches).find((batch) => LOCALLY_ACTIVE.has(batch.status));
  if (otherActive) return { ok: false, code: "ANOTHER_BATCH_ACTIVE" };
  const batch = createBatch(payload);
  await saveBatch(batch);
  await broadcast(batch, "PROJECT_AI_SYNC_ACCEPTED");
  void processBatch(batch);
  return { ok: true };
}

async function controlSync(value: Record<string, unknown>): Promise<{ ok: boolean; code?: string }> {
  const batches = await loadBatches();
  const id = typeof value.syncBatchId === "string" ? value.syncBatchId : "";
  const batch = batches[id];
  if (!batch || value.requestId !== batch.requestId) return { ok: false, code: "BATCH_NOT_FOUND" };
  try {
    const action = value.action;
    if (action === "pause" || action === "cancel") {
      requestedControls.set(batch.syncBatchId, action);
    } else if (action === "resume") {
      requestedControls.delete(batch.syncBatchId);
    }
    const updated = action === "pause" ? pauseBatch(batch) : action === "cancel" ? cancelBatch(batch) : action === "resume" ? resumeBatch(batch) : null;
    if (!updated) return { ok: false, code: "CONTROL_INVALID" };
    await saveBatch(updated);
    await broadcast(updated);
    if (action === "pause" || action === "cancel") {
      if (!processing.has(batch.syncBatchId)) requestedControls.delete(batch.syncBatchId);
    }
    if (action === "resume") void processBatch(updated);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : "CONTROL_FAILED" };
  }
}

async function resolveUnknown(value: Record<string, unknown>): Promise<{ ok: boolean; code?: string }> {
  const batches = await loadBatches();
  const id = typeof value.syncBatchId === "string" ? value.syncBatchId : "";
  const taskId = typeof value.taskId === "string" ? value.taskId : "";
  const batch = batches[id];
  if (!batch || value.requestId !== batch.requestId) return { ok: false, code: "BATCH_NOT_FOUND" };
  if (value.resolution !== "saved" && value.resolution !== "failed") {
    return { ok: false, code: "RESOLUTION_INVALID" };
  }
  try {
    const updated = resolveUnknownItem(batch, taskId, value.resolution);
    await saveBatch(updated);
    await broadcast(updated);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : "RESOLUTION_FAILED" };
  }
}

async function recover(): Promise<void> {
  const batches = await loadBatches();
  for (const batch of Object.values(batches)) {
    const recovered = recoverInterruptedBatch(batch);
    if (recovered !== batch) await saveBatch(recovered);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  const value = message as Record<string, unknown>;
  if (value.kind === "START_SYNC") {
    const fromProjectAi = value.source === "project-ai-content" && projectAiSender(sender);
    const fromPopup = value.source === "popup" && popupSender(sender);
    if (!fromProjectAi && !fromPopup) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void runRequestMutation(() =>
      startSync(value.payload, fromProjectAi || __MANUAL_ACTUAL_SYNC_ALLOWED__),
    ).then(sendResponse);
    return true;
  }
  if (value.kind === "OPEN_BOARD") {
    if (value.source !== "project-ai-content" || !projectAiSender(sender)) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void openConfiguredBoard().then(sendResponse);
    return true;
  }
  if (value.kind === "OPEN_BOARD_FROM_POPUP") {
    if (value.source !== "popup" || !popupSender(sender)) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void openConfiguredBoard().then(sendResponse);
    return true;
  }
  if (value.kind === "CONTROL_SYNC") {
    const allowed =
      (value.source === "project-ai-content" && projectAiSender(sender)) ||
      (value.source === "popup" && popupSender(sender));
    if (!allowed) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void runRequestMutation(() => controlSync(value)).then(sendResponse);
    return true;
  }
  if (value.kind === "RESOLVE_UNKNOWN") {
    if (value.source !== "popup" || !popupSender(sender)) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void runRequestMutation(() => resolveUnknown(value)).then(sendResponse);
    return true;
  }
  if (value.kind === "GET_STATE") {
    void runRequestMutation(loadBatches).then((batches) => sendResponse({ batches }));
    return true;
  }
  if (value.kind === "GET_DIAGNOSTICS") {
    if (value.source !== "popup" || !popupSender(sender)) {
      sendResponse({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
      return;
    }
    void diagnostics().then((result) => sendResponse({ ok: true, ...result }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => void runRequestMutation(recover));
chrome.runtime.onInstalled.addListener(() => void runRequestMutation(recover));
void runRequestMutation(recover);
