import { executeTaskWithAdapter } from "./wecom-adapter";
import { validateSelectorConfig } from "./shared/selector-config";
import { loadConfig } from "./shared/storage";

async function execute(message: unknown) {
  if (!message || typeof message !== "object") {
    return { status: "failed", code: "MESSAGE_INVALID", message: "消息无效" };
  }
  const value = message as Record<string, unknown>;
  if (value.kind !== "EXECUTE_TASK" || !value.task || typeof value.dryRun !== "boolean") {
    return { status: "failed", code: "MESSAGE_INVALID", message: "任务消息无效" };
  }
  const config = await loadConfig();
  const selectors = validateSelectorConfig(config.selectors);
  if (!selectors.ok) {
    return { status: "failed", code: selectors.code, message: "企业微信选择器尚未配置" };
  }
  return executeTaskWithAdapter({
    documentRoot: document,
    task: value.task as Parameters<typeof executeTaskWithAdapter>[0]["task"],
    dryRun: value.dryRun,
    selectors: selectors.value,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if ((message as Record<string, unknown>).kind === "GET_PAGE_DIAGNOSTICS") {
    const rawView = document.documentElement.dataset.projectaiView ?? "";
    sendResponse({
      loaded: true,
      origin: location.origin,
      worksheet: /^[\p{L}\p{N}\s._-]{1,80}$/u.test(document.documentElement.dataset.projectaiWorksheet ?? "")
        ? document.documentElement.dataset.projectaiWorksheet
        : null,
      view: /^[\p{L}\p{N}\s._-]{1,80}$/u.test(rawView) ? rawView : null,
    });
    return;
  }
  if ((message as Record<string, unknown>).kind !== "EXECUTE_TASK") return;
  void execute(message).then(sendResponse, () =>
    sendResponse({ status: "failed", code: "ADAPTER_UNAVAILABLE", message: "页面适配器不可用" }),
  );
  return true;
});

if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  Object.defineProperty(window, "__PROJECTAI_WECOM_TEST__", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { execute },
  });
}
