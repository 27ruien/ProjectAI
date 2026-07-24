# 日报 AI 合同

## 调用路径

`generateDailyTimesheet` → 现有 Project Assistant Gateway → 固定 Profile `qwen-project-assistant-cn-v1` → 既有 Qwen Adapter。CI 与默认 Local UAT 使用 Fake Provider；真实人工 UAT 只有在服务端明确配置 `UAT_AI_PROVIDER=real`、`AI_PROVIDER=qwen` 和既有 Secret 机制后才使用 Qwen。页面和扩展不能提交 Provider、模型、Secret 或 Prompt。

Local UAT 使用 `UAT_AI_PROVIDER=mock|real` 显式切换。Mock 模式必须显示“当前使用 Mock AI，仅用于功能测试，不代表真实 AI 输出质量”；Real 模式缺少服务端凭据时禁用 AI 整理并显示未配置，不静默回退 Fake Provider。服务端只向浏览器传递模式、Provider、Profile 和“已配置/未配置”布尔值，绝不传递 Secret。Mock 自动化结果与真实 AI 人工质量结果分开记录。

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

顶层只允许 `tasks`、`warnings`、`unresolved_record_ids`。任务只允许：描述、授权项目 ID、正常工时或 null、有明确证据的加班工时或 null、目录分类、目录状态、可空紧急度/进度、来源记录 ID、逐字段置信度与兼容性的审核提示字段。来源未提加班时不能把 0 当成事实；进度只接受明确百分比、完成=100 或未开始=0；受信紧急度候选项未配置前任何非空值都拒绝。未知字段、非法 JSON、越界/合计超过 24 小时、无效目录、非本用户/日期来源、来源遗漏/冲突、跨项目合并和无来源工时都被拒绝。MVP 对 AI 自动合并采取保守策略：一个生成任务只能绑定一条原始随记；需要合并时由用户审核后显式执行。

服务端仍为向后兼容保存 `needs_review`/`review_fields`，字段为空或置信度低于 `PM_DAILY_REPORT_CONFIDENCE_THRESHOLD`（默认 0.85）时形成视觉提示；它们不再是逐条点击或整批确认门禁。用户只需点击一次“确认本次工时”，由前后端统一校验全部必填字段。总工时超过 16 小时时增加 `TOTAL_HOURS` 警告，但不修改模型数值，也不补足八小时。

Fake Provider 的任务描述来自对应随记文本，保留 `sourceRecordIds`、明确工时和明确状态；近似工时继续提示确认，无工时保持空。它不得再生成与输入无关的“虚构项目工作记录 1/2/3”。这只验证确定性流程，不代表真实模型拆解质量。

## Prompt 规则

- 只输出 JSON；只使用输入事实和候选目录。
- 不得把计划、准备、讨论中、对齐中、待确认写成已完成。
- 描述为“动作 + 对象 + 结果或进展”，建议 18–50 个汉字。
- 不同项目、交付物或状态必须分开。
- 工时仅来自明确数值或时间区间；近似值必须要求审核；无依据为 null。
- 不创建项目、分类、状态、会议或来源。

第一次输出未通过 Schema 或事实校验时，只允许一次格式/受控字段修复；第二次失败返回可恢复错误，不保存输出。发生 Repair 时 execution 聚合记录两次调用的 token usage 与 latency，而不是只记录第二次。
