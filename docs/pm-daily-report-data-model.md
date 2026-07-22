# 项目经理日报数据模型

Migration：`drizzle/0016_tricky_revanche.sql`。它只新增表、索引、外键、检查约束和作用域触发器，不修改或删除现有列与数据。

## 表

| 表 | 归属与用途 | 关键约束 |
| --- | --- | --- |
| `work_log_records` | 组织 + 用户 + 日期的原始随记 | 项目必须属于同组织；原文 1–4000 字；软删除 |
| `daily_timesheet_drafts` | 每组织/用户/日期唯一日报 | 状态、版本、总工时检查；所有权唯一索引 |
| `timesheet_tasks` | 草稿中的结构化任务 | 草稿外键、可空正式字段、来源记录 ID、人工审核状态 |
| `timesheet_ai_executions` | AI 调用账本 | execution 唯一；来源 SHA-256；每用户/日期仅一个 running |
| `timesheet_sync_batches` | 一次扩展同步 | request 幂等；每草稿仅一个活动批次；创建者与草稿一致 |
| `timesheet_sync_items` | 逐条同步结果 | `sync_batch_id:task_id` 幂等；任务必须属于批次草稿 |

## 数据隔离

应用查询使用 `organization_id + user_id`，资源 ID 仅作附加过滤。`projectai_timesheet_scope_guard()` 在数据库层补充五项跨资源约束：随记项目同组织、任务项目同草稿组织、AI execution owner 同草稿 owner、批次 owner 同草稿 owner、同步项 task 同批次 draft。

管理员不获得新的“查看下属日报”权限。管理员若使用此功能，也只能读写自己的日报；项目列表仍按现有项目授权规则产生。

## 并发与幂等

- 草稿 `version`：编辑、确认和创建同步批次均要求 `expectedVersion`。
- AI：advisory transaction lock + running partial unique index；stale execution 受控失败后恢复。
- 同步：`(organization_id,user_id,request_id)` 唯一；同 request 参数完全一致才返回原批次。
- 活动批次：`draft_id` 部分唯一索引覆盖 pending/validating/waiting/running/paused。
- 同步项：全局 `idempotency_key` 唯一，保存/未知/取消项不能静默回退；终态批次不可重新打开。

## 迁移与回滚

上线前执行：

```bash
npm run timesheets:migration-upgrade
npm run db:migrate
```

应用级回滚首先把两个 Feature Flag 设为 `false` 并回滚应用镜像；新增表可以保留，不影响旧代码。生产或 Staging 不提供自动 `DROP` 回滚，因为那会销毁用户日报与审计数据。如必须移除 Schema，应先完成数据库备份和数据保留审批，再由独立、经审查的向前 Migration 删除；不得使用 schema push/reset。

本地/CI 的升级测试会创建隔离临时数据库，先应用 0000–0015、插入非空旧数据，再应用 0016，核对旧数据、表、触发器和活动批次索引，最后只删除该临时数据库。
