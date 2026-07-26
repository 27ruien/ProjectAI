# 日报与企业微信同步故障排查

| 现象/错误码 | 含义 | 安全处理 |
| --- | --- | --- |
| `TIMESHEET_FEATURE_DISABLED` | 日报 Flag 关闭 | 核对环境与 Migration；不要在 Production 临时开启 |
| `AI_ASSISTANT_DISABLED` / `AI_CONFIGURATION_INVALID` | 服务端 AI 未启用或配置无效 | 随记仍可用；由运维核对 Secret File/受控配置，不把值发到浏览器 |
| `TIMESHEET_GENERATION_IN_PROGRESS` | 同用户/日期已有非 stale execution | 等待；不要并发反复点击 |
| `TIMESHEET_SOURCE_CHANGED` | Provider 调用期间随记变化 | 刷新后重新生成 |
| `TIMESHEET_VERSION_CONFLICT` | 草稿版本过期 | 刷新并重新应用人工修改 |
| `TIMESHEET_REVIEW_REQUIRED` | 字段为空或未完成审核 | 人工填写并标记审核 |
| `TIMESHEET_SYNC_ACTIVE` | 已有活动批次 | 在同步中心继续、暂停或取消原批次 |
| `SYNC_TERMINAL_MISMATCH` | 扩展报告终态与逐项事实不一致 | 保持批次活动/暂停，核对扩展状态，不手工伪造终态 |
| `SYNC_BATCH_TERMINAL` / `SYNC_ITEM_UNKNOWN_REVIEW_REQUIRED` | 迟到消息试图重开终态，或自动恢复 unknown | 保留现状并人工核对；不要修改本地存储或伪造进度 |
| `ANOTHER_BATCH_ACTIVE` | 扩展本地已有活动或暂停批次 | 先完成、核对或取消原批次，避免两个看板流程并发 |
| 扩展未连接 | 未安装、未加载或 URL 不匹配 | 重新加载扩展并刷新 ProjectAI 页面 |
| `BOARD_CONFIGURATION_REQUIRED` | 构建未绑定真实 Origin或 Options 未配置 | 取得精确 URL 后重新构建；不使用宽 Host Permission |
| `LOGIN_REQUIRED` | 企业微信未登录/过期 | 用户手动登录后主动继续；不要导出二维码或 Session |
| `OPTION_NOT_FOUND` / `OPTION_AMBIGUOUS` | 目录不唯一 | 停止并人工核对，不选择第一个近似项 |
| `ELEMENT_TIMEOUT` | Selector 失效或 iframe 未加载 | 视为 DOM 变更，重新走 Selector 审查与 Dry Run |
| `ITEM_SAVE_OUTSIDE_TASK_FORM` / `FINAL_SUBMIT_CONTROL_FORBIDDEN` | 保存 Selector 越出单条表单或命中最终提交语义 | 停止使用该配置，重新审查真实 DOM；不得绕过保护 |
| `ITEM_SAVE_FAILED` | 页面明确保存失败 | 修复原因后由用户继续，saved 项不会重做 |
| `SAVE_RESULT_UNKNOWN` | 无法确认是否保存 | 立即暂停；人工检查企业微信，再在 Popup 二次确认“已保存/未保存”，禁止自动重试 |
| 重启后项目为 unknown | Service Worker 曾在 running 中断 | 这是预期保护；人工核对后使用 Popup unknown 处置入口，不清空幂等记录 |

诊断时只导出 Popup 的脱敏错误日志和 ProjectAI 同步摘要。不得提供完整 DOM、HAR、Cookie、Token、二维码、完整环境变量、Shell History 或真实任务内容。若需报告 Selector 问题，只记录字段名、受控错误码、扩展版本、页面版本和脱敏截图。
