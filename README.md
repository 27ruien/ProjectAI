# Project AI OS

面向项目经理的 AI 项目交付工作台 MVP。它以项目为核心容器，将项目资料、知识、结构化需求、AI 工作流、人工审核、Scope 变更、Action Plan 与风险管理串联起来。

> **安全提示：当前版本仍为 Mock 演示版。未完成正式身份认证和项目权限隔离前，禁止上传真实客户项目资料。**

## 已实现能力

- 工作台：项目进度、AI 审核、风险、待办、AI 活动和状态演示。
- 项目管理：搜索、组合筛选、排序、分页、列控制和项目创建。
- 项目空间：概览、资料、知识、需求、Scope、Action、会议、风险八个模块。
- 项目知识：九层知识结构、预设/自定义问答、有效版本过滤与来源引用。
- 需求中心：TanStack Table、批量操作、CSV 导出和可编辑 Requirement Drawer。
- AI 工作流：可视步骤、执行日志、真实 Mock Gateway 调用、失败与备用路由重试。
- 审核中心：三栏审核、差异、证据、执行信息、通过/修改后通过/驳回/草稿/重新生成。
- 系统治理：Skills 只读详情、Provider/Model/Profile/关系/调用/成本视图。

AI 产出始终以草稿或待审核状态存在，只有人工通过后才进入正式数据写入队列。

## 技术栈

- Next.js App Router（vinext / Cloudflare Worker 兼容构建）
- React 19、TypeScript strict、Tailwind CSS 4
- TanStack Table、React Hook Form、Zod、Lucide Icons
- localStorage 保存演示交互状态
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
  → 正式项目数据写入队列
```

项目问答通过 `ProjectKnowledgeService`，返回回答、引用、置信度、有效版本、执行 ID、Model Profile、延迟与 Mock 成本。当前服务使用集中 Mock 数据，接口已为 Hybrid Search、Metadata/Version/Permission Filter、Reranker 和 Evidence Citation 预留。

## 目录

```text
app/                    App Router 入口与全局 Design Tokens
components/             布局、公共组件和业务页面
config/                 导航、状态映射、AI 默认配置
data/mock/              唯一 Mock 数据源
lib/ai/                 Gateway、Provider、Registry、Router、日志、成本
lib/knowledge/          项目知识检索、问答与引用服务
types/                  严格 TypeScript 领域模型
tests/                  SSR、路由和架构回归测试
docs/                   MVP 规格、验收、流程、架构、测试与部署事实来源
.github/                CI、Issue 模板与 PR 模板
```

## Mock 数据规模

8 个项目、30 条需求、15 份文档、4 个 Scope 版本、20 条 Action、8 条风险、10 条 AI 活动、8 条审核任务、10 个 Skills、4 个 Provider、6 个中性模型、9 个 Model Profiles、20 条 AI 执行、20 条引用、6 场会议与 10 条决策。

## 本地运行

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run qa:mvp
```

Playwright 失败时会保留 HTML report、screenshot、video、trace 和运行时错误日志。完整测试策略见 [docs/TESTING.md](./docs/TESTING.md)。

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

Staging 使用独立目录 `/srv/projectai-staging`、容器 `project-ai-os-staging`、端口 `127.0.0.1:3101` 和 basePath `/tool/projectai-staging`，不得复用或重建 Production。页面全局显示环境、版本、Commit、构建时间和禁止真实资料提示，并设置 noindex。

顶部“反馈”入口只保存当前路径、反馈类型、描述、严重级别、构建信息、User Agent 和时间；不读取页面业务内容、上传文件、网络请求或项目数据。反馈保存在按环境隔离的 localStorage 中，可复制为 GitHub Issue Markdown。

## 后续接入

1. 用服务端 Provider Adapter 替换 `MockAIProvider`，密钥只进入托管环境变量。
2. 将结构化对象迁移到 PostgreSQL，并按 `projectId`、版本和权限建立索引。
3. 原始文件写入对象存储，解析结果写入知识分块表。
4. 接入 PostgreSQL FTS/OpenSearch + pgvector 的 Hybrid Search，再增加 Reranker。
5. 保持 `ProjectKnowledgeService` 和 `AIGateway` 接口不变，逐步替换 Mock 实现。
6. 第二阶段可在现有 Skill/Workflow/Review 契约上扩展原型生成、页面生成与自动化测试。

## 生产部署

生产地址：<https://gridworks.cn/tool/projectai>

应用以 `/tool/projectai` 作为 Next.js `basePath`。`NEXT_PUBLIC_BASE_PATH` 是构建时配置，修改后必须重新构建镜像；应用内的 `next/link` 和 Router 继续使用 `/dashboard` 等逻辑路径，不要手工重复前缀。

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

容器内监听 `0.0.0.0:3000`，宿主机只暴露 `127.0.0.1:3100`。健康检查地址为：

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
