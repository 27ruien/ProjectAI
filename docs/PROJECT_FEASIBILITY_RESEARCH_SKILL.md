# Project Feasibility Research Skill

## Status

`project-feasibility-research` `0.1.0` is an experimental research Skill for
evidence-backed project decisions. It accepts a Requirement Analysis Pack or
standalone supplied context.

## Problem addressed

A single broad search often overweights the first plausible solution, misses
platform/data/content/delivery constraints, and produces a verdict before
counter-evidence or alternatives are examined. This Skill makes the research
route observable and gates the verdict.

## Research Plan

Before searching, the Agent defines:

- Decision Question;
- ten Research Dimensions;
- Claims to Verify;
- breadth, primary-source, and deep-dive queries;
- A–E Source Priority;
- Contradiction and Alternative queries;
- six required Stopping Criteria.

The required dimensions are Product/Experience, Technical, Vendor/Market,
Platform Constraints, Data/Compliance, Content/Asset Production, Cost,
Delivery, Risks/Failure Modes, and Alternatives.

## Fixed protocol

Research executes in this order:

```text
Breadth Scan
-> Primary Source Verification
-> Contradiction Search
-> Alternative Search
-> Critical Unknown Deep Dive
-> Synthesis
```

Every core option must have a planned and executed counter-search. At least one
materially different alternative must be assessed. Synthesis cannot disguise a
new search pass.

## Evidence and verdict

Sources are graded A Primary, B Authoritative Secondary, C Market, D Community,
or E Inference. Grades A-D require direct URLs, publisher, access date, finding,
and limitations. Grade E has no external URL.

The final report assesses all dimensions with Evidence or an explicit Unknown.
`GO` requires A/B decision evidence and no blocker. `CONDITIONAL_GO` requires
explicit Unknown conditions. Numeric cost is allowed only with Evidence or a
visible Assumption; otherwise cost remains `UNKNOWN`.

If search is unavailable, the Skill stops with a Research Plan and
`RESEARCH_STATUS: NOT_TESTED`/`BLOCKED`; it cannot fabricate a final report.

## Implementation

- Skill: `skills/project-feasibility-research/`
- Contracts, renderer, and A/B observation comparator:
  `lib/feasibility-research/`
- Deterministic Eval: `tests/feasibility-research.test.ts`
- Portable UAT and A/B packs: `tests/feasibility-research-cross-agent/`

No search provider, model, Agent Runtime, Workflow, Registry, UI, Extension,
MCP, PAT, purchase flow, Project write, or deployment is added.
