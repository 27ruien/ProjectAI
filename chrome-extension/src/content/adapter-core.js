(function registerAdapterCore(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});

  class AdapterDiagnosticError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "AdapterDiagnosticError";
      this.code = code;
      this.details = details || {};
    }

    toDiagnostic(site) {
      return {
        code: this.code,
        message: this.message,
        site,
        details: this.details,
      };
    }
  }

  function normalizeUrl(value) {
    try {
      return value instanceof URL ? value : new URL(String(value));
    } catch {
      return null;
    }
  }

  function elementText(element) {
    const value =
      typeof element.innerText === "string"
        ? element.innerText
        : element.textContent;
    return typeof value === "string" ? value.replace(/\u00a0/g, " ").trim() : "";
  }

  function isUsable(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (element.disabled || element.readOnly) return false;
    return element.isConnected !== false;
  }

  function queryFirst(root, selectors, predicate) {
    for (const selector of selectors) {
      const candidates = root.querySelectorAll(selector);
      for (const element of candidates) {
        if (!predicate || predicate(element)) return { element, selector };
      }
    }
    return null;
  }

  function queryAllInDocumentOrder(root, selectors) {
    const seen = new Set();
    const matches = [];

    for (const selector of selectors) {
      for (const element of root.querySelectorAll(selector)) {
        if (!seen.has(element)) {
          seen.add(element);
          matches.push({ element, selector });
        }
      }
    }

    matches.sort((left, right) => {
      if (left.element === right.element) return 0;
      if (typeof left.element.compareDocumentPosition !== "function") return 0;
      const position = left.element.compareDocumentPosition(right.element);
      if (position & 4) return -1;
      if (position & 2) return 1;
      return 0;
    });
    return matches;
  }

  function dispatchInputEvents(element, text) {
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const EventConstructor = (view && view.Event) || globalScope.Event;
    const InputEventConstructor =
      (view && view.InputEvent) || globalScope.InputEvent;

    if (typeof InputEventConstructor === "function") {
      element.dispatchEvent(
        new InputEventConstructor("input", {
          bubbles: true,
          composed: true,
          data: text,
          inputType: "insertText",
        }),
      );
    } else if (typeof EventConstructor === "function") {
      element.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    }

    if (typeof EventConstructor === "function") {
      element.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    }
  }

  function setFormControlValue(element, text) {
    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const tagName = String(element.tagName || "").toLowerCase();
    const prototype =
      tagName === "textarea" && view && view.HTMLTextAreaElement
        ? view.HTMLTextAreaElement.prototype
        : tagName === "input" && view && view.HTMLInputElement
          ? view.HTMLInputElement.prototype
          : null;
    const setter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "value")?.set
      : null;

    if (setter) setter.call(element, text);
    else element.value = text;
    dispatchInputEvents(element, text);
  }

  function setContentEditableValue(element, text) {
    const ownerDocument = element.ownerDocument;
    const view = ownerDocument && ownerDocument.defaultView;
    element.focus();

    let inserted = false;
    if (
      ownerDocument &&
      view &&
      typeof ownerDocument.createRange === "function" &&
      typeof view.getSelection === "function" &&
      typeof ownerDocument.execCommand === "function"
    ) {
      const selection = view.getSelection();
      const range = ownerDocument.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      inserted = ownerDocument.execCommand("insertText", false, text);
    }

    if (!inserted) {
      element.textContent = text;
      dispatchInputEvents(element, text);
    }
  }

  function injectIntoComposer(composer, text) {
    if (typeof text !== "string" || text.length === 0) {
      throw new AdapterDiagnosticError(
        "EMPTY_INJECTION",
        "没有可注入的内容。",
      );
    }

    const tagName = String(composer.tagName || "").toLowerCase();
    if (tagName === "textarea" || tagName === "input") {
      composer.focus();
      setFormControlValue(composer, text);
      return;
    }

    if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
      setContentEditableValue(composer, text);
      return;
    }

    throw new AdapterDiagnosticError(
      "UNSUPPORTED_COMPOSER",
      "匹配到的输入框不可编辑。",
      { tagName },
    );
  }

  function extractUsingSelectors(block, selectors) {
    for (const selector of selectors) {
      const candidates = Array.from(block.querySelectorAll(selector)).filter(
        (element) => elementText(element).length > 0,
      );
      if (candidates.length === 0) continue;

      const outermost = candidates.filter(
        (candidate) =>
          !candidates.some(
            (other) => other !== candidate && other.contains(candidate),
          ),
      );
      const text = outermost.map(elementText).filter(Boolean).join("\n\n");
      if (text) return { text, selector };
    }
    return null;
  }

  function extractFallback(block, stripSelectors) {
    if (typeof block.cloneNode !== "function") return elementText(block);
    const clone = block.cloneNode(true);
    for (const element of clone.querySelectorAll(stripSelectors.join(","))) {
      element.remove();
    }
    return elementText(clone);
  }

  function createSiteAdapter(config) {
    const supportedHosts = new Set(config.hosts);

    return {
      id: config.id,
      displayName: config.displayName,
      hosts: [...config.hosts],
      verificationStatus: config.verificationStatus,
      selectors: {
        composer: [...config.composerSelectors],
        assistant: [...config.assistantSelectors],
        responseContent: [...config.responseContentSelectors],
      },

      isSupportedPage(value) {
        const parsed = normalizeUrl(value);
        return Boolean(
          parsed && parsed.protocol === "https:" && supportedHosts.has(parsed.hostname),
        );
      },

      findComposer(root) {
        const match = queryFirst(
          root || globalScope.document,
          config.composerSelectors,
          isUsable,
        );
        if (!match) {
          throw new AdapterDiagnosticError(
            "COMPOSER_NOT_FOUND",
            `未找到 ${config.displayName} 输入框，页面结构可能已更新。`,
            { attemptedSelectors: config.composerSelectors },
          );
        }
        return match;
      },

      injectText(text, root) {
        const match = this.findComposer(root);
        injectIntoComposer(match.element, text);
        return {
          composerSelector: match.selector,
          injectedLength: text.length,
          autoSent: false,
        };
      },

      findLatestAssistantResponse(root) {
        const matches = queryAllInDocumentOrder(
          root || globalScope.document,
          config.assistantSelectors,
        );

        for (let index = matches.length - 1; index >= 0; index -= 1) {
          const match = matches[index];
          const selected = config.preferAssistantBlockFallback
            ? null
            : extractUsingSelectors(
                match.element,
                config.responseContentSelectors,
              );
          const fallback = selected
            ? selected.text
            : config.preserveAssistantBlockText
              ? elementText(match.element)
              : extractFallback(match.element, config.stripSelectors);
          if (fallback.trim()) {
            return { ...match, extracted: selected || { text: fallback, selector: null } };
          }
        }

        throw new AdapterDiagnosticError(
          "ASSISTANT_RESPONSE_NOT_FOUND",
          `未找到 ${config.displayName} 的最新非空 AI 回复。`,
          { attemptedSelectors: config.assistantSelectors },
        );
      },

      extractLatestResponse(root) {
        const match = this.findLatestAssistantResponse(root);
        return {
          text: match.extracted.text,
          format: "rendered_text",
          assistantSelector: match.selector,
          contentSelector: match.extracted.selector,
        };
      },
    };
  }

  namespace.adapterCore = {
    AdapterDiagnosticError,
    createSiteAdapter,
    elementText,
    injectIntoComposer,
    queryAllInDocumentOrder,
  };
  namespace.adapters = namespace.adapters || [];
})(globalThis);
