# Project AI Skill UAT Adapter

This Manifest V3 Chrome Extension is the manual client for the full UAT path:

```text
logged-in Project AI Staging
  -> Sync official Skills through the current browser Session
  -> select one Skill in the Extension
  -> inject the exact SKILL.md + user task into an external Agent
  -> user sends manually
  -> capture, copy, download, save, and export the latest response
```

The default flow does not require opening a local `SKILL.md` or a Project AI
Skills Library page.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `chrome-extension/` directory.
5. Pin **Project AI Skill UAT Adapter** if desired.

No build step is required. After source changes, click **Reload** on the
Extension card before UAT. See `docs/CHROME_EXTENSION_UAT_GUIDE.md` for the
complete entry-by-entry flow.

## Supported pages

- Project AI Staging:
  `https://gridworks.cn/tool/projectai-slim-uat/*`
- ChatGPT: `https://chatgpt.com/*`
- DeepSeek: `https://chat.deepseek.com/*`
- Qwen: `https://chat.qwen.ai/*`

Only the reviewed Project AI Staging base path is configured. The Production
base path and older Staging paths are not authorized. All three external-Agent
DOM adapters still require signed-in manual verification because those sites
can change their private DOM without notice.

## Skill sync and storage

On the logged-in Project AI page, **Sync Skills from Project AI** asks a content
script on that exact page to call the read-only `/api/skills` endpoints with a
same-origin fetch. Chrome supplies the current Session cookie to Project AI;
the Extension never reads, copies, or stores the cookie value.

The returned official Skill metadata and main `SKILL.md` files are cached only
in `chrome.storage.session`. The selected Skill therefore survives tab changes
and popup reopen inside the same browser session, but is not written to
long-lived `chrome.storage.local`. Project Knowledge, Documents, Timeline, and
Project Context are never requested or cached.

Saved UAT results remain in `chrome.storage.local` only after the user clicks
**Save UAT Result locally**. Each synced result records `skillId`,
`skillVersion`, and `skillSource = project_ai`; it does not save the Skill text
or Task Instruction.

## Manual fallback

**Advanced / Manual fallback** keeps the original paste flow for diagnosing a
sync or API issue. It is not the default UAT path.

## Safety boundary

- No `cookies` permission, cookie API, token, localStorage, or login automation.
- No Project Knowledge, Documents, RAGFlow, Timeline, or generic Project
  Context API.
- No attachment upload; use the external Agent site's native UI.
- No automatic Send, remote code, analytics, answer judge, or result upload.
- URLs saved with UAT results are reduced to origin + path.
