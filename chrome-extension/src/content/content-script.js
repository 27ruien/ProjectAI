/* global chrome */
(function registerContentBridge(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;

  function currentAdapter() {
    return namespace.adapters.find((adapter) =>
      adapter.isSupportedPage(globalScope.location.href),
    );
  }

  function safePageUrl() {
    return `${globalScope.location.origin}${globalScope.location.pathname}`;
  }

  function statusPayload(adapter) {
    if (!adapter) {
      return {
        ok: true,
        supported: false,
        mode: "chat",
        site: "暂不支持",
        agent: null,
        pageUrl: safePageUrl(),
      };
    }

    return {
      ok: true,
      supported: true,
      mode: "chat",
      site: adapter.displayName,
      agent: adapter.id,
      pageUrl: safePageUrl(),
      verificationStatus: adapter.verificationStatus,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const adapter = currentAdapter();

    try {
      if (!message || message.source !== "project-ai-uat-popup") return false;
      if (message.type === "GET_STATUS") {
        sendResponse(statusPayload(adapter));
        return false;
      }
      if (!adapter) {
        sendResponse({
          ok: false,
          error: {
            code: "UNSUPPORTED_PAGE",
            message: "当前页面没有可用的适配器。",
          },
        });
        return false;
      }
      if (message.type === "INJECT_TEXT") {
        const result = adapter.injectText(message.text, globalScope.document);
        sendResponse({ ok: true, ...statusPayload(adapter), ...result });
        return false;
      }
      if (message.type === "EXTRACT_LATEST_RESPONSE") {
        const result = adapter.extractLatestResponse(globalScope.document);
        sendResponse({ ok: true, ...statusPayload(adapter), ...result });
        return false;
      }
      sendResponse({
        ok: false,
        error: {
          code: "UNKNOWN_MESSAGE",
          message: "浏览器插件收到了未知操作。",
        },
      });
    } catch (error) {
      const diagnostic =
        error instanceof namespace.adapterCore.AdapterDiagnosticError
          ? error.toDiagnostic(adapter ? adapter.displayName : "暂不支持")
          : {
              code: "ADAPTER_OPERATION_FAILED",
              message: "浏览器插件操作失败，请重试。",
              site: adapter ? adapter.displayName : "暂不支持",
              details: {},
            };
      sendResponse({ ok: false, error: diagnostic });
    }

    return false;
  });
})(globalThis);
