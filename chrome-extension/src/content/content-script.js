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
        site: "Unsupported",
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
            message: "The current page does not have a configured adapter.",
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
          message: "The Extension received an unknown operation.",
        },
      });
    } catch (error) {
      const diagnostic =
        error instanceof namespace.adapterCore.AdapterDiagnosticError
          ? error.toDiagnostic(adapter ? adapter.displayName : "Unsupported")
          : {
              code: "ADAPTER_OPERATION_FAILED",
              message: error instanceof Error ? error.message : String(error),
              site: adapter ? adapter.displayName : "Unsupported",
              details: {},
            };
      sendResponse({ ok: false, error: diagnostic });
    }

    return false;
  });
})(globalThis);
