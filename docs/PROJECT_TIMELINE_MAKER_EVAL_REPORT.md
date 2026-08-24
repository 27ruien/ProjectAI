# Project Timeline Maker Eval Report

## Result

**PASS — READY FOR INTERNAL EVAL**

`project-timeline-maker` `0.1.0` passes all eight required deterministic Eval
Cases and both supplemental negative-control tests. The Skill, Contract,
Requirement Framework, Workbench adapter, Markdown renderer, and deterministic
parser were evaluated without an LLM judge or external model call.

## Summary

| Check | Result |
|---|---|
| Core Timeline Maker Cases | 8 / 8 PASS |
| Supplemental parser/schema controls | 2 / 2 PASS |
| Timeline Maker test module | 10 / 10 PASS |
| Repository `npm test` | 54 / 54 PASS (47 unit + 7 rendered/proxy) |
| Typecheck | PASS |
| Lint | PASS |
| `git diff --check` | PASS |
| Formal Skill validation | PASS |
| External Agent / Cross-Agent UAT | NOT RUN |

## Case results

| Case | Result | Deterministic evidence |
|---|---|---|
| TM-01 Basic Project | PASS | Explicit phase, task, owner, status, and dates survive Draft validation, Workbench mapping, and Markdown round trip |
| TM-02 Campaign | PASS | Activity Rules remain `MISSING`; generated gap task has no invented owner/date/rule |
| TM-03 Visual Design | PASS | Brand Guideline, Logo, and Fonts are detected as missing |
| TM-04 Personal Data | PASS | Phone/Email fields are confirmed; Privacy and Consent are missing; no legal or retention conclusion is generated |
| TM-05 Photo/Face | PASS | Consent, sensitive handling, deletion, notice, and provider/location checks use allowed missing/unclear states |
| TM-06 Third-party Integration | PASS | API Documentation and Test Environment become dependency gaps without invented integration values |
| TM-07 Confirmed vs Assumed Dates | PASS | Launch stays `2026-09-30`; inferred design dates remain linked to a Planning Assumption |
| TM-08 Existing Timeline | PASS | Version 3 is accepted only through `propose_timeline_update`; create is rejected |

## Negative controls

- Markdown parsing rejects preamble prose, code fences, invalid date formats,
  invalid Workbench statuses, malformed structure, and unsupported trailing
  content.
- Draft validation rejects an inferred task without an assumption and a
  requirement-gap task without a requirement reference.

## Contract evidence

The adapter maps Draft tasks only to the existing Workbench Snapshot fields:
`id`, `stage`, `name`, `owners`, `status`, `start`, and `end`. Draft provenance
is not added to the persisted Snapshot, database, or API.

Tool Mode and Markdown Mode share the same validated Draft. Capability requests
are limited to create-draft or version-bound proposed-update intents. No direct
save, database operation, RAGFlow access, Knowledge API, Agent Runtime, or Tool
Loop was implemented.

## Limitations

- The automated Cases exercise structured, synthetic fixtures after project
  understanding; they do not evaluate the quality of an external Agent's free
  interpretation of long, messy source documents.
- Feature selection is an Agent responsibility constrained by the Skill and
  catalog. The deterministic requirement helper consumes the selected feature
  set; it is intentionally not a keyword classifier.
- No GPT, Claude, DeepSeek, or Qwen Timeline Maker run was executed.
- No Timeline UI was changed. Paste/import UI integration is deferred because
  the current Slim source does not expose a small existing Workbench import
  surface that can be extended without broad UI work.
- The capability contract is design and validation only; no external Agent
  connector or apply flow exists in this iteration.

## Recommendation

Proceed to internal manual Eval with representative, synthetic project
materials. Cross-Agent UAT should follow only after reviewers confirm that the
Draft/Markdown contract is usable. Do not mark the Skill production-ready or
add an automatic apply path based on this result alone.
