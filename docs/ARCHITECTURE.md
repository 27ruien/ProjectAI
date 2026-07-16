# Architecture

## v0.5 请求、身份、文件与知识边界

```mermaid
flowchart LR
  A["Browser"] --> B["App Router / Route Handler"]
  B --> C["Better Auth + PostgreSQL Session"]
  C --> D["Authenticated Principal"]
  D --> E["Central Project Authorization"]
  E --> F["projects + project_members"]
  F -->|"authorized projectId"| G["Project Document Service"]
  G --> H["project_documents + versions"]
  G --> I["S3-compatible private object storage"]
  G --> J["audit_events"]
  E -->|"missing / cross-project"| K["404 + sanitized audit"]
  E -->|"known project, insufficient role"| L["403 + sanitized audit"]
```

身份、角色、`projectId`、`documentId` 和 `versionId` 均不可信。受保护页面和 Route Handler 从数据库 Session 恢复用户，再由集中授权层查询项目成员关系。文件服务继续验证 `project → document → version` 复合归属；不存在和跨项目资源统一 404，只有已经确认项目可见但写角色不足时返回 403。`system_admin` 绕过项目成员关系只存在于集中授权层。

项目资料和项目知识搜索均不再走 `data/mock`：列表、版本、current、归档、下载、处理状态和词法命中来自 PostgreSQL 与私有对象存储。需求、Scope、Action、会议、风险和 AI execution 仍是授权后按精确 `projectId` 过滤的 Mock；真实文件正文不会交给 Mock AI。

## PostgreSQL 与对象存储职责

| 存储 | 责任 | 明确不保存 |
| --- | --- | --- |
| PostgreSQL | 身份、Session、项目/成员；逻辑资料；版本元数据；解析 Job/Lease；Section/Chunk；词法索引；状态/current/effective；审计 | 原始文件正文、对象存储 Secret、完整 Provider 响应 |
| S3-compatible Object Storage | 不可变文件正文和 `sha256` object metadata | 用户角色、项目授权、current/归档业务状态 |

数据库是业务状态事实来源，但不能单独证明对象存在；对象存储也不能决定访问权限。任何读取先授权并查询数据库，再以内置 Object Key 访问对象。客户端 DTO 永不包含 Bucket、Endpoint、Object Key、Access Key 或 Secret。

## PostgreSQL 模型

| 表 | 责任与关键约束 |
| --- | --- |
| `users` | 唯一规范化 email、系统角色、active/disabled；不保存密码 |
| `accounts` | Better Auth credential；安全哈希只位于 `accounts.password_hash` |
| `sessions` | 数据库 Session、到期/创建/last seen；token 唯一 |
| `verifications` / `rate_limits` | Better Auth 兼容状态与数据库登录限流 |
| `projects` | 项目基础信息及同项目成员/文件写操作的事务锁边界 |
| `project_members` | `(project_id, user_id)` 唯一、项目角色 enum；最后 Manager 约束由事务服务执行 |
| `project_documents` | 逻辑资料、项目、display name、`pending/active/archived/failed`、创建/归档元数据；项目删除 `restrict` |
| `project_document_versions` | 不可变版本、project/document 复合外键、版本号、current、upload/object 唯一标识、文件元数据、`pending/stored/failed/quarantined/deleted` |
| `document_ingestion_jobs` | project/document/version/Generation、Parser/Chunker Version、状态、Attempt、Lease、Heartbeat 与脱敏失败 |
| `document_sections` | 文件自然结构与 PDF Page、DOCX Paragraph、XLSX Range、PPTX Slide、文本行 Source Locator |
| `document_chunks` | 确定性分块、内容 Hash、generated `tsvector`、`pg_trgm` 搜索字段和 `is_effective` |
| `audit_events` | actor、project、event/entity/result、脱敏 metadata、请求上下文与时间 |

文件版本约束包括：

- `(document_id, version_number)`、`upload_id`、`object_key` 唯一。
- Partial Unique Index：`unique(document_id) where is_current = true`。
- current 必须是 stored；stored 必须有 ETag/storedAt 且没有 failure code。
- pending 不得有 ETag/storedAt/current；failed/quarantined 必须有受控 failure code 且不得 current。
- `documentId + projectId` 复合外键和版本查询共同防止跨项目资源拼接。

数据库访问集中在 `lib/db/repositories/` 和领域服务中，页面组件不写 SQL。Migration 提交在 `drizzle/` 并只通过 `npm run db:migrate` 前向执行；Staging/Production 禁止 schema push。

## Object Key、文件验证与下载

Object Key 由服务端生成：

```text
projects/{projectId}/documents/{documentId}/versions/{versionId}/{randomUuid}
```

四个动态段只允许受控 ID 字符；Key 不使用原文件名、邮箱、客户/项目名称、路径、Session 或客户端随机片段。原文件名经 NFKC、basename、控制/bidi/非字符和 UTF-8 长度清理，仅作为 PostgreSQL 元数据及安全 `Content-Disposition` 使用。

上传默认上限 50 MiB，允许 PDF、DOCX、XLSX、PPTX、TXT 和 Markdown。上传路径先做签名与容器验证；独立 Parser Worker 再做受限正文解析，拒绝 DTD/Entity、外部关系、宏和危险部件，不执行公式或网络访问。

下载在读取对象后、发送响应前核对数据库大小、ETag 和 SHA-256 object metadata；响应固定 `attachment`、`X-Content-Type-Options: nosniff` 与 `Cache-Control: private, no-store`。完整性异常统一为脱敏的 `STORAGE_UNAVAILABLE`，不返回内部 S3 错误。

## 上传状态机与补偿

```mermaid
stateDiagram-v2
  [*] --> Pending: "DB reservation + upload audit"
  Pending --> Stored: "Object put verified + DB finalize"
  Pending --> Failed: "Put/finalize failed; object deletion confirmed"
  Pending --> Quarantined: "Compensation deletion not confirmed"
  Failed --> Pending: "same idempotency key + identical file retry"
  Stored --> [*]
```

三段式流程：

1. 事务锁定项目和逻辑资料，使用 `projectId + actorUserId + UUID Idempotency-Key` 派生唯一 `upload_id`，创建 pending 版本。
2. 向全新 Object Key 写入验证后的字节并核对 size/SHA-256/ETag。
3. 再次锁定并事务性标记 stored、选择最高 stored 版本为 current、取消旧 current、激活资料并写审计。

对象 put 失败会尝试删除目标 Key并把版本置 failed；删除无法确认则 quarantined。对象成功但数据库 finalize 失败会再次补偿删除并记录 `FINALIZE_*` failure code。标记失败本身为 best effort；stale pending、缺失对象、metadata mismatch 和 orphan 由只读检查接管。新版本永远生成新 Key，不覆盖历史对象。

## 版本、current 与归档

- 新版本事务锁定 `project_documents` 行后计算下一个版本号，数据库唯一约束兜底并发重复。
- 只有 Manager/Admin 能切换 current；目标必须属于同一项目/文档并为 stored。锁 + Partial Unique Index 防止双 current。
- 归档/恢复只有 Manager/Admin 可执行。归档不删对象、不删版本、不改变 current，仅从默认 active 列表排除并禁止新增版本/current 切换。
- Member 可上传资料/版本，Viewer 只读；所有项目角色可下载其授权项目 stored 版本。

## 一致性与 reconciliation

`verifyFileStorage()` 同时遍历数据库与 `projects/` 对象前缀，报告：missing object、size/ETag/SHA metadata mismatch、multiple current、active without current、超过 15 分钟 pending 和 orphan。CLI 只输出计数，不输出 Object Key 或 Secret。

`storage:reconcile` 默认 dry-run。即使传入 `--apply`，仍要求非 Production、`ALLOW_STORAGE_RECONCILE_APPLY=1`、精确 `OBJECT_STORAGE_BUCKET_CONFIRM`、至少 300 秒 orphan 年龄；删除前再次查询数据库引用，只删除仍无引用的对象并写审计。数据库记录缺对象不会被脚本自动删除或伪造修复。

## 文档处理队列与有效索引

```mermaid
flowchart LR
  A["Stored Current Version"] --> B["Pending Job"]
  B --> C["FOR UPDATE SKIP LOCKED"]
  C --> D["Worker + Lease + Heartbeat"]
  D --> E["Integrity Revalidation"]
  E --> F["Terminable Parser Thread"]
  F --> G["Section + Deterministic Chunk"]
  G --> H["Lease/Version Revalidation"]
  H --> I["Atomic Effective Generation"]
```

解析不在领取事务内执行。完成事务必须确认 Worker 仍持有 Lease，且版本仍属于相同项目/文档；只有 Active 文档的 Current/Stored 版本能激活 Chunk。新版本、current 切换、归档和恢复都通过同一领域服务更新有效性，页面不直接操作索引。

搜索 SQL 同时限制 `project_id`、文档状态、current、storage、Job status 和 `is_effective`，组合 FTS、contains 与 `pg_trgm`。返回 DTO 不含 Job Lease、Worker ID、Object Key、Bucket 或 Endpoint。

## AI 与知识稳定边界

```mermaid
flowchart LR
  A["Business Page"] --> B["Workflow / Skill"]
  B --> C["modelProfileId"]
  C --> D["AI Gateway"]
  D --> E["Mock Provider"]
  E --> F["AI Draft"]
  F --> G["Human Review"]
```

`ProjectKnowledgeService` 与 `AIGateway` 保持稳定边界，页面和 Skill 不保存具体 Provider 模型名。v0.5 B2 只有 Parser、Section/Chunk 与词法搜索，没有 OCR、Embedding、RAG、Reranker、真实模型或 Provider Key；词法结果不是 AI 结论。

## Staging 环境与备份

- Production：`/tool/projectai`、`/srv/projectai`、`project-ai-os`、`127.0.0.1:3100`；v0.5 B2 不得修改或增加 Worker。
- Staging 应用/Worker/数据库：`project-ai-os-staging`、`project-ai-os-staging-worker`、`project-ai-os-staging-postgres`、卷 `projectai-staging-postgres`、App `127.0.0.1:3101`；Worker/DB 无端口。
- Staging MinIO：`project-ai-os-staging-minio`、卷 `projectai-staging-minio`、Bucket `projectai-staging-files`；仅连接 `projectai-staging-internal`，不发布 API/Console 端口，不允许匿名访问。
- `projectai-minio-init` 使用 root credential 幂等创建私有 Bucket 和受 `projects/*` 限制的应用用户；应用只得到 scoped app credential。root/app credential 必须不同并只存在于 `root:root 600` 环境文件。
- Worker 与 App 使用同一 immutable image；Worker 独立 command、心跳健康、scoped credential、优雅退出。所有服务有 CPU、内存、PID 与滚动日志边界。

部署在 Migration 前同时停止 Staging App/Worker，创建 PostgreSQL custom dump 与 MinIO inventory/mirror；Migration 后验证 `pg_trgm`，先启动 Worker再启动 App。普通部署、失败和镜像回滚均保留两个命名卷和备份。

## CI 与产品审查证据边界

CI 使用 PostgreSQL 17 和运行时创建的 MinIO：每次生成随机 root/app credential 与唯一 Bucket，Secret 全部 mask，MinIO 数据放在 tmpfs，结束时 `if: always()` 删除容器、网络和 root-only 临时凭据文件。CI 不连接 Staging/Production 或远程 Bucket。

产品 Evidence 采用强 allowlist。Payload A 只可包含：

- `evidence-index.json`、`sanitization-report.json`。
- 22 张约定 PNG 截图（原有 12 张 + 10 张解析/搜索截图），每张记录实际宽高。
- 固定名称的 UTF-8 纯文本测试日志。

`playwright-report/`、`test-results/`、trace/video、任意归档/PDF、上传测试原件、数据库/对象备份和未列名文件均不进入 Payload A。sanitizer 对数据库/认证/MinIO/object-storage Secret、Bucket/Endpoint/Object Key、Cookie/Session 和编码变体做删除/脱敏并失败关闭。

GitHub Actions 仍先上传不可变 Payload A，再用返回的真实 artifact ID/digest 生成 Provenance B。Manifest schema v3 记录 Worker/Parser/Chunker Version 和 PNG 实际尺寸。`MVP_STATUS.md` 记录稳定交付结论；当前 v0.5 最终 Head、CI、Artifact 与 Staging 动态精确事实以 Draft PR #4 描述、Provenance Manifest 和受控部署证据为准。
