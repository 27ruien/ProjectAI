# Requirement Analysis Pack Contract v0.2

Provider-neutral structured contract: `projectai-requirement-analysis-pack-v2`.
Skill: `project-requirement-analyst@0.2.1`.

## Core structures

- `statements[]`: stable ID, `FACT|GAP|ASSUMPTION`, domain, statement, supplied
  evidence, source IDs, and reason.
- `domainAssessments[]`: exactly one assessment for every controlled domain.
- `requirementSummary`: bounded Chinese summary plus statement references.
- `businessConcepts[]`: order, concept name, definition, key attributes/states,
  relationships, notes, basis, and statement references.
- `userJourneyDraft[]`: ordered actor/action/outcome, notes, basis, and statement
  references.
- `functionalScopeDraft[]`: order, surface, module, description,
  `IN_SCOPE|OUT_OF_SCOPE|DEFERRED|UNRESOLVED`, notes, basis, and statement
  references.
- `informationArchitecture[]`: ordered parent-linked surface/section/page/feature
  nodes with description, notes, basis, and statement references.
- `requirementMatrix[]`: domain, requirement, basis, status, P0/P1/P2, optional
  acceptance signal, and statement references.
- `missingInformation[]` and `criticalQuestions[]`: only resolve visible Gaps.
- `dependencies[]`, `risksUnknowns[]`, `initialScopeBoundary`, and
  `suggestedNextStep`.

A Fact requires a supplied source excerpt and source ID. An Assumption cannot
carry a source excerpt. Every based item must reference at least one statement
with the same basis. Every scope item appears exactly once in its matching
boundary group.

Concrete candidate functionality without supplied evidence must use an
`ASSUMPTION` statement, remain `UNRESOLVED`, reference the corresponding Gap,
and state in notes that it is a core-flow consideration rather than confirmed
scope. Only Fact-based scope may be `IN_SCOPE`, `OUT_OF_SCOPE`, or `DEFERRED`.

Information Architecture nodes must reference existing analysis statements and
must not introduce a module absent from Functional Scope. Unresolved nodes must
be visibly marked for confirmation.

## Markdown

Start with `# 需求分析产出包`. Render the thirteen required Chinese sections in
the order specified by `SKILL.md`.

The following tables are mandatory:

- core business concepts: `序号 | 核心业务概念 | 概念定义 | 关键属性/状态 | 关系 | 依据 | 备注`;
- user flow: `序号 | 角色 | 操作/步骤 | 结果/反馈 | 依据 | 备注`;
- functional scope: `序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注`.

Render Information Architecture as a Markdown nested list. Do not render an
image, Mermaid diagram, JSON block, preamble, or postamble. Keep stable labels
such as:

- `[FACT:F-01][business_goal] ...`
- `[GAP:G-01][success_metric] ...`
- `[ASSUMPTION:A-01][functional_scope] ...`
- `[P0:Q-01] ... — 解决：G-01`

Machine-readable domain names and enum values remain unchanged in the structured
contract. The final Markdown must render their Simplified Chinese display labels
and must not expose English domain names or enum values. Evidence labels,
canonical IDs, versions, and error codes remain unchanged.

Use `/` only for an intentionally empty section. Escape table pipes.

## Runtime boundary

Portable user-supplied input has no `projectId`. Project-bound input requires a
server-authorized `projectId` and pre-cut materials. The Skill Contract neither
retrieves context nor persists the result. It is executable in a plain web AI
conversation without Agent or tool capabilities.
