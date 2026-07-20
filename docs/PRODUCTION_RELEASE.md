# Production Release Readiness

## 状态与边界

B3-C1 只建立 Production 上线所需的只读盘点、差异报告、Release Manifest、隔离演练、回滚合同和 Go/No-Go 门禁。本阶段不得部署、迁移、重启、修改 Compose/Nginx、创建 Qwen Secret、增加 Worker 或启用任何 Production AI。所有 release 命令默认 dry-run，任何 `--environment=production --apply` 都必须由代码返回 `PRODUCTION_APPLY_NOT_AUTHORIZED`。

正式执行属于后续独立的 B3-C2 Production Rollout，必须基于已合并 main 的新完整 SHA 和对应 immutable image，而不是历史 Feature Branch SHA。

## 权威输入

每次发布都重新读取 Git、GitHub、CI、Production 和 Staging 实际状态，不依赖聊天记录或 tracked 文档中的动态值。动态 Container ID、Image ID、CI Run、Backup ID 和 Evidence Digest 只进入未跟踪 Release Artifact、CI Artifact 或 PR 描述。

发布操作必须锁定：

- 完整 `sourceMainSha` 与 `releaseCandidateSha`；
- Release App 与 db-tools Image SHA-256；
- Node 22 具体版本、Build 时间和 Base Image Digest；
- 当前 Production Container/Image/StartedAt/Restart Count；
- Compose 与 Nginx Hash；
- 当前与目标 Migration、PostgreSQL/pgvector 与 MinIO Image；
- Evidence、Backup 和 Rollback Digest。

## Readiness 命令

以下命令均从仓库根目录运行，输出写入已忽略的 `release-artifacts/` 或 `review-artifacts/`：

```bash
npm run release:inventory -- --environment=production
npm run release:inventory -- --environment=staging
npm run release:diff -- --production-inventory=<sanitized-json> --staging-inventory=<sanitized-json>
npm run release:manifest -- --input=<manifest-input-json>
npm run release:preflight -- --manifest=<manifest-json> --production-baseline=<initial-production-inventory> --production-inventory=<fresh-production-inventory> --ci-run-id=<github-actions-run-id>
npm run release:backup -- --environment=production --expected-sha=<full-sha> --expected-image=<sha256> --inventory=<sanitized-json>
npm run release:rollback-check -- --matrix=release/rollback-compatibility.json --rehearsal=<sanitized-json>
npm run release:go-no-go -- --manifest=<manifest-json> --production-baseline=<initial-production-inventory> --production-inventory=<fresh-production-inventory> --staging-inventory=<staging-inventory> --diff=<diff-report> --preflight=<preflight-report> --rehearsal=<rehearsal-report> --restore-drill=<restore-report> --smoke=<smoke-report> --rollback-check=<rollback-report> --disabled-image=<disabled-image-report> --old-app=<old-app-report> --backup=<backup-report> --ci-evidence=<ci-evidence-report>
```

Tracked 文件只保存 Schema、Contract 和明确标记为 synthetic 的虚构 fixture。Release Artifact 禁止包含 Secret、完整 Env、Cookie、Session Token、数据库密码、Bucket Name、对象 Key、客户内容、完整 Prompt/问题、Query/Document Vector 或 Provider Payload。

`release:preflight` 不接受工作树、CI、Image、服务器时钟或 Manifest/服务器匹配的手写布尔值。它自行读取 Git、GitHub Actions、Docker Image Label/Digest、Production Inventory 时间和 Digest 锁定的 Production Baseline。测试命令 Adapter 仅在 `NODE_ENV=test` 可用。

Migration Lock 使用 `release/migration-lock-contract.json` 的版本化文件路径和固定 PostgreSQL Advisory Key。数据库不存在时 Advisory 明确为 `not-applicable`；数据库存在时只接受 `clear`，`held` 与 `unknown` 都是 NO-GO。MinIO Inventory 从目标 App 的受控 Bucket 配置定位数据目录，只公开 Bucket Hash 与实际 Bucket/Object/Byte Count；缺失 Bucket、权限或统计失败不得伪装为零。

## B3-C2 分阶段计划

任何阶段只能在上一阶段成功、观察窗口完成、批准人签字且基线未漂移后进入。每次切换都重新记录时间、操作者、目标 SHA/Image、验证结果和回退点。

| 阶段 | 进入条件 | 执行范围 | 成功标准 | 停止/回退 | 最小观察 |
| --- | --- | --- | --- | --- | --- |
| Phase 0 冻结与备份 | Manifest/CI/Evidence 锁定，磁盘、inode、Nginx、Compose、锁与活动任务门禁通过 | 获取部署锁；PostgreSQL logical backup；MinIO immutable inventory/必要 mirror；配置脱敏备份 | Checksum、可恢复性检查、Inventory 和基线一致 | 任一备份或空间门禁失败即停止，不修改服务 | 完成全部校验 |
| Phase 1 基础设施与 Schema | Restore/Migration/旧 App 兼容演练通过 | 如有必要切换固定 Digest 的 pgvector PostgreSQL 17；执行 0004–0007 | DB Healthy，vector 0.8.1，旧数据/关系保留，旧 App 兼容，无等待锁 | 旧 App 不兼容、Major/Locale/权限异常时恢复备份 | 15 分钟 |
| Phase 2 新 App 全关闭 | Phase 1 成功，Release Image Digest 未变 | 部署新 App；Assistant=false、Embedding=false、Mode=lexical；不挂 Qwen Secret | Health、身份、项目权限、文件、词法检索与存储一致性通过；无 AI 调用/Job | 回旧 Image；不得删除新表/向量 | 15 分钟 |
| Phase 3 Assistant Lexical | Secret 方案和成本门禁批准，App-only mount 验证 | Assistant=true、Embedding=false、Mode=lexical | Grounded Answer、Citation、Viewer、私有 Thread、Usage/Audit 通过 | Assistant=false | 30 分钟 |
| Phase 4 Embedding | Lexical 稳定，Embedding Worker 最小权限与预算通过 | Embedding=true；启动专用 Worker；小批量 backfill | 首批 100 Chunk、Lease/Retry/unknown、Usage 和范围 Probe 通过 | Embedding=false；停止 Worker；保留向量 | 100 Chunk 且 30 分钟 |
| Phase 5 Shadow | Coverage、成本和 Worker backlog 门禁通过 | Mode=shadow，仅记录 Hybrid Candidate，Prompt 仍用 Lexical | Fallback、Latency、泄漏、Candidate 与 Query Usage 通过 | Mode=lexical | 至少 30 个受控请求或批准窗口 |
| Phase 6 Hybrid | Shadow 与冻结 Profile 通过 | Mode=hybrid | Citation、安全、精确事实、语义、Fallback 与成本门禁通过 | Mode=lexical | 30–60 分钟 |

具体执行命令必须在 B3-C2 根据已合并 main、真实 Manifest 和服务器目录生成；B3-C1 不提供可绕过保护的 Production apply 命令。

## Production Qwen Secret 方案

B3-C1 不创建 Secret。B3-C2 应使用 `/srv/projectai/secrets/qwen_api_key` 或经安全评审批准的等价 Secret File，owner/group 对齐实际非 root App 用户，建议权限 `0400`，并满足：

- 不写入 `.env`、Git、镜像、普通 Artifact 或 `docker inspect` Env；
- Phase 3 只挂载 App；Phase 4 才允许挂载专用 Embedding Worker；
- Document Worker、PostgreSQL、MinIO、Migration 和普通运维容器不得挂载；
- Backup 只记录存在性、权限摘要和 Hash，不复制明文；
- 缺失、不可读或配置错误时保持 AI 关闭或 Lexical Fallback；
- 轮换先创建新 root-only 文件并验证权限，再在单一阶段重建允许的服务；撤销时关闭 Flag、移除 mount、重建服务并复核不可见性。

## Stop Conditions

出现以下任一情况立即停止：Production 基线、目标 SHA/Image 或 Manifest 漂移；CI/Evidence 失败；Backup/Checksum/Restore 失败；磁盘或 inode 不足；PostgreSQL、pgvector、Locale、权限或 Migration 锁异常；旧 App + 0007 不兼容；核心 Smoke、跨项目 404、Citation 或存储一致性失败；Restart Count/HTTP 错误上升；Secret 泄漏；Token/成本异常；Embedding backlog/unknown Call 异常；Retrieval 泄漏或 Fallback 异常。

不得人工忽略 unknown。不得执行 `docker compose down`、无范围 prune、destructive schema push、无备份 Migration、浮动 `latest` Image、无范围 SQL DELETE、Force Push 或 Production 自动修复。

## Go/No-Go

`release:go-no-go` 对全部机器报告的内容 Digest、SHA、Image 和上下游 Digest 绑定 fail-closed，不接受 passed=true Checklist 作为真实证据。输出明确区分 `machineReadiness`、`independentReview` 和 `productionRolloutAuthorized`。B3-C1 即使机器结果为 GO，也保持 `independentReview=pending`、`productionRolloutAuthorized=false` 和 Draft PR，不能授权 Production Rollout。

Rerank、`qwen3-rerank`、HNSW、IVFFlat 和其他 ANN 不属于本计划。

## B3-C2A executor handoff

B3-C1 已合并，但不构成 Production rollout 授权。B3-C2A 增加的执行器仍默认拒绝 Production Apply，并要求独立签名 Authorization、未漂移 Inventory、精确 Session/SHA/App 与 db-tools Image/Go-No-Go/Phase 绑定、前置 Phase 报告和非零观察窗口。B3-C2A 只在 CI/本地隔离 Compose 中演练；B3-C2B 才能准备正式 Authorization 和执行 Phase。
