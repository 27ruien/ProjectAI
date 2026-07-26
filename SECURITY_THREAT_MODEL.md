# ProjectAI 日报与 WeCom 扩展 Threat Model

## Assets and trust zones

Protected assets are user-owned work logs/drafts, organization/project boundaries, confirmed task facts, AI execution metadata, sync idempotency state, WeCom tasks and authentication state. Trust zones are the authenticated ProjectAI server, ProjectAI page, isolated extension world/service worker/local storage, and user-authenticated WeCom page.

## Threats and controls

| Threat | Control | Residual risk |
| --- | --- | --- |
| 恶意网页伪造 ProjectAI 消息 | Content script is injected only on two narrow paths; requires top frame, `event.source===window`, exact current/allowed Origin, protocol/source/type/version and exact fields | XSS in ProjectAI same Origin can act as the user; existing CSP/input defenses remain required |
| 跨租户/跨用户日报读取或同步 | Server Session, active organization membership, `organizationId+userId` ownership predicates, project ACL recheck, 404 anti-enumeration, DB scope triggers | Existing system admin project semantics remain unchanged; no subordinate-report permission added |
| 重放旧批次 | Server request unique index and one active batch per draft; extension exact canonical payload identity; per-item `batch:task` unique key; server batch/item transitions are monotonic | Manual JSON is not a server attestation, so Review/real builds force it to Dry Run; actual saves start only from authenticated ProjectAI |
| 重复创建 | saved is immutable/skipped; running interruption becomes unknown; unknown never auto-retries; restart does not resume work | A page may save but fail before feedback; this is intentionally unknown and requires human reconciliation |
| 选择器失效导致错误点击 | Typed exact config, unique text match, read-back verification, MutationObserver waits, overlay/login checks, no approximate fallback | Real DOM is unverified until user supplies URL and demonstrates flow; real use is blocked pending Dry Run |
| 误点最终提交 | No final-submit command/key; save control must be inside `taskForm`; dangerous text/aria semantics are rejected; tests assert Mock final-submit count remains zero | Real DOM and localization still require review; every selector/code change requires package/source review and acceptance tests |
| 恶意任务文本 | Values assigned through DOM value APIs, never `innerHTML`; length/schema limits; no eval/new Function | WeCom may apply its own rendering rules after save; use fictional data for first validation |
| 日志泄露 | Allowlisted local log fields, credential/URL redaction, no task body/full DOM, manual export, confirmed clear | Browser profile compromise can read extension-local storage; endpoint security remains required |
| 扩展权限过宽 | No `<all_urls>`; exact ProjectAI paths; exact optional WeCom Origin; permission justification/package tests | True WeCom Origin still requires review before a publishable build |
| Service Worker 中断 | Persistent per-item state; startup converts running to unknown; saved never rolls back; no automatic restart processing | Human must inspect uncertain WeCom state before deciding next action |
| WeCom 登录状态泄露 | Only a configured visible logged-out indicator is checked; no Cookie/Token/QR read or export | Page itself is controlled by WeCom and visible to the user/browser profile |
| 扩展伪造完成/终态 | API authenticates owner, validates items and rejects terminal status inconsistent with persisted per-item snapshot | The browser user controls their own page; this is not a cryptographic attestation of WeCom server state |
| AI invents facts | ACL-scoped structured input, strict output schema, source bindings, catalog allowlists, duration/completion contradiction checks, always human review | Provider can still phrase poorly; human confirmation is mandatory |
| AI request replay/concurrency | Advisory lock, running partial unique index, stale recovery, source digest recheck | External Provider may have accepted a timed-out request; no automatic business write occurs |

## Secrets

Provider credentials stay in the existing server Secret File/environment injection. No secret is serialized to the page, extension, audit, CI artifact or logs. Extension build configuration contains only an approved public Origin, never login material.

## Security release gates

Before real WeCom use: review exact URL and selectors, inspect the manifest and ZIP, run unit/package/Mock E2E, perform one Dry Run, then one fictional task save with the user present. Any DOM ambiguity, unknown save, permission expansion, XSS finding, cross-user access or final-submit path is release-blocking.

Current transitive dependency findings, runtime reachability, mitigations, expiry dates and upstream closure conditions are recorded in [docs/dependency-security.md](./docs/dependency-security.md). A proposed expiry is not approval; a Security/依赖维护 Reviewer must explicitly accept any unresolved high finding before Ready.
