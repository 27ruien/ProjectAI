(function registerDeepSeekAdapter(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;
  const adapter = namespace.adapterCore.createSiteAdapter({
    id: "deepseek",
    displayName: "DeepSeek",
    hosts: ["chat.deepseek.com"],
    verificationStatus: "NEEDS_MANUAL_VERIFICATION",
    preferAssistantBlockFallback: true,
    preserveAssistantBlockText: true,
    composerSelectors: [
      "textarea#chat-input",
      "textarea[data-testid='chat-input']",
      "textarea[placeholder*='DeepSeek' i]",
      "[contenteditable='true'][data-slate-editor='true']",
      "main [contenteditable='true'][role='textbox']",
    ],
    assistantSelectors: [
      "[data-role='assistant']",
      "[data-message-role='assistant']",
      "[data-testid='assistant-message']",
      "[class*='assistant'][class*='message']",
    ],
    responseContentSelectors: [
      "[class*='message-content']",
      "[class*='content']",
      ".ds-markdown",
      "[data-role='assistant'] .markdown",
      "[class*='markdown']",
    ],
    stripSelectors: [
      "button",
      "[role='button']",
      "[aria-hidden='true']",
      "[class*='action']",
      "[class*='toolbar']",
      "[class*='thinking']",
      "[class*='reasoning']",
    ],
  });

  namespace.adapters.push(adapter);
})(globalThis);
