# Production Rollback

## 原则

回滚优先通过 Feature Flag 或旧 immutable App Image 完成，不删除向量、Job、Execution、Citation 或新增表。数据库恢复只在 Schema 不兼容、Migration/数据完整性失败或明确的数据损坏时使用。任何回滚都先冻结写入、记录基线和批准人，再执行最小范围动作。

当前 Production Image 没有 ProjectAI PostgreSQL 数据依赖。兼容演练应把 `DATABASE_URL` 指向隔离的 0007 Schema，同时验证旧页面 200、Restart Count=0、Production 容器/网络/Secret 未接触。这里的兼容含义是旧 Image 可在 0007 数据面存在时继续提供既有功能；不得虚构它读取了当前尚不依赖的数据库。

## 兼容矩阵

| 组合 | 期望 | 回退含义 |
| --- | --- | --- |
| 当前 Production Image + 当前 Schema | 正常 | 当前基线 |
| 当前 Production Image + 0007 隔离 Schema | 必须通过 | 允许 Schema forward + App rollback |
| 新 Image、AI 全关闭 + 0007 | 必须通过 | Phase 2 可回旧 Image |
| 新 Image、Assistant lexical + 0007 | 必须通过 | 先关 Assistant，必要时回旧 Image |
| 新 Image、Embedding enabled + 0007 | 必须通过 | 关 Embedding、停 Worker，保留向量 |
| 新 Image、Shadow + 0007 | 必须通过 | Mode 回 lexical |
| 新 Image、Hybrid + 0007 | 必须通过 | Mode 回 lexical，Query 失败保持 Lexical Fallback |

机器检查使用 `release/rollback-compatibility.json` 和 `npm run release:rollback-check`。任一 required combination 缺少明确 `true` 证据即失败。

## 场景矩阵

| 故障点 | 首选动作 | 何时恢复数据库 |
| --- | --- | --- |
| App 部署后、Migration 前 | 恢复旧 immutable App Image | 不需要 |
| 0004–0007 后、新 App 前 | 保持旧 App 运行并验证 | 旧 App 不兼容或数据/约束异常 |
| 新 App、AI 全关闭 | 恢复旧 Image | 通常不需要 |
| Assistant Lexical | `AI_ASSISTANT_ENABLED=false` | 仅 AI 数据破坏且无法前向修复时 |
| Embedding | `AI_EMBEDDING_ENABLED=false`，停止专用 Worker | 不因回滚删除向量；仅完整性损坏时 |
| Shadow | `AI_ASSISTANT_RETRIEVAL_MODE=lexical` | 不需要 |
| Hybrid | `AI_ASSISTANT_RETRIEVAL_MODE=lexical` | 不需要 |
| PostgreSQL/pgvector 启动失败 | 停止阶段，恢复原隔离验证过的 DB Image/Volume 组合 | 数据目录、Major、Locale 或 Extension 不兼容时 |
| Secret 泄漏 | 立即关闭 AI、撤销/轮换 Secret、保留审计 | 不需要，除非伴随数据事件 |

## RPO 与 RTO

- 当前没有 ProjectAI Production 持久化数据面时，持久业务数据 RPO 为不适用；首次 B3-C2 上线前必须重新定义。
- 建立数据面后，Phase 0 一致性备份时间点是上线事务的 RPO，目标为 0–15 分钟，实际值写入 Manifest/Evidence。
- App/Flag 回滚预计 30–60 分钟，包括基线、重建、Smoke 和观察。
- 需要数据库恢复时预计 60–120 分钟；实际 RTO 由最近 Restore Drill 的数据量和恢复耗时计算。
- 对象恢复 RTO 按 Inventory/Mirror 大小、抽样 Checksum 和数据库对象引用核对结果单独估算。

## 回滚完成条件

旧 Image/Flag 与 Manifest 一致；Health、Restart Count、登录、Session、项目权限、文件、词法检索和跨项目 404 通过；数据库/对象一致性通过；无 active Migration/Job/Execution；Nginx/Compose 未漂移；Secret mount 符合阶段；审计和时间记录完整。

回滚失败、基线继续变化或 Restore Checksum 不一致时停止自动动作并升级为人工事故响应。不得删除 Volume、向量表或最近有效 Backup。
