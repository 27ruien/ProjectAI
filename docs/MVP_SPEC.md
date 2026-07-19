# Project AI OS MVP Spec

## 第一阶段产品定义

核心用户是项目经理，第一阶段只验证三个问题：编写项目文档耗时过长、项目信息分散难以查找、需求容易遗漏/重复/误解。

目标主流程：

```text
登录 → 选择授权项目 → 上传项目资料 → 安全持久化与版本管理
→ 文档解析与项目知识搜索 → Grounded AI 问答与来源引用
→ AI 提取需求草稿 → 人工修改与审核 → 写入正式需求
```

v0.4 已完成真实文件存储边界，v0.5 B2 已完成解析与词法索引，v0.6 B3-A 已完成受控问答，v0.7 B3-B1 已建立向量基础。v0.8 B3-B2 在保持用户知识搜索为词法的前提下，为项目助手提供经过评测的 Hybrid Evidence：

```text
Stored Current Version → Durable Job → Independent Worker
→ Parser → Section → Chunk → Lexical Index
→ Project-scoped Search → Source Locator
→ Grounded Evidence → Qwen Answer → Validated Citation
→ Embedding Job → Dedicated Worker → text-embedding-v4 → vector(1024)
→ Query Embedding → Exact Vector + Lexical → RRF → Assistant Evidence
```

本轮只把向量接入项目助手 Evidence，使用服务端 Mode、Coverage Gate、成本账本、Shadow、Fallback 和 60 Query 质量门禁；用户知识搜索、Rerank、ANN、Tool Calling 和正式需求写入仍不在范围。

## v0.7 — Embedding and pgvector Foundation / B3-B1

- 固定只读 Profile `qwen-text-embedding-cn-v1`：Qwen、`cn-beijing`、`text-embedding-v4`、1024 维 cosine、Profile Version 1。
- PostgreSQL 17 + pgvector 0.8.1 保存 Chunk Embedding；project/document/version/chunk/content Hash 由复合约束绑定，向量不进入普通浏览器 API。
- 独立 Embedding Job/Batch/不可变 Provider Call 与专用 Worker 复用 B2 的 `FOR UPDATE SKIP LOCKED`、Lease、Heartbeat、Retry、Stale Recovery 和旧 Worker 拒绝提交。
- 只处理 Active Document、Current/Stored Version、Succeeded Ingestion、Effective/non-empty Chunk；归档、旧版本、needs_ocr、未完成解析和同 Hash current 向量排除。
- Backfill 默认 dry-run，支持 project/limit/current/effective 范围；Provider Usage 原样记录，缺失/unknown 按 `min(itemCount × 8192, 33000)` 版本化硬上限持有预算，只有发送前 confirmed-no-charge 释放，并有每日 Job/Token 上限。
- 一旦进入 Provider `fetch`，Timeout、网络、HTTP 拒绝、2xx 解析/校验失败或本地提交失败都必须终止为不可自动重试的 `PROVIDER_RESULT_UNKNOWN`；人工恢复保留旧 Call/预算并新增调用级预留。
- B2 知识搜索和 B3-A Grounded Assistant 继续使用词法检索；B3-B1 只允许测试/受保护运维的精确 cosine Probe，不实现 ANN、Hybrid Retrieval、RRF 或 Rerank。

## v0.6 — Grounded Qwen Project Assistant / B3-A

### 服务端闭环

`Session Principal → Project/Thread 授权 → B2 词法 Evidence → Grounded Prompt → AI Gateway → Qwen → Citation Validation/一次 Repair → AI 持久化 → 公开来源 DTO`。

- 固定 Profile：`qwen-project-assistant-cn-v1`。
- 主模型：`qwen3.7-plus`；主模型初始调用加最多 2 次网络/Timeout/429/5xx 重试。
- Fallback：主模型耗尽后仅调用一次 `qwen3.6-flash`。
- 非 Streaming；未经引用验证的 Token 不发送到浏览器。
- 无 Evidence 时不调用 Provider，返回 `insufficient_evidence`。

### 数据与权限

- `ai_model_profiles` 是服务端只读配置；`ai_threads` 默认创建者私有。
- `ai_messages` 只保存用户/助手业务消息，不保存 System Prompt 或原始 Provider Payload。
- `ai_executions` 保存状态、Profile、模型、Fallback、Token Usage、Latency、问题 Hash、幂等键和受控失败码。
- `ai_message_citations` 保存服务端来源快照，并以复合外键绑定 Project、Thread、Message 和 B2 Chunk。
- Admin、Manager、Member、Viewer 均可在有项目读取权限时使用自己的助手；跨项目和他人 Thread 统一 404。

### 安全和成本

- Staging/Production 只能从 Secret File 读取 Qwen Key；Secret 只挂 App。
- 每用户每分钟 6 次、用户每日 100000 Token、项目每日 500000 Token、全局同时运行 3 个 Execution。
- Evidence 是不可信文本，不能改变 System 规则、读取文件、访问 URL、调用工具或泄露 Secret。
- SEC-006 已关闭：B3-A 只能写 AI 表和 Audit，不能写正式 Requirement、Scope、Action、Risk、Meeting、Project Setting 或 Document。

### B3-B 边界

Embedding、`text-embedding-v4`、pgvector、向量索引、Hybrid Retrieval、`qwen3-rerank` 和 Reranker 均不在 B3-A。

## v0.5 — Document Processing and Knowledge Index Foundation（历史已完成范围）

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

### v0.5 当时的 UI 合同

- 资料页和版本抽屉显示 `not_started`、`pending`、`running`、`succeeded`、`failed`、`needs_ocr`，具备 Loading、Error、Retry、Polling 和 reindex。
- 项目知识页是真实搜索：查询、资料筛选、空态、加载、错误重试、结果片段、文件/版本和精确来源。
- v0.5 交付时页面声明尚无 AI 综合回答；v0.6 B3-A 已以独立项目助手替换该历史边界，公开词法搜索仍不得伪装成 AI 结论。
- 需求、Scope、Action、会议和风险仍为 Mock，且不参与真实文件搜索；AI Execution 已由 v0.6 B3-A 真实化。

## 权限矩阵

| 角色 | 搜索/查看来源 | 下载原文件 | 上传 | reindex | current/归档/恢复 |
| --- | --- | --- | --- | --- | --- |
| `system_admin` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `project_manager` | 允许 | 允许 | 允许 | 允许 | 允许 |
| `project_member` | 允许 | 允许 | 允许 | 禁止 | 禁止 |
| `viewer` | 允许 | 允许 | 禁止 | 禁止 | 禁止 |

前端隐藏按钮不承担授权；写限制和项目归属必须由服务端执行。

## 明确不在 v0.5 B2 范围（历史）

- OCR、图片理解、音视频、压缩包通用文件管理。
- Embedding、pgvector、Hybrid Search、Reranker、RAG。
- Qwen、OpenAI 或其他真实 Provider/模型/API Key。
- 自动总结、需求/Scope/Action/风险/周报生成。
- AI 草稿写入正式业务数据。
- Production Migration、Worker、MinIO 变更、构建、重启或部署。

## v0.5 历史交付门禁

v0.5 当时的开发分支为 `agent/document-processing-index`、版本为 `0.5.0-staging`。该阶段已通过 PR #4 完成交付；以下保留为历史证据合同：

- 从空 PostgreSQL 17 执行 Migration 和 `pg_trgm` 验证。
- PostgreSQL + MinIO + Worker 的解析、Lease、并发、版本、归档、权限和搜索集成证据。
- Playwright 六格式、状态、来源、Viewer、跨项目、reindex 和无运行错误证据。
- 原有截图加 10 张 B2 截图；Manifest 从 PNG 读取每张实际宽高，并记录 Worker/Parser/Chunker Version。
- Staging App/PostgreSQL/MinIO/Worker Healthy、备份恢复、业务 smoke、测试 Session/文档/版本/Job/Section/Chunk/对象/running Job/临时文件均为 0。
- Production 容器身份、运行状态、restart count 与 health 在部署前后精确不变。

当前实际进度以 `docs/MVP_STATUS.md` 为准。

## v0.8 B3-B2：Evaluated Hybrid Retrieval

- 仅改变 B3-A 项目助手的 Evidence Retrieval；B2 用户知识搜索、Answer Prompt、Citation Validation 与正式业务数据边界不变。
- `hybrid-rrf-v1` 冻结 Lexical/Vector/Fused=30、Evidence=10、RRF K=60、权重 1:1、cosine 最大距离 0.55、Coverage=9800 bps。
- Exact Vector SQL 必须用 `embedding <=> query_vector` 并绑定精确项目、Active Document、Current/Stored Version、Succeeded Ingestion、Effective Chunk、内容 Hash 和 Embedding Profile；禁止 ANN。
- `lexical` 不调用 Query Embedding；`shadow` 记录 Hybrid 但向 Prompt 交付 Lexical；`hybrid` 交付 RRF Evidence。所有异常均回退原 Lexical，Lexical 为空则保持 Evidence Insufficient 且不调用 Answer Model。
- Query Embedding 走 Provider-neutral Gateway，1024 维，向量只驻留请求内存；调用使用 UTC 日预算、硬预留、真实 Usage 结算和发送后 `unknown` 不自动重试。
- 上线门禁为 60 条虚构 Query 的安全、整体质量、语义提升、精确事实、无答案和性能指标。Staging 必须按 lexical→shadow→hybrid；Production 保持不变。
- 本轮不实现 Rerank、`qwen3-rerank`、HNSW、IVFFlat、其他 ANN、B3-B3 或正式业务写入。
