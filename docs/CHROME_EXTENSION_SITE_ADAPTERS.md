# Chrome Extension Site Adapters

Last Verified: 2026-08-25

## Status vocabulary

- **IMPLEMENTED**: host mapping, selector candidates, injection, extraction, and
  diagnostics exist and pass synthetic adapter tests.
- **NEEDS_MANUAL_VERIFICATION**: the signed-in live page has not yet completed
  the manual steps in `CHROME_EXTENSION_UAT_GUIDE.md`.
- **MANUAL VERIFIED**: a signed-in live page completed exact injection,
  no-auto-send, native send, newest-response extraction, Copy, Download, Save,
  and Export through Computer Use.
- **BLOCKED**: a known prerequisite prevents testing or operation.

## Current status

| Site | Authorized host | Implementation | Live DOM status | Evidence / condition |
|---|---|---|---|---|
| ChatGPT | `chatgpt.com` | **IMPLEMENTED** | **MANUAL VERIFIED** | Signed-in live injection, no-auto-send, native send, newest-response extraction, Copy, Download, Save, and Export passed on 2026-08-25. |
| DeepSeek | `chat.deepseek.com` | **IMPLEMENTED / REPAIRED IN v0.1.1** | **MANUAL VERIFIED AFTER FIX** | Initial live extraction omitted headings/matrix (`EXT-UAT-001`). The bounded full-assistant-block repair passed deterministic regression, exact-head branch/tag CI, and a fresh 11,531-character post-CI live rerun. |
| Qwen | `chat.qwen.ai` | **IMPLEMENTED** | **MANUAL VERIFIED** | Signed-in live injection, no-auto-send, native send, newest-response extraction, Copy, Download, Save, and Export passed on 2026-08-25. |

None of the sites is currently **BLOCKED** by repository evidence. A site may
become blocked during future UAT if login, rollout differences, CSP changes, or
a DOM revision prevents a selector match. The business user should stop that
site and hand technical evidence capture to Codex/operator.

## Host policy

The manifest intentionally does not request wildcard Alibaba, OpenAI, or
DeepSeek domains. `qianwen.aliyun.com`, `tongyi.aliyun.com`, `qwen.ai`, and
similar landing/product domains are not treated as chat pages. If the user's
actual Qwen session runs on a different official host, do not add a broad
wildcard. Record the observed URL, verify that it is an official chat host,
then add the exact host to both:

1. `manifest.json` `host_permissions` and `content_scripts.matches`;
2. the Qwen adapter `hosts` list.

After any host change, rerun all validation gates and repeat manual UAT.

## Selector maintenance

All selectors live in the three adapter files under
`chrome-extension/src/content/`. If the popup reports:

- `COMPOSER_NOT_FOUND`: inspect the live composer, add the narrowest stable
  candidate to that adapter, and add a regression fixture;
- `ASSISTANT_RESPONSE_NOT_FOUND`: inspect assistant-role/message attributes and
  response-content structure, then add narrow candidates and a regression
  fixture;
- `UNSUPPORTED_COMPOSER`: the selected node is not an input, textarea, or
  contenteditable; remove or narrow that selector.

Do not move selectors into popup code, use conversation titles, click Send, or
fall back to reading every message on the page.
