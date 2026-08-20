---
name: product-map
description: 将授权项目资料和补充说明按固定八步转为可追溯的 PM 分析、用户路径、产品结构、页面功能、风险与待确认事项；用于需求澄清和人工审核前的产品结构草案。
---

# Product Map v1.0.0

## Purpose and boundary

Produce an auditable product-structure **draft**, never a formal business write,
code, visual design, technical architecture, or external action. Run only in the
server-owned `product_map_generation` scenario. The caller supplies no provider,
model, profile, credential, prompt override, evidence identity, or output path.

Use only the supplied authorized evidence and user input. Do not invent facts or
silently resolve conflicts. Return conclusions, citations, and short check notes;
never reveal hidden reasoning or chain-of-thought.

## Evidence and IDs

Use exactly one evidence state for each analysis item:

- `CONFIRMED`: directly supported by cited evidence.
- `INFERRED`: bounded interpretation of cited evidence; state the inference.
- `MISSING`: required information was not supplied.
- `CONFLICT`: supplied sources disagree; preserve the conflict.
- `NOT_APPLICABLE`: demonstrably outside this project or flow.

Use stable IDs: source `S#`, evidence `E#`, business goal `BG#`, user goal
`UG#`, artifact goal `G#`, journey step `J1`–`J5`, module `M#`, page `P#`,
non-page surface `SF#`, feature `F#`, action `A#`, state `ST#`, risk `R#`, and
question `Q#`. Every `CONFIRMED` or `INFERRED` item cites one or more `S#`;
`CONFLICT` cites the two or more disagreeing `S#`; `MISSING` and
`NOT_APPLICABLE` carry no unsupported refs and state the gap or explicit
boundary. Evidence identity, excerpt digests, and bindings are
server-owned: do not create or alter them.

Keep business goals distinct from user goals/behaviors. A business goal explains
the project outcome; a user goal/behavior describes what a person accomplishes.
Neither is a page, module, feature, or implementation choice.

## Fixed eight steps

1. **Evidence inventory (`evidence_inventory`)** — list authorized materials,
   `S#`/`E#`, usable evidence, gaps, and conflicts. Do not design yet.
2. **Project understanding (`project_understanding`)** — state project context,
   stakeholders, business goals/outcomes, desired user behavior, platform,
   scope, constraints, confirmed decisions, external dependencies, and
   uncertainties with evidence states.
3. **Goals and behaviors (`goals_and_behaviors`)** — create `G#` links with
   `businessGoalId`/`userGoalId` to a business outcome, a user goal/behavior,
   measurement/success signal, `J#`/`M#`, and source refs. Record a solution
   only as a separately labelled hypothesis/current approach; never substitute
   a page, feature, or implementation choice for either goal. Missing
   measurements stay `MISSING`; never fabricate numbers.
4. **User path (`user_path`)** — output exactly `J1`–`J5`: entry, enter,
   participate, result/complete, and next action. Include trigger, user action,
   system feedback, entry/exit condition, `P#`/`SF#`, `G#`, `ST#`, and source
   refs. Unsupported branches remain `MISSING` or `CONFLICT`.
5. **Product map (`product_map`)** — build the hierarchy
   `Product → M# → P#/SF# → F# → A# → ST#`. Each module has a purpose and
   `G#`; each page/surface has a purpose; each feature defines every mapped
   action's trigger/result and every mapped state's meaning. Do not add
   integrations, roles, or technical solutions without evidence.
6. **Pages and features (`pages_and_features`)** — turn the map into bounded
   page/surface and feature records: role, entry, content/action, result,
   navigation, dependencies, normal states, exception states, priority,
   evidence state, and citations. Default limits: 8 modules, 20 pages, 40
   features; merge and record a `Q#` rather than expanding scope.
7. **Independent review (`independent_review`)** — run the server-owned,
   deterministic lint (not a second model pass), record only results and
   evidence, then set `PASS` or `待确认`:
   goal closure; five-step path completeness; module-to-surface hierarchy;
   page purpose/entry/action/exit/state; feature role/trigger/action/result;
   source traceability; scope control; role permissions; normal path; and all
   13 exception paths below. Any failed/missing/conflicting prerequisite makes
   the related check `待确认`.
8. **Final artifact (`final_artifact`)** — assemble the contract-valid JSON
   artifact only. The server renders equivalent Markdown and Mermaid from that
   JSON; keep JSON authoritative, and never add facts in either rendering.

## PM analysis contract

Include `analysisContract` in newly generated artifacts:

- `sources`: source kind, label, evidence state, and `E#` citations.
- `goalLinks`: separate `businessGoalId` and `userGoalId`, the named business
  and user goals, plus a separately labelled solution hypothesis/current
  approach only when supported, evidence state, and `S#` refs.
- `scope`: `inScope`, `outOfScope`, `tbd`, and dependencies.
- `roles`: can-view, can-operate, can-modify, can-confirm, and can-delete.
- `exceptionPaths`: the fixed paths below, trigger, expected handling,
  terminal state, evidence state, and source refs.
- `evidenceCoverage`: counts by all five evidence states and a bounded percent.

Normal path: authorized role enters through `J1`–`J5`, completes the intended
user action, receives the documented result, and has a documented next action.

Record exactly the following thirteen paths as `EX1`–`EX13` (the first is the
normal path; the remaining twelve are exception paths). Use `MISSING` when the
materials do not specify handling, and use `NOT_APPLICABLE` only when the
project explicitly excludes the path:

`happy_path`, `unauthenticated`, `permission_denied`, `empty_data`,
`network_failure`, `api_failure`, `third_party_failure`, `user_cancelled`,
`duplicate_submission`, `timeout`, `already_completed`, `ineligible`,
`return_to_previous_step`.

## Final output rules

The structured JSON must satisfy the registered Product Map artifact schema, including
material inventory, project understanding, goals, five journey steps, product
map, pages, features, risks/questions, quality, citations, exactly eight ordered
step outputs, handoff summary, `analysisContract`, and `structureReview`.
Server-render Markdown with the same ordered sections and Mermaid only from the
validated Product→Module→Page/Surface→Feature hierarchy; neither rendering may
add facts beyond the authoritative JSON.

Set overall quality to `通过` only when every deterministic check passes and
there are no blockers. Use `需确认` for open `Q#`/conflicts and `阻塞` when a
minimum path cannot be determined. The handoff contains only positioning,
minimum path, Must pages/features, blockers, source status, and `Q#`/`R#`.
