# Project Timeline Maker Eval Plan

## Objective

Evaluate whether `project-timeline-maker` can preserve supplied facts, expose
required gaps, keep assumptions explicit, and produce a valid Structured
Timeline Draft for the current Workbench contract.

This Eval is contract-based. It does not require task names or planning choices
to be word-for-word identical across Agents, and it does not use an LLM judge.
Every automated assertion is deterministic.

## Global PASS rules

Each Case must satisfy its stated must-have facts and requirements and must not
contain any forbidden fact. Across all Cases:

- confirmed dates, tasks, dependencies, and owners are preserved;
- no requirement answer, date, owner, deadline, milestone, or legal conclusion
  is fabricated;
- every requirement uses an allowed status;
- every gap task references a real requirement;
- every inferred task references a declared planning assumption;
- the Draft validates against the current contract;
- rendered Markdown parses back to the same Draft;
- the parsed Draft maps to the current Workbench Snapshot fields;
- an existing Timeline can only produce a version-bound proposal.

## Core cases

| ID | Scenario | Required assertions | Forbidden assertions |
|---|---|---|---|
| TM-01 | Basic Project with explicit phase, task, owner, and dates | Exact fact preservation; valid Workbench mapping; Markdown round trip | Moving dates or renaming the supplied owner |
| TM-02 | Campaign with dates but no activity rules | `activity-rules=MISSING`; gap task with empty owner/date | Invented participation, probability, reward, or coupon rules |
| TM-03 | Visual Design without brand guideline, logo, or fonts | All three inputs are `MISSING` | Invented brand assets or style values |
| TM-04 | Personal data collection for phone and email | Data fields confirmed; privacy and consent checks triggered | Legal-compliance conclusion or invented retention period |
| TM-05 | Photo/face upload | Sensitive-data requirements triggered; missing/unclear preserved | Invented consent, provider, location, or deletion policy |
| TM-06 | Third-party API integration without docs/test environment | API Docs and Test Environment gaps; prerequisite task | Invented endpoint, credential, owner, or environment |
| TM-07 | Launch fixed at 2026-09-30; other dates not confirmed | Launch unchanged; planned dates labeled `inferred` and linked to assumption | Moving Launch or presenting inferred dates as confirmed |
| TM-08 | Project already has Timeline version 3 | `propose_update`; reviewed version 3; create capability rejected | Silent create/overwrite or versionless update |

## Supplemental contract tests

- Reject prose before the Markdown contract, code fences, invalid date formats,
  and invalid Workbench statuses.
- Reject an inferred task without an assumption and a requirement-gap task
  without a requirement reference.
- Validate both Skill assets with the repository's formal Skill validator.

## Execution

The automated implementation is in `tests/timeline-maker.test.ts`. The eight
named TM Cases are the acceptance denominator. Supplemental parser and schema
negative controls are reported separately and do not inflate the `x / 8`
result.

An internal release candidate requires 8 / 8 core Cases, all supplemental
controls, repository `npm test`, typecheck, lint, and `git diff --check` to pass.
Cross-Agent UAT is a later step and is not claimed by this plan.
