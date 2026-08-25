(function registerChatGptAdapter(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;
  const adapter = namespace.adapterCore.createSiteAdapter({
    id: "chatgpt",
    displayName: "ChatGPT",
    hosts: ["chatgpt.com"],
    verificationStatus: "NEEDS_MANUAL_VERIFICATION",
    composerSelectors: [
      "#prompt-textarea",
      "[data-testid='composer-text-input'][contenteditable='true']",
      "textarea[data-id='root']",
      "form [contenteditable='true'][role='textbox']",
      "form .ProseMirror[contenteditable='true']",
    ],
    assistantSelectors: [
      "[data-message-author-role='assistant']",
      "article[data-turn='assistant']",
      "[data-testid^='conversation-turn-'] [data-message-author-role='assistant']",
    ],
    responseContentSelectors: [
      "[data-message-author-role='assistant'] .markdown",
      ".markdown.prose",
      ".markdown",
      "[class*='prose']",
    ],
    stripSelectors: [
      "button",
      "[role='button']",
      "[aria-hidden='true']",
      "[data-testid*='copy']",
    ],
  });

  namespace.adapters.push(adapter);
})(globalThis);
