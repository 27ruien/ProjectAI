# Weekly Report Eval Issues

## Functional Issues

### WR-EVAL-DEF-001 — Ambiguous Project 缺少 Execution Package Finalization Gate

- Severity: S2 High
- Module: Project Match → Weekly Report Execution Package
- Source Case: WR-EVAL-09
- Environment: `/Users/ryan/Documents/ProjectAI-Focused-MVP`, branch
  `refactor/project-ai-slim`
- Status: **RESOLVED**
- Retest Status: **PASS / resolved 2026-08-21**

### Root Cause

Matcher 正确返回 `needs_confirmation`，但 builder 只把 `matched` 项建立 Project 映射，随后
把歧义项当作普通 unmatched item 继续 finalization。Match 与 Alias/Context/package 之间缺少
硬门禁。

### Fix

1. 增加 `needs_confirmation | finalized` 的最小 discriminated Service result；
2. 在 Match 完整确定后、Alias 写入和所有 Project Context 之前执行 gate；
3. 确认分支不返回 Execution Package、output、Timeline Context 或 Knowledge Evidence；
4. 确认分支记录 `weekly_report_match_confirmation_required / denied`，不记录
   `weekly_report_context_built / succeeded`；
5. 保留现有 `matchOverrides`，并继续以当前用户 authorized project set 验证 override。

### Regression Test

- 12 / 12 semantic cases PASS；
- 12 / 12 Codex reference outputs PASS；
- Eval suite 28 / 28 PASS；
- full `npm test` 44 / 44 PASS；
- typecheck、lint、`git diff --check`、readiness command 全部 PASS；
- Case 01/02/08/09、Multi-project isolation、Structured Timeline priority、Knowledge
  boundary、Unauthorized Project Timeline 均通过。

### Confirmation Flow Test

真实 Service + 隔离 PostgreSQL 集成测试为 1 / 1 PASS：首次歧义输入返回确认 payload，且
Alias、Timeline、Knowledge、final package、output、final success Audit 全部被阻止；以已授权
Project ID 显式确认后，同一 pipeline 正常返回 finalized Execution Package。

### Authorization Test

用户仅授权 Project A 时，`matchOverrides` 指向未授权 Project B 会返回防枚举语义
`404 / PROJECT_NOT_FOUND`。确认流程没有引入项目授权绕过。

## Design Consistency Issues

Not applicable。本轮没有 UI 或设计稿范围，也没有修改 Timeline Workbench。

## Prior Result Corrections

此前 Matcher 单元测试只能证明 matcher 进入 `needs_confirmation`，不能证明 finalization 已被
阻止。本次通过 Service control-flow、HTTP contract 和真实数据库集成测试分别验证两层语义；
WR-EVAL-09 现已从 OPEN / S2 High 更新为 RESOLVED。
