# Project Requirement Analyst Eval Plan

## Method

The deterministic Eval validates schema invariants, evidence classification,
controlled-domain coverage, priority handling, renderer structure, and portable
pack synchronization. It does not attempt to judge free-form Agent writing with
an LLM judge.

## Core cases

| Case | Scenario | Required behavior |
|---|---|---|
| RA-01 | Vague membership campaign | Preserve sparse facts; raise business goal, metric, rules, and exact-deadline gaps; no invented rules |
| RA-02 | B2B inventory dashboard | Keep user/scenario facts; expose incomplete journey and success metric |
| RA-03 | AI support draft assistant | Preserve draft-only and human-review facts; expose evidence, failure, permission, and retention gaps |
| RA-04 | Partner API integration | Identify documentation, authentication, test environment, owner, and dependency gaps |
| RA-05 | Fixed Web launch | Preserve exact `2026-09-30` deadline and Web-only constraint without expanding platforms |
| RA-06 | Conflicting identity statements | Keep both supplied statements and create an unresolved identity Gap |
| RA-07 | Explicit phase boundary | Preserve in-scope, out-of-scope, and deferred work |
| RA-08 | Provisional channel | Keep planning assumption explicit and require confirmation |
| RA-09 | Product decomposition | Produce core business concepts, user flow, functional-scope table, and text Information Architecture without promoting unsupported candidates to confirmed scope |

## Deterministic gates

- all eighteen controlled domains appear exactly once;
- Facts require evidence and valid source IDs;
- every based item references a matching Fact/Gap/Assumption;
- every Gap appears in Missing Information and a Critical Question;
- matrix status cannot silently convert a Gap or Assumption to confirmed;
- unresolved scope cannot become committed scope;
- Information Architecture must derive from Functional Scope evidence;
- Functional Scope renders `序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注`;
- all thirteen Simplified Chinese Markdown sections are rendered;
- no image or Mermaid output is generated;
- eight portable packs carry the exact current Skill and unified instruction.

External AI behavior is scored manually with each pack's `expected.json`.
That file is not uploaded to the tested AI platform.
