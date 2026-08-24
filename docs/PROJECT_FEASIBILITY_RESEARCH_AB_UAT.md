# Feasibility Research A/B UAT

## Status

`NOT_TESTED`

## Purpose

Compare an ordinary one-general-search answer with the multi-pass Skill without
assuming that the Skill wins. The package is at
`tests/feasibility-research-cross-agent/ab-comparison/`.

## Files

- `input.json`: identical synthetic decision context for both runs.
- `BASELINE_INSTRUCTION.txt`: deliberately permits one general search.
- `SKILL.md` and `MULTI_PASS_INSTRUCTION.txt`: multi-pass treatment.
- `SCORING_RUBRIC.json`: observation-only metrics.
- `STATUS.md`: current unexecuted status.

## Execution control

Run both arms in fresh sessions of the same external Agent with the same live
search capability, date, locale, and time/query budget. Do not show the Skill or
rubric to the baseline arm. Preserve both raw outputs and direct URLs.

## Compare

Record only observed values:

1. required research dimensions covered with Evidence or Unknown;
2. valid first-party sources;
3. materially different alternatives;
4. explicit contradiction searches for core options;
5. blocker/Unknown items with resolution paths;
6. whether contradiction/alternative evidence changed the verdict or
   recommendation.

A conclusion change is not automatically good, and more links do not
automatically mean better research. Human PASS judgment must also reject
fabricated sources, misgraded evidence, hidden blockers, and verdicts issued
before stopping criteria.

No baseline or multi-pass run has been executed in this implementation, so no
winner or improvement claim is recorded.
