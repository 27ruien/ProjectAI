# Chrome Extension Real Full-Chain UAT Report

Date: 2026-08-25

Environment: Staging/UAT only

Overall status: **PASS WITH CONDITIONS**

The authenticated Project AI Skill API, unpacked Chrome Extension, Project AI
sync, and real signed-in ChatGPT, DeepSeek, and Qwen adapter flows were operated
end to end with Computer Use. One DeepSeek extraction defect was reproduced,
preserved, fixed with a regression test, and re-verified after exact-head CI.
The user did not perform issue discovery, reproduction, or evidence capture.

The remaining condition is outside the Extension chain: the Weekly Report
multipart context endpoint was not re-executed live in this pass because it has
no browser UI and this run did not extract or reuse browser credentials.
Deterministic exact-head CI passed, and the prior immutable v1.1 live report
remains the latest live Weekly Report context evidence.

## Baselines and provenance

| Item | Result | Evidence |
|---|---|---|
| Previous immutable baseline | **UNCHANGED** | `staging-validation-v1.1` -> `62d06e7184df9b43d72ad6780566d774b6f7255d` |
| Full-chain server baseline | **PASS** | commit `9fe4eab20390a312c1f9300f18e8525e83fca60c`; tag `staging-validation-v1.2` |
| Branch CI for v1.2 | **PASS** | GitHub Actions run `32812994411`, exact head `9fe4eab...` |
| Tag CI for v1.2 | **PASS** | GitHub Actions run `32813115303`, exact head `9fe4eab...` |
| Staging image | **PASS** | `projectai-slim-uat:20260825T053448Z-staging-validation-v1.2`; image ID `sha256:44349a2f6db673b4c2dcf57aeae54eb1b4876d612eb6436b457b1a0a72be0321` |
| Source archive | **PASS** | SHA-256 `d3433a3ad0f450d6fad0e49ab7cc8c976cbff8468aae17cec5754fef3fddaa2b` |
| Image archive | **PASS** | SHA-256 `aab9360db8b95d65a393619362871d141343a0a9acb95708c401375d9c6dd50f` |
| Release directory | **PASS** | `/srv/projectai-slim-uat/releases/20260825T053448Z` |
| Online exact-SHA provenance | **PASS** | public health headers report app version `1.0.0-staging-validation-v1.2` and commit `9fe4eab...`; running container is healthy, restart count `0`, started `2026-08-25T05:39:39Z` |
| Extension repair revision | **PASS** | commit `9327c16e578f5ed63e9a54b5841553a05ad63d1e`; tag `staging-validation-v1.2.1`; Extension version `0.1.1` |
| Branch CI for v1.2.1 | **PASS** | GitHub Actions run `32816033713`, exact head `9327c16...` |
| Tag CI for v1.2.1 | **PASS** | GitHub Actions run `32816208604`, exact head `9327c16...` |

The v1.2.1 change is Extension-only. The Project AI server was not redeployed
for it and correctly remains the exact v1.2 image/SHA above. Neither existing
immutable tag was moved.

## Validation gates

Before v1.2, all 102 tests, typecheck, lint, build, and whitespace checks
passed. After the DeepSeek repair, the complete gate was rerun:

| Gate | Result |
|---|---|
| `npm test` | **PASS — 103/103** (`96` unit + `7` rendered/proxy) |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |
| Skill List/Read authentication tests | **PASS** |
| Unknown Skill and traversal-shaped ID | **404 / BLOCKED** |
| Generic Project Knowledge through Skill API | **BLOCKED** |
| Cookie/token access | **ABSENT / PASS** |
| Extension auto-send | **ABSENT / PASS** |
| ChatGPT/DeepSeek/Qwen deterministic adapters | **PASS** |

## Real Project AI API and Extension sync

Computer Use loaded and reloaded the unpacked Extension from
`chrome-extension/`. Chrome reported no manifest or runtime error, and the
Extension was pinned. The existing legal browser Session was used; no password,
cookie, token, or local-storage credential was read.

Authenticated live list and read requests passed. Unauthenticated requests
returned `401`; unknown, traversal-shaped, and Project-ID-shaped reads returned
the non-disclosing `SKILL_NOT_FOUND` contract. Exactly these assets synced:

| Skill ID | Version |
|---|---|
| `project-weekly-report` | `1.2.0` |
| `project-timeline-maker` | `0.1.0` |
| `project-requirement-analyst` | `0.1.0` |
| `project-feasibility-research` | `0.1.0` |

`project-requirement-analyst` was selected with `source = project_ai`. The
selection and metadata survived popup close/reopen and tab switching through
`chrome.storage.session`.

Evidence: `docs/ui-audit/chrome-extension-real-uat/01-extension-reloaded.png`
and `02-project-ai-sync-selected.png`.

## Real external-Agent adapter UAT

All three sites used the same sanitized fictional task. Business-output quality
was deliberately not scored; this pass verifies transport, DOM integration,
capture, and result metadata.

| Site | Auth | Exact Skill/task injection | No auto-send | Native send | Latest response | Copy / download / save | Final adapter status |
|---|---|---|---|---|---|---|---|
| ChatGPT | **PASS** | **PASS** | **PASS** | **PASS** | **PASS**, newest assistant response, 5,060 chars | **PASS** | **MANUAL VERIFIED** |
| DeepSeek | **PASS** | **PASS** | **PASS** | **PASS** | Initial **FAIL**, then **PASS** after v0.1.1; fresh post-CI response 11,531 chars | **PASS** after repair | **MANUAL VERIFIED AFTER FIX** |
| Qwen | **PASS** | **PASS** | **PASS** | **PASS** | **PASS**, newest assistant response, 2,115 chars | **PASS** | **MANUAL VERIFIED** |

The pre-send composer was visually checked for the complete `<SKILL>` and
`<USER_TASK>` blocks on every site. Send was clicked through each site's native
UI only. Preview was compared to the latest visible assistant block; no user or
older assistant message was selected.

Evidence sets:

- ChatGPT: `03-chatgpt-injected-before-send.png` through
  `06-chatgpt-result-saved.png`.
- DeepSeek original failure: `07-deepseek-injected-before-send.png` through
  `10-deepseek-defect-saved.png`.
- Qwen: `11-qwen-injected-before-send.png` through
  `14-qwen-result-saved.png`.
- DeepSeek repair and post-CI rerun: `15-deepseek-preview-fixed.png` through
  `21-deepseek-post-ci-result-exported.png`.

## Issue and automatic repair

One issue was found: `EXT-UAT-001`. DeepSeek's live DOM exposed nested Markdown
fragments before the complete assistant block, so the initial extractor omitted
headings and the Requirement Matrix. The original 5,072-character failure was
saved before any change.

The minimal repair makes only the DeepSeek adapter prefer and preserve the full
connected assistant block. A deterministic regression covers the matrix-loss
case. The repaired extractor returned 6,830 characters on the first rerun and
11,531 characters in a fresh conversation after branch and tag CI. Full details
are in `docs/CHROME_EXTENSION_REAL_UAT_ISSUES.md`.

Issues found: **1**

Issues auto-fixed: **1**

Issues remaining in the tested chain: **0**

## Saved result artifact

The final JSON export contains five records so the initial DeepSeek failure and
both repair confirmations remain auditable. Every record has `skillId`,
`skillVersion`, `skillSource = project_ai`, site/agent, timestamp, and
`rawResponse`; sanitized URLs contain no query string or fragment. A scan found
no password, secret, token, cookie, or test-login email.

- `docs/ui-audit/chrome-extension-real-uat/results/full-chain-uat-results.json`
- `docs/ui-audit/chrome-extension-real-uat/results/full-chain-uat-summary.md`
- Per-site Markdown files in the same directory, including the original
  DeepSeek failure and post-CI fixed result.

JSON SHA-256:
`7e307ec7147d1e916a35a344cea00ee4a0f36a7d3e0e776e4ed969f2d09168af`.

## Staging regression and Production boundary

| Check | Result |
|---|---|
| Public application health | **PASS**, HTTP 200, exact v1.2 SHA headers |
| Browser auth and Project permissions | **PASS**, authorized UAT Admin and scoped Projects visible |
| Project A Knowledge / RAGFlow | **PASS**, three queryable documents and a grounded answer with three citations |
| Structured Timeline | **PASS**, authenticated Project-linked snapshot returned at version `2` |
| RAGFlow tunnel service | **PASS**, active/running |
| Weekly Report context live rerun | **NOT_RUN in this pass**; exact-head deterministic CI PASS; prior immutable v1.1 live evidence retained |
| Production | **NOT TOUCHED**; read-only fingerprint remained `sha256:a4b6d41941ebb8f995cf2ecaba65a595990187b8b93d03758287f42443cb5469`, healthy, restart `0`, started `2026-07-13T01:53:13Z` |

Regression screenshots:
`22-project-a-knowledge-ragflow-pass.png` and
`23-structured-timeline-pass.png`.

## Final decision

The Full-chain UAT Client is ready for the user's business-quality comparison
work. No technical issue recording is delegated to the user. The only future
human actions are normal third-party login/MFA if a browser Session expires;
technical diagnosis, screenshots, reproduction, and issue records remain an
operator/Codex responsibility.

Start URL: `https://gridworks.cn/tool/projectai-slim-uat/`

Extension directory: `/Users/ryan/Documents/ProjectAI-Focused-MVP/chrome-extension`

First Skill: `project-requirement-analyst`
