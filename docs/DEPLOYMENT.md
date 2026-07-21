# Deployment

## 环境矩阵

| 环境 | URL / basePath | 目录与应用 | PostgreSQL | Object Storage | 宿主机端口 |
| --- | --- | --- | --- | --- | --- |
| Production | https://gridworks.cn/tool/projectai/ / `/tool/projectai` | `/srv/projectai` / `project-ai-os` | 当前无 ProjectAI PostgreSQL；B3-C1 不得修改 | 当前无 ProjectAI MinIO/Worker；B3-C1 不得增加 | `127.0.0.1:3100` |
| Staging | https://gridworks.cn/tool/projectai-staging/ / `/tool/projectai-staging` | `/srv/projectai-staging` / App + Document Worker + Embedding Worker | PostgreSQL 17 + pgvector 0.8.1 / `projectai-staging-postgres` | 私有 MinIO + `projectai-staging-files` | 应用 `127.0.0.1:3101`；Worker/DB/MinIO 无端口 |

B3-C1 只做 Production Readiness 和隔离 Rehearsal。不得在 Production 主机构建、迁移、重启、增加 PostgreSQL/pgvector/MinIO/Worker、配置 Qwen Secret、修改 Retrieval Mode、修改环境或重新部署。全部 Production `--apply` 被代码硬禁用；正式分阶段流程见 `PRODUCTION_RELEASE.md`，只可在后续 B3-C2 执行。

## Staging 构建元数据

```env
NEXT_PUBLIC_BASE_PATH=/tool/projectai-staging
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_APP_VERSION=0.8.0-staging
NEXT_PUBLIC_COMMIT_SHA=<feature branch full sha>
NEXT_PUBLIC_BUILD_TIME=<ISO-8601>
AI_ASSISTANT_ENABLED=false
AI_PROVIDER=qwen
AI_REGION=cn-beijing
AI_PROJECT_ASSISTANT_PROFILE_ID=qwen-project-assistant-cn-v1
AI_EXECUTION_STALE_AFTER_MS=900000
AI_EMBEDDING_ENABLED=false
AI_EMBEDDING_PROFILE_ID=qwen-text-embedding-cn-v1
AI_EMBEDDING_DIMENSIONS=1024
```

环境条必须显示 build 元数据。资料页显示异步解析/索引状态；知识页同时提供原始词法搜索和真实 Grounded 项目助手，并明确用户知识搜索仍为词法、Assistant Evidence 可由服务端受控 Hybrid 检索。robots 与 Nginx header 均设置 noindex。认证配置继续使用完整 Staging `BETTER_AUTH_URL`、独立 `AUTH_COOKIE_PREFIX` 和 `/tool/projectai-staging` Cookie Path；Cookie 必须 HttpOnly、SameSite=Lax、Secure。

## 受保护环境文件

服务器实际值只保存在 `/srv/projectai-staging/.env.auth-staging`：

- 普通文件、非 symlink，`root:root 600`；部署/rsync 不覆盖、不移动、不打印。
- PostgreSQL、`DATABASE_URL`、Better Auth、Cookie/Origin、5 个 Seed 身份。
- `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`，以及不同的 `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY`。
- 固定内部 Endpoint `http://projectai-minio:9000`、region `us-east-1`、Bucket `projectai-staging-files`、path-style true、SSL false。
- `MAX_UPLOAD_BYTES=52428800` 与 `UPLOAD_ALLOWED_EXTENSIONS=pdf,docx,xlsx,pptx,txt,md`。
- `DOCUMENT_*` Worker/Parser/Chunker 资源上限及版本必须与 `.env.auth-staging.example` 精确一致。

真实 credential 不进入示例、Git、镜像层、日志或 Artifact。MinIO root/app credential 必须满足长度/字符规则且互不相同。

AI/Embedding 配置分为三个受保护文件：

- `/srv/projectai-staging/.env.ai`：普通文件、非 symlink、`deploy:deploy 600`，包含 Feature Flag、Provider、Region、Profile、`AI_EXECUTION_STALE_AFTER_MS=900000`、北京 Qwen Base URL 和容器内 Secret File 路径；不得进入 Artifact 或日志。
- `/srv/projectai-staging/.env.embedding`：部署脚本生成的 `root:root 600` 非密钥配置，只保存 Embedding Flag、固定 Profile/Dimensions、Worker/Batch 与每日上限；每次发布先重置为 false，Probe 通过后原子启用。
- `/srv/projectai-staging/secrets/qwen_api_key`：普通非空文件、非 symlink、`deploy:deploy 600`；部署只检查状态，禁止读取、打印、复制、编码或导出内容。
- Compose 只把 `.env.ai` 和只读 `qwen_api_key` 挂载给 App 与专用 Embedding Worker。Document Worker、Migration 和 operations service 都不获得 Qwen Base URL 或 Secret；AI Smoke 只能通过 App API 触发 Chat Provider，Embedding Probe 只在专用 Worker 容器执行。

`.env.auth-staging` 是 Compose 插值来源，不代表完整注入每个容器：

- PostgreSQL 只接收自身初始化变量。
- MinIO server 只接收 root credential。
- init 任务短期得到 root + app credential，创建私有 Bucket、应用用户和 `projects/*` 最小权限策略。
- App 只接收 `DATABASE_URL`、认证运行参数和 app-level object credential，不接收 PostgreSQL 密码、Seed 密码或 MinIO root credential。
- Document Worker 只接收 `DATABASE_URL`、app-level object credential、文件/Embedding 入队配置与构建版本；不接收 Qwen 或认证/Seed/MinIO root credential。Embedding Worker 只接收 `DATABASE_URL`、Embedding 配置与 Qwen Secret，不接收对象存储 credential。
- Migration 与 storage operations 使用独立短生命周期 Compose service，各自只获取任务需要的变量。

## Staging MinIO

Compose 固定：

```text
service: projectai-minio
container: project-ai-os-staging-minio
volume: projectai-staging-minio:/data
network: projectai-staging-internal
bucket: projectai-staging-files
published ports: none
```

镜像固定到已审查 release，不使用 `latest`。健康检查只访问容器内 `/minio/health/live`。`projectai-minio-init` 必须幂等执行：创建 Bucket、明确关闭 anonymous policy、创建/复用应用用户、绑定只允许该 Bucket 和 `projects/*` 对象操作的 policy，再用应用账号验证访问；任何步骤失败使部署失败关闭。

数据卷不得在普通部署/回滚删除，部署脚本不得出现 `docker compose down -v`。MinIO API 与 Console 都不通过 Nginx 或宿主机端口暴露。

## Staging 部署流程

使用 `scripts/deploy-staging.sh`。脚本要求：

- 分支精确为 `agent/phase1-project-knowledge-management`，工作区 clean，完整 40 位 Commit。
- 固定 Compose project `projectai-staging`、目录 `/srv/projectai-staging` 和远端平台。
- 原子取得 Staging 专属部署锁；发布目录、环境、备份、锁和 marker 均不得是 symlink。
- 记录 Production 容器 ID、running、restart count、health，进入发布事务后的成功/失败/回滚出口都必须精确一致。

受控顺序：

1. 使用当前 Commit 的 tracked-file `git archive` 构造临时 release；拒绝 `.env`、私钥与 reserved overrides。
2. 在本地按远端平台构建 immutable App 和 DB-tools 镜像，通过 `docker save/load` 传输并核对 image ID/OS/architecture；共享服务器不执行应用构建。
3. 拉取固定 `pgvector/pgvector:0.8.1-pg17` digest 与 MinIO release；检查现有 PostgreSQL/MinIO 挂载必须分别为预期命名卷，且均不得有 published port。
4. 启动 PostgreSQL 与 MinIO并等待 Healthy；强制重建 init 任务并等待 exit 0，失败即停止。
5. 在 rollback trap 与事务 marker 已建立后，短暂停止当前 Staging App、Document Worker 和 Embedding Worker，取得 PostgreSQL/MinIO 同一静默写入边界。
6. 生成并验证 PostgreSQL custom-format dump；生成 MinIO JSONL inventory 与 mirror，核对对象数和总字节，再恢复到唯一临时 Bucket 并复核/删除。
7. 备份成功后才把 Staging PostgreSQL 容器切到锁定的 pgvector 镜像；先以新代码和 `AI_EMBEDDING_ENABLED=false` 验证旧 Schema 健康，再由 Migration ledger 只执行尚未应用的 committed Migration（当前至 `0014_authorization_deny_priority.sql`，不得修改历史 Migration），不 schema push/reset；随后验证 `pg_trgm`、pgvector 0.8.1、`vector(1024)`、只读 Profile、Batch、不可变 Provider Call、Worker heartbeat、文档—知识空间跨组织/项目/部门约束与显式 Deny 优先级。
8. 用 scoped storage operations 执行 `npm run storage:verify`；任何 finding 或存储不可用都失败关闭。
9. Migration 完成后启动 Document Worker 与 disabled Embedding Worker，并复核已在 Flag=false 下健康的 App；验证 App、两个 Worker、PostgreSQL、MinIO 健康，同一 immutable image、Secret 最小化和无新增端口。
10. Health 必须显示 Assistant/Embedding disabled 但 Provider configured；在 App 执行 Chat Probe，在专用 Worker 执行固定 `Project AI embedding probe`，均不读取项目资料或输出向量。
11. Probe 成功后原子把 `.env.ai` 的 Flag 改为 true，只 `--no-deps --force-recreate` App；重新验证 Health enabled/configured/Gateway Version，Worker 不重启。
12. 再次运行只读 `storage:verify`；通过 `documents:smoke` 验证 B2，并通过 `assistant:smoke` 的内部上游和公网路径验证真实 Qwen、Citation、资料不足不调用模型、Viewer、私人 Thread、跨项目 404、Token Usage、Audit 和全量清理。公网验证最后运行 `phase1:staging-smoke`，覆盖 Organization、Department、Department Admin 受限空间上传、Project Mount、View/Download 分离、权限检索、Requirement 人工审核、Scope、Action、Risk、Weekly、Export、Audit 与跨部门/项目拒绝；验证项目、对象和 Session 在结束时清理。
13. 等待队列为空，短暂停止 Worker，通过 `documents:lease-smoke` 验证独占 Lease、过期恢复、旧 Worker 拒绝提交和双 Worker `SKIP LOCKED`；再以虚构数据运行 Embedding crash-window、shutdown、并发预算及成本一致性 smoke，显式验证 Timeout/Network/非法成功响应为 unknown、无自动重试、人工重试保留旧调用并双重计入预算、额度不足在调用前拒绝；真实 Qwen 双项目流程同时验证纯中文/混合语言 Usage 不超过版本化硬 Reservation。随后恢复同一 immutable image 并重新检查心跳。
14. 清理本次及失败重试遗留的验证 Session、测试 AI Thread/Message/Execution/Citation、测试文档、版本、Job、Section、Chunk、对象和审计；确认 running Execution、running Job、解析临时文件、恢复 Bucket、partial backup、init 容器和 marker/lock 均为 0。
15. `nginx -t`、公网 canonical/Host/MIME/noindex 验证以及 Production 精确不变复核；脚本不自动编辑或 reload Nginx。

任一步骤失败都会触发 Staging App 镜像回滚；若上一版本已有 Worker，则条件恢复其 immutable image，否则移除本轮 Worker。PostgreSQL/MinIO 卷及跨存储备份始终保留，数据库或对象数据恢复不自动执行。

`0006` 是向前兼容且非破坏性的 Migration：保留既有 Batch、Job、向量和 unknown，按历史尝试数回填调用级记录并增加硬预算与终态不可变约束。应用回滚可以继续在 Flag=false 下运行；不得尝试删除 enum value、调用、向量或表。若产品负责人明确要求完整数据回退，必须停止 Staging 的 App 与两个 Worker，保留当前卷与备份，再由受控人工流程从 Migration 前 custom dump 恢复到新的隔离 Staging 数据库并完成一致性验证；本脚本不自动恢复数据库，Production 不得执行该流程。

## PostgreSQL 与 MinIO 备份

备份根 `/srv/projectai-staging/backups/` 必须 `root:root 700`；文件为 root-only，不能进入 Git、产品 Artifact 或普通日志。

### PostgreSQL

- Migration 前查询数据库大小与文件系统余量。
- `pg_dump --format=custom --no-owner --no-acl` 流式写入 `.partial`。
- 非空且同版本 `pg_restore --list` 成功后才原子改名为 `.dump`。
- 只清理严格匹配命名的 stale partial，并保留最近 10 份。

### MinIO

- 备份目录 `/srv/projectai-staging/backups/object-storage/`。
- `mc --json ls --recursive` 生成 `.inventory.jsonl.partial`；每行必须有可解析 size。
- `mc mirror --retry` 写入独立 `.mirror.partial`；文件数与字节数必须等于 inventory。
- 权限收紧后才将 inventory/mirror 原子改名；最终不得有 `.partial`。
- 恢复演练创建 `projectai-restore-*` 临时 Bucket，绝不能等于正式 Bucket；把 mirror 写入后重新 inventory，核对数/字节，再 `rb --force` 删除临时 Bucket并确认不存在。
- 对象正文、完整 Object Key 和 credential 不打印。备份只保留最近 10 组严格命名的 inventory + mirror。

App 与 Worker 同时停止后，PostgreSQL 与 Bucket 不再有本应用写入，但两个系统没有分布式快照。若未来增加其他写入者，必须先扩展统一 quiesce 协议。

## 一致性命令

```bash
npm run storage:verify
npm run storage:reconcile
npm run documents:smoke
npm run documents:lease-smoke
npm run ai:probe:qwen
npm run assistant:smoke
```

`storage:verify` 只读核对 stored object、size、ETag、SHA-256 metadata、单 current、active/current、stale pending 和 orphan。输出不含 Key 或 Secret。部署前后均必须为 `ok: true`。

`storage:reconcile` 与 `embeddings:backfill` 默认 dry-run。Embedding Backfill 只有显式 `--apply` 才入队，并支持 project/limit/current/effective 范围；所有命令只输出计数，不输出正文、向量或 Secret。

`documents:smoke`、`assistant:smoke` 与 `embeddings:smoke:*` 只生成运行时虚构资料。Embedding 验收覆盖增量入队、真实 1024 维向量、Usage、Stale Lease、旧 Worker 拒绝、同 Hash 不重复计费、project-scoped Backfill、精确 cosine 范围 Probe、旧版本排除和清理；operations 容器没有 Qwen Secret。

## Nginx

- 只向现有 HTTPS server block 增加/维护 Staging exact/assets/general location，不代理 MinIO。
- `/tool/projectai-staging` 使用固定绝对 canonical URL，不能继承未验证 Host。
- 应用只信任受控 Nginx 覆写的 Host/协议；不匹配 Host/X-Forwarded-Host/协议统一 404。
- `client_max_body_size 52m`，为 50 MiB 文件加 multipart framing 余量；应用仍以 `MAX_UPLOAD_BYTES` 执行业务上限。
- 通用 proxy 保留 basePath；静态 location 仅剥离已知 assets 前缀。
- 修改前备份实际站点文件；只有 `nginx -t` 通过后才能 reload。部署脚本本身只测试，不 reload。
- 不修改 Production location、DNS、证书或其他服务。

## 健康与验收

```text
http://127.0.0.1:3101/tool/projectai-staging/api/health
https://gridworks.cn/tool/projectai-staging/
```

基础验收：

- App、PostgreSQL、MinIO、Document Worker Healthy；Worker/App 使用同一 immutable image且 Worker 无端口，MinIO 固定命名卷且 anonymous 请求拒绝。
- 登录/刷新/退出、Manager A/B、Member、Viewer、Admin、最后 Manager 409 和跨项目 404 回归。
- 真实上传允许类型/大小/签名，六格式解析、needs_ocr、Section/Chunk、搜索来源、刷新持久化、下载 SHA-256、版本/current、归档/恢复/reindex、权限与全量清理。
- `storage:verify` 为零 finding；无 orphan、stale pending、临时 Bucket 或 partial backup。
- Cookie、canonical HTTPS、恶意 Host、CSS/JS/font/image MIME、noindex 和 Nginx 新错误检查。
- `/api/health` 的 `x-projectai-commit-sha`、App/Worker/Parser/Chunker Version Header 必须等于部署合同。
- `/api/health` 只公开 AI enabled/configured/Gateway Version，不公开 Base URL、Secret 路径或模型配置；Probe 前 false/true/`1`，启用后 true/true/`1`。
- 真实 Qwen 回答有服务端 Citation；无 Evidence 的 Execution 没有 actual model、Provider Request ID 或 Token Usage；Viewer 只读自己的 Thread，其他用户 Thread 和跨项目访问统一 404。
- Production 根路径/dashboard 可用，容器 ID、running、restart count、health 与基线精确一致。

## 回滚与恢复

1. 应用替换后的失败由 EXIT trap 使用发布前记录的 immutable App image ID 自动回滚，并按发布前状态条件恢复/移除 Worker；无上一镜像则停止失败 App/Worker。
2. 自动回滚不删除或重建 `projectai-staging-postgres` / `projectai-staging-minio`，也不删除发布前 dump/inventory/mirror。
3. Migration 不兼容时，先保存失败状态，再在维护窗口使用同版本工具人工恢复 PostgreSQL；对象恢复只能先进入临时 Bucket 验证，不直接覆盖正式 Bucket。
4. 数据库与对象必须成组选择同一时间戳/Commit 的备份。只恢复一边会造成不一致，恢复后必须运行 `storage:verify` 和完整身份/文件验收。
5. 自动回滚失败时保留 marker 并停止发布，禁止绕过、`down -v`、删除卷或测试 Reset。
6. 只有实际改过 Nginx 才从时间戳备份恢复，并遵守 `nginx -t` 后 reload。

## 日志

- Staging 总览：`docker compose -p projectai-staging -f /srv/projectai-staging/docker-compose.staging.yml logs --tail=200`。
- PostgreSQL/MinIO 只检查必要健康和当前时间窗；不要记录完整 `docker inspect` 环境或 `mc alias` 配置。
- 日志不得输出文件正文、完整 Object Key、Bucket 内部地址、密码、Cookie、Session、数据库 URL、Qwen Base URL、Authorization、System Prompt、Evidence Set、Provider 原始响应或任何凭据。

## 当前发布状态

B3-C1 的稳定合同是：锁定完整 SHA/Image/Base Digest；生成带 Migration File/Advisory 状态和环境感知 MinIO Count 的 Production/Staging 脱敏 Inventory 与分类差异；在隔离 PostgreSQL/pgvector 中完成 Backup/Restore/0004–0007；验证旧 Image 的 legacy application shell 可在旁路 0007 数据库存在时运行以及新 Image AI 全关闭；由工具采集 Git/CI/Image/Clock/Baseline Preflight；对全部 Readiness Report 做 Digest/SHA/Image 交叉绑定；CI 上传脱敏 Release Evidence/Provenance；最后复核 Production Container、Image、StartedAt、Restart Count、Health、Compose、Nginx、服务、Migration、Secret Mount 和公网响应精确不变。

Mode 配置只存在 `/srv/projectai-staging/.env.ai`：`AI_ASSISTANT_RETRIEVAL_MODE`、`AI_HYBRID_RETRIEVAL_PROFILE_ID=hybrid-rrf-v1`、`AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS`、`AI_HYBRID_VECTOR_SQL_TIMEOUT_MS` 和 Query 日 Token 上限。Qwen Secret 仍只读挂载 App/Embedding Worker，切勿读取或打印文件内容。回滚先把 Mode 恢复为 lexical，再恢复上一 immutable App image；不得 `down -v`、删除卷、修改 Production 或绕过质量门禁。

## B3-C2A deployment executor

Production rollout 使用 `docker-compose.production-rollout.yml` 和 Phase 3+ 的 `docker-compose.production-ai.yml`，固定 `projectai-production` Project、内部 Network、命名 Volume、immutable Image 和 `127.0.0.1:3100` App 端口；PostgreSQL/MinIO 不发布宿主机端口。执行器禁止 `docker compose down`，Phase 必须分开执行并停顿。B3-C2A 不传输 Image、不创建 Production 配置/Secret、不运行 Compose；正式部署仍未开始。
