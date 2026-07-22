# 日报 AI 合同

## 调用路径

`generateDailyTimesheet` → 现有 Project Assistant Gateway → 固定 Profile `qwen-project-assistant-cn-v1` → 既有 Qwen Adapter。CI 仅在 `NODE_ENV=test` 和 `NEXT_PUBLIC_APP_ENV=test` 使用 Fake Provider。页面和扩展不能提交 Provider、模型、Secret 或 Prompt。

Execution 记录 `executionId`、`skillId=pm-daily-timesheet-generation`、`modelProfileId`、Prompt 版本、实际 Provider/模型、latency、token usage、状态、失败码和来源选择 SHA-256。当前 Gateway 没有可信模型价格表时，cost 保留 `null`，不估算。

## 输入

服务端构造严格结构化 JSON：

- `date`、`user_timezone=Asia/Shanghai`；
- 当前用户和日期的 `today_records`；
- `today_meetings: []`（当前没有真实会议来源）；
- 当前授权项目内的未关闭正式 `current_action_plans`；
- ACL 过滤后的 `available_projects`；
- 服务端固定分类和状态目录。

原始随记在 Provider 调用前后计算 digest；调用期间发生变化时拒绝保存并要求重新生成。

## 输出

顶层只允许 `tasks`、`warnings`、`unresolved_record_ids`。任务只允许：描述、授权项目 ID、正常工时或 null、有明确证据的加班工时或 null、目录分类、目录状态、可空紧急度/进度、来源记录 ID、逐字段置信度、审核标记与审核字段。来源未提加班时不能把 0 当成事实；进度只接受明确百分比、完成=100 或未开始=0；受信紧急度候选项未配置前任何非空值都拒绝。未知字段、非法 JSON、越界/合计超过 24 小时、无效目录、非本用户/日期来源、来源遗漏/冲突、跨项目合并和无来源工时都被拒绝。MVP 对 AI 自动合并采取保守策略：一个生成任务只能绑定一条原始随记；需要合并时由用户审核后显式执行。

服务端强制每个 AI 任务 `needs_review=true`。字段为空或置信度低于 `PM_DAILY_REPORT_CONFIDENCE_THRESHOLD`（默认 0.85）时自动加入 `review_fields`。总工时超过 16 小时时增加 `TOTAL_HOURS` 警告，但不修改模型数值，也不补足八小时。

## Prompt 规则

- 只输出 JSON；只使用输入事实和候选目录。
- 不得把计划、准备、讨论中、对齐中、待确认写成已完成。
- 描述为“动作 + 对象 + 结果或进展”，建议 18–50 个汉字。
- 不同项目、交付物或状态必须分开。
- 工时仅来自明确数值或时间区间；近似值必须要求审核；无依据为 null。
- 不创建项目、分类、状态、会议或来源。

第一次输出未通过 Schema 或事实校验时，只允许一次格式/受控字段修复；第二次失败返回可恢复错误，不保存输出。发生 Repair 时 execution 聚合记录两次调用的 token usage 与 latency，而不是只记录第二次。
