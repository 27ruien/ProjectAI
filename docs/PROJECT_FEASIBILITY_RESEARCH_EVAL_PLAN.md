# Project Feasibility Research Eval Plan

## Method

Deterministic tests validate the Plan/Report contracts, protocol order, source
grading, option counter-searches, alternatives, blocker/verdict rules, Markdown
sections, Requirement Analysis Pack input, UAT synchronization, and A/B rubric.
They do not grade external search quality or use an LLM judge.

## Core cases

| Case | Scenario | Required behavior |
|---|---|---|
| FR-01 | In-store browser experience | Ten-dimension Plan, platform primary-source search, counter-search, different alternative |
| FR-02 | Browser vs native vs reduced offline approach | Technical/platform evidence, fleet blocker, failure-mode research |
| FR-03 | Build vs vendor | Vendor/market, official terms/pricing attempt, build and buy contradictions |
| FR-04 | Photo/face data flow | Official data/compliance evidence, no invented legal conclusion, non-photo alternative |
| FR-05 | Embedded mobile browser | First-party platform limits, policy/version Unknowns, external/native alternative |
| FR-06 | 500-SKU 3D production | Asset throughput, quality/rework, cost, and reduced-SKU alternative |
| FR-07 | Eight-week launch with no quote/capacity | Delivery dependencies, sourced/assumed/Unknown cost, no invented estimate |
| FR-08 | Requirement Analysis Pack input | Preserve upstream Fact/Gap/Assumption and avoid silent gap resolution |

## Contract gates

- all ten dimensions, all six passes, A–E source priority, and all six stopping
  gates are present;
- every CORE claim has a primary-source query;
- every core option has an executed contradiction query;
- recommended and alternative approaches differ;
- all Evidence and Unknown references resolve;
- A Primary is actually first-party; E Inference cannot carry a URL;
- blocker Unknowns are included in the next confirmation list;
- GO is rejected with blockers or without A/B evidence;
- no report can omit or falsify Stopping Criteria Results.

External search and model behavior are evaluated manually with the portable
packs and A/B runbook.
