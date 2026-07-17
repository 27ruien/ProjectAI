# Project AI OS

面向项目经理的 AI 项目交付工作台 MVP。它以项目为核心容器，将项目资料、知识、结构化需求、AI 工作流、人工审核、Scope 变更、Action Plan 与风险管理串联起来。

> **安全提示：v0.6 B3-A 在 B2 词法索引之上实现了带服务端引用校验的 Qwen 项目助手。它不是向量 RAG：OCR、Embedding、pgvector、Hybrid Retrieval、Rerank、Tool Calling 和正式业务写入仍未实现。真实 Provider 只允许在受控 Staging 使用 Secret File，测试和演示只能使用虚构文件。**

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
- 需求中心：TanStack Table、批量操作、CSV 导出和可编辑 Requirement Drawer。
- AI 工作流：项目助手使用真实 AI Gateway；其他需求提取、Scope、Action 和风险工作流仍为 Mock。
- 审核中心：三栏审核、差异、证据、执行信息、通过/修改后通过/驳回/草稿/重新生成。
- 系统治理：Skills 只读详情、Provider/Model/Profile/关系/调用/成本视图。

AI 产出始终以草稿或待审核状态存在；当前人工审核只产生 Mock 状态反馈，正式业务写入尚未实现。

## 技术栈

- Next.js App Router（vinext / Cloudflare Worker 兼容构建）
- React 19、TypeScript strict、Tailwind CSS 4
- Better Auth `1.6.23`、Drizzle ORM、PostgreSQL 17
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
/analytics
/settings
/settings/ai-models
/settings/ai-models/[profileId]
```

## AI 与知识架构

```text
业务页面
  → Project Assistant Service
  → B2 Project Evidence Retrieval
  → Grounded Prompt（Evidence 与规则分区）
  → AI Gateway
  → qwen-project-assistant-cn-v1
  → Qwen Provider Adapter
  → Citation Validation / 一次 Repair
  → Thread + Message + Execution + Citation + Audit
```

项目页面先在服务端从 Session 建立用户身份，再从 PostgreSQL 查询项目成员关系。资料 API 继续验证 `projectId → documentId → versionId` 归属，再访问 PostgreSQL 文件元数据和私有对象存储；Bucket、Endpoint、Object Key 与凭据不会序列化给浏览器。其他业务模块仍在授权后按精确 `projectId` 映射 Mock 数据，客户端不会收到其他项目内容。

项目知识页继续保留真实词法搜索与来源定位，并由服务端内部检索为项目助手提供最多 10 条、总计最多 24000 字符的 Evidence。没有合格 Evidence 时不调用模型；有 Evidence 时由 Qwen 生成回答，服务端只接受本次 Evidence 标记并生成公开来源 DTO。当前没有 OCR、Embedding、pgvector、Hybrid Retrieval 或 Reranker。

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
scripts/db/             Migration、幂等 Seed 与测试库 Reset
types/                  严格 TypeScript 领域模型
tests/                  SSR、授权集成、跨项目和产品流程 E2E
docs/                   MVP 规格、验收、流程、架构、测试与部署事实来源
.github/                CI、Issue 模板与 PR 模板
```

## 数据边界

- 真实 PostgreSQL：用户、credential、Session、项目/成员、逻辑资料、文件版本、解析 Job、Section、Chunk、generated `tsvector`、有效性和审计事件。
- 真实对象存储：不可变文件正文；数据库只保存服务端生成的 Object Key，不保存正文，客户端不返回 Key/Endpoint/Bucket。
- CI/本地 Seed：缺失时创建 5 个预创建用户、3 个项目及成员关系；重跑不会重新激活账号、重置角色、覆盖项目编辑或替换 credential hash。
- 真实 PostgreSQL AI 状态：模型 Profile、私人 Thread、Message、Execution、Citation、Token Usage、限流和 Audit。
- 仍为 Mock：需求、Scope、Action、会议、风险、审核任务和相关生成工作流。
- 未实现：OCR、Embedding、pgvector、Hybrid Retrieval、Rerank、Tool Calling 和正式业务写入。

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
npm test
npm run test:e2e
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
```

`db:reset:test` 会拒绝远程主机或名称不含 `test` / `ci` 的数据库。文件集成测试还要求隔离的 S3-compatible 测试存储；CI 每次创建随机 MinIO 凭据和临时 Bucket，并在 `always()` 收尾销毁。

`storage:verify` 只读核对数据库与对象存储；`storage:reconcile` 默认也是 dry-run。`--apply` 需要非 Production、显式开关、精确 Bucket 确认和最小对象年龄，删除前仍会二次检查数据库引用。

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

Staging 使用独立目录 `/srv/projectai-staging`、应用容器 `project-ai-os-staging`、Worker `project-ai-os-staging-worker`、数据库容器/卷 `project-ai-os-staging-postgres` / `projectai-staging-postgres`、MinIO 容器/卷 `project-ai-os-staging-minio` / `projectai-staging-minio`、Bucket `projectai-staging-files`、端口 `127.0.0.1:3101` 和 basePath `/tool/projectai-staging`。Worker/PostgreSQL/MinIO 只连接内部 Docker 网络且不发布端口。

认证和存储凭据保存在 `/srv/projectai-staging/.env.auth-staging`；AI 非密钥配置保存在 `/srv/projectai-staging/.env.ai`；Qwen Key 只存在于 `/srv/projectai-staging/secrets/qwen_api_key` 并只读挂载到 App。Worker 不获得 Qwen 配置或 Secret。部署先保持 Flag 关闭，健康后执行固定 Provider Probe，成功后只重建 App，再运行虚构资料的真实问答与清理 Smoke。稳定状态见 [MVP_STATUS](./docs/MVP_STATUS.md)，动态 SHA、CI、Artifact 和 image 事实只记录在 Draft PR 与 Provenance。

Compose 按容器最小化注入 Secret：Worker 只接收数据库连接和 Bucket-scoped object credential，不接收认证/Seed/MinIO root credential。App、Worker、数据库、MinIO 和 operations 均设置资源/日志上限。

每次 Migration 前，部署脚本同时停止 App 和 Worker，创建并验证 PostgreSQL custom dump、MinIO JSONL inventory 和 root-only Bucket mirror；Migration 后验证 `pg_trgm`，先启动 Worker 再启动 App。普通部署/回滚保留 PostgreSQL/MinIO 命名卷及备份。

顶部“反馈”入口只保存当前路径、反馈类型、描述、严重级别、构建信息、User Agent 和时间；不读取页面业务内容、上传文件、网络请求或项目数据。反馈保存在按环境隔离的 localStorage 中，可复制为 GitHub Issue Markdown。

## 后续接入

1. 完成 v0.6 B3-A 产品与安全人工审查；Draft PR 不自动 Ready 或合并。
2. B3-B 单独评审 Embedding、pgvector、Hybrid Retrieval 与 Reranker，不得混入 B3-A。
3. 保持 `ProjectKnowledgeService` 和 `AIGateway` 稳定边界；Provider Key 只进入服务端 Secret File。
4. 项目助手回答必须显示来源并保留审计，不直接覆盖正式数据。

## Production 保护

生产地址：<https://gridworks.cn/tool/projectai>

v0.6 B3-A 只允许部署 Staging，禁止在 Production 服务器构建、重启、迁移、增加 Worker/对象存储、配置 Qwen Secret 或重新部署本应用。现有 Production 继续使用 `/tool/projectai`、`/srv/projectai`、`project-ai-os` 和 `127.0.0.1:3100`；发布前后必须精确比对 Production 容器身份、运行状态、restart count 与 health。

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
