# Project AI OS MVP Spec

## 第一阶段产品定义

核心用户是项目经理，第一阶段只验证三个问题：编写项目文档耗时过长、项目信息分散难以查找、需求容易遗漏/重复/误解。

目标主流程：

```text
登录 → 选择授权项目 → 上传项目资料 → 安全持久化与版本管理
→ 文档解析与项目知识搜索 → 后续 AI 问答与来源引用
→ AI 提取需求草稿 → 人工修改与审核 → 写入正式需求
```

v0.4 已完成真实文件存储边界。v0.5 B2 只完成下一层基础能力：

```text
Stored Current Version → Durable Job → Independent Worker
→ Parser → Section → Chunk → Lexical Index
→ Project-scoped Search → Source Locator
```

本轮不接入 AI 综合回答、Embedding、RAG、Qwen 或正式需求写入。

## v0.5 — Document Processing and Knowledge Index Foundation

### 持久化任务与 Worker

- `document_ingestion_jobs` 绑定精确 `projectId`、`documentId`、`versionId`、Generation、Parser/Chunker Version。
- 领取使用 PostgreSQL `FOR UPDATE SKIP LOCKED`；解析在领取事务外执行。
- Running Job 必须有实例级 Worker ID、Lease、Heartbeat、Attempt；Lease 到期可重领，未到期不可被其他 Worker 获取。
- 完成时必须再次验证 Worker ID、Lease、版本归属、current/active 状态；Lease 丢失的 Worker 不得提交结果。
- 独立 Worker 与 App 使用同一 immutable image，独立 command，无端口、内部网络、scoped object credential、资源限制、日志轮转、优雅退出和心跳健康。

### 文件读取与解析安全

- Worker 只能从数据库记录取得 Object Key，浏览器和任务输入不能指定 Bucket、Endpoint 或 Key。
- 读取后重新核对大小、ETag、SHA-256 和受限文件结构。
- Parser 在可终止线程内运行，受页数、Slide、Sheet、行列、Cell、字符、Section、Chunk 和时间上限控制。
- DOCX/XLSX/PPTX 继续拒绝异常 ZIP、DTD/Entity、外部关系、宏和危险部件；不执行公式、脚本、宏或网络抓取。
- PDF 按页提取文字；文字不足的扫描件进入 `needs_ocr`，原文件仍可下载，本轮不执行 OCR。

默认配置：

```env
DOCUMENT_WORKER_POLL_MS=2000
DOCUMENT_WORKER_LEASE_SECONDS=120
DOCUMENT_WORKER_MAX_ATTEMPTS=3
DOCUMENT_MAX_PAGES=1000
DOCUMENT_MAX_SLIDES=1000
DOCUMENT_MAX_SHEETS=100
DOCUMENT_MAX_ROWS=100000
DOCUMENT_MAX_COLUMNS=1000
DOCUMENT_MAX_CELLS=500000
DOCUMENT_MAX_CHARACTERS=10000000
DOCUMENT_MAX_SECTIONS=20000
DOCUMENT_MAX_CHUNKS=50000
DOCUMENT_PARSE_TIMEOUT_MS=120000
DOCUMENT_CHUNK_TARGET_CHARS=1800
DOCUMENT_CHUNK_OVERLAP_CHARS=200
DOCUMENT_CHUNK_MIN_CHARS=120
DOCUMENT_PARSER_VERSION=1
DOCUMENT_CHUNKER_VERSION=1
```

### Section、Chunk 与来源

- PDF：Page。
- DOCX：Heading、Paragraph/List、Table，并保留 Heading Path 和段落范围。
- XLSX：只处理可见 Sheet，按行保存 Sheet、行列范围，不计算公式。
- PPTX：按 Slide 保存文字和 Slide Number。
- TXT：按文本行范围。
- Markdown：按 Heading Section 和行范围。
- Chunker 必须确定性输出，保留 Section 来源、Heading Path、字符数、估算 Token 数和内容 SHA-256。
- Parser/Chunker 版本变化或人工 reindex 使用新 Generation；旧 Generation 只有在新索引成功激活后失效。

### 词法搜索

- PostgreSQL Migration 创建 `pg_trgm`、generated `tsvector`、GIN FTS 和 trigram Index。
- 搜索组合 FTS、contains 和 `pg_trgm` similarity，并用标题/文件名等受控字段加权；排序稳定。
- 所有查询首先通过服务端 Session 和项目成员校验，SQL 必须精确限制 `project_id`。
- 只检索 Active 文档、Current/Stored 版本、Succeeded Job 和 `is_effective=true` Chunk。
- 返回浏览器的结果只含公开文件/版本元数据、受控片段、相关度和 Source Locator；不得包含 Object Key、Bucket、Endpoint、Lease、Worker ID 或正文导出。

### 版本与生命周期

- 上传完成后在同一数据库事务创建当前版本的解析 Job，并使旧 current 索引失效。
- 切换 current 时，有成功索引则原子激活；否则排队解析。
- 归档立即使索引失效；恢复后只激活当前版本的成功索引或创建新 Job。
- Manager/Admin 可 reindex；Member/Viewer 由服务端返回 403。
- 不存在或跨项目的 project/document/version/filter 统一返回 404。

### UI 合同

- 资料页和版本抽屉显示 `not_started`、`pending`、`running`、`succeeded`、`failed`、`needs_ocr`，具备 Loading、Error、Retry、Polling 和 reindex。
- 项目知识页是真实搜索：查询、资料筛选、空态、加载、错误重试、结果片段、文件/版本和精确来源。
- 页面必须声明当前没有 AI 综合回答；不得把词法命中包装成 AI 结论。
- 需求、Scope、Action、会议、风险及 AI execution 仍为 Mock，且不参与真实文件搜索。

## 权限矩阵

| 角色 | 搜索/查看来源 | 下载原文件 | 上传 | reindex | current/归档/恢复 |
| --- | --- | --- | --- | --- | --- |
| `system_admin` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `project_manager` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `project_member` | 允许 | 允许 | 允许 | 禁止 | 禁止 |
| `viewer` | 允许 | 允许 | 禁止 | 禁止 | 禁止 |

前端隐藏按钮不承担授权；写限制和项目归属必须由服务端执行。

## 明确不在 v0.5 B2 范围

- OCR、图片理解、音视频、压缩包通用文件管理。
- Embedding、pgvector、Hybrid Search、Reranker、RAG。
- Qwen、OpenAI 或其他真实 Provider/模型/API Key。
- 自动总结、需求/Scope/Action/风险/周报生成。
- AI 草稿写入正式业务数据。
- Production Migration、Worker、MinIO 变更、构建、重启或部署。

## 交付门禁

开发分支固定为 `agent/document-processing-index`，版本固定为 `0.5.0-staging`，Draft PR 不得自动合并。最终必须提供：

- 从空 PostgreSQL 17 执行 Migration 和 `pg_trgm` 验证。
- PostgreSQL + MinIO + Worker 的解析、Lease、并发、版本、归档、权限和搜索集成证据。
- Playwright 六格式、状态、来源、Viewer、跨项目、reindex 和无运行错误证据。
- 原有截图加 10 张 B2 截图；Manifest 从 PNG 读取每张实际宽高，并记录 Worker/Parser/Chunker Version。
- Staging App/PostgreSQL/MinIO/Worker Healthy、备份恢复、业务 smoke、测试 Session/文档/版本/Job/Section/Chunk/对象/running Job/临时文件均为 0。
- Production 容器身份、运行状态、restart count 与 health 在部署前后精确不变。

当前实际进度以 `docs/MVP_STATUS.md` 为准。
