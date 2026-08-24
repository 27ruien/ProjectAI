# Project Weekly Report Skill v1.2 Changelog

## Status

Version `1.2.0` is implemented and passes the existing semantic, matching,
PLAN/ACTUAL, Timeline, package, and repository regression suites. It is ready
for Cross-Agent re-test.

## Why this version exists

The prior Cross-Agent UAT used the same `SKILL.md`, execution package, and run
instruction with GPT, DeepSeek, and Qwen. According to the supplied UAT
evidence, all three Agents preserved the core architecture:

- Daily Report remained ACTUAL and Timeline remained PLAN;
- no Project fact leakage was observed;
- no owner or milestone date was fabricated;
- no Timeline plan was reported as completed actual work.

The UAT did expose two instruction-consistency gaps: bounded inference was not
always worded as an inference, and some Agents emitted analysis or repeated the
report around the final answer. It also showed that Good/Bad wording needed a
stricter evidence boundary.

## Changes

### WR-XAGENT-01 — inference language

- Preserved the existing Next Step priority: explicit Timeline plan, unfinished
  Daily Report fact, explicit Knowledge next step, then bounded inference.
- Defined separate wording rules for factual plans, unfinished actual work, and
  bounded inference.
- Restricted `按计划` to packages containing an explicit plan.
- Required weak language such as `可推进` or `下一步可考虑` for bounded
  inference.
- Prohibited adding a causal relation by combining two unrelated facts.

### Good/Bad evidence boundary

- Required every evaluation to point directly to supplied evidence.
- Kept the existing rule that clear forward movement may be `好` and an
  explicit PLAN/ACTUAL deviation may be `不好`.
- Prohibited new claims about project health, readiness, importance, smooth
  progress, schedule status, or causality.

### WR-XAGENT-02 — final-only output

- Required the title on the first line.
- Required exactly one six-column weekly-report table after the title.
- Prohibited preambles, postambles, reasoning, package summaries, code fences,
  completion notices, and duplicate reports.
- Kept the existing table header and Project cell contract unchanged.

### Portable fixtures and checks

- Refreshed the four existing Cross-Agent packs to the exact `1.2.0` Skill
  asset without changing their execution-package facts.
- Added deterministic checks for banned inference wording, unsupported causal
  relations, unsupported `按计划`, preamble/postamble, code fences, and duplicate
  reports.
- Added synchronization checks that every portable pack carries the current
  Skill and the same run instruction.
- No LLM judge is used.

## Deliberately unchanged

This version does not change the Daily Report parser, Project matcher, match
confirmation gate, Timeline provider or rules, Execution Package schema or
business facts, Knowledge retrieval, database, API, or UI. It does not add an
Agent Runtime, model call, or deployment behavior.

## Verification

| Check | Result |
|---|---|
| Formal semantic reference cases | 12 / 12 PASS |
| Weekly Report Eval suite | 35 / 35 PASS |
| Cross-Agent pack synchronization | 4 / 4 PASS |
| Repository `npm test` | 54 / 54 PASS |
| Typecheck | PASS |
| Lint | PASS |
| Skill asset validation | PASS |

The deterministic evaluator can score only the supplied/reference output and
explicit negative controls. It does not prove that a future external Agent will
follow the Skill. GPT, DeepSeek, and Qwen were not rerun automatically in this
iteration; the four portable packs remain the manual Cross-Agent re-test path.
