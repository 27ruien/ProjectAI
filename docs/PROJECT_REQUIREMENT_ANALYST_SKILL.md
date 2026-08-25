# Project Requirement Analyst Skill

## Status

`project-requirement-analyst` `0.2.0` is an experimental upstream Skill. It
turns sparse user-supplied project material into a usable Simplified Chinese
Requirement Analysis Pack. It does not persist approved requirements or replace
project authorization.

## Input and boundary

Portable mode accepts only files/text supplied for the current task and carries
no `projectId`. Project-bound mode requires a server-authorized `projectId` and
pre-cut context. The Skill cannot retrieve Project Knowledge, query RAGFlow or
the database, create a Project, or write Requirement, Scope, or Timeline data.

The same Skill is designed to work in a plain ChatGPT, DeepSeek, or Qwen web
conversation. It returns copyable Chinese Markdown and does not require Agent
tools. It does not generate images, Mermaid, or JSON.

## Usable product artifacts

The output now leads with four concrete artifacts:

1. Core business concepts: definitions, key attributes/states, relationships,
   evidence, and notes.
2. User flow: ordered actor, action, outcome, evidence, and notes.
3. Functional Scope: a Markdown table with `序号 | 端 | 功能模块 | 功能说明 |
   范围状态 | 依据 | 备注`.
4. Information Architecture: a minimal Markdown nested list derived from the
   Functional Scope.

A concrete feature not supported by supplied evidence can appear only as an
`ASSUMPTION` with `UNRESOLVED` status. Its notes must say that it is a core-flow
consideration rather than confirmed scope, and a Gap/question must request user
confirmation. Conventional login, analytics, configuration, sharing, payment,
or admin features are never added by default.

## Controlled framework and evidence

After the usable artifacts, the Skill still evaluates all eighteen controlled
domains. Each domain is `COMPLETE`, `PARTIAL`, `MISSING`, `ASSUMED`, or
factually `NOT_APPLICABLE`.

- `FACT`: explicit supplied source excerpt plus source ID.
- `GAP`: absent, ambiguous, or contradictory required information.
- `ASSUMPTION`: bounded discussion hypothesis with no source-evidence claim.

Every downstream concept, flow, scope item, information node, dependency, risk,
and next step references an analysis statement. Gap- or Assumption-based next
steps require user confirmation.

## Output

The Simplified Chinese Markdown renderer produces:

1. 需求摘要
2. 核心业务概念
3. 用户流程
4. 功能范围
5. 信息架构
6. 需求矩阵
7. 分析依据与覆盖检查
8. 待确认信息
9. 关键问题
10. 依赖
11. 风险与未知项
12. 初始范围边界
13. 建议下一步

The first five sections are the usable analysis product. Audit-oriented
evidence and coverage follow them so a user does not have to read a long Gap
inventory before reaching the product output.

## Implementation

- Skill: `skills/project-requirement-analyst/`
- Structured Contract: `projectai-requirement-analysis-pack-v2`
- Contracts and renderer: `lib/requirement-analyst/`
- Deterministic Eval: `tests/requirement-analyst.test.ts`
- Portable UAT: `tests/requirement-analyst-cross-agent/`

This revision changes only the Requirement Analyst Skill and its contract,
renderer, tests, documentation, and official distribution metadata. It does not
change the other three Skills, Project Knowledge, Timeline data, RAGFlow, auth,
database, or Production.
