# Project AI OS

面向项目经理的 AI 项目交付工作台 MVP。它以项目为核心容器，将项目资料、知识、结构化需求、AI 工作流、人工审核、Scope 变更、Action Plan 与风险管理串联起来。

> **安全提示：v0.3 已实现数据库身份、Session 和项目隔离，但项目资料、知识、需求与 AI 内容仍为 Mock。本轮没有文件上传或对象存储，禁止录入真实客户资料。**

## 已实现能力

- 企业账号登录：Better Auth 邮箱/密码认证、数据库 Session、HttpOnly Cookie、token 最小化/no-store 响应、停用撤销、退出、基础登录限流和写请求的精确 Origin/JSON 边界；只开放登录、Session 查询和退出端点，不开放公共注册或账户管理端点。
- 项目隔离：`system_admin` / `standard_user` 系统角色，`project_manager` / `project_member` / `viewer` 项目角色，以及统一服务端 404 防枚举授权。
- PostgreSQL 基础：Drizzle Schema、已提交 Migration、insert-only 幂等环境变量 Seed、受保护的测试库 Reset、数据库项目列表/创建/基础信息/成员关系和审计事件。
- 工作台：项目进度、AI 审核、风险、待办、AI 活动和状态演示。
- 项目管理：搜索、组合筛选、排序、分页、列控制和项目创建。
- 项目空间：概览、资料、知识、需求、Scope、Action、会议、风险八个模块。
- 项目知识：九层知识结构、预设/自定义问答、有效版本过滤与来源引用。
- 需求中心：TanStack Table、批量操作、CSV 导出和可编辑 Requirement Drawer。
- AI 工作流：可视步骤、执行日志、真实 Mock Gateway 调用、失败与备用路由重试。
- 审核中心：三栏审核、差异、证据、执行信息、通过/修改后通过/驳回/草稿/重新生成。
- 系统治理：Skills 只读详情、Provider/Model/Profile/关系/调用/成本视图。

AI 产出始终以草稿或待审核状态存在；当前人工审核只产生 Mock 状态反馈，正式业务写入尚未实现。

## 技术栈

- Next.js App Router（vinext / Cloudflare Worker 兼容构建）
- React 19、TypeScript strict、Tailwind CSS 4
- Better Auth `1.6.23`、Drizzle ORM、PostgreSQL 17
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
  → Workflow
  → Skill（只保存 modelProfileId）
  → AI Gateway
  → Model Profile Registry
  → Model Router
  → Provider Adapter / MockAIProvider
  → Execution Logger + Cost Calculator
  → AI 草稿
  → 人工审核
  → Mock 审核反馈（正式项目数据写入尚未实现）
```

项目页面先在服务端从 Session 建立用户身份，再从 PostgreSQL 查询项目成员关系。项目详情授权成功后，服务端才按精确 `projectId` 映射并序列化 Mock 文档、知识、需求、Scope、Action、会议、风险与 AI execution；客户端不会收到其他项目的业务 Mock。

项目问答仍是 Mock，并返回来源引用、置信度和有效版本等演示信息。当前没有文档解析、Embedding、RAG、Reranker 或真实模型调用。

## 目录

```text
app/                    App Router 入口与全局 Design Tokens
components/             布局、公共组件和业务页面
config/                 导航、状态映射、AI 默认配置
data/mock/              主要项目业务 Mock 数据
drizzle/                已提交的 PostgreSQL Migration
lib/auth/               Better Auth、Session、授权与浏览器安全视图
lib/db/                 PostgreSQL Client、Schema 与 Repository
lib/project-data/       授权后的服务端 Mock 映射
lib/ai/                 Gateway、Provider、Registry、Router、fixtures、日志、成本
lib/knowledge/          项目知识检索、问答与引用服务
scripts/db/             Migration、幂等 Seed 与测试库 Reset
types/                  严格 TypeScript 领域模型
tests/                  SSR、授权集成、跨项目和产品流程 E2E
docs/                   MVP 规格、验收、流程、架构、测试与部署事实来源
.github/                CI、Issue 模板与 PR 模板
```

## 数据边界

- 真实 PostgreSQL：用户、`accounts.password_hash` credential hash（`users` 无重复 hash）、Session、登录限流、项目、项目成员关系、项目基础信息和审计事件。
- CI/本地 Seed：缺失时创建 5 个预创建用户、3 个项目及成员关系；重跑不会重新激活账号、重置角色、覆盖项目编辑或替换 credential hash。
- 仍为 Mock：文件、知识问答、引用内容、需求、Scope、Action、会议、风险、审核和 AI execution。
- 未实现：上传、对象存储、解析/OCR、Embedding、RAG、真实模型和 Provider Key。

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
```

`db:reset:test` 会拒绝远程主机或名称不含 `test` / `ci` 的数据库。Playwright 失败时会在 CI 工作区保留 HTML report、screenshot、video、trace 和运行时错误日志；CI 随后把这些原始目录复制到 `product-review-evidence/`，按内容特征递归处理改名或嵌套 ZIP、gzip 与 Report 内嵌 ZIP，同时清理敏感路径名和任意文本中的 Session 数据，脱敏并复核成功后才上传该副本，保留 14 天。脱敏失败时整个 CI 失败且不上传未经确认的证据。完整策略见 [docs/TESTING.md](./docs/TESTING.md)。

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

Staging 使用独立目录 `/srv/projectai-staging`、应用容器 `project-ai-os-staging`、数据库容器 `project-ai-os-staging-postgres`、命名卷 `projectai-staging-postgres`、端口 `127.0.0.1:3101` 和 basePath `/tool/projectai-staging`。PostgreSQL 只连接内部 Docker 网络，不发布宿主机或公网端口。

服务器凭据保存在 `/srv/projectai-staging/.env.auth-staging`，权限必须为 `600`；部署脚本只从当前 Commit 的 `git archive` 构造发布内容，不会同步工作区 ignored 文件，也不会移动或打印该环境文件。部署开始前必须原子取得 Staging 专属锁，失败事务标记需要人工或成功回滚后才能清除。Staging 与 Production 使用不同的认证 URL、Cookie 前缀和 Cookie Path。本分支的 v0.3 Staging 运行验收仍以 `docs/MVP_STATUS.md` 为准，不能用上一版在线状态替代。

Compose 按容器最小化注入 Secret：PostgreSQL 只接收数据库初始化变量，短生命周期 Migration/Seed 容器才接收 Seed 凭据，应用容器只接收运行必需的 `DATABASE_URL` 与认证配置，不接收独立的 `POSTGRES_PASSWORD` 或 Seed 密码。应用、数据库和 operations 容器均设置 CPU、内存、PID 与滚动日志上限。每次 Migration 前，部署脚本先检查磁盘余量，再把 custom-format `pg_dump` 直接流式写入 root-only 备份，原子完成后只保留最近 10 份；替换应用后若验证失败，则自动恢复上一 Staging 应用镜像，数据库卷和发布前 dump 均保留。`/api/health` 只有在 PostgreSQL 可连接且 `users`、`sessions`、`projects`、`project_members` 关键表可查询时返回 `{"status":"ok"}`，不返回记录或连接信息。

顶部“反馈”入口只保存当前路径、反馈类型、描述、严重级别、构建信息、User Agent 和时间；不读取页面业务内容、上传文件、网络请求或项目数据。反馈保存在按环境隔离的 localStorage 中，可复制为 GitHub Issue Markdown。

## 后续接入

1. 在 v0.3 身份和项目隔离通过产品/安全审查后，再设计受控文件上传与独立对象存储。
2. 建立解析结果、版本、有效性和来源表，并让每条记录强制绑定 `projectId`。
3. 接入 PostgreSQL FTS/OpenSearch + pgvector 的 Hybrid Search，再增加 Reranker。
4. 保持 `ProjectKnowledgeService` 和 `AIGateway` 接口不变，逐步替换 Mock；Provider Key 只进入服务端 Secret。
5. 真实 AI 结论继续保留来源引用、人工审核和审计，不直接写入正式数据。

## Production 保护

生产地址：<https://gridworks.cn/tool/projectai>

v0.3 本轮只部署 Staging，禁止在 Production 服务器构建、重启、迁移或重新部署本应用。现有 Production 继续使用 `/tool/projectai`、`/srv/projectai`、`project-ai-os` 和 `127.0.0.1:3100`；进入远端发布事务前后及其任一失败退出路径都必须记录并比对 Production 容器 ID、运行状态、restart count 与 health。更早的本地、SSH、锁或环境预检失败不得产生 Production 写操作。

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
AI_PROVIDER=mock
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
