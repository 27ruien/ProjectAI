# Chrome Extension MVP Architecture

Last Updated: 2026-08-25

## Scope

The Project AI Skill UAT Adapter is a Manifest V3 browser client for this one
manual full-chain boundary:

```text
authenticated Project AI Staging Session
  -> read-only official Skill list/read API
  -> same-origin Project AI content-script fetch
  -> browser-session Skill cache and selector
  -> exact Skill + Task injection into one supported chat composer
  -> user reviews and sends manually
  -> newest assistant response capture and explicit local save/export
```

The Extension is not an Agent runtime. It does not call Project Knowledge,
Documents, RAGFlow, Timeline, or Project Context; run an LLM; upload an
attachment; judge an answer; or write external output into Project AI.

## Project AI read API

`GET /api/skills` and `GET /api/skills/{skillId}` reuse Better Auth's current
database Session through `requireApiPrincipal()`. Unauthenticated calls return
401. Both routes are read-only and return `Cache-Control: no-store`.

The server catalog is a fixed allowlist of the four formal directories under
`skills/`. A request ID is looked up before any path is constructed. The only
file read by the distribution catalog is that entry's fixed `SKILL.md`; unknown,
traversal-shaped, reference, asset, and project-document paths return 404.
Version, status, name, and description come from the current Skill frontmatter,
not from Extension constants.

The read response contains necessary metadata and `skillMarkdown`. It does not
return Project IDs, Knowledge, Documents, RAGFlow data, Timeline data, Project
Context, arbitrary files, or directory contents.

## Session bridge

The reviewed source configuration contains one deployment:

- origin: `https://gridworks.cn`;
- base path: `/tool/projectai-slim-uat`;
- label: Project AI Staging.

The manifest installs `project-ai-content-script.js` only on that exact HTTPS
base path. The script validates origin and path again before accepting Sync. It
uses same-origin `GET` requests with `credentials: same-origin`; Chrome applies
the page's current Project AI Session. Neither the content script nor popup can
read the HttpOnly cookie value.

The Project AI response travels back through an internal
`chrome.runtime.onMessage` response. ChatGPT, DeepSeek, and Qwen pages do not
load this bridge, and their adapter content script has no Sync operation. A page
script cannot supply a Project AI response through the Extension's isolated
content-script world.

Production and older Staging base paths are not configured.

## Runtime components

| Component | Responsibility |
|---|---|
| `manifest.json` | Declares MV3, popup, minimal permissions, exact chat hosts, and the reviewed Project AI Staging path. |
| `src/shared/project-ai-source.js` | Owns the one allowed Project AI deployment and constructs only official Skill API URLs. |
| `src/content/project-ai-content-script.js` | Performs authenticated same-origin list/read Sync and returns a bounded response to the popup. |
| `src/shared/session-cache.js` | Validates and stores the synced Skill set and current selection in `chrome.storage.session`. |
| `popup/` | Syncs/selects a Skill, collects Task Instruction, invokes adapters, previews responses, and performs explicit result actions. |
| `src/shared/format.js` | Preserves raw Skill content and adds only the documented `<SKILL>` / `<USER_TASK>` envelope when a task is present. |
| `src/shared/uat-results.js` | Builds local result records, sanitizes URLs, and creates JSON or Markdown exports. |
| `src/content/adapter-core.js` | Implements shared composer injection, newest-response extraction, and diagnostics. |
| `src/content/*-adapter.js` | Owns exact host and selector candidates for ChatGPT, DeepSeek, and Qwen. |
| `src/content/content-script.js` | Receives popup chat operations and delegates to the current site adapter. |

No service worker, remote script, build system, page-injected script, cookie
permission, or background token store is used.

## Cache and result lifecycle

Official Skill metadata, the four main `SKILL.md` strings, last sync time, and
selected Skill ID use `chrome.storage.session` under
`projectAiSyncedSkillsV1`. The cache is shared across tabs and popup reopen in
the same browser session, and Chrome clears it when the browser session ends.
No fallback copies it to `chrome.storage.local`.

Task Instruction is not cached. The manual paste fallback is not cached.
Project Knowledge is never fetched or cached.

Saved UAT results use `chrome.storage.local` key `projectAiUatResultsV1` only
after **Save UAT Result locally**. A synced record contains:

- `skillId` and `skillVersion` from the currently selected session-cache entry;
- `skillSource = project_ai`;
- Agent/site, timestamp, origin + path, raw response, response length, and
  optional human label/notes.

The saved record excludes Skill text and Task Instruction. Query strings and
fragments are removed from saved URLs. The JSON export contains full saved
records; the Markdown export is a concise metadata summary.

## Injection and adapter contract

With a Task Instruction, the exact injected text is:

```text
<SKILL>
{raw skillMarkdown returned by Project AI}
</SKILL>

<USER_TASK>
{raw task instruction}
</USER_TASK>
```

No business content is rewritten. If the manual fallback has an empty Task,
the existing raw-Skill-only diagnostic behavior remains available. The
Extension never clicks or submits Send.

Each chat adapter supports exact HTTPS host recognition, ordered composer
fallbacks, normal input/change signals, newest-to-oldest non-empty assistant
selection, and explicit diagnostic codes. Synthetic tests do not prove the
private signed-in DOM of a live external site.

## Security boundary

- No `cookies`, `tabs`, `scripting`, `downloads`, `clipboardRead`, or
  `unlimitedStorage` permission.
- No cookie value, Session token, bearer token, localStorage, or automatic login.
- No Project Knowledge, Documents, Timeline, RAGFlow, Project Context, PAT, MCP,
  or Agent token.
- No remote code, analytics, attachment upload, result upload, auto-send, or AI
  quality judge.
- Exact Project AI Staging base path and exact external chat hosts only.

## Deferred scope

- Skills Library UI, editor, publisher, and Resources Library;
- PAT, MCP, Agent Runtime, or automatic execution;
- generic Project Knowledge or Documents API;
- Timeline Workbench connector/import/apply bridge;
- automatic chat send, login, attachment upload, result synchronization, or
  quality scoring;
- live-DOM automation.
