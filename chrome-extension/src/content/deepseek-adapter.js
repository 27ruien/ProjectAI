(function registerDeepSeekAdapter(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;
  const adapter = namespace.adapterCore.createSiteAdapter({
    id: "deepseek",
    displayName: "DeepSeek",
    hosts: ["chat.deepseek.com"],
    verificationStatus: "NEEDS_MANUAL_VERIFICATION",
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
      "[data-role='assistant'] .markdown",
      "[class*='markdown']",
      "[class*='message-content']",
      "[class*='content']",
    ],
    stripSelectors: [
      "button",
      "[role='button']",
      "[aria-hidden='true']",
      "[class*='action']",
      "[class*='toolbar']",
    ],
  });

  namespace.adapters.push(adapter);
})(globalThis);
