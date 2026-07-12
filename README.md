# Project AI OS

面向项目经理的 AI 项目交付工作台 MVP。它以项目为核心容器，将项目资料、知识、结构化需求、AI 工作流、人工审核、Scope 变更、Action Plan 与风险管理串联起来。

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
npm run build
npm test
```

## 后续接入

1. 用服务端 Provider Adapter 替换 `MockAIProvider`，密钥只进入托管环境变量。
2. 将结构化对象迁移到 PostgreSQL，并按 `projectId`、版本和权限建立索引。
3. 原始文件写入对象存储，解析结果写入知识分块表。
4. 接入 PostgreSQL FTS/OpenSearch + pgvector 的 Hybrid Search，再增加 Reranker。
5. 保持 `ProjectKnowledgeService` 和 `AIGateway` 接口不变，逐步替换 Mock 实现。
6. 第二阶段可在现有 Skill/Workflow/Review 契约上扩展原型生成、页面生成与自动化测试。
