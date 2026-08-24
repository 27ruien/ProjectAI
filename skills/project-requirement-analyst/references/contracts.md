# Requirement Analysis Pack Contract v0.1

The provider-neutral structured contract is
`projectai-requirement-analysis-pack-v1`, Skill
`project-requirement-analyst@0.1.0`.

## Core structures

- `statements[]`: stable ID, `FACT|GAP|ASSUMPTION`, domain, statement, source
  evidence, source IDs, and reason.
- `domainAssessments[]`: exactly one assessment for every controlled domain.
- `requirementSummary`: bounded summary plus statement references.
- `userJourneyDraft[]`: ordered actor/action/outcome with basis references.
- `functionalScopeDraft[]`: `IN_SCOPE|OUT_OF_SCOPE|DEFERRED|UNRESOLVED`.
- `requirementMatrix[]`: domain, requirement, basis, status, P0/P1/P2, optional
  acceptance signal, and statement references.
- `missingInformation[]` and `criticalQuestions[]`: only Gap references.
- `dependencies[]`, `risksUnknowns[]`, `initialScopeBoundary`, and
  `suggestedNextStep`.

A Fact requires a supplied source excerpt and source ID. An Assumption cannot
carry a source excerpt. Every based item must reference a statement of the same
basis. Every scope item appears exactly once in its matching boundary group.

## Markdown

Start with `# Requirement Analysis Pack`. Render the ten required sections in
the order specified by `SKILL.md`. Use stable labels such as:

- `[FACT:F-01][business_goal] ...`
- `[GAP:G-01][success_metric] ...`
- `[ASSUMPTION:A-01][channel] ...`
- `[P0:Q-01] ... — Resolves: G-01`

Use `/` for an intentionally empty list. Escape table pipes. Do not put the
Pack in a code fence and do not add a preamble or postamble.

## Runtime boundary

Portable user-supplied input has no `projectId`. Project-bound input requires a
server-authorized `projectId` and pre-cut materials. The Skill Contract neither
retrieves context nor persists the result.
