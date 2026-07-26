import { sanitizeLogs } from "./shared/logging";
import { validateSyncPayload } from "./shared/protocol";
import { clearLocalData, loadBatches, loadLogs } from "./shared/storage";
import type { PersistedBatch } from "./shared/state-machine";

const input = document.querySelector<HTMLTextAreaElement>("#payload")!;
const preview = document.querySelector<HTMLElement>("#preview")!;
const status = document.querySelector<HTMLElement>("#status")!;
const dryRun = document.querySelector<HTMLInputElement>("#dry-run")!;
let lastDiagnostics: {
  pageDetected: boolean;
  contentScriptLoaded: boolean;
  origin: string | null;
  worksheet: string | null;
  view: string | null;
} | null = null;
dryRun.disabled = !__MANUAL_ACTUAL_SYNC_ALLOWED__;
if (!__MANUAL_ACTUAL_SYNC_ALLOWED__) dryRun.checked = true;

function text(id: string, value: string): void {
  const element = document.querySelector<HTMLElement>(id);
  if (element) element.textContent = value;
}

function latestBatch(batches: Record<string, PersistedBatch>): PersistedBatch | null {
  return Object.values(batches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function renderBatch(batch: PersistedBatch | null): void {
  if (!batch) {
    status.textContent = "暂无本地同步批次";
    return;
  }
  const saved = batch.items.filter((item) => item.status === "saved").length;
  const failed = batch.items.filter((item) => item.status === "failed").length;
  const unknown = batch.items.filter((item) => item.status === "unknown").length;
  status.textContent = `${batch.status} · 成功 ${saved}/${batch.items.length} · 失败 ${failed} · 未知 ${unknown}`;
  text("#batch-id", batch.syncBatchId);
}

async function refresh(): Promise<void> {
  renderBatch(latestBatch(await loadBatches()));
  const diagnostics = await chrome.runtime.sendMessage<{
    ok?: boolean;
    pageDetected?: boolean;
    contentScriptLoaded?: boolean;
    origin?: string | null;
    worksheet?: string | null;
    view?: string | null;
  }>({ kind: "GET_DIAGNOSTICS", source: "popup" }).catch(() => null);
  lastDiagnostics = diagnostics?.ok ? {
    pageDetected: diagnostics.pageDetected === true,
    contentScriptLoaded: diagnostics.contentScriptLoaded === true,
    origin: diagnostics.origin ?? null,
    worksheet: diagnostics.worksheet ?? null,
    view: diagnostics.view ?? null,
  } : null;
  text("#diagnostic-page", diagnostics?.pageDetected ? "已检测" : "未检测");
  text("#diagnostic-script", diagnostics?.contentScriptLoaded ? "已加载" : "未加载");
  text("#diagnostic-origin", diagnostics?.origin ?? "未绑定");
  text("#diagnostic-worksheet", diagnostics?.worksheet ?? "未识别（不会读取任务内容）");
  text("#diagnostic-view", diagnostics?.view ?? "未识别（不会读取任务内容）");
}

document.querySelector("#validate")?.addEventListener("click", () => {
  try {
    const parsed = validateSyncPayload(JSON.parse(input.value));
    if (!parsed.ok) {
      preview.textContent = `${parsed.code}：${parsed.message}`;
      preview.dataset.state = "error";
      return;
    }
    const total = parsed.value.tasks.reduce(
      (sum, task) => sum + task.regularHours + (task.overtimeHours ?? 0),
      0,
    );
    preview.textContent = `${parsed.value.date} · ${parsed.value.tasks.length} 条任务 · ${total.toFixed(2)} 小时`;
    preview.dataset.state = "success";
    dryRun.checked = __MANUAL_ACTUAL_SYNC_ALLOWED__ ? parsed.value.dry_run : true;
  } catch {
    preview.textContent = "JSON 格式无效";
    preview.dataset.state = "error";
  }
});

document.querySelector("#start")?.addEventListener("click", () => {
  void (async () => {
    try {
      const raw = JSON.parse(input.value) as Record<string, unknown>;
      raw.dry_run = __MANUAL_ACTUAL_SYNC_ALLOWED__ ? dryRun.checked : true;
      const parsed = validateSyncPayload(raw);
      if (!parsed.ok) throw new Error(parsed.code);
      if (parsed.value.tasks.length !== 1) throw new Error("ONE_RECORD_TEST_REQUIRED");
      if (!parsed.value.dry_run && !window.confirm("确认只保存这一条虚构 UAT 任务？扩展仍不会点击最终提交。")) return;
      const result = await chrome.runtime.sendMessage<{ ok?: boolean; code?: string }>({
        kind: "START_SYNC",
        source: "popup",
        payload: parsed.value,
      });
      preview.textContent = result?.ok ? "同步批次已接收" : `批次拒绝：${result?.code ?? "UNKNOWN"}`;
      await refresh();
    } catch (error) {
      preview.textContent = error instanceof Error ? error.message : "同步请求无效";
      preview.dataset.state = "error";
    }
  })();
});

async function control(action: "pause" | "resume" | "cancel"): Promise<void> {
  const batch = latestBatch(await loadBatches());
  if (!batch) return;
  const result = await chrome.runtime.sendMessage<{ ok?: boolean; code?: string }>({
    kind: "CONTROL_SYNC",
    source: "popup",
    requestId: batch.requestId,
    syncBatchId: batch.syncBatchId,
    action,
  });
  preview.textContent = result?.ok ? `已执行 ${action}` : `操作失败：${result?.code ?? "UNKNOWN"}`;
  await refresh();
}

async function resolveUnknown(resolution: "saved" | "failed"): Promise<void> {
  const batch = latestBatch(await loadBatches());
  const item = batch?.items.find((candidate) => candidate.status === "unknown");
  if (!batch || !item) {
    preview.textContent = "当前批次没有待人工核对的 unknown 项";
    return;
  }
  const prompt = resolution === "saved"
    ? "请先在企业微信中确认该任务确实已保存。确认后扩展会永久跳过该任务，是否继续？"
    : "请先在企业微信中确认该任务确实未保存。确认后该任务会转为 failed，仍需点击继续才会重试，是否继续？";
  if (!window.confirm(prompt)) return;
  const result = await chrome.runtime.sendMessage<{ ok?: boolean; code?: string }>({
    kind: "RESOLVE_UNKNOWN",
    source: "popup",
    requestId: batch.requestId,
    syncBatchId: batch.syncBatchId,
    taskId: item.taskId,
    resolution,
  });
  preview.textContent = result?.ok ? "unknown 项已按人工核对结果更新" : `处置失败：${result?.code ?? "UNKNOWN"}`;
  await refresh();
}

document.querySelector("#pause")?.addEventListener("click", () => void control("pause"));
document.querySelector("#resume")?.addEventListener("click", () => void control("resume"));
document.querySelector("#cancel")?.addEventListener("click", () => void control("cancel"));
document.querySelector("#resolve-saved")?.addEventListener("click", () => void resolveUnknown("saved"));
document.querySelector("#resolve-failed")?.addEventListener("click", () => void resolveUnknown("failed"));
document.querySelector("#options")?.addEventListener("click", () => void chrome.runtime.openOptionsPage());
document.querySelector("#open-board")?.addEventListener("click", () => {
  void chrome.runtime.sendMessage<{ ok?: boolean; code?: string }>({
    kind: "OPEN_BOARD_FROM_POPUP",
    source: "popup",
  }).then((result) => {
    preview.textContent = result?.ok ? "已打开配置的企业微信页面" : `打开失败：${result?.code ?? "UNKNOWN"}`;
    return refresh();
  });
});
document.querySelector("#export-logs")?.addEventListener("click", () => {
  void (async () => {
    const blob = new Blob([JSON.stringify(sanitizeLogs(await loadLogs()), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "projectai-wecom-sync-errors-redacted.json";
    anchor.click();
    URL.revokeObjectURL(url);
  })();
});
document.querySelector("#copy-diagnostics")?.addEventListener("click", () => {
  const report = {
    extensionVersion: __EXTENSION_VERSION__,
    pageDetected: lastDiagnostics?.pageDetected ?? false,
    contentScriptLoaded: lastDiagnostics?.contentScriptLoaded ?? false,
    origin: lastDiagnostics?.origin ?? null,
    worksheet: lastDiagnostics?.worksheet ?? null,
    view: lastDiagnostics?.view ?? null,
    fullUrlIncluded: false,
    taskContentIncluded: false,
  };
  void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
    preview.textContent = "已复制脱敏诊断结果";
  });
});
document.querySelector("#clear")?.addEventListener("click", () => {
  if (!window.confirm("确认清除本地同步状态和脱敏日志？此操作不会删除企业微信任务。")) return;
  void clearLocalData(true).then(refresh);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && typeof message === "object" && (message as Record<string, unknown>).kind === "STATUS_UPDATE") {
    void refresh();
  }
});

void refresh();
