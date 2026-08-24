# Project Weekly Report Skill Eval Plan

## 目标

验证当前 Project Weekly Report Skill、Daily Report、Project Match、Structured
Timeline、受控 Project Capability 和 Execution Package 是否足够稳定，可进入真实员工使用阶段。

本轮只建设和执行 Eval，不扩 Timeline Workbench，不开发 Extension、Skills UI、Agent
Runtime、Workflow 或 Registry，不修改 Production。

## Contract 审计

现有 `WeeklyReportExecutionPackage` 已能表达用户要求的逻辑边界，不创建重复类型：

| 逻辑边界 | 当前真实字段 |
|---|---|
| meta | `schemaVersion`、`executionId`、`generatedAt`、`currentDate`、`reportingPeriod`、`skill`、`source`、`output` |
| project | `projects[].project` |
| actual | `projects[].dailyReport.facts` |
| plan | `projects[].timeline` |
| supportingEvidence | `projects[].knowledge.evidence` |
| constraints | 嵌入的 `skill`、`matches`、`contextWarnings` 和固定 Markdown Contract |

`dailyReport` 保持 ACTUAL，`timeline` 保持 PLAN，`knowledge` 只包含 Project AI
已经按授权范围裁剪的 supporting evidence。Timeline 派生字段不持久化。

## Eval 方法

不做 Golden Markdown 逐字匹配。每个 Case 声明：

- Input Fixtures
- Expected Facts
- Forbidden Claims
- Required Sections
- Optional Claims
- Evaluation Notes
- 日期 allow-list
- 禁止 Capability
- 多项目 Canary（适用时）

Evaluator 检查：

- 固定六列表格和周窗口；
- 每个 Project 恰好一行；
- Expected Fact 的同义词组是否出现在正确 Project、正确列；
- PLAN 是否被写成 ACTUAL；
- 虚构完成状态、日期、Milestone、Owner；
- 下周安排证据优先级；
- 好/不好是否有明确事实；
- `需要支持` 是否固定为 `/`；
- 是否按日流水账；
- 是否请求通用 Knowledge/RAGFlow Capability；
- 多项目 Canary 是否串入其他 Project。

## Cases

| Case | 重点 | 门禁 |
|---|---|---|
| WR-EVAL-01 | 多日日报聚合 | 1–3 条真实进展，无逐日流水账 |
| WR-EVAL-02 | PLAN / ACTUAL 冲突 | 未完成计划不得写成完成 |
| WR-EVAL-03 | 跨周和月边界 | 同一任务在相关窗口出现 |
| WR-EVAL-04 | 明确 plannedNextWeek | Timeline 优先，顺序正确 |
| WR-EVAL-05 | 无 plannedNextWeek | 从明确未完成 ACTUAL 提取，不乱猜 |
| WR-EVAL-06 | Current Milestone | 名称和日期原样保留 |
| WR-EVAL-07 | Future Milestone | 使用真实未来节点，普通远期任务被裁剪 |
| WR-EVAL-08 | Alias Match | 四个 Alias 落入同一正式 Project |
| WR-EVAL-09 | Ambiguous Match | 未确认前不得 finalization |
| WR-EVAL-10 | 中性事实 | 好/不好为 `/`，无套话 |
| WR-EVAL-10B | 明确延期事实 | 允许一句客观、克制评价 |
| WR-EVAL-MULTI | 多项目组合 | A/B/C Canary 不串事实 |

## Capability Boundary

外部 Agent 只能消费 Execution Package，不得调用：

- `search_project_knowledge`
- `get_project_documents`
- `list_project_documents`
- `retrieve_ragflow_chunks`
- `query_ragflow`

Agent Run 记录必须包含 `capabilityRequests`。任何命中立即 FAIL。

## 执行命令

```bash
NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  tests/weekly-report-eval/weekly-report-eval.test.ts

NODE_ENV=test node --import tsx tests/weekly-report-eval/run-eval.ts

npm run test:unit
npm run typecheck
npm run lint
git diff --check
```

第一条验证 Eval 框架、参考输出、负向控制和核心 deterministic logic。第二条是正式
readiness gate，发现真实 blocker 时应非零退出。

## Go / No-Go

进入真实员工使用前必须同时满足：

1. 全部 reference / candidate Agent Case 通过；
2. 负向控制能稳定检出错误；
3. Timeline 当前、历史和未来窗口重算通过；
4. Alias 与 ambiguous Match 均符合 deterministic Contract；
5. ambiguous 项目在用户确认前无法生成 final Execution Package；
6. 无 Project Capability 越权；
7. 多项目无 Canary 串流；
8. 现有 unit、typecheck、lint 和 diff-check 通过。

任一事实隔离、PLAN/ACTUAL、日期/Milestone、权限或 finalization 门禁失败，结论为
NO-GO。
