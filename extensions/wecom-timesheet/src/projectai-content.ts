import {
  EXTENSION_SOURCE,
  PROTOCOL_VERSION,
  validateProjectAiWindowMessage,
} from "./shared/protocol";

const NIL_ID = "00000000-0000-0000-0000-000000000000";

function post(type: string, input: Record<string, unknown> = {}): void {
  window.postMessage(
    {
      source: EXTENSION_SOURCE,
      type,
      version: PROTOCOL_VERSION,
      request_id: typeof input.request_id === "string" ? input.request_id : NIL_ID,
      sync_batch_id:
        typeof input.sync_batch_id === "string" ? input.sync_batch_id : NIL_ID,
      timestamp: new Date().toISOString(),
      status: typeof input.status === "string" ? input.status : "ready",
      extension_version: __EXTENSION_VERSION__,
      ...input,
    },
    window.location.origin,
  );
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const parsed = validateProjectAiWindowMessage({
    data: event.data,
    eventOrigin: event.origin,
    currentOrigin: window.location.origin,
    isTopFrame: window.top === window,
    allowedOrigins: __PROJECTAI_ALLOWED_ORIGINS__,
  });
  if (!parsed.ok) return;
  if (parsed.value.kind === "ping") {
    post("PROJECT_AI_EXTENSION_READY");
    return;
  }
  if (parsed.value.kind === "open_board") {
    void chrome.runtime.sendMessage({
      kind: "OPEN_BOARD",
      source: "project-ai-content",
    });
    return;
  }
  const runtimeMessage =
    parsed.value.kind === "sync"
      ? {
          kind: "START_SYNC",
          source: "project-ai-content",
          requestId: parsed.value.requestId,
          payload: parsed.value.payload,
        }
      : {
          kind: "CONTROL_SYNC",
          source: "project-ai-content",
          requestId: parsed.value.requestId,
          syncBatchId: parsed.value.syncBatchId,
          action: parsed.value.action,
        };
  void chrome.runtime
    .sendMessage(runtimeMessage)
    .catch(() => {
      const requestId = "requestId" in parsed.value ? parsed.value.requestId : NIL_ID;
      const syncBatchId =
        "payload" in parsed.value
          ? parsed.value.payload.sync_batch_id
          : "syncBatchId" in parsed.value
            ? parsed.value.syncBatchId
            : NIL_ID;
      post("PROJECT_AI_SYNC_FAILED", {
        request_id: requestId,
        sync_batch_id: syncBatchId,
        status: "failed",
        items: [],
      });
    });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  const value = message as Record<string, unknown>;
  if (value.kind === "STATUS_UPDATE" && value.message && typeof value.message === "object") {
    const status = value.message as Record<string, unknown>;
    post(String(status.type || "PROJECT_AI_SYNC_PROGRESS"), status);
  }
});

if (window.top === window && __PROJECTAI_ALLOWED_ORIGINS__.includes(window.location.origin)) {
  post("PROJECT_AI_EXTENSION_READY");
}
