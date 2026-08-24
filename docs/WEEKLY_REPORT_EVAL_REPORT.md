# Project Weekly Report Skill Eval Report

## 结论

**READINESS: PASS — READY FOR CROSS-AGENT UAT**

WR-EVAL-09 已解决。Project Match 只要包含 `needs_confirmation`，Service 就会在
Alias 写入、Project Context 分组、Timeline、Knowledge、最终 Execution Package 和最终
成功 Audit 之前硬停止。返回值以 `status` 明确区分 `needs_confirmation` 与
`finalized`，不使用带 nullable output 的模糊成功对象。

## 汇总

| 项目 | 结果 |
|---|---|
| Formal semantic cases | 12 PASS / 0 FAIL |
| Codex reference Agent | 12 PASS / 0 FAIL |
| Eval suite | 28 PASS / 0 FAIL |
| Service gate DB integration | 1 PASS / 0 FAIL |
| Existing full `npm test` | 44 PASS / 0 FAIL（37 unit + 7 rendered/proxy） |
| Typecheck / Lint / Diff check | PASS / PASS / PASS |
| Current product readiness | 12 PASS / 0 FAIL |
| Blocking defect | 0 open；1 resolved |
| Production / Staging | 未连接、未部署、未修改 |

## Case Results

| Case | 状态 | 证据 |
|---|---|---|
| WR-EVAL-01 多日日报聚合 | PASS | 连续工作合并，重复/日常信息不占行，最多 3 条 |
| WR-EVAL-02 PLAN / ACTUAL | PASS | reference 输出保留“尚未完成”；负向样本被检出 |
| WR-EVAL-03 跨周任务 | PASS | 8/30–9/2 任务同时出现在本周与下周窗口 |
| WR-EVAL-04 plannedNextWeek | PASS | UAT → 客户评审 → 技术修复按 Timeline 顺序 |
| WR-EVAL-05 未完成事项 fallback | PASS | Timeline 为空时使用显式 Daily unfinished |
| WR-EVAL-06 Current Milestone | PASS | `UAT Complete / 2026-08-21` 原样保留 |
| WR-EVAL-07 Future Milestone | PASS | `Launch Review / 2026-09-15`；普通远期 task 不泄露 |
| WR-EVAL-08 Alias Match | PASS | CHAGEE、CHAGEE VF、茶姬、Valley Fair 均落到正式名称 |
| WR-EVAL-09 Ambiguous Match | **PASS** | 非最终确认 payload；无 package/output/final success Audit；确认后完成 |
| WR-EVAL-10 中性评价 | PASS | 好/不好为 `/`；套话负向样本被检出 |
| WR-EVAL-10B 明确延期 | PASS | 只输出一句客观延期评价 |
| WR-EVAL-MULTI | PASS | Project A/B/C Canary 无跨项目串流 |

## WR-EVAL-09 Resolution

### Root Cause

`buildWeeklyReportExecutionPackage()` 把非 `matched` 项放入 `unmatchedItems`，但没有把
`needs_confirmation` 作为 finalization gate。因此 matcher 虽然正确给出确认状态，builder
仍会继续构建 Context、写 `weekly_report_context_built / succeeded` 并返回带 output 的
最终 package。

### Fix

- 新增最小 discriminated result：`needs_confirmation` 或 `finalized`；
- 在完整 Match 结果产生后立即检查 unresolved matches；
- gate 位于 `saveConfirmedAliases`、分组、Timeline、Knowledge 和最终 package 之前；
- 确认分支只返回 `confirmationRequired` 与现有 `ProjectMatch[]` 所需信息；
- 确认分支写 `weekly_report_match_confirmation_required / denied`，不写最终成功 Audit；
- 已有 `matchOverrides` 继续用于显式确认，且仍通过当前用户 authorized projects 校验。

### Regression Test

Eval suite 验证 payload 最小化、source control-flow 顺序、HTTP discriminated contract、
非最终 Audit、authorized override 和 unauthorized override。原有聚合、PLAN/ACTUAL、Alias、
多项目隔离、Structured Timeline priority、Knowledge boundary 与未授权 Timeline 回归均通过。

### Confirmation Flow Test

在临时、隔离、完成 Migration 的 PostgreSQL 17 + pgvector 数据库中调用真实 Service：

1. 歧义项目返回 `needs_confirmation`；
2. `executionPackage` 不存在，Alias/Timeline/Knowledge 均未执行；
3. 只产生 confirmation-required 非最终 Audit；
4. 使用已授权 Project 的 `matchOverrides` 重试，返回 `finalized` package；
5. Timeline 与最终成功 Audit 只在确认后产生。

结果：1 / 1 PASS。临时数据库容器和 tmpfs 数据已删除。

### Authorization Test

测试用户只授权 Project A；手工 override 到未授权 Project B 时，Service 返回当前防枚举语义
`404 / PROJECT_NOT_FOUND`，未形成最终 package。

## Execution Evidence

```text
Semantic cases: 12/12 PASS
Codex reference cases: 12/12 PASS
Weekly Report Eval suite: 28/28 PASS
Service gate DB integration: 1/1 PASS
Existing full npm test: 44/44 PASS (37 unit + 7 rendered/proxy)
Typecheck: PASS
Lint: PASS
git diff --check: PASS
Readiness gate: PASS
Finding count: 0
```

正式 readiness 命令
`NODE_ENV=test node --import tsx tests/weekly-report-eval/run-eval.ts` 返回 0，并报告
`readiness: PASS`。

## Contract Audit

Execution Package 内容结构未重构。仅在 Service/API 结果外层加入最终态区分：

- `needs_confirmation`：仅含 `confirmationRequired` 与 `unresolvedMatches`；
- `finalized`：包含原有 `executionPackage`；
- HTTP confirmation 返回 200，finalized 保持 201；
- 不包含 nullable output，也不会在 confirmation 分支泄露最终 Context。

## Coverage Gaps

- 本轮 reference Agent 为 Codex；Claude、Qwen、Gemini、DeepSeek 尚未运行同一套 Case。
- 未连接 Staging/Production，也未使用真实员工日报；fixture 全部为虚构数据。
- Service 真实数据库路径已覆盖；HTTP route contract 已测试，但未执行浏览器会话 E2E。

## Recommendation

WR-EVAL-09 已不再阻塞，可进入 Cross-Agent UAT。该结论不等于 Production 发布批准；本轮
没有 commit、push 或 deploy，也没有扩展 Timeline、Matcher、Knowledge、Skill、UI 或 Agent。
