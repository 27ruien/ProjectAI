# Feasibility Research Contracts v0.1

The Skill uses three provider-neutral contracts:

- `projectai-feasibility-research-input-v1`
- `projectai-feasibility-research-plan-v1`
- `projectai-feasibility-research-report-v1`

## Research Plan

The plan contains the Decision Question, exactly ten Research Dimensions,
Claims to Verify, Search Queries, fixed A-E Source Priority, Contradiction
Queries, Alternative Queries, and all six required Stopping Criteria kinds.
Query and Claim IDs are stable and are referenced by execution evidence.

## Final Report

The final report contains the Plan plus six completed protocol passes,
Requirement Interpretation (`FACT|GAP|ASSUMPTION`), at least two options, all
dimension assessments, graded Evidence, per-core-option contradiction checks,
Constraints, Risks, Unknowns, Cost/Effort Range, distinct Recommended and
Alternative approaches, verdict, Stopping Criteria Results, and confirmation
items.

Every final Evidence reference must resolve. Grade A must be first-party;
Grades A-D require publisher and URL; Grade E cannot have a URL or pretend to
be a source. Every core option must have a planned contradiction query. Every
dimension must have Evidence or an explicit Unknown.

`GO` requires at least one A/B decision source and no blocker Unknown.
`CONDITIONAL_GO` requires explicit Unknown conditions. The report schema accepts
only satisfied required Stopping Criteria; incomplete research must stop at a
Plan with `NOT_TESTED` or `BLOCKED`, not a partial final report.

## Markdown

Start with `# Project Feasibility Research`. Include the Plan and protocol log,
then the fourteen required final sections in `SKILL.md` order. Evidence uses
stable `[E-*]` references, direct links, source grades, dates, findings, and
limitations. Do not wrap the report in a code fence or add an unsupported
summary outside the contract.
