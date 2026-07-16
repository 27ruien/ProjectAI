# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.5.0-staging`（Document Processing and Knowledge Index Foundation / B2） |
| `main` 基线 | `a4a171d6c241ffd14e2d29a52a8a83e64942becb`（已合并 v0.4 Project Files Foundation） |
| 开发分支 | `agent/document-processing-index` |
| Draft PR | [#4 Add document processing and knowledge index foundation](https://github.com/27ruien/ProjectAI/pull/4)，OPEN / Draft / MERGEABLE / 未合并 |
| 最终 PR Head | 以 PR #4 当前 Head 为准；精确 SHA 记录在 PR 描述和 Provenance Manifest |
| 最终 CI | PR #4 当前 Head 对应完整 CI 全绿；精确 Run、tested merge SHA 和 Artifact 绑定记录在 PR 描述和 Provenance Manifest |
| Evidence / Provenance | 最终 CI 已生成并通过强 allowlist、实际 PNG 尺寸校验和脱敏；精确名称、ID 与 Digest 记录在 PR 描述 |
| Staging | https://gridworks.cn/tool/projectai-staging/；运行 PR #4 当前最终 Head，精确 SHA、Build Time、image digest 和健康状态记录在 PR 描述及受控部署证据 |
| Production | https://gridworks.cn/tool/projectai/；容器 ID/镜像、running、restart count `0`、health `healthy` 前后精确不变 |

## 当前结论

v0.5 B2 工程交付门禁已闭环：持久化解析任务、独立 Worker、六格式有界解析、Section/Chunk、来源定位、PostgreSQL FTS/contains/`pg_trgm`/`word_similarity`、版本与归档有效性、reindex、服务端权限/审计和真实项目知识搜索均通过最终 CI 与 Staging 实测。

这不授权合并或开始 B3。Draft PR 仍等待产品与安全人工审查；AI 综合回答、OCR、Embedding、RAG、Qwen 和正式 AI 业务写入均未实现。

## v0.5 真实能力

- `document_ingestion_jobs` 是 PostgreSQL 持久化队列，使用 `FOR UPDATE SKIP LOCKED`、实例级 Worker ID、Lease/Heartbeat、最大尝试次数、退避与终态约束。
- 独立 `project-ai-os-staging-worker` 与 App 使用同一 immutable image、不同 command；无端口、私网访问 PostgreSQL/MinIO、仅使用 Bucket scoped credential，并有 CPU/Memory/PID、日志轮转、优雅退出和文件心跳健康检查。
- Worker 只从数据库取得 Object Key，重新核对对象大小、ETag、SHA-256 和文件结构；解析在线程内运行并有硬超时，失败不会产生有效半成品索引。
- 支持 PDF、DOCX、XLSX、PPTX、TXT 和 Markdown：保留页码、标题/段落、Sheet/行列、Slide、文本行等来源定位；扫描型 PDF 进入 `needs_ocr`，本轮不执行 OCR。
- `document_sections` 保存自然结构；`document_chunks` 保存确定性字符分块、重叠、内容哈希、来源和 generated `tsvector`。索引只在 Job 仍持有 Lease 且版本仍有效时原子激活。
- 搜索只返回当前项目内 `Active + Current + Stored + Succeeded + Effective` 的 Chunk；支持 PostgreSQL FTS、contains 与 `pg_trgm`，结果包含文件、版本、原文片段和精确 Source Locator。
- 上传新 current、切换 current、归档、恢复和重新解析会在服务端事务内更新索引有效性；旧版本和归档资料不会继续作为当前知识。
- Manager/Admin 可重新解析；Member/Viewer 不可。所有跨项目资源继续统一 404，Viewer 可检索和下载来源文件。
- 项目知识页是真实词法搜索，不生成 AI 综合答案；需求、Scope、Action、会议、风险和 AI execution 仍为 Mock。

## 明确未实现

- OCR、图片提取、宏执行、公式计算或外部链接抓取。
- Embedding、pgvector、Hybrid Search、Reranker、RAG、Qwen 或任何真实模型/Provider Key。
- 自动总结、需求提取、Scope/Action/风险生成和 AI 正式业务写入。
- Production Worker、Production Migration 或 Production 部署。

## 当前验证状态

| 门禁 | 当前状态 |
| --- | --- |
| TypeScript / ESLint / Build / Parser / Artifact / Deployment | PR #4 当前 Head 对应最终 CI 全绿；Parser/Chunker `15/15`，部署契约 `16/16`；精确 Run 见 PR 描述和 Provenance Manifest |
| PostgreSQL + MinIO 集成 | CI 从空库执行 Migration/Seed；文件存储与文档 Queue/Lease/Search 集成全绿 |
| Playwright | `18/18`；覆盖六格式、状态、来源、Viewer、跨项目、版本、归档与 reindex |
| Evidence | Manifest schema v3；22 张 PNG 全部存在并读取实际尺寸：19 张 `1280×720`，`dashboard-admin` `1280×891`，`project-a-overview` `1280×1441`，`viewer-readonly` `1280×1477` |
| Artifact 脱敏 | `passed`；Session Token 数 `0`，禁止条目/不安全二进制/不安全归档删除数均 `0` |
| Staging 健康 | App / PostgreSQL / MinIO / Worker 均 Healthy；App/Worker 使用同一当前 Head immutable image，Worker/DB/MinIO 无宿主端口；精确 image digest 见 PR 描述及部署证据 |
| Staging 业务 | 内部与公网六格式 smoke 均通过：`succeeded=6`、`failed=1`、`needsOcr=1`；中文/英文/模糊搜索、Source Locator、权限、current/archive/reindex 均通过 |
| Queue / Lease | 独占 Lease、过期恢复、旧 Worker 拒绝提交、双 Worker `SKIP LOCKED` 均通过 |
| 清理 | 验收 Session、文档、版本、Job、Section、Chunk、对象、审计、running Job、解析临时文件全部 `0` |
| 备份恢复 | PostgreSQL custom dump 与 MinIO inventory/mirror 均生成并验证；MinIO 临时 Bucket 恢复演练通过且已删除 |
| Production | 发布前后容器身份、running、restart count 和 health 精确一致；未构建、迁移、重启、增加 Worker 或重新部署 |

## 合并前剩余步骤

1. 产品与安全复审最终 PR、Evidence、Provenance 和 Staging 证据。
2. 复审通过后才可 Ready 和 Squash Merge。
3. 合并前不得部署 Production，不得开始 B3 或接入 Qwen、Embedding、RAG。
