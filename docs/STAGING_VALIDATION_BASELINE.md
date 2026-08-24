# Project AI Staging Validation Baseline

Last verified: 2026-08-24 (Asia/Shanghai)

## 1. Baseline identity

| Field | Frozen value |
|---|---|
| Baseline tag | `staging-validation-v1` |
| Source branch | `refactor/project-ai-slim` |
| Pre-freeze parent | `56bfec5ed954146538af6a373dbc339073eaeab3` |
| Package | `project-ai-slim@1.0.0-staging` |
| Node contract | `>=22.13.0`; validation used Node `v24.18.0` and npm `11.16.0` |
| Latest included migration | `drizzle/0036_normal_sister_grimm.sql` |
| Canonical revision lookup | `git rev-parse staging-validation-v1^{commit}` |

The tag, rather than an embedded self-referential commit hash, is the repository source of truth. The tag must not be moved. Every Staging deployment and UAT report derived from this baseline must record the resolved 40-character commit SHA.

This baseline freezes the complete Slim working tree, including the intentional legacy-module deletions, the current Project/RAGFlow/Skill implementation, the Slim deployment files, the current tests, the reconciled CI workflow, and this document. It is not a claim that the tagged revision has already been deployed.

## 2. Frozen architecture boundary

### Included and active

- Better Auth-backed database Sessions and centralized Project authorization.
- PostgreSQL persistence for identity, organization/department, Project, ProjectMember, Project aliases, one current Structured Timeline snapshot per Project, RAGFlow mappings, and Audit Events.
- Project-scoped RAGFlow dataset/document operations and guarded single-Project or authorized cross-Project knowledge retrieval.
- Server-side grounded knowledge-answer synthesis through the existing AI Gateway when accepted Evidence exists; no-Evidence requests return `insufficient_evidence` without an LLM call.
- Four portable Skill assets: Weekly Report, Timeline Maker, Requirement Analyst, and Feasibility Research.
- An authenticated, bounded, versioned Weekly Report Execution Package API. Project AI prepares the package; it does not generate the report.
- Project-linked Structured Timeline `GET/PUT` persistence and structured-first Weekly Report context, with authorized Timeline-document fallback.

### Explicitly excluded

- Agent Runtime, Agent Loop, Tool Calling runtime, automatic external-Agent execution, or automatic application of Agent output.
- MCP server, PAT/Agent token, generic external-Agent Project Knowledge API, or generic Project Context API.
- Generic Skill Registry/catalog runtime, Workflow Runtime, Skills Library UI, Resources Library UI, or active Product Map runtime.
- Timeline Workbench UI, Timeline Maker connector/tool mode, diff/confirmation/apply flow, or automatic Timeline persistence from an external Agent.
- Chrome/WeCom Extension runtime, assistant Threads/Conversation Memory, and the removed legacy Requirement/Scope/Action/Risk/Timesheet/Weekly product workflows.
- Legacy self-built parser, Chunk/FTS/Embedding/pgvector/RRF retrieval path in the active Slim application.

No future feature may be inferred from a Skill instruction, UAT pack, historical branch, deleted module, contract, or design document.

## 3. Validation evidence

All commands below were rerun against the final pre-commit frozen working tree on 2026-08-24, after the Slim-only CI reconciliation, release documentation, and the React 19.2.8 security patch.

| Command | Result | Observed duration | Scope |
|---|---:|---:|---|
| `npm ci` | PASS | 12.93 s | Clean install from `package-lock.json` before the final patch-level refresh; a second clean install also passed after lockfile regeneration |
| `npm test` | PASS, 77/77 | 6.62 s | 70 unit/contract tests and 7 rendered/proxy tests |
| `npm run typecheck` | PASS | 2.45 s | TypeScript no-emit check |
| `npm run lint` | PASS | 5.16 s | Active tree, excluding generated output |
| `npm run build` | PASS | 7.16 s | Vinext production build; standalone output generated |
| `npm run test:integration` | PASS, 31/31 | 3.84 s | Disposable PostgreSQL 17 + pgvector 0.8.1, isolated seed, Fake RAGFlow, Fake AI provider |
| `npm audit --omit=dev` | PASS WITH LIMITATIONS | n/a | 0 critical/high; 4 moderate findings in the Drizzle/esbuild migration-tool chain |

The first integration setup attempt passed 28/31 and exposed a missing local Fake RAGFlow/AI environment configuration. After supplying the current test-only provider contract, the full suite passed 31/31. No existing local, Staging, or Production database was accessed or reset.

The reconciled `.github/workflows/ci.yml` now runs only current Slim scripts and uses ephemeral test credentials, PostgreSQL 17 + pgvector 0.8.1, and Fake RAGFlow. It no longer invokes removed Product Map, file-workspace, Worker, release-evidence, or legacy E2E commands.

## 4. Deployment status

- Frozen revision deployment: **NOT PERFORMED BY THIS FREEZE TASK**.
- Read-only check at 2026-08-24 17:18 Asia/Shanghai: `/tool/projectai-staging/api/health` returned HTTP 200 for app `0.8.0-staging` at commit `b4bc6b92be4e222279a4d267466175bf24623cf2`, which is not this baseline.
- The same check found `/tool/projectai-slim-uat/api/health` healthy at app version `1.0.0-ui-refactor-v1.1`, but that endpoint returned no commit-SHA header, so its exact revision is unproven and it cannot be treated as this baseline.
- Active Staging baseline status: **NOT DEPLOYED / NOT THE CURRENT UAT SOURCE OF TRUTH**.
- Production: **OUT OF SCOPE; MUST REMAIN UNCHANGED**.
- Remote exact-head CI: **NOT VERIFIED until the branch/tag is pushed and the workflow succeeds for that exact SHA**.

Before this baseline can be called the active Staging UAT source of truth, a separate authorized Staging-only delivery must:

1. resolve and record `staging-validation-v1^{commit}`;
2. obtain successful remote CI for that exact SHA;
3. build an immutable image with the exact revision label and record its digest;
4. back up Staging data and apply only committed migrations through `0036` using the controlled migration path;
5. deploy only to the isolated Staging stack;
6. verify health, login, Project authorization, RAGFlow connectivity, and the response revision header;
7. record deployment time, image digest, applied migration, RAGFlow version/configuration, enabled model profile, and rollback target;
8. confirm Production invariance.

## 5. Known limitations

- Real WeCom OAuth is not implemented; credential-based Staging UAT is not WeCom OAuth acceptance.
- Live RAGFlow/Qwen/Staging behavior was not rerun as part of this local freeze.
- Weekly Report v1.2 has deterministic coverage but has not completed manual first-run external-Agent re-test.
- Timeline Maker, Requirement Analyst, and Feasibility Research have deterministic contract coverage only; their external-Agent interpretation quality is unverified.
- Feasibility Research live search and controlled A/B evaluation are not tested.
- There is no active Timeline UI/apply flow and no generic external-Agent Project context surface.
- Historical physical tables and object binaries remain until a separate reviewed cleanup and rollback-window decision.
- The direct React Server Components DoS advisory was removed by aligning React, React DOM, and `react-server-dom-webpack` on `19.2.8`. The full development/build-tool audit still reports 10 high findings through Vinext/Cloudflare/parser tooling; resolving them requires broader dependency upgrades and remains a separate pre-Production supply-chain task. The production-oriented `--omit=dev` view reports no high or critical finding.

## 6. UAT rules for this baseline

1. Every UAT record must include the resolved baseline commit SHA, immutable image digest, Skill ID/version or asset hash, external Agent/model/version, case ID, start time, and first-run result.
2. Do not run Skill UAT until live Staging reports the same exact commit SHA as `staging-validation-v1` and exact-head CI is green.
3. Use real PM work or explicitly marked synthetic fixtures only within an authorized Project. Never copy customer data into Git, logs, screenshots, prompts, or UAT artifacts.
4. Run Weekly Report v1.2 first. Project AI supplies the Execution Package; the selected external Agent performs the Skill reasoning.
5. Preserve the first answer. Do not repair prompts, manually rewrite the answer, add missing facts, or change the rubric before recording PASS/FAIL and defects.
6. Deterministic tests, prepared packs, or successful package creation do not count as external-Agent UAT.
7. Keep facts, assumptions, gaps, unknowns, and sources visibly distinct. No external-Agent output may automatically overwrite Project, Timeline, Requirement, Scope, or other formal data.
8. Evaluate cross-project isolation, source citation, date fidelity, missing-data behavior, and unsupported inference as release gates, not presentation polish.
9. Do not use legacy branches, deleted runtimes, historical reports, or recovered Product Map assets to supplement this baseline.
10. A defect may trigger a narrowly scoped fix and a new immutable revision. Do not move `staging-validation-v1`; create a new baseline tag after complete revalidation.

## 7. Remaining validation sequence

1. Push the frozen branch/tag and obtain exact-head CI success.
2. Perform the separately authorized Staging-only deployment and provenance verification.
3. Run the four Weekly Report v1.2 external-Agent packs without repair prompts.
4. Run Timeline Maker messy-document review and Cross-Agent UAT.
5. Run all Requirement Analyst Cross-Agent cases.
6. Run Feasibility Research live-search cases and the equal-budget A/B comparison.
7. Decide and verify the production authentication provider separately.

Future Agent Runtime, MCP, Skill Registry, Workflow, Extension, or generic external-Agent access work is not part of this baseline and requires a separate product and security decision.
