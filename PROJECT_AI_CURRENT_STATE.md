# Project AI Current State

Last Verified: 2026-08-25

Source of Truth: current working tree + tests + current repository docs/reports + exact-SHA live Staging validation

Working Tree: corrected freeze target `staging-validation-v1.1` on `refactor/project-ai-slim`; immutable predecessor `staging-validation-v1` failed clean-checkout CI

Audit Result: **PASS WITH CONDITIONS**

This file describes the current working tree, not the legacy snapshot at HEAD and not a future architecture. When code/tests and an older report disagree, current code and freshly executed tests win.

### Current Staging validation

- Staging baseline: **VERIFIED WITH CONDITIONS** at immutable tag
  `staging-validation-v1.1`, SHA
  `62d06e7184df9b43d72ad6780566d774b6f7255d`.
- Online provenance: **VERIFIED** by the public exact-SHA health headers and
  running image fingerprint.
- Real RAGFlow Staging chain: **VERIFIED** after the existing SSH tunnel target
  was updated from the stopped ECS address `47.116.3.32` to the operator-
  confirmed replacement address `8.133.185.111`. Dataset provision, retrieval,
  Evidence Guard, real Qwen answer, Citation, and no-Evidence behavior passed.
- Structured Timeline and Weekly Report context: **VERIFIED IN LIVE STAGING**
  for persistence/reload, Project permission, `timeline.source=structured`,
  PLAN/ACTUAL separation, confirmation gate, and unauthorized override.
- Conditions: successful RAGFlow API-Key requests emit a non-blocking JWT parse
  warning, and Nginx retains a pre-existing duplicate port-80 server-name
  warning. No 5xx, restart, Health degradation, application code change, or
  application redeployment occurred.
- Production: **NOT TOUCHED**. A read-only fingerprint check remained unchanged,
  but Production behavior is not verified by this Staging result.

Evidence: `docs/STAGING_VALIDATION_V1_1_REPORT.md`.

## 1. CONFIRMED CURRENT ARCHITECTURE

### Project AI DOES

- authenticate users through Better Auth-backed database Sessions and enforce centralized Project authorization;
- persist Users, Organizations/Departments, Projects, ProjectMembers, Project aliases, one Structured Timeline snapshot per Project, RAGFlow Dataset/Document mappings, and Audit Events in PostgreSQL;
- provision one backend-resolved RAGFlow Dataset per Project and use RAGFlow for document upload, parsing, status, deletion/retry, and retrieval;
- provide single-Project and authorized cross-Project knowledge question APIs;
- call the server-side AI Gateway/LLM for grounded knowledge-answer synthesis and one citation-repair attempt when retrieved Evidence exists;
- return `insufficient_evidence` without an LLM call when no accepted Evidence exists;
- store four portable Skill assets in `skills/`;
- expose those four formal assets through authenticated, read-only
  `GET /api/skills` and `GET /api/skills/{skillId}` routes backed by a fixed
  allowlist and repository-derived `SKILL.md` metadata;
- provide a standalone, Load-unpacked Manifest V3 UAT Extension that accepts a
  browser-Session sync of those formal Skills from the reviewed Project AI
  Staging path, caches them for the browser session, injects the selected exact
  Skill/task into a supported external-Agent composer, and explicitly
  captures/saves/exports the latest assistant response locally;
- build an authenticated, bounded, versioned Weekly Report Execution Package without calling the AI Gateway;
- persist and serve a Project-linked Structured Timeline through `GET/PUT /api/projects/{projectId}/timeline`;
- prefer the persisted Structured Timeline in Weekly Report context and use an authorized Timeline document only as fallback.

### Project AI DOES NOT

- run any of the four business Skills itself;
- contain an Agent Runtime, Agent Loop, Tool Calling runtime, Workflow Runtime, or automatic external-Agent execution;
- persist assistant Threads or Conversation Memory;
- provide a generic external-Agent Project Knowledge API, Agent token, PAT, or MCP server;
- provide a generic or mutable Skill Registry runtime, editor, or publisher;
- provide a Skills Library UI, Resources Library UI, Timeline Workbench UI, or Timeline Maker apply/diff/confirmation UI;
- use the legacy self-built parser/Chunk/FTS/Embedding/pgvector/RRF retrieval chain in the active application path.

### Critical AI distinction

Project AI **does perform model inference for current Project Knowledge Q&A** through `lib/knowledge-slim/query.ts` and `lib/ai/project-assistant/gateway.ts`. It **does not** perform the reasoning required by `project-weekly-report`, `project-timeline-maker`, `project-requirement-analyst`, or `project-feasibility-research`; those Skills are consumed by an external Agent.

### RAGFlow responsibility

RAGFlow owns Dataset/Document handling, parsing, and retrieval. It is not an authorization authority and does not generate the final Project AI knowledge answer in the current path. Project AI resolves authorized Dataset IDs, guards returned Evidence against local Dataset/Document mappings, bounds the context, then asks its AI Gateway to synthesize the cited answer.

### External Agent responsibility

An external Agent reads a portable Skill and supplied/pre-cut materials, performs Skill-specific interpretation or synthesis, and returns the Skill contract. Project AI currently launches no Agent and automatically applies no external-Agent output. Only Weekly Report has a current Project AI Execution Package API.

The standalone Chrome Extension is a manual transport/capture adapter for that
external-Agent boundary. Its default path syncs only the four formal Skill
assets through the current Project AI browser Session; a manual paste remains
an advanced fallback. It uses one user-supplied task and one user-requested
latest assistant response; it neither makes the Agent part of Project AI nor
turns external output into Project data.

Evidence: `README.md`, `docs/ARCHITECTURE.md`, `lib/knowledge-slim/query.ts`, `lib/ragflow/client.ts`, `lib/weekly-report/service.ts`, `components/workspace.tsx`.

## 2. IMPLEMENTED & VERIFIED CAPABILITIES

| Capability | Current status | Evidence and boundary |
|---|---|---|
| Projects | **IMPLEMENTED / VERIFIED** | CRUD, authorized listing, creator-manager membership, project serialization, audit. Fresh isolated integration suite passed. `app/api/projects/`, `lib/db/repositories/project-repository.ts`, `tests/integration/identity-project-isolation.test.ts`. |
| Auth / database Session | **PARTIAL / VERIFIED IN TEST AND STAGING CREDENTIAL UAT** | Better Auth database Session, sanitized endpoints, logout/revocation, disabled-user handling, and rate limiting passed the fresh isolated integration suite. The real WeCom OAuth adapter is not implemented; `publicAuthProvider()` reports `implemented: false` for `wecom`. `lib/auth/`, `docs/STAGING_UAT_EVIDENCE.md`. |
| ProjectMember / authorization | **IMPLEMENTED / VERIFIED** | `project_manager`, `project_member`, and `viewer`; missing and unauthorized Project IDs share 404 behavior; project-manager invariants and concurrency passed integration. `lib/auth/authorization.ts`, `lib/projects/member-management.ts`. |
| Knowledge / RAGFlow mapping | **IMPLEMENTED / VERIFIED** | One Project-to-Dataset mapping, local Document mapping, backend-only Dataset IDs, upload/parse/delete/retry, and Evidence Guard. Fresh deterministic tests passed; exact-SHA real RAGFlow Staging re-test passed on 2026-08-25 after the public-IP tunnel recovery. `lib/knowledge-slim/`, `lib/ragflow/`, `docs/STAGING_VALIDATION_V1_1_REPORT.md`. |
| Grounded knowledge Q&A | **IMPLEMENTED / VERIFIED** | Single/cross-Project bounded retrieval, LLM synthesis, citation validation/repair, and no-Evidence no-call behavior. The exact-SHA live Staging run verified real retrieval, Evidence Guard, Qwen answer, Citation, no-Evidence, and unauthorized-Project behavior. `lib/knowledge-slim/query.ts`, `docs/STAGING_VALIDATION_V1_1_REPORT.md`. |
| Structured Timeline persistence/provider | **IMPLEMENTED / VERIFIED** | One current JSONB snapshot per Project, versioned optimistic conflict handling, audited `GET/PUT`, authorized read/write roles, database adapter to `StructuredTimelineRepository`, and Weekly Report structured-first selection. Fresh isolated integration passed 5/5; exact-SHA Staging verified save/reload, permission, and `timeline.source=structured`. `drizzle/0036_normal_sister_grimm.sql`, `lib/db/repositories/project-timeline-repository.ts`, `app/api/projects/[projectId]/timeline/route.ts`. |
| Weekly Report backend/package | **IMPLEMENTED / VERIFIED** | CSV/XLSX parsing, deterministic Project matching/confirmation, alias persistence, bounded Timeline/Knowledge context, active Skill loading, and Execution Package output. Exact-SHA Staging verified finalized package construction, PLAN/ACTUAL separation, confirmation gate, and unauthorized override. It does not generate the report. `lib/weekly-report/`, `app/api/skills/project-weekly-report/`. |
| Official Skill read API | **IMPLEMENTED / DETERMINISTICALLY VERIFIED / NOT YET DEPLOYED** | Authenticated read-only list/read routes distribute only the four fixed formal `SKILL.md` assets and their current frontmatter metadata. Unknown and traversal-shaped IDs return 404; unauthenticated access returns 401; no Project Knowledge, Documents, references directory, or arbitrary file path is exposed. `lib/skills/`, `app/api/skills/`, `tests/skill-distribution.test.ts`. |
| Timeline Maker | **IMPLEMENTED AS PORTABLE EXPERIMENTAL SKILL / DETERMINISTICALLY VERIFIED** | Skill, Draft/schema validation, requirement checks, Workbench Snapshot adapter, Markdown render/parse. No Project AI connector, API, UI, direct save, or apply flow. `skills/project-timeline-maker/`, `lib/timeline-maker/`. |
| Requirement Analyst | **IMPLEMENTED AS PORTABLE EXPERIMENTAL SKILL / DETERMINISTICALLY VERIFIED** | Skill, contracts, framework, renderer, and portable UAT packs. No API/UI/runtime/persistence. `skills/project-requirement-analyst/`, `lib/requirement-analyst/`. |
| Feasibility Research | **IMPLEMENTED AS PORTABLE EXPERIMENTAL SKILL / DETERMINISTICALLY VERIFIED** | Skill, research plan/report contracts, renderer, A/B observation comparator, and portable packs. No search provider/runtime is bundled. `skills/project-feasibility-research/`, `lib/feasibility-research/`. |
| Chrome Extension Skill UAT adapter | **IMPLEMENTED / DETERMINISTICALLY VERIFIED / LIVE DOM NOT YET VERIFIED** | Load-unpacked MV3 client recognizes only the reviewed Project AI Staging path plus exact ChatGPT, DeepSeek, and Qwen hosts. It syncs the four formal Skills through a same-origin Session fetch, keeps the selection and exact `SKILL.md` in `chrome.storage.session`, injects without auto-send, and retains response preview/copy/download/local-save/export. Synthetic sync/adapter/cache/result/security tests passed 21/21. It has no cookie/token access, Project Knowledge API, login automation, upload, answer scoring, or Timeline Workbench bridge. The API change is not deployed and all three signed-in chat DOMs remain `NEEDS_MANUAL_VERIFICATION`. `chrome-extension/`, `tests/chrome-extension.test.mjs`, `docs/CHROME_EXTENSION_UAT_GUIDE.md`. |
| Organization/Department administration | **IMPLEMENTED / PARTIALLY VERIFIED** | Active schema, service, APIs, and admin UI exist. The fresh integration suite exercises related schema/Project-creation scope, but no separate current product UAT report was found for every organization UI operation. |

`VERIFIED` above means a relevant current test or recorded UAT actually passed. It does not convert deterministic Skill tests into external-Agent UAT.

## 3. SKILLS STATUS

| id | version / asset status | engineering status | deterministic status | cross-agent status | external/web status | known limitations |
|---|---|---|---|---|---|---|
| `project-weekly-report` | `1.2.0` / `active` | **IMPLEMENTED**: asset + authenticated package API + official read API | **VERIFIED**: current Weekly module 19/19 inside `npm test`; fresh reference readiness 12/12; existing v1.2 report records 35/35 | **NOT_TESTED_EXTERNALLY FOR v1.2**. Prior GPT/DeepSeek/Qwen runs found instruction gaps; v1.2 packs were refreshed but not manually rerun | Not applicable; Skill uses supplied package only | Project AI does not generate the final report and has no Weekly Report product UI. The Extension can sync/transport the main Skill but does not build the Execution Package or evaluate the answer |
| `project-timeline-maker` | `0.1.0` / `experimental` | **IMPLEMENTED** as portable Skill/contracts/adapter + official read distribution | **VERIFIED**: 10/10 fresh | **NOT RUN** | Not applicable | Free interpretation of messy documents unverified; no Project-bound connector; no Workbench paste/UI; no diff/confirm/apply path |
| `project-requirement-analyst` | `0.1.0` / `experimental` | **IMPLEMENTED** as portable Skill/contracts/renderer + official read distribution | **VERIFIED**: 11/11 fresh, including pack synchronization | **NOT_TESTED**: all eight portable packs remain unexecuted | External search is prohibited by this Skill | No Project Knowledge/context retrieval, product UI, runtime, or persistence; long/messy material interpretation unverified |
| `project-feasibility-research` | `0.1.0` / `experimental` | **IMPLEMENTED** as portable Skill/contracts/renderer/comparator + official read distribution | **VERIFIED**: 12/12 fresh | **NOT_TESTED**: eight packs unexecuted | **LIVE SEARCH NOT_TESTED; A/B NOT_TESTED** | Source discovery, contradiction quality, first-party-source selection, and verdict quality remain unverified |

`assets/skills-recovered/product-map/SKILL.md` is a recovered historical asset, not a fifth active formal Skill and not an active Product Map runtime.

## 4. DATA / AI BOUNDARIES

### Project AI fact layer

- PostgreSQL is authoritative for identity/session, organization/department, Project, ProjectMember, Project alias, Project-to-RAGFlow Dataset mapping, local Document mapping/status metadata, Structured Timeline snapshot/version, and Audit Event.
- The current active Drizzle source exports 16 tables. Older reports that say 14 predate the alias/timeline additions and other current exports.
- `project_document_versions` remains a read-only compatibility source for one-time legacy object migration; new Slim uploads do not create version rows or use legacy object storage.
- RAGFlow owns parsed document content, chunks/internal indexes, and retrieval behavior. Project AI stores only the business mapping needed to authorize and guard results.

### AI execution

- Knowledge Q&A inference occurs inside Project AI's server-side AI Gateway when `AI_ASSISTANT_ENABLED=true` and accepted Evidence exists.
- Test inference uses the Fake provider only in the exact test environment. The only current real provider implementation is Qwen with server-controlled profile/model settings and server-only credentials; actual deployed enablement is not inferred from the code default.
- Business Skill reasoning occurs in an external Agent. No Skill output is automatically written to Project, Timeline, Requirement, Scope, or other formal data.

### Context boundaries

- The browser may submit a Project ID or a list of selected Project IDs, but the backend re-derives and validates the authorized Project set.
- RAGFlow Dataset IDs and Document mappings are backend-resolved and are not serialized in Project DTOs.
- Weekly Report has a specific Execution Package builder. There is no generic Execution Package builder shared by all Skills.
- The official Skill read API distributes only portable `SKILL.md` assets and
  metadata. It exposes no Project Knowledge, Documents, Timeline, Project
  Context, or Project-bound execution material.
- Structured Timeline is available through a Project-scoped user-session API and the internal Weekly Report provider. It is not exposed as generic external-Agent Project Knowledge access.
- Requirement Analyst and Feasibility Research allow a conceptual `project_bound_context`, but current Project AI provides no API that builds that context for them.

## 5. SECURITY / PERMISSION BOUNDARIES

- Every retained Project route requires an authenticated database Session and centralized `requireProjectAccess()` or `requireProjectRole()` checks.
- Product `super_admin`/`admin` are global Project readers; regular users see only Projects they created or where a `ProjectMember` row exists.
- Missing and unauthorized Projects return the same 404 contract and generate a sanitized denial Audit Event.
- `project_manager` and `project_member` can edit Project content and upload/retry Knowledge; only manager-level authority can manage members, delete documents/projects, or retry Dataset provisioning; `viewer` is read-only.
- Structured Timeline: authorized viewers may read; `project_manager` and `project_member` may save; stale versions return 409; unauthorized Project reads return 404.
- Cross-Project Knowledge validates every explicit selection against the backend authorized set, retrieves per Project, then applies Dataset/Document Evidence Guard.
- Mutation routes enforce trusted-origin/media-type checks. Session tokens and provider/RAGFlow credentials are not returned by product APIs.
- Official Skill distribution is read-only, requires the Better Auth database
  Session, resolves IDs through a four-entry allowlist before reading a fixed
  `SKILL.md`, and returns no arbitrary files or Project data.
- There is no Agent token, PAT, MCP endpoint, or external-Agent credential scope to audit in the current tree.
- The current generic-looking route `/api/projects/knowledge/ask` is an authenticated user-session cross-Project Q&A endpoint, not a generic external-Agent knowledge API.

Evidence: `lib/auth/authorization.ts`, `lib/auth/http.ts`, `lib/auth/session.ts`, `lib/projects/serialization.ts`, `lib/knowledge-slim/query.ts`, `tests/integration/identity-project-isolation.test.ts`.

## 6. CURRENTLY NOT IMPLEMENTED / PROPOSED

The following are **NOT IMPLEMENTED in the current active tree** unless stated otherwise:

- real WeCom OAuth adapter completion (`wecom` is configured as a future provider surface but currently reports `implemented: false`);
- MCP server or MCP-based Project context/tool surface;
- Personal Access Token / Agent token;
- Agent Runtime, Agent Loop, Tool Calling runtime, Agent Harness, or automatic external-Agent execution;
- Workflow Runtime and durable Skill execution orchestration;
- generic or mutable Skill Registry runtime, editor, publisher, or arbitrary
  asset catalog (the current `/api/skills` surface is a fixed read-only catalog
  of four formal `SKILL.md` files only);
- Skills Library UI and Resources Library UI;
- generic external-Agent Project Knowledge API;
- generic Project Context/Execution Package for Timeline Maker, Requirement Analyst, or Feasibility Research;
- Timeline Maker Tool Mode connector implementing `get_project_timeline`, `create_timeline_draft`, or `propose_timeline_update` as callable capabilities;
- Timeline Draft diff, user-confirmation, and apply flow;
- Project AI Timeline Workbench page, Paste/import UI, or Workbench AI auto-generation;
- automatic persistence of any external-Agent output;
- active Company Knowledge product surface;
- active Product Map runtime (only a recovered historical Skill asset exists under `assets/skills-recovered/`).

Contracts, Skill instructions, reference documents, or UAT packs alone do not make any item above implemented.

## 7. DEPRECATED / REMOVED / HISTORICAL

- The full pre-Slim snapshot is preserved at branch `legacy/project-ai-full`, tag `pre-slim-ragflow-migration`, commit `56bfec5`.
- Current working-tree deletions remove the legacy Requirement/Scope/Action/Risk product surfaces, old Weekly Report product workflow/page, Timesheet, Product Map runtime, Company Knowledge, broad document/file workspace, ordinary-user Model Management, assistant Threads/Conversation Memory, and related routes/UI/services/tests.
- Legacy Skill catalog UI, registry modules, Workflow UI/routes, Product Map registry/runtime, and Agent experiments are **REMOVED/INACTIVE**, not current capabilities.
- The legacy WeCom Timesheet Chrome Extension source and release material are deleted in the current working tree.
- The self-built document worker, embedding worker, parsing/chunking, lexical/vector/RRF retrieval, Retrieval Run, and related schemas/adapters are removed from the active application source and replaced by RAGFlow for the Slim knowledge path.
- Historical physical database tables and old object binaries intentionally remain for rollback/migration until a separate cleanup is reviewed. Their presence does not make the removed modules active runtime.
- `project_document_versions` and legacy object-storage code are compatibility/migration support, not the current upload path.

Evidence: `docs/PROJECT_AI_SLIM_MIGRATION_REPORT.md`, `docs/SLIM_DEPENDENCY_AUDIT.md`, `docs/CLEANUP_MIGRATION_PLAN.md`, `docs/SKILL_ASSET_INVENTORY.md`, and the current Git deletion set.

## 8. KNOWN LIMITATIONS

- The formerly extensive uncommitted Slim working tree is frozen by the corrected immutable target tag `staging-validation-v1.1` at `62d06e7184df9b43d72ad6780566d774b6f7255d`. The predecessor `staging-validation-v1` remains immutable failed-CI evidence.
- `.github/workflows/ci.yml` has been reconciled to the current Slim `package.json` and no longer invokes removed Product Map/file-workspace/worker scripts. Branch run `32712537099` and tag run `32712753945` passed on the exact v1.1 SHA.
- Real WeCom OAuth is not implemented. Test/staging credential behavior must not be described as production WeCom acceptance.
- Weekly Report v1.2 has not completed manual Cross-Agent re-test.
- Timeline Maker, Requirement Analyst, and Feasibility Research have deterministic contract coverage only; external-Agent interpretation quality is unverified.
- Feasibility Research live-search and A/B packs remain `NOT_TESTED`; pack readiness is not real research evidence.
- The Chrome Extension passes synthetic engineering tests, but the signed-in
  ChatGPT, DeepSeek, and Qwen DOMs have not completed manual injection/extraction
  verification. Selector compatibility and real Cross-Agent UAT remain open.
- The official Skill API and Project AI Sync changes are uncommitted local
  working-tree changes and have not been deployed to the currently validated
  Staging image. The live Sync step cannot be claimed until a separately
  authorized Staging delivery exposes these routes.
- Project AI contains a Timeline persistence API but no active Timeline UI route/tab. Timeline Maker Paste/import and apply flows remain absent.
- `docs/WEEKLY_REPORT_SKILL.md` still contains a pre-persistence statement saying no Project-linked Timeline repository exists; current code/tests supersede that statement.
- `docs/PROJECT_AI_SLIM_MIGRATION_REPORT.md` records the earlier resource-blocked RAGFlow phase; `docs/RAGFLOW_LIVE_POC_REPORT.md` and `docs/STAGING_UAT_EVIDENCE.md` record the earlier live POC/UAT. The newer `docs/STAGING_VALIDATION_V1_1_REPORT.md` proves the exact v1.1 SHA is now deployed and the real Staging chain is verified with the recorded conditions.
- Production was read-only fingerprinted during the 2026-08-25 Staging validation and remained healthy, unchanged, and restart-count `0`; Production behavior, data, and release acceptance remain **NOT_VERIFIED** and were not exercised.
- Current row counts and cleanup readiness for historical physical tables/object binaries were not inspected: **UNKNOWN**.

## 9. CURRENT VALIDATION STATUS

Fresh local validation through 2026-08-25:

| Validation | Result |
|---|---|
| `npm test` | **PASS — 102/102** (`95` unit + `7` rendered/proxy), including official Skill distribution 4/4 and Chrome Extension 21/21 |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `git diff --check` | **PASS**; all new untracked files were also checked independently for whitespace errors |
| `npm run build` | **PASS**; standalone output generated |
| Weekly Report readiness command | **PASS — 12/12 reference cases**, unresolved-match gate present, no findings |
| `npm run test:integration` in disposable PostgreSQL 17 + pgvector 0.8.1 + Fake RAGFlow | **PASS — 31/31** |
| Timeline persistence/provider integration subsection | **PASS — 5/5** within the 31 integration tests |
| Live RAGFlow/Qwen/Staging re-test | **PASS WITH CONDITIONS** on 2026-08-25; real Dataset provision, retrieval, Evidence Guard, Qwen answer, Citation, no-Evidence, permissions, Timeline, and Weekly Report context passed |
| Live deployment provenance check | **PASS**; public health and running image report exact SHA `62d06e7184df9b43d72ad6780566d774b6f7255d` |
| Current repository CI workflow | **PASS**; branch `32712537099` and tag `32712753945` succeeded on the exact v1.1 SHA |
| Chrome Extension live site UAT | **NEEDS_MANUAL_VERIFICATION** for signed-in ChatGPT, DeepSeek, and Qwen DOM injection/extraction; no online E2E was claimed |
| External Skill UAT | Weekly v1.2: **NOT RETESTED**; Timeline Maker: **NOT RUN**; Requirement Analyst: **NOT_TESTED**; Feasibility live/Cross-Agent/A-B: **NOT_TESTED** |

The final successful integration run used an isolated tmpfs database and test-only Fake RAGFlow and removed the temporary container afterward. Earlier setup attempts exposed environment mismatches (missing pgvector image, wrong auth provider/base path, and stale CI rate-limit override); no existing database was accessed or reset.

Existing live reports:

- `docs/RAGFLOW_LIVE_POC_REPORT.md`: real authenticated Project AI → RAGFlow → Evidence Guard → real Qwen → Citation path, **GO WITH CONDITIONS**, 2026-08-21.
- `docs/STAGING_UAT_EVIDENCE.md`: remote standalone-node Staging UAT for auth, project isolation, upload/parse, real answer/citation, **PASS**, 2026-08-21.
- `docs/STAGING_VALIDATION_V1_1_REPORT.md`: exact-SHA deployment provenance, RAGFlow public-IP/tunnel recovery, and resumed real Staging UAT, **PASS WITH CONDITIONS**, 2026-08-25.

The v1.1 validation report proves the immutable baseline, not any later uncommitted documentation change or future application source.

## 10. CURRENT NEXT STEPS

These are unfinished validation/productization items, not current capabilities.

### Near-term validation

1. After a separately authorized Staging deployment of the official Skill read
   API, reload the Extension unpacked, sync all four formal Skills through the
   logged-in Staging Session, and complete the first signed-in adapter
   verification on ChatGPT, DeepSeek, and Qwen before recording any live site as
   PASS.
2. Run the four Weekly Report v1.2 portable packs manually across the selected external Agents and record first-run PASS/FAIL without repair prompts.
3. Run Timeline Maker internal messy-document review and then Cross-Agent UAT; keep UI/apply claims absent until separately implemented and verified.
4. Execute all Requirement Analyst portable Cross-Agent cases.
5. Execute Feasibility Research live-search Cross-Agent cases and the controlled A/B comparison with equal budgets.
6. Decide and implement/verify the real production authentication provider; do not treat credential UAT as WeCom OAuth completion.
7. Track the non-blocking RAGFlow API-Key/JWT warning and the pre-existing Nginx server-name warning separately from the validated baseline.
8. Update stale supporting reports, especially the pre-persistence section in `docs/WEEKLY_REPORT_SKILL.md` and the earlier blocked RAGFlow migration report.

### Productization later

- Timeline Workbench UI/Paste integration and a reviewed diff/confirm/apply flow;
- Project-bound adapters for the three experimental upstream/research Skills;
- any generic external-Agent knowledge/tool access, PAT, MCP, or automatic execution path, only after an explicit product/security decision;
- physical legacy-table/object cleanup only after migration acceptance, backup/restore evidence, and rollback-window sign-off.

## 11. FACT CLASSIFICATION RULES

- **CONFIRMED** = current code, current test, or current repository report directly supports the statement.
- **IMPLEMENTED** = an active current code path or portable Skill implementation exists.
- **VERIFIED** = the relevant current test/UAT actually passed; the validation scope must be stated.
- **PARTIAL** = some active pieces exist, but a required runtime/UI/provider/integration piece is absent or unverified.
- **NOT_TESTED_EXTERNALLY** = deterministic/local evidence exists, but no current external-Agent execution passed.
- **BLOCKED** = a stated validation cannot currently complete because an explicit prerequisite or workflow is broken/missing.
- **PROPOSED / NOT IMPLEMENTED** = discussed/designed/referenced, but no active implementation exists.
- **DEPRECATED / REMOVED / INACTIVE** = historical code/assets existed but are not part of the current active runtime.
- **HISTORICAL** = supported only by legacy Git history or a dated prior run/report.
- **UNKNOWN** = repository evidence is insufficient; do not infer an answer.

Deterministic tests do not equal Cross-Agent UAT. Prepared packs do not equal execution. A contract or reference does not equal a connector/runtime. A historical branch or physical table does not equal active code.

## 12. EVIDENCE INDEX

| Conclusion | Minimum evidence paths |
|---|---|
| Slim architecture and explicit no-Agent/no-Workflow boundary | `README.md`; `docs/ARCHITECTURE.md`; `components/workspace.tsx`; `app/[...slug]/page.tsx` |
| Project AI performs grounded Q&A inference | `lib/knowledge-slim/query.ts`; `lib/ai/project-assistant/gateway.ts`; `lib/ai/project-assistant/config.ts` |
| RAGFlow role and backend-only mappings | `lib/ragflow/client.ts`; `lib/ragflow/config.ts`; `lib/knowledge-slim/datasets.ts`; `lib/knowledge-slim/documents.ts`; `lib/projects/serialization.ts` |
| Project/Auth/ProjectMember permissions | `lib/auth/authorization.ts`; `lib/auth/session.ts`; `lib/db/repositories/project-repository.ts`; `lib/db/schema/project-members.ts`; `tests/integration/identity-project-isolation.test.ts` |
| Real WeCom adapter incomplete | `lib/auth/providers.ts`; `components/auth/login-page.tsx` |
| Structured Timeline persistence/provider | `lib/db/schema/project-timelines.ts`; `drizzle/0036_normal_sister_grimm.sql`; `lib/db/repositories/project-timeline-repository.ts`; `app/api/projects/[projectId]/timeline/route.ts`; `lib/weekly-report/service.ts`; `tests/integration/identity-project-isolation.test.ts` |
| Weekly Report implementation/status | `skills/project-weekly-report/SKILL.md`; `lib/weekly-report/`; `app/api/skills/project-weekly-report/`; `tests/weekly-report.test.ts`; `tests/weekly-report-eval/`; `docs/WEEKLY_REPORT_V1_2_CHANGELOG.md`; `docs/WEEKLY_REPORT_CROSS_AGENT_UAT.md` |
| Official Skill distribution and Extension sync | `lib/skills/`; `app/api/skills/route.ts`; `app/api/skills/[skillId]/route.ts`; `chrome-extension/`; `tests/skill-distribution.test.ts`; `tests/chrome-extension.test.mjs`; `docs/CHROME_EXTENSION_UAT_GUIDE.md` |
| Timeline Maker status | `skills/project-timeline-maker/`; `lib/timeline-maker/`; `tests/timeline-maker.test.ts`; `docs/PROJECT_TIMELINE_MAKER_EVAL_REPORT.md` |
| Requirement Analyst status | `skills/project-requirement-analyst/`; `lib/requirement-analyst/`; `tests/requirement-analyst.test.ts`; `docs/PROJECT_REQUIREMENT_ANALYST_EVAL_REPORT.md`; `docs/PROJECT_REQUIREMENT_ANALYST_CROSS_AGENT_UAT.md` |
| Feasibility Research status | `skills/project-feasibility-research/`; `lib/feasibility-research/`; `tests/feasibility-research.test.ts`; `docs/PROJECT_FEASIBILITY_RESEARCH_EVAL_REPORT.md`; `docs/PROJECT_FEASIBILITY_RESEARCH_CROSS_AGENT_UAT.md`; `docs/PROJECT_FEASIBILITY_RESEARCH_AB_UAT.md` |
| Removed/historical modules | current Git deletion set; `docs/PROJECT_AI_SLIM_MIGRATION_REPORT.md`; `docs/SLIM_DEPENDENCY_AUDIT.md`; `docs/SKILL_ASSET_INVENTORY.md`; `docs/CLEANUP_MIGRATION_PLAN.md` |
| Live POC and Staging evidence | `docs/RAGFLOW_LIVE_POC_REPORT.md`; `docs/STAGING_UAT_EVIDENCE.md`; `docs/STAGING_UAT_ISSUES.md` |
| Current validation commands | `package.json`; `.github/workflows/ci.yml`; this working tree's 2026-08-25 command results |
