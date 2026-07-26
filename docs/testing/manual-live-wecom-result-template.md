# 企业微信真实页面 UAT 结果模板

只填写脱敏状态和计数。真实 URL 统一写成
`https://doc.weixin.qq.com/smartsheet/[REDACTED]`，不得粘贴访问参数、Cookie、Token、
二维码、完整页面内容、客户资料或私有 Selector。

| 项目 | 结果 | 脱敏证据/说明 |
| --- | --- | --- |
| 环境 | Local / Staging | Production 禁止 |
| 批准 Origin | PASS / FAIL | 只记录 Origin |
| 用户手动登录 | PASS / FAIL | 不保存认证状态 |
| iframe 层级 | PASS / BLOCKED | 只记录层数与稳定语义 |
| 八字段唯一 DOM 定位 | PASS / BLOCKED | 不记录随机 class |
| Dry Run 字段回读 | PASS / FAIL / BLOCKED | 八字段逐项结果 |
| Dry Run 单条保存点击 | 数字 | 必须为 0 |
| Dry Run 最终提交点击 | 数字 | 必须为 0 |
| 单条保存反馈 | PASS / FAIL / BLOCKED | 反馈 + 列表回读 |
| 刷新后持久化 | PASS / FAIL / BLOCKED | 仅测试任务 |
| 幂等重试重复数 | 数字 / BLOCKED | 必须为 0 |
| 最终提交点击总数 | 数字 | 必须为 0 |
| 测试任务创建数 | 数字 | 只允许 0 或 1 |
| 测试任务删除数 | 数字 | 应等于创建数 |
| 原有记录变化 | 数字 | 必须为 0 |
| 结论 | PASS / FAIL / BLOCKED | BLOCKED 不得写成 PASS |

问题记录至少包含：发生阶段、受控错误码、是否可能已写入、人工核对结论和下一步。
不得附带原始日志或未经脱敏的截图。
