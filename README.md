# Project AI OS

面向项目经理的 AI 项目交付工作台 MVP。它以项目为核心容器，将项目资料、知识、结构化需求、AI 工作流、人工审核、Scope 变更、Action Plan 与风险管理串联起来。

> **安全提示：B3-C1 只增加 Production Release Readiness、隔离演练、回滚和脱敏证据工具，不执行 Production 部署、迁移、重启或 AI 启用。所有 Production `--apply` 均被代码硬拒绝；正式上线属于后续 B3-C2。ANN、Rerank、Tool Calling 和正式业务写入仍未开始。**

## 已实现能力

- 企业账号登录：Better Auth 邮箱/密码认证、数据库 Session、HttpOnly Cookie、token 最小化/no-store 响应、停用撤销、退出、基础登录限流和写请求的精确 Origin/JSON 边界；只开放登录、Session 查询和退出端点，不开放公共注册或账户管理端点。
- 项目隔离：`system_admin` / `standard_user` 系统角色，`project_manager` / `project_member` / `viewer` 项目角色，以及统一服务端 404 防枚举授权。
- PostgreSQL 基础：Drizzle Schema、已提交 Migration、insert-only 幂等环境变量 Seed、受保护的测试库 Reset、数据库项目列表/创建/基础信息/成员关系和审计事件。
- 项目资料：真实上传与持久化、PDF/OOXML/TXT/Markdown 校验、50 MiB 上限、S3-compatible 私有对象存储、幂等重试、版本/current、归档/恢复、权限下载、SHA-256/ETag 完整性和文件审计。
- 文档处理：PostgreSQL 持久化 Job、独立 Worker、Lease/Heartbeat、六格式有界解析、needs_ocr、Section/Chunk、来源定位、版本/归档有效性和 reindex。
- 工作台：项目进度、AI 审核、风险、待办、AI 活动和状态演示。
- 项目管理：搜索、组合筛选、排序、分页、列控制和项目创建。
- 项目空间：概览、真实资料、真实项目知识搜索、真实 Grounded 项目助手，以及仍为 Mock 的需求、Scope、Action、会议和风险模块。
- 项目知识：读取当前项目 Active/Current/Stored/Succeeded/Effective 索引，支持 FTS、contains、`pg_trgm` 模糊匹配与 PDF Page、DOCX Section、XLSX Range、PPTX Slide、文本行来源。
- 项目 AI 助手：私人 Thread、有限多轮、Qwen 主/备用模型、服务端 Evidence/Citation 校验、资料不足、失败重试、Token Usage、限流与审计；回答不直接写入正式业务数据。
- Assistant Evidence Retrieval：服务端 lexical/shadow/hybrid Mode、冻结 `hybrid-rrf-v1`、Query Embedding 成本账本、exact pgvector、RRF、Coverage Gate、Lexical Fallback 与 60 条虚构 Query 质量门禁。
- 向量基础：固定 `qwen-text-embedding-cn-v1` Profile、`text-embedding-v4`、1024 维 pgvector、Chunk Embedding、持久化 Job/Batch/不可变 Provider Call、专用 Worker、Lease/Recovery、发送后 unknown 防重放、硬 Token 预算、dry-run Backfill、Probe 与 Usage；不接入浏览器检索或回答 Evidence。
- 需求中心：TanStack Table、批量操作、CSV 导出和可编辑 Requirement Drawer。
- AI 工作流：项目助手使用真实 AI Gateway；其他需求提取、Scope、Action 和风险工作流仍为 Mock。
- 审核中心：三栏审核、差异、证据、执行信息、通过/修改后通过/驳回/草稿/重新生成。
- 系统治理：Skills 只读详情、Provider/Model/Profile/关系/调用/成本视图。
- 项目经理日报（Feature Flag）：个人工作随记、ACL 过滤的 AI 工时草稿、人工审核/确认、JSON 导出，以及与独立 MV3 企业微信连接器的逐条同步协议；AI 不确认工时，扩展不点击最终提交。

AI 产出始终以草稿或待审核状态存在；当前人工审核只产生 Mock 状态反馈，正式业务写入尚未实现。

## 技术栈

- Next.js App Router（vinext / Cloudflare Worker 兼容构建）
- React 19、TypeScript strict、Tailwind CSS 4
- Better Auth `1.6.23`、Drizzle ORM、PostgreSQL 17 + pgvector 0.8.1（CI/Staging）
- AWS SDK for JavaScript v3、S3-compatible Object Storage、Staging/CI MinIO
- TanStack Table、React Hook Form、Zod、Lucide Icons
- 仅剩余 Mock 交互状态使用按环境隔离的 localStorage；身份和 Session 不使用浏览器存储
- Playwright、GitHub Actions 与独立 Staging 审查闭环

## 主要路由

```text
/dashboard
/projects
/projects/new
/projects/[projectId]/overview
/projects/[projectId]/documents
/projects/[projectId]/knowledge
/projects/[projectId]/requirements
/projects/[projectId]/scope
/projects/[projectId]/actions
/projects/[projectId]/meetings
/projects/[projectId]/risks
/workflows
/workflows/requirement-extraction
/reviews
/skills
/skills/[skillId]
/knowledge
/daily-report
/analytics
/settings
/settings/ai-models
/settings/ai-models/[profileId]
```

## AI 与知识架构

```text
业务页面
  → Project Assistant Service
  → 服务端 lexical / shadow / hybrid Evidence Retrieval
  → Grounded Prompt（Evidence 与规则分区）
  → AI Gateway
  → qwen-project-assistant-cn-v1
  → Qwen Provider Adapter
  → Citation Validation / 一次 Repair
  → Thread + Message + Execution + Citation + Audit
```

项目页面先在服务端从 Session 建立用户身份，再从 PostgreSQL 查询项目成员关系。资料 API 继续验证 `projectId → documentId → versionId` 归属，再访问 PostgreSQL 文件元数据和私有对象存储；Bucket、Endpoint、Object Key 与凭据不会序列化给浏览器。其他业务模块仍在授权后按精确 `projectId` 映射 Mock 数据，客户端不会收到其他项目内容。

项目知识页继续使用真实词法搜索与来源定位；项目助手则由服务端按配置使用 lexical、shadow 或经过评测的 exact-vector + RRF hybrid Evidence，最终最多 10 条、总计最多 24000 字符。Coverage、预算、Timeout、Provider 或向量异常自动回退 Lexical；没有合格 Evidence 时不调用回答模型。Query Vector 不持久化，客户端不能提交 Mode、Profile、Score 或内部 Evidence。OCR、ANN 索引和 Reranker 仍未实现。

## 目录

```text
app/                    App Router 入口与全局 Design Tokens
components/             布局、公共组件和业务页面
config/                 导航、状态映射、AI 默认配置
data/mock/              主要项目业务 Mock 数据
drizzle/                已提交的 PostgreSQL Migration
lib/auth/               Better Auth、Session、授权与浏览器安全视图
lib/db/                 PostgreSQL Client、Schema 与 Repository
lib/files/              文件校验、授权、S3 存储、版本服务与一致性检查
lib/documents/          资料客户端、Parser、Chunker、Job、Worker 与 Search
lib/project-data/       授权后的服务端 Mock 映射
lib/ai/                 Gateway、Provider、Registry、Router、fixtures、日志、成本
lib/knowledge/          浏览器知识搜索客户端
lib/timesheets/         日报 Schema、服务、ACL、AI 合同和同步协议
extensions/             独立 Chrome MV3 企业微信连接器、Adapter 与 Mock 页面
scripts/db/             Migration、幂等 Seed 与测试库 Reset
scripts/release/        Inventory、Manifest、Preflight、Rehearsal、Smoke 与 Rollback 工具
release/                Release Schema、Checklist、Compatibility Matrix 与虚构 fixture
types/                  严格 TypeScript 领域模型
tests/                  SSR、授权集成、跨项目和产品流程 E2E
docs/                   MVP 规格、验收、流程、架构、测试与部署事实来源
.github/                CI、Issue 模板与 PR 模板
```

## 数据边界

- 真实 PostgreSQL：用户、credential、Session、项目/成员、逻辑资料、文件版本、解析 Job、Section、Chunk、generated `tsvector`、有效性和审计事件。
- 真实对象存储：不可变文件正文；数据库只保存服务端生成的 Object Key，不保存正文，客户端不返回 Key/Endpoint/Bucket。
- CI/本地 Seed：缺失时创建 5 个预创建用户、3 个项目及成员关系；重跑不会重新激活账号、重置角色、覆盖项目编辑或替换 credential hash。
- 真实 PostgreSQL AI 状态：模型 Profile、私人 Thread、Message、Execution、Citation、Token Usage、限流和 Audit；Embedding Profile/Job/Batch/Provider Call/Chunk Vector 只供 Worker 与受保护运维使用。
- Feature Flag 开启后，真实 PostgreSQL 还保存当前用户自己的工作随记、日报草稿、任务、AI execution 与脱敏同步摘要；管理员不会因此获得查看下属日报的新权限。
- 仍为 Mock：需求、Scope、Action、会议、风险、审核任务和相关生成工作流。
- 未实现：OCR、用户知识搜索的向量检索、ANN、Rerank、Tool Calling 和正式业务写入。

## 本地运行

要求 Node.js `>=22.13.0` 和独立的本地 PostgreSQL 测试/开发数据库。复制环境变量名称到未跟踪的本地环境文件，填入本机值；不要提交密码、Cookie、`DATABASE_URL` 或 Seed 凭据。

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

质量检查：

```bash
npm run typecheck
npm run lint
npm run test:integration
npm run test:files
npm run test:storage
npm run test:embeddings
npm run test:embedding-integration
npm test
npm run test:e2e
npm run test:timesheets
npm run test:timesheets-integration
npm run test:extension-e2e
npm run qa:mvp
```

数据库命令：

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
ALLOW_TEST_DATABASE_RESET=true npm run db:reset:test
npm run storage:verify
npm run storage:reconcile
npm run embeddings:backfill
npm run embeddings:status
npm run embeddings:probe
```

`db:reset:test` 会拒绝远程主机或名称不含 `test` / `ci` 的数据库。文件集成测试还要求隔离的 S3-compatible 测试存储；CI 每次创建随机 MinIO 凭据和临时 Bucket，并在 `always()` 收尾销毁。

`storage:verify` 只读核对数据库与对象存储；`storage:reconcile` 默认也是 dry-run。`--apply` 需要非 Production、显式开关、精确 Bucket 确认和最小对象年龄，删除前仍会二次检查数据库引用。

## 项目经理日报与企业微信连接器

该 MVP 默认关闭。完成 Migration `0016_tricky_revanche.sql` 后，在 Local 或 Staging 显式设置：

```env
PM_DAILY_REPORT_ENABLED=true
WECOM_TIMESHEET_SYNC_ENABLED=true
PM_DAILY_REPORT_CONFIDENCE_THRESHOLD=0.85
```

日报模型调用继续复用服务端 Project Assistant Gateway；浏览器和扩展不会获得 Provider、模型密钥或完整 Provider Response。页面只允许当前 Session 用户读写自己的日报，项目候选项和正式任务项目都重新经过服务端 ACL 校验。确认状态使用版本号，未确认或失去项目权限的草稿不能创建同步批次。

本地启动与扩展构建：

```bash
npm ci
npm run db:migrate
npm run db:seed
npm run dev
npm run extension:build
npm run extension:package
```

在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，目录为 `dist/wecom-timesheet-extension`。真实企业微信看板 Origin 未提供前，默认构建不会申请企业微信 Host Permission，也不能执行真实页面同步。获得并人工核验 URL 后，使用 `WECOM_TASK_BOARD_URL=https://exact.example/path npm run extension:build` 生成绑定精确 Origin 的构建，再按 [Selector 配置指南](./docs/wecom-selector-configuration.md) 由用户手动登录并先执行 Dry Run。不要提交本地 Selector Config。

Dry Run 会打开表单、填写并二次验证项目/分类/状态，但不会点击单条保存；正常模式只允许点击单条任务保存。Adapter 中不存在“最终提交”选择器，因此两种模式都不会点击日报或看板的最终提交。用户需要在企业微信页面完成最终人工检查和提交。

扩展本地状态与脱敏故障日志可在 Popup 中导出，并通过“清除本地记录”二次确认后删除。升级扩展时重新构建、在扩展管理页点击“重新加载”，随后重新执行 Dry Run。完整范围、协议、安装、已知限制与测试命令见：

- [日报架构](./docs/pm-daily-report-architecture.md)
- [数据模型](./docs/pm-daily-report-data-model.md)
- [AI 合同](./docs/pm-daily-report-ai-contract.md)
- [同步协议](./docs/wecom-sync-protocol.md)
- [Dry Run](./docs/wecom-dry-run.md)
- [人工验收](./docs/manual-acceptance-checklist.md)
- [故障排查](./docs/troubleshooting.md)
- [扩展发布清单](./docs/wecom-extension-release-checklist.md)

Playwright report、test results、trace/video 和运行时上传原件只保留在 CI 工作区，不进入产品 Evidence。发布 Payload 采用强 allowlist，只包含索引/脱敏报告、30 张约定 PNG 和固定名称的 UTF-8 日志，并扫描 Session、MinIO/S3/Qwen 凭据、Base URL、Bucket/Endpoint/Object Key、System Prompt、Provider Request/Response 与编码变体；Manifest 读取每张 PNG 的实际尺寸。完整策略见 [docs/TESTING.md](./docs/TESTING.md)。

## 权威文档

- [AGENTS.md](./AGENTS.md)：产品、AI、安全与 Review 强制规则。
- [MVP_SPEC](./docs/MVP_SPEC.md) 与 [MVP_ACCEPTANCE](./docs/MVP_ACCEPTANCE.md)：第一阶段范围和可验证清单。
- [MVP_STATUS](./docs/MVP_STATUS.md)：版本、环境、风险、阻塞和最近验证。
- [USER_FLOWS](./docs/USER_FLOWS.md) 与 [UI_GUIDELINES](./docs/UI_GUIDELINES.md)：流程和界面规范。
- [ARCHITECTURE](./docs/ARCHITECTURE.md) 与 [DECISIONS](./docs/DECISIONS.md)：当前/未来架构和决策记录。
- [TESTING](./docs/TESTING.md) 与 [DEPLOYMENT](./docs/DEPLOYMENT.md)：验证、Staging、生产保护和回滚。

每个 PR 必须更新 `MVP_STATUS.md`，并核对 `MVP_ACCEPTANCE.md`。

## Staging 与反馈

Staging 地址：<https://gridworks.cn/tool/projectai-staging/>

Staging 使用独立目录 `/srv/projectai-staging`、App、Document Worker、专用 Embedding Worker、PostgreSQL 17/pgvector 与私有 MinIO；只有 App 发布 `127.0.0.1:3101`，其余服务只连接内部网络。

认证和存储凭据保存在 `.env.auth-staging`；AI 配置保存在 `.env.ai`，Embedding Flag/上限保存在 `.env.embedding`。Qwen Key 只读挂载到 App 与专用 Embedding Worker，Document Worker 不获得 Qwen Base URL 或 Secret。部署先保持 Flag 关闭，完成 Migration、pgvector/Profile 校验与固定 Probe 后分阶段启用，并只用虚构资料完成问答、向量、Lease、Backfill、范围 Probe 和清理。

Compose 按容器最小化注入 Secret：Worker 只接收数据库连接和 Bucket-scoped object credential，不接收认证/Seed/MinIO root credential。App、Worker、数据库、MinIO 和 operations 均设置资源/日志上限。

每次 Migration 前，部署脚本同时停止 App 和 Worker，创建并验证 PostgreSQL custom dump、MinIO JSONL inventory 和 root-only Bucket mirror；Migration 后验证 `pg_trgm`，先启动 Worker 再启动 App。普通部署/回滚保留 PostgreSQL/MinIO 命名卷及备份。

顶部“反馈”入口只保存当前路径、反馈类型、描述、严重级别、构建信息、User Agent 和时间；不读取页面业务内容、上传文件、网络请求或项目数据。反馈保存在按环境隔离的 localStorage 中，可复制为 GitHub Issue Markdown。

## 后续接入

1. 完成 B3-C1 Production Readiness 的独立产品、安全与运维复审；Draft PR 不自动 Ready 或合并。
2. Production Rollout 必须在独立 B3-C2 中按 Phase 0–6 执行，不得把 readiness 当作上线授权。
3. 后续 ANN 或 Reranker 必须独立评测和立项，不得混入 B3-C1/B3-C2。
4. 保持 `ProjectKnowledgeService` 和 `AIGateway` 稳定边界；Provider Key 只进入服务端 Secret File。
5. 项目助手回答必须显示来源并保留审计，不直接覆盖正式数据。

## Production 保护

生产地址：<https://gridworks.cn/tool/projectai>

B3-C1 只允许只读盘点和本地/CI/隔离 Rehearsal，禁止在 Production 服务器构建、重启、迁移、增加 PostgreSQL/MinIO/Worker、配置 Qwen Secret、修改 Retrieval Mode 或重新部署。本阶段所有 Production `--apply` 都返回 `PRODUCTION_APPLY_NOT_AUTHORIZED`。现有 Production 继续使用 `/tool/projectai`、`/srv/projectai`、`project-ai-os` 和 `127.0.0.1:3100`；开始和结束必须精确比对 Container ID、Image、StartedAt、Restart Count、Health、Compose 与 Nginx Hash。

正式流程见 [Production Release](./docs/PRODUCTION_RELEASE.md)、[Rollback](./docs/PRODUCTION_ROLLBACK.md)、[Backup/Restore](./docs/PRODUCTION_BACKUP_RESTORE.md) 和 [Observability](./docs/PRODUCTION_OBSERVABILITY.md)。以下既有部署说明不是 B3-C1 授权，也不得用于本轮执行。

以下命令仅保留为既有 Production 基线说明，不是本轮执行清单。`NEXT_PUBLIC_BASE_PATH` 是构建时配置，修改后必须重新构建镜像；应用内的 `next/link` 和 Router 继续使用 `/dashboard` 等逻辑路径，不要手工重复前缀。

本地生成生产构建：

```bash
NEXT_PUBLIC_BASE_PATH=/tool/projectai npm run build
```

生产环境变量参考 [.env.example](./.env.example)：

```env
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_BASE_PATH=/tool/projectai
AI_ASSISTANT_ENABLED=false
AI_PROVIDER=qwen
AI_EXECUTION_STALE_AFTER_MS=900000
```

### Docker Compose

```bash
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=200
```

容器内监听 `0.0.0.0:3000`，宿主机只暴露 `127.0.0.1:3100`。既有 Production 基线的健康检查地址为：

```text
http://127.0.0.1:3100/tool/projectai/dashboard
```

### Nginx

将 [deploy/nginx-projectai.conf](./deploy/nginx-projectai.conf) 中的 `location` 加入现有 `gridworks.cn` HTTPS server block。通用应用代理的 `proxy_pass http://127.0.0.1:3100` 不带尾部 `/`，以保留 basePath。两个静态资源代理是 vinext standalone 的兼容层：只对 `/tool/projectai/assets/` 去掉 basePath，并将 vinext 专用的 `/assets/_vinext_fonts/` 命名空间映射到上游；不要把整个根路径 `/assets/` 代理给本应用。

每次修改后必须先验证，再重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 可重复部署脚本

首次代码已同步到服务器时：

```bash
sudo PROJECT_DIR=/srv/projectai \
  CHECK_NGINX=1 \
  RELOAD_NGINX=0 \
  /srv/projectai/scripts/deploy-production.sh
```

确认 Nginx 配置已准备好后，可将 `RELOAD_NGINX=1`。如果服务器配置了安全的 GitHub 只读 Deploy Key，可额外设置 `DEPLOY_FROM_GIT=1`；否则继续使用 rsync 发布，不要在服务器保存个人 GitHub Token。

### 生产验证

```bash
curl -I https://gridworks.cn/tool/projectai
curl -I https://gridworks.cn/tool/projectai/
curl -I https://gridworks.cn/tool/projectai/dashboard
curl -I https://gridworks.cn/tool/projectai/projects
curl -I https://gridworks.cn/tool/projectai/reviews
curl -I https://gridworks.cn/tool/projectai/settings/ai-models
```

vinext 的浏览器静态资源 URL 位于 `/tool/projectai/assets/`，不是 `/_next/static`；standalone 上游实际从 `/assets/` 提供这些文件，因此 Nginx 使用窄范围静态代理适配。验证时不仅要确认状态为 200，还要确认 CSS、JavaScript 和字体的 `Content-Type` 分别正确，避免把路由回退 HTML 误判为有效资源。

### 日志

```bash
sudo tail -n 200 /var/log/nginx/access.log
sudo tail -n 200 /var/log/nginx/error.log
sudo docker compose -f /srv/projectai/docker-compose.prod.yml logs --tail=200
```

### 回滚

每次 rsync 发布前保留上一部署目录：

```bash
sudo mv /srv/projectai /srv/projectai.failed.$(date +%Y%m%d%H%M%S)
sudo mv /srv/projectai.backup.<timestamp> /srv/projectai
cd /srv/projectai
sudo docker compose -f docker-compose.prod.yml up -d --build
curl -I https://gridworks.cn/tool/projectai/
```

若只需回滚容器代码且上一目录仍在，可先停止当前容器，再从备份目录重新构建。回滚不需要修改 DNS 或替换现有 HTTPS 证书。

### 常见问题

- 静态资源 404 或 MIME 错误：确认构建时 `NEXT_PUBLIC_BASE_PATH=/tool/projectai`；通用应用代理不带尾部 `/`，而 `/tool/projectai/assets/` 窄范围代理按示例映射到上游 `/assets/`。
- 深层路由 404：确认请求完整转发到应用，没有在 Nginx 中剥离 `/tool/projectai`。
- 修改 basePath 后页面仍旧：重新构建镜像，单独修改运行时环境变量不会更新客户端资源路径。
- 容器不健康：先查看 Compose 日志并修复应用，不要在上游未通过健康检查前修改或 reload Nginx。

## v0.8 B3-B2：Evaluated Hybrid Retrieval

项目助手现在通过统一服务获取 Evidence。服务端 Mode 默认为 `lexical`，Staging 依次经过 `shadow` 和质量门禁后才可进入 `hybrid`；客户端不能选择 Mode 或提交检索内部参数。冻结的 `hybrid-rrf-v1` 使用原词法候选、PostgreSQL `embedding <=> query_vector` 精确 cosine 检索和确定性 RRF，Coverage 或 Query Embedding 异常时回退原词法结果。

```bash
npm run retrieval:evaluate
npm run retrieval:probe
npm run retrieval:shadow-report
npm run retrieval:status
```

评测集是 60 条纯虚构 Query，报告 HitRate/Recall/MRR/nDCG、无答案误报、安全泄漏和延迟门禁。Query Vector 不持久化、不进入浏览器或 Evidence；Query Embedding 使用独立不可变成本账本。本轮没有 ANN/HNSW/IVFFlat、Rerank 或 `qwen3-rerank`，用户知识搜索仍为词法检索，Production 未上线 B3-B2。

## B3-C1：Production Release Readiness

```bash
npm run release:inventory
npm run release:diff
npm run release:manifest
npm run release:preflight
npm run release:database-rehearsal
npm run release:smoke
npm run release:rollback-check
npm run release:go-no-go
```

工具默认 dry-run，Artifact 使用 canonical JSON SHA-256 和强脱敏；CI 使用 Fake Provider、临时 PostgreSQL/pgvector、临时 MinIO 与纯虚构数据，执行 Backup/Restore/0004–0007、新 Image 全关闭、Smoke、Rollback 和现有 B3-A/B3-B1/B3-B2 回归。当前 Production 没有 ProjectAI PostgreSQL/MinIO 数据面，所以 B3-C1 的 Production Backup 是明确的 dry-run/not-applicable 证据，不触碰无关宿主机数据库。

## B3-C2A guarded rollout executor

B3-C2A 只开发并隔离演练分阶段 Production Rollout Executor；Production 仍未部署 B3 数据面或 AI。执行器提供签名 Authorization、Phase 0–6、原子 Deployment Lock、Digest Journal、Status/Resume/Rollback、Observation/Cost/Stop Gates、私有 Production Compose 和最小 Secret Scope。正式 Production Apply 默认返回 `PRODUCTION_APPLY_NOT_AUTHORIZED`；本 PR 不生成 formal Authorization，正式上线属于独立 B3-C2B。

```bash
npm run production:phase -- --phase=0 --environment=production --dry-run ...
npm run production:verify -- --phase=0 --environment=production ...
npm run production:status -- --environment=production ...
npm run production:resume -- --phase=0 --environment=production ...
npm run production:rollback -- --phase=0 --environment=production --dry-run ...
npm run production:finalize -- --environment=production ...
npm run production:lock:review -- --environment=production ...
npm run production:image -- plan --session=<release-session>
npm run test:production-rollout
npm run production:rehearsal
```

C1/C2/D 冻结；Rerank、ANN、OCR、Tool Calling 与 Agent Execution 未开始。
