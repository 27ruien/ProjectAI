# Weekly Report Cross-Agent UAT

本目录用于人工比较 ChatGPT、Claude、DeepSeek、Qwen 对同一份 Project Weekly Report
Skill 与同一组 synthetic Execution Package 的遵循能力。本轮不执行外部模型。

## 统一执行方法

对每个目标 Agent、每个 Case 都执行相同操作：

1. 新建一个无历史上下文的会话。
2. 只上传该 Case 的 `SKILL.md` 和 `execution-package.json`。
3. 打开 `RUN_INSTRUCTION.txt`，将其完整内容原样粘贴为启动指令。
4. 不提供 Project AI 仓库、其他文件、外部项目知识或额外解释。
5. 保存 Agent 返回的最终 Markdown。
6. 测试结束后，在本地打开 `expected.json`，按语义标准人工判定 PASS / FAIL。

四个 Agent 必须使用完全相同的两个上传文件和完全相同的启动指令。不要添加模型专属
提示词，也不要在失败后通过追问修正第一次结果。

## 文件边界

应该上传：

- `SKILL.md`
- `execution-package.json`

作为 Prompt 粘贴、无需上传：

- `RUN_INSTRUCTION.txt`

绝对不能上传给被测试 Agent：

- `expected.json`

`expected.json` 只供测试人员在 Agent 完成输出后评分；提前上传会泄露答案标准，令结果无效。

## 通用 PASS / FAIL 门禁

每个 Case 都必须满足：

- 只返回最终周报 Markdown，没有分析、说明、JSON 或评分文字；
- 标题日期为 `2026.08.17 - 2026.08.21`；
- 使用规定的六列表格，Project 不重复；
- 只使用 Execution Package 中的事实；
- 不虚构日期、Owner、完成状态、批准、承诺、里程碑或支持请求；
- “需要支持”始终为 `/`；
- 不把 Timeline PLAN 写成 Daily Report ACTUAL；
- 没有明确 PLAN Evidence 时不使用“按计划”；自由推演只能使用“可……”等弱确定性表达；
- 不把彼此独立的事实改写为因果关系；
- 好/不好只评价已有事实，不增加健康度、重要性或阶段就绪判断；
- 第一行直接是标题，且没有前言、结语、Code Fence、分析过程或重复周报；
- 不使用外部项目知识。

任一通用门禁或 Case 专属门禁失败，则该 Agent 的该 Case 判为 FAIL。没有
`PASS WITH CONDITIONS`；人工 UAT 使用二元 PASS / FAIL。

## Case 01 — Normal Aggregation

目录：`tests/weekly-report-cross-agent/case-01-normal/`

测试内容：多日日报聚合、重复信息压缩、低价值流水账过滤。

PASS：

- 只生成一行 Project A；
- 把多日“推进/继续推进/完成需求梳理”合并成真实结果；
- 重复的需求资料确认不重复输出；
- 不输出“参加例会并回复消息”；
- 本周进展不超过 3 个 bullet，不按日期逐日复述。

FAIL：出现 Monday-to-Friday 流水账、保留低价值日常沟通、重复 Project 行，或补充任何
Package 不存在的计划、里程碑、Owner、日期、支持与泛化评价；无明确 PLAN 时使用“按计划”
或强确定性承诺也判 FAIL。

## Case 02 — PLAN vs ACTUAL

目录：`tests/weekly-report-cross-agent/case-02-plan-vs-actual/`

测试内容：Timeline 计划本周完成技术方案，但 Daily Report 明确仍在修改且未完成。

PASS：

- 本周进展明确保留“仍在修改 / 本周未完成”的 ACTUAL；
- 下周可继续该未完成事项，但不能倒写为本周已完成；
- 评价为 `/`，或只用一句有事实依据的计划偏差描述。

FAIL：声称技术方案本周已完成、顺利完成、已批准或已提交；把 Timeline 计划当成完成
证据；虚构日期、Owner、批准或承诺。

## Case 03 — Next Step / Missing Plan

目录：`tests/weekly-report-cross-agent/case-03-next-step/`

测试内容：`timeline.plannedNextWeek` 为空，但 Daily Report 存在两个明确未完成事实。

PASS：

- 下周安排包含继续接口联调；
- 下周安排包含收到客户反馈后继续修改；
- 不新增其他工作流、日期或 Owner；
- 无证据的里程碑和支持均为 `/`。

FAIL：下周安排整体输出 `/`、遗漏任一明确未完成事实、把事项写成已完成，或自行推演新
任务、时间、Owner、批准、客户承诺与里程碑；把等待客户反馈改写为接口联调延期原因也判
FAIL。

## Case 04 — Multi-project

目录：`tests/weekly-report-cross-agent/case-04-multi-project/`

测试内容：Project A / B / C 同包生成时的事实隔离。

PASS：

- 恰好三行，Project A、Project B、Project C 各一行；
- `A_ONLY` 只在 Project A；
- `B_ONLY` 只在 Project B；
- `C_ONLY` 只在 Project C；
- 每行只使用自己的状态和事实。

FAIL：任一 Canary 串入其他 Project、合并或遗漏 Project、创建额外 Project，或跨项目转移
状态、事实、计划与里程碑。

## 建议记录表

| Agent | Case 01 | Case 02 | Case 03 | Case 04 | Notes |
|---|---|---|---|---|---|
| ChatGPT |  |  |  |  |  |
| Claude |  |  |  |  |  |
| DeepSeek |  |  |  |  |  |
| Qwen |  |  |  |  |  |

评分时只依据本文件与各 Case 的 `expected.json`。保留第一次输出作为证据，不执行外部工具
调用，也不要把一次 Agent 输出用于影响另一个 Agent。
