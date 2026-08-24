# Skill Asset Inventory

## Summary

Total Candidates: 16

Recoverable Skills: 1

Draft Skills: 7 (all are `PARTIAL`; no standalone `DRAFT` package was found)

Non-Skill Legacy Modules: 8

Inventory Date: 2026-08-21

Audit Basis:

- Current repository: `/Users/ryan/Documents/ProjectAI-Focused-MVP`
- Current branch: `refactor/project-ai-slim`
- Current HEAD: `56bfec5ed954146538af6a373dbc339073eaeab3`
- Legacy branch: `legacy/project-ai-full` -> `56bfec5ed954146538af6a373dbc339073eaeab3`
- Annotated tag: `pre-slim-ragflow-migration^{}` -> `56bfec5ed954146538af6a373dbc339073eaeab3`
- Explicit snapshot commit: `56bfec5ed954146538af6a373dbc339073eaeab3`
- Additional historical branch used for older Skill/Workflow evidence: `agent/projectai-workflows-knowledge-v3` -> `05021cb1afaccdb951daf5b6ef45293af6847cb4`
- PM Daily Report branch: `agent/pm-daily-report-mvp` -> `0bbcdb36b82c78e9b5a424e0d76c97508ae8f0cc`
- User-level search: `/Users/ryan/.agents/skills`
- Project-level search: `.agents/skills`
- Ignored: `node_modules`, `.next`, `build`, `dist`, third-party dependencies, plugin caches

Interpretation:

- `RECOVERABLE`: satisfies most portability criteria and has a real, independently readable Skill asset.
- `PARTIAL`: has useful Prompt, schema, SOP, or contract material, but lacks a complete portable Skill package or remains coupled to the old ProjectAI runtime.
- `DRAFT`: explicitly drafted as a Skill but not sufficiently implemented. No candidate ended in this exact state.
- `NOT_A_SKILL`: a product feature, mock catalog row, workflow/runtime component, UI, API, database model, or infrastructure rather than a portable Skill.
- “Draft Skills” in the summary counts `DRAFT` plus `PARTIAL`.

Direct conclusion:

- Exactly **one recoverable Skill lineage** was found: Product Map.
- Two real `SKILL.md` paths were found in reachable Git history: Product Map and Assistant Chat. Assistant Chat does not meet the portability threshold.
- The historical `.agents/skills/pm-daily-report/SKILL.md` package was **not found** in the current tree, any inspected branch/tag/commit, reachable/reflog object paths, the project-level `.agents/skills`, or `/Users/ryan/.agents/skills`.
- The only user-level Skill found was `/Users/ryan/.agents/skills/find-skills/SKILL.md`; it is a general third-party Skill-discovery utility, not a historical ProjectAI Skill, so it is excluded from the candidate count.
- Product Map is a real Skill, not merely a product feature: it has a `SKILL.md`, fixed SOP, input/output schemas, immutable registry metadata, version/digest checks, and tests. Its old UI/API/DB/worker implementation is separate legacy product infrastructure and was not recovered.
- Only Product Map can be handed directly to Codex, Claude, GPT, or a generic Markdown-capable Agent today. Strict JSON validation still requires the historical schema contract or a future portable schema extraction.

## Product Map

Name:

Product Map (`product-map`; earlier frontmatter name `requirements-product-map`)

Status:

RECOVERABLE

Source:

Legacy Branch / Tag / Git History

Original Path:

- `skills/product-map/SKILL.md`
- Supporting contract: `lib/product-map/contracts.ts`
- Supporting registry metadata: `lib/product-map/registry.ts`
- Earlier implementation paths: `lib/workflows/product-map/contracts.ts`, `lib/workflows/product-map/registry.ts`

Git Ref:

- Latest frozen version: `56bfec5` (also `legacy/project-ai-full` and peeled tag `pre-slim-ragflow-migration^{}`)
- Earlier portable version: `05021cb` on `agent/projectai-workflows-knowledge-v3`

Purpose:

Turn authorized requirements material and bounded user input into an auditable product-structure draft covering evidence inventory, project understanding, goals, user path, product hierarchy, pages, features, risks/questions, quality checks, and handoff.

Inputs:

- Requirements or project source material
- Optional bounded user instruction
- In the integrated version: project context, selected source IDs, retrieval instruction, conversation context, and idempotency key
- Evidence labels and stable IDs

Outputs:

- Authoritative structured Product Map artifact
- Project understanding and business/user goals
- Fixed five-stage user path
- Product -> Module -> Page/Surface -> Feature -> Action -> State hierarchy
- Pages, features, risks, questions, quality results, citations, step outputs, and handoff summary
- Integrated runtime rendered Markdown and Mermaid from validated JSON

Instructions / SOP:

A fixed evidence-first workflow is present. The latest frozen version uses eight ordered steps: evidence inventory, project understanding, goals and behaviors, user path, product map, pages and features, independent review, and final artifact. The earlier version contains a standalone Markdown workflow from material inventory through quality check and downstream handoff.

Dependencies:

- Instruction-only use: a Markdown-capable Agent and supplied source material
- Strict historical output validation: Product Map Zod contracts and schema version
- Integrated historical execution only: ProjectAI authorization, retrieval, AI Gateway, database, service, and review UI
- No provider name is embedded in the Skill instructions

Files:

- `56bfec5:skills/product-map/SKILL.md`
- `56bfec5:lib/product-map/contracts.ts`
- `56bfec5:lib/product-map/registry.ts`
- `56bfec5:tests/product-map-contract.test.ts`
- `05021cb:skills/product-map/SKILL.md`
- `05021cb:lib/workflows/product-map/contracts.ts`
- `05021cb:lib/workflows/product-map/registry.ts`

Portability:

HIGH for the earlier standalone Markdown SOP; MEDIUM-HIGH for the latest frozen instructions because strict JSON validation references a repository-side registered schema.

Agent Compatibility:

- Codex
- Claude
- GPT
- Generic Markdown Agent

Missing Pieces:

- No portable standalone JSON Schema file was found beside `SKILL.md`; the strict schema is embedded in TypeScript.
- No `agents/openai.yaml`, `references/examples.md`, or `references/projects.example.yaml` was found for this repository Skill.
- No self-contained invocation/materials README is present in the frozen Skill directory.
- The latest integrated version assumes server-owned evidence identities and deterministic lint.

Issues:

- The current Slim working tree deletes the original `skills/product-map/SKILL.md`; the deletion was preserved and not reversed.
- The same declared version `1.0.0` has different historical contents/digests across `05021cb` and `56bfec5`. Provenance must therefore include Git ref and SHA-256, not version alone.
- The product UI, API, database schema, leases, worker/service code, and runtime registry are not part of the portable Skill asset.

Recommendation:

KEEP

Recovered copies:

- `assets/skills-recovered/product-map/SKILL.md` from `56bfec5`
- `assets/skills-recovered/product-map/history/05021cb/SKILL.md` from `05021cb`

## Assistant Chat / Project Question Answering

Name:

Assistant Chat (`assistant-chat`); related mock catalog name `project-question-answering`

Status:

PARTIAL

Source:

Git History / Legacy Product Module

Original Path:

- `skills/assistant-chat/SKILL.md`
- `lib/workflows/product-map/registry.ts`
- `data/mock/ai.ts`
- `lib/ai/project-assistant/*`

Git Ref:

- Formal Skill file and registry: `05021cb`
- Mock catalog and later assistant implementation: `56bfec5`

Purpose:

Answer questions using authorized current project knowledge and retain auditable citations.

Inputs:

Question plus optional source-document IDs according to the historical registry.

Outputs:

A grounded answer with citations according to the historical registry.

Instructions / SOP:

The eight-line `SKILL.md` states that the server validates access, retrieves valid sources, preserves citations, refuses caller-controlled provider/model/prompt/credentials, and keeps output as a draft.

Dependencies:

ProjectAI server authorization, project-scoped retrieval, AI Gateway, citation validation, threads/messages/executions, and database persistence.

Files:

- `05021cb:skills/assistant-chat/SKILL.md`
- `05021cb:lib/workflows/product-map/registry.ts`
- `56bfec5:data/mock/ai.ts`
- `56bfec5:lib/ai/project-assistant/service.ts`

Portability:

LOW

Agent Compatibility:

Unknown as a standalone asset; Codex, Claude, GPT, and generic Agents would require a new portable retrieval/input contract.

Missing Pieces:

No self-contained evidence input format, execution SOP, output schema, failure rules, examples, or portable citation contract exists in `SKILL.md).

Issues:

The formal file describes ProjectAI’s grounded assistant infrastructure rather than an independently executable business Skill. Its historical registry even defines zero steps and an open-ended output object.

Recommendation:

ARCHIVE

## PM Daily Report

Name:

PM Daily Report (`pm-daily-report`; historical prompt version `pm-daily-report-v1`)

Status:

PARTIAL

Source:

Legacy Branch / Git History

Original Path:

Expected historical package `.agents/skills/pm-daily-report/` was not found. Surviving assets are:

- `docs/pm-daily-report-ai-contract.md`
- `docs/pm-daily-report-architecture.md`
- `docs/pm-daily-report-data-model.md`
- `lib/timesheets/contracts.ts`
- `lib/timesheets/service.ts`
- `examples/uat-timesheet-payload.json`

Git Ref:

- Frozen snapshot: `56bfec5`
- Dedicated branch: `0bbcdb3` (`agent/pm-daily-report-mvp`)

Purpose:

Transform a project manager’s bounded daily work records into an auditable daily timesheet draft for review and later submission.

Inputs:

Report date, user/organization scope, work-log records, candidate projects/categories/statuses, explicit hours or time ranges, progress, and source-record IDs.

Outputs:

Structured task rows with project/category/status, description, hours/overtime, progress, source-record IDs, unresolved records, warnings, and aggregate totals.

Instructions / SOP:

The surviving contract requires JSON-only output, facts limited to input records and candidate catalogs, no invented projects/categories/status/meetings/sources, separation of distinct project/deliverable/status work, strict handling of completed versus planned work, evidence-backed hours, and at most one schema/fact repair.

Dependencies:

ProjectAI authentication and organization scope, PostgreSQL timesheet models, AI Gateway, durable AI jobs, review/confirmation UI, and optional WeCom connector.

Files:

- `56bfec5:docs/pm-daily-report-ai-contract.md`
- `56bfec5:docs/pm-daily-report-architecture.md`
- `56bfec5:lib/timesheets/contracts.ts`
- `56bfec5:lib/timesheets/service.ts`
- `56bfec5:examples/uat-timesheet-payload.json`

Portability:

MEDIUM as source material; LOW as a directly executable package.

Agent Compatibility:

Codex / Claude / GPT after refactoring; Generic Markdown Agent after adding a standalone input/output contract.

Missing Pieces:

- `.agents/skills/pm-daily-report/SKILL.md` not found
- `agents/openai.yaml` not found
- `references/examples.md` not found
- `references/projects.example.yaml` not found
- No portable package, neutral invocation protocol, or standalone schema file

Issues:

This is a substantial implemented product workflow, but the known Skill package itself is absent. Reconstructing a new Skill now would violate this inventory-only round, so no file was synthesized or recovered.

Recommendation:

REFACTOR

## Meeting Summary

Name:

Meeting Summary (`meeting-summary` / `meeting_minutes`)

Status:

PARTIAL

Source:

Git History / Legacy Workflow

Original Path:

- `lib/workflows/meeting-summary-provider.ts`
- `lib/workflows/contracts.ts`
- `data/mock/ai.ts`

Git Ref:

- Concrete prompt/schema implementation: `05021cb`
- Mock catalog row: `56bfec5`

Purpose:

Convert bounded speaker-labelled transcript segments into grounded meeting background, topics, key points, confirmed decisions, proposals, open questions, risks, and actions.

Inputs:

Array of transcript segments containing ID, start/end time, speaker, and text; bounded segment/character limits.

Outputs:

Strict JSON meeting summary with source segment IDs, confirmed-decision guard, action owner/deadline/dependencies, risks, and open questions.

Instructions / SOP:

A concrete JSON contract, citation-label rule, speaker/owner guard, confirmed-decision rule, chunk/merge path, schema validation, and one controlled repair are implemented.

Dependencies:

Historical ProjectAI workflow service, audio/transcript pipeline, AI Gateway, provider usage aggregation, and Zod schemas.

Files:

- `05021cb:lib/workflows/meeting-summary-provider.ts`
- `05021cb:lib/workflows/contracts.ts`
- `05021cb:docs/WORKFLOW_KNOWLEDGE_V3.md`
- `56bfec5:data/mock/ai.ts`

Portability:

MEDIUM

Agent Compatibility:

Codex / Claude / GPT after packaging; Generic Markdown Agent if supplied a neutral transcript JSON format.

Missing Pieces:

No `SKILL.md`, portable metadata, examples, or standalone schema artifact.

Issues:

The useful instruction is embedded in provider/runtime code and coupled to the old meeting/audio Workflow.

Recommendation:

REFACTOR

## Project Overview Generator

Name:

Project Overview Artifact Generator (`project_overview`)

Status:

PARTIAL

Source:

Git History / Legacy Workflow

Original Path:

- `lib/workflows/prompt.ts`
- `lib/workflows/contracts.ts`

Git Ref:

`05021cb`

Purpose:

Generate a grounded project overview with required fields and pending questions from authorized evidence.

Inputs:

Artifact kind, project name, evidence items with labels/document metadata/locator/content, and optional invalid prior output for repair.

Outputs:

Strict JSON sections and fields covering the fixed overview field set, with fact/assumption/advice/pending classification, evidence labels, and pending questions.

Instructions / SOP:

Concrete evidence-only system instructions and schema validation exist; facts require citations and missing values stay pending/TBD.

Dependencies:

Historical ProjectAI retrieval, workflow worker/service, evidence labels, and Zod schema.

Files:

- `05021cb:lib/workflows/prompt.ts`
- `05021cb:lib/workflows/contracts.ts`

Portability:

MEDIUM

Agent Compatibility:

Codex / Claude / GPT after packaging; Generic Markdown Agent after schema extraction.

Missing Pieces:

No `SKILL.md`, metadata, invocation README, examples, or independent schema file.

Issues:

This is an artifact kind inside a fixed Workflow engine, not a portable Skill package.

Recommendation:

REFACTOR

## Requirements Document Generator

Name:

Requirements Document Artifact Generator (`requirements_document`)

Status:

PARTIAL

Source:

Git History / Legacy Workflow

Original Path:

- `lib/workflows/prompt.ts`
- `lib/workflows/contracts.ts`

Git Ref:

`05021cb`

Purpose:

Generate a citation-grounded 26-section requirements document and testable acceptance criteria from evidence.

Inputs:

Project name, evidence items, artifact kind, optional batches of required section numbers, and optional prior invalid output for repair.

Outputs:

Exactly 26 ordered titled sections, classifications, citations, and acceptance criteria.

Instructions / SOP:

Concrete prompt rules enforce evidence-only facts, fixed titles/order, bounded batch generation, classification labels, citation validation, and repair without new facts.

Dependencies:

Historical ProjectAI evidence retrieval, workflow orchestration/batching, AI Gateway, and Zod validation.

Files:

- `05021cb:lib/workflows/prompt.ts`
- `05021cb:lib/workflows/contracts.ts`

Portability:

MEDIUM

Agent Compatibility:

Codex / Claude / GPT after packaging; Generic Markdown Agent after schema extraction.

Missing Pieces:

No `SKILL.md`, portable metadata, examples, material protocol, or standalone schema.

Issues:

The workflow is substantially specified, but the input evidence model and batching/repair lifecycle are implemented inside ProjectAI.

Recommendation:

REFACTOR

## GA4 Measurement Plan Generator

Name:

GA4 Measurement Plan Artifact Generator (`ga4_measurement_plan`)

Status:

PARTIAL

Source:

Git History / Legacy Workflow

Original Path:

- `lib/workflows/prompt.ts`
- `lib/workflows/contracts.ts`

Git Ref:

`05021cb`

Purpose:

Generate a grounded GA4 measurement plan with public parameters, events, requirement coverage, and page-event mapping.

Inputs:

Project name and labelled evidence through the shared artifact prompt input.

Outputs:

Strict JSON overview, public parameters, event rows, requirement-event coverage, and page-event matrix.

Instructions / SOP:

Concrete schema instructions define stable snake_case IDs, event types, value types, multi-parameter row handling, TBD behavior, evidence fidelity, and coverage invariants.

Dependencies:

Historical Workflow engine, evidence retrieval, AI Gateway, extensive normalization, and Zod validation.

Files:

- `05021cb:lib/workflows/prompt.ts`
- `05021cb:lib/workflows/contracts.ts`

Portability:

MEDIUM

Agent Compatibility:

Codex / Claude / GPT after packaging; Generic Markdown Agent after schema extraction.

Missing Pieces:

No `SKILL.md`, portable metadata, examples, platform-specific material checklist, or standalone schema.

Issues:

The candidate is more than a name, but its SOP and schema are embedded in code and not independently distributable.

Recommendation:

REFACTOR

## Action Plan Generator

Name:

Action Plan Generator (`action_plan`); related mock catalog name `action-plan-extraction`

Status:

PARTIAL

Source:

Git History / Legacy Workflow / Mock Catalog

Original Path:

- `lib/workflows/prompt.ts`
- `lib/workflows/contracts.ts`
- `data/mock/ai.ts`

Git Ref:

- Concrete prompt/schema: `05021cb`
- Mock catalog row: `56bfec5`

Purpose:

Generate grounded tasks with owners, stakeholders, dates, progress, milestones, dependencies, confirmation status, delay impact, and critical path.

Inputs:

Project name and labelled evidence through the shared artifact prompt input.

Outputs:

Strict JSON tasks and warnings with bounded status/date/source rules and an acyclic dependency graph.

Instructions / SOP:

Concrete prompt and schema rules exist. Dates must be sourced, TBD, or explicitly labelled as AI suggestions; dependencies and parent tasks must reference current output tasks and remain acyclic.

Dependencies:

Historical Workflow engine, evidence retrieval, AI Gateway, validation/normalization, and old work-management product models.

Files:

- `05021cb:lib/workflows/prompt.ts`
- `05021cb:lib/workflows/contracts.ts`
- `56bfec5:data/mock/ai.ts`

Portability:

MEDIUM

Agent Compatibility:

Codex / Claude / GPT after packaging; Generic Markdown Agent after schema extraction.

Missing Pieces:

No `SKILL.md`, portable metadata, examples, or standalone schema.

Issues:

The concrete generator is embedded in Workflow V3, while `action-plan-extraction` in the old Skill page is only mock catalog metadata.

Recommendation:

REFACTOR

## Project Document Summary

Name:

Project Document Summary (`project-document-summary`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog

Original Path:

`data/mock/ai.ts`

Git Ref:

`56bfec5`

Purpose:

Catalog description says it extracts document structure, facts, and pending questions.

Inputs:

Only a generic mock schema: `projectId` and `sourceIds`.

Outputs:

Only a generic mock schema: `result`, `citations`, and `confidence`.

Instructions / SOP:

Only generic mock steps: validate input, run analysis through a Model Profile/Gateway, and validate output.

Dependencies:

Old mock Skill UI, mock model profiles, and ProjectAI document/assistant product code.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/skill/skills-page.tsx`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No dedicated prompt, SOP, output definition, examples, references, schema, or `SKILL.md`.

Issues:

The detailed usage, version history, metrics, and validation rows are synthetic mock data, not evidence of an implemented reusable Skill.

Recommendation:

ARCHIVE

## Requirement Extraction

Name:

Requirement Extraction (`requirement-extraction`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog / Product Feature

Original Path:

- `data/mock/ai.ts`
- `components/workflow/requirement-extraction-page.tsx`
- Requirement API/routes and project-management services

Git Ref:

`56bfec5`

Purpose:

Catalog description says it extracts structured requirements and evidence from project material.

Inputs:

Generic mock `projectId` and `sourceIds`; product routes use ProjectAI-specific project/document state.

Outputs:

Generic mock `result`, `citations`, and `confidence`; product code writes/reviews ProjectAI requirement drafts.

Instructions / SOP:

No dedicated portable SOP was found. The mock catalog provides only the shared three generic steps.

Dependencies:

React UI, API routes, project authorization, PostgreSQL requirements models, review lifecycle, and AI Gateway.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/workflow/requirement-extraction-page.tsx`
- `56bfec5:lib/project-management/requirements.ts`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No `SKILL.md`, dedicated prompt, independent input/output schema, examples, or references.

Issues:

The separately inventoried Requirements Document Generator has concrete prompt/schema evidence, but it must not be silently equated with this mock catalog ID.

Recommendation:

ARCHIVE

## Requirement Clarification

Name:

Requirement Clarification (`requirement-clarification`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog

Original Path:

`data/mock/ai.ts`

Git Ref:

`56bfec5`

Purpose:

Catalog description says it finds information gaps and generates clarification questions.

Inputs:

Generic mock `projectId` and `sourceIds`.

Outputs:

Generic mock `result`, `citations`, and `confidence`.

Instructions / SOP:

Only the shared generic mock steps and validators.

Dependencies:

Old mock Skill UI and model-profile catalog.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/skill/skills-page.tsx`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No dedicated instructions, question-prioritization rules, output schema, examples, references, or `SKILL.md`.

Issues:

A display name and synthetic execution metrics do not establish a reusable Skill.

Recommendation:

ARCHIVE

## Requirement Deduplication

Name:

Requirement Deduplication and Conflict Detection (`requirement-deduplication`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog

Original Path:

`data/mock/ai.ts`

Git Ref:

`56bfec5`

Purpose:

Catalog description says it finds semantic duplicates, rule conflicts, and Scope conflicts.

Inputs:

Generic mock `projectId` and `sourceIds`.

Outputs:

Generic mock `result`, `citations`, and `confidence`.

Instructions / SOP:

Only the shared generic mock steps and validators.

Dependencies:

Old mock Skill UI and requirement-analysis model-profile metadata.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/skill/skills-page.tsx`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No matching criteria, conflict taxonomy, decision rules, output schema, examples, references, or `SKILL.md`.

Issues:

No evidence was found that an independent Agent could execute this from the catalog row.

Recommendation:

ARCHIVE

## Scope Diff

Name:

Scope Version Comparison (`scope-diff`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog / Product Feature

Original Path:

- `data/mock/ai.ts`
- `components/scope/scope-page.tsx`
- Scope API routes and project-management services

Git Ref:

`56bfec5`

Purpose:

Catalog/product description says it compares Scope versions and generates impact/risk suggestions.

Inputs:

ProjectAI project and stored Scope comparison state; the mock row exposes only generic `projectId` and `sourceIds`.

Outputs:

ProjectAI-specific diff/review records; the mock row exposes only generic result/citations/confidence.

Instructions / SOP:

No standalone comparison SOP, portable input format, or output schema was found.

Dependencies:

React UI, API routes, authorization, PostgreSQL scope models, review state, and AI Gateway.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/scope/scope-page.tsx`
- `56bfec5:lib/project-management/requirements.ts`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No `SKILL.md`, dedicated prompt, comparison rules, examples, or independent schema.

Issues:

This is an old ProjectAI product capability, not a portable Skill asset.

Recommendation:

ARCHIVE

## Project Risk Analysis

Name:

Project Risk Analysis (`project-risk-analysis`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog / Product Feature

Original Path:

- `data/mock/ai.ts`
- `components/risk/risks-page.tsx`
- Risk API routes and project-management services

Git Ref:

`56bfec5`

Purpose:

Catalog description says it identifies risk level, impact, and suggested mitigation from current evidence.

Inputs:

ProjectAI project/evidence state; only generic mock input metadata is present.

Outputs:

ProjectAI risk drafts/records; only generic mock output metadata is present.

Instructions / SOP:

No dedicated portable risk taxonomy, scoring rubric, SOP, or output contract was found.

Dependencies:

React UI, API routes, authorization, database risk models, review lifecycle, and AI Gateway.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/risk/risks-page.tsx`
- `56bfec5:lib/project-management/work-management.ts`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No `SKILL.md`, dedicated prompt, independent schema, examples, or references.

Issues:

The catalog row and product code are insufficient for an independent Agent to reproduce the intended analysis.

Recommendation:

ARCHIVE

## Weekly Status Report

Name:

Weekly Status Report (`weekly-status-report`; product service ID `weekly-report-generation`)

Status:

NOT_A_SKILL

Source:

Legacy Mock Catalog / Product Feature

Original Path:

- `data/mock/ai.ts`
- `components/report/weekly-reports-page.tsx`
- Weekly report API routes and `lib/project-management/work-management.ts`

Git Ref:

`56bfec5`

Purpose:

Aggregate weekly progress, risk, decisions, and next-week plans into a reviewable report.

Inputs:

ProjectAI requirement/action/risk/report database state; the mock Skill row exposes only generic project/source IDs.

Outputs:

ProjectAI weekly report draft/version/export records; the mock row exposes only generic result/citations/confidence.

Instructions / SOP:

A product service and review/publish workflow exist, but no dedicated portable prompt/SOP/schema was found.

Dependencies:

ProjectAI authorization, PostgreSQL work-management models, API/UI review and publish flow, and AI Gateway.

Files:

- `56bfec5:data/mock/ai.ts`
- `56bfec5:components/report/weekly-reports-page.tsx`
- `56bfec5:lib/project-management/work-management.ts`

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

No `SKILL.md`, dedicated prompt, reporting period input contract, standalone output template/schema, examples, or references.

Issues:

This is a product workflow backed by application data, not a distributable Skill.

Recommendation:

ARCHIVE

## Legacy Skill Catalog, Registry, Workflow Engine, and Agent Runtime

Name:

Legacy Skill/Workflow/Agent Infrastructure

Status:

NOT_A_SKILL

Source:

Current Deletion Set / Legacy Branch / Git History

Original Path:

- `components/skill/*`
- `app/api/skills/route.ts`
- `lib/product-map/registry.ts`
- `components/workflow/*`
- `app/api/projects/[projectId]/workflows/*`
- `lib/workflows/*`
- `lib/ai/*`
- `worker/*`
- Product Map UI/API/database/service files

Git Ref:

`56bfec5` and `05021cb`

Purpose:

Historically displayed mock Skill metadata, registered executable capabilities, orchestrated durable workflows, called providers, persisted runs/artifacts, and presented review UI.

Inputs:

ProjectAI HTTP/database/session/runtime state.

Outputs:

ProjectAI pages, API responses, database rows, executions, artifacts, and audit records.

Instructions / SOP:

Runtime orchestration and security rules are implemented in application code, not as a portable business Skill.

Dependencies:

Next.js, React, PostgreSQL, Drizzle, AI Gateway, workers, object storage, authorization, and application deployment.

Files:

The paths above plus their tests, migrations, and mock data.

Portability:

LOW

Agent Compatibility:

Unknown

Missing Pieces:

Not applicable; this category is intentionally infrastructure rather than a Skill.

Issues:

Restoring these modules would restore the old Agent/Workflow/Harness product direction, which is explicitly out of scope. The Skill page’s ten catalog entries are synthetic mock assets and must not be treated as ten proven Skills.

Recommendation:

ARCHIVE

## Recovery Manifest

Recovered root:

`assets/skills-recovered/`

Recovered Skill lineage count:

1

Files:

| Recovered Path | Original Git Object | Original Source | SHA-256 | Treatment |
|---|---|---|---|---|
| `assets/skills-recovered/product-map/SKILL.md` | `56bfec5:skills/product-map/SKILL.md` | Frozen legacy branch/tag/commit | `29fd6d2e7942d6a840cc995dc74ec53342931bb54d83026167a3ed24493ec20a` | Exact copy |
| `assets/skills-recovered/product-map/history/05021cb/SKILL.md` | `05021cb:skills/product-map/SKILL.md` | Earlier Git history | `6046f5de59d16da76978834b8f9ffaec3bca0077642690e53f1ef043f06db1d7` | Exact copy |

Not recovered:

- Assistant Chat, because it is an eight-line wrapper around old ProjectAI grounded-assistant infrastructure and is not independently executable.
- PM Daily Report, because no historical `SKILL.md` or Skill package was found; only implementation/contracts survive.
- Workflow V3 artifact generators, because their Prompt/schema assets remain embedded in runtime code and have no historical portable Skill package.
- Mock catalog rows and all UI/API/database/worker/registry infrastructure.

## Future Skill Asset Library Recommendation

Enter now:

1. Product Map — direct `KEEP`; publish only with provenance that includes Git ref and digest.

Refactor before entry:

1. PM Daily Report
2. Meeting Summary
3. Requirements Document Generator
4. Project Overview Generator
5. GA4 Measurement Plan Generator
6. Action Plan Generator

Archive as historical product concepts unless new independent Skill specifications are authored in a later, explicitly authorized round:

1. Assistant Chat / Project Question Answering
2. Project Document Summary
3. Requirement Extraction
4. Requirement Clarification
5. Requirement Deduplication
6. Scope Diff
7. Project Risk Analysis
8. Weekly Status Report
9. Legacy Skill Catalog / Registry / Workflow / Agent infrastructure

No candidate was rewritten, redesigned, activated, registered, executed, or connected to the current Slim product.
