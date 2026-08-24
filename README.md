# Project AI

Project AI 是一个轻量的公司项目知识与效率工具。它以 Project 作为最小权限边界，由 RAGFlow 管理每个项目的文件解析与检索，再通过现有 AI Gateway 生成带来源的单项目或跨项目回答。

## Core

- Projects：项目列表、创建、编辑、负责人、成员、状态与时间。
- Knowledge：一个 Project 对应一个 RAGFlow Dataset；支持批量上传、解析状态、删除、重试、问答和来源引用。
- Cross-project AI：只查询当前用户后端授权的项目，每个项目独立限量检索，再合并有界 Evidence。
- Skills：以可移植 `SKILL.md` 管理正式资产；Weekly Report PoC 只构建授权 Execution Package，由 Codex、Claude、GPT 等外部 Agent 执行。没有 Workflow 或 Agent Runtime。

## Architecture

```text
Browser
  |
  v
Project AI Backend
  |-- Better Auth / Project authorization
  |-- PostgreSQL: User, Project, ProjectMember, Alias, Document mapping, Audit
  |-- Skill assets + deterministic context package (no model call)
  |-- RAGFlow official API: Dataset, Document, Parse, Retrieval
  `-- AI Gateway -> LLM: grounded synthesis and citation repair
```

Project AI 不连接 RAGFlow 的 MySQL、Elasticsearch、MinIO 或 Redis。浏览器不能提交 Dataset ID，也不会获得 RAGFlow URL、API Key、Chunk、Vector 或 Prompt。

## Permission Model

```text
Project Membership = Project Knowledge Access
```

所有项目请求都先经过 `requireProjectAccess()` 或 `requireProjectRole()`。跨项目查询先从服务端成员关系得到 authorized projects，再映射 Dataset。RAGFlow 返回后，后端还会用 Dataset ID 与本地 Document mapping 进行第二次 Evidence Guard。

## Local setup

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Seed 是 insert-only，并要求显式测试环境与各测试账号凭据。真实凭据不得提交到 Git。

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

数据库集成测试需要受保护的本地/CI 测试数据库：

```bash
npm run db:reset:test
npm run test:integration
```

## RAGFlow and deployment

当前固定官方稳定版为 `v0.27.0`，使用独立 CPU Docker Compose stack 和私有 Docker network。Project AI Slim stack 见 `docker-compose.slim.yml`；RAGFlow 的资源门禁、部署、API 验收和回滚命令见 `deploy/ragflow/README.md`。

现有旧 MinIO 只作为一次性迁移源，不属于 Slim Runtime。迁移命令：

```bash
npm run knowledge:migrate-ragflow -- --dry-run --all
npm run knowledge:migrate-ragflow -- --project PROJECT_ID
npm run knowledge:migrate-ragflow -- --all --resume
```

迁移完成、逐项目 Retrieval 验证和回滚观察期结束前，不删除旧对象或旧物理表。

## Documentation

- `docs/SLIM_DEPENDENCY_AUDIT.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/TESTING.md`
- `docs/CLEANUP_MIGRATION_PLAN.md`
- `docs/PROJECT_AI_SLIM_MIGRATION_REPORT.md`
- `docs/WEEKLY_REPORT_SKILL.md`
