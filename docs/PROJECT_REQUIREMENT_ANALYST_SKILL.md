# Project Requirement Analyst Skill

## Status

`project-requirement-analyst` `0.1.0` is an experimental upstream Skill. It
turns sparse user-supplied project material into a reviewable Requirement
Analysis Pack; it does not persist approved requirements or replace project
authorization.

## Input and boundary

Portable mode accepts only files/text supplied for the current task and carries
no `projectId`. Project-bound mode requires a server-authorized `projectId` and
pre-cut context. The Skill cannot retrieve Project Knowledge, query RAGFlow or
the database, create a Project, or write Requirement, Scope, or Timeline data.

Use this Skill before feasibility research or Timeline planning when the project
description is too sparse or ambiguous to support those decisions.

## Free understanding plus controlled framework

The Agent first understands the actual project instead of matching keywords.
It then assesses eighteen controlled domains:

- Business Goal, User, Scenario, Deliverable, Success Metric, Channel,
  Deadline, and Constraint;
- User Journey, Functional Scope, Identity/Permission, Data, AI Behavior,
  Third-party Integration, Content/Assets, Operations Rules, Test/Launch, and
  Project Dependencies.

Each domain is `COMPLETE`, `PARTIAL`, `MISSING`, `ASSUMED`, or explicitly
`NOT_APPLICABLE`. The framework is a completeness gate and never supplies a
missing answer.

## Evidence model

- `FACT`: explicit source excerpt plus supplied source ID.
- `GAP`: relevant information is absent, ambiguous, or contradictory.
- `ASSUMPTION`: bounded working hypothesis with no source-evidence claim.

Every downstream journey, scope, matrix, dependency, risk, and suggested next
step references a statement with the same basis. All Gaps appear in Missing
Information and receive an equal- or higher-priority Critical Question.

Question priority is decision-based: P0 blocks safe commitment or architecture;
P1 materially changes experience/effort/dependency; P2 improves later
completeness.

## Output

The Markdown renderer produces:

1. Requirement Summary and Evidence Register;
2. User Journey Draft;
3. Functional Scope Draft;
4. Requirement Matrix;
5. Missing Information;
6. Critical Questions;
7. Dependencies;
8. Risks / Unknowns;
9. Initial Scope Boundary;
10. Suggested Next Step.

The output is an analysis draft. Gap- or Assumption-based next steps always
require user confirmation.

## Implementation

- Skill: `skills/project-requirement-analyst/`
- Contracts and renderer: `lib/requirement-analyst/`
- Deterministic Eval: `tests/requirement-analyst.test.ts`
- Portable UAT: `tests/requirement-analyst-cross-agent/`

No UI, Agent Runtime, Workflow, Registry, Extension, MCP, PAT, API, database, or
deployment change is part of this implementation.
