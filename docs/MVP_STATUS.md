# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.5.0-staging`（Document Processing and Knowledge Index Foundation / B2） |
| `main` 基线 | `a4a171d6c241ffd14e2d29a52a8a83e64942becb`（已合并 v0.4 Project Files Foundation） |
| 开发分支 | `agent/document-processing-index` |
| Draft PR | 待创建；标题固定为 `Add document processing and knowledge index foundation` |
| B2 CI / Evidence | 待最终 Commit 推送后由 GitHub Actions 生成；不得用 v0.4 Run 或 Artifact 代替 |
| Staging | 待最终 CI 通过后仅部署 https://gridworks.cn/tool/projectai-staging/ |
| Production | https://gridworks.cn/tool/projectai/；B2 禁止构建、迁移、重启、增加 Worker 或重新部署 |

## 当前结论

v0.5 B2 已在本地工作树完成核心实现：持久化解析任务、独立 Worker、六种文件格式的有界解析、Section/Chunk、来源定位、PostgreSQL 全文与 `pg_trgm` 模糊检索、版本/归档有效性切换、重建索引、服务端权限与审计，以及真实项目知识搜索页面。

这不等于交付完成。最终 Commit、Draft PR、远端 CI、22 张产品截图及实际尺寸、Payload A/Provenance B、Staging Migration/Worker/业务验收和 Production 精确不变证据仍待完成。不得在这些门禁前声明 B2 已交付或合并。

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
| TypeScript / ESLint / parser unit / artifact / deployment contract | 本地执行并持续修复；最终结果以提交前完整回归为准 |
| PostgreSQL + MinIO 集成 | 测试已实现；本机无可用隔离服务时由 CI 从空库执行 Migration 后验证 |
| Playwright | B2 流程已实现，覆盖六格式、状态、来源、Viewer、跨项目、版本、归档与 reindex；最终截图只接受 CI 实际产物 |
| Evidence | Manifest schema v3 已记录 Worker/Parser/Chunker 版本及每张 PNG 的实际宽高，不再硬编码统一 viewport |
| Staging | 未部署；受控脚本已补齐内部/公网六格式搜索冒烟、暂停 Worker 的 Lease/SKIP LOCKED 验收及失败重试遗留清理，最终仍须在 CI 通过后实际执行 |
| Production | 不得改变；部署前后必须比较容器身份、运行状态、restart count 与 health |

## 合并前剩余步骤

1. 完成完整本地门禁，确认 Migration、类型、Lint、Build、单元、集成、E2E、Artifact 和部署契约。
2. 提交并推送 `agent/document-processing-index`，创建 Draft PR，不自动合并。
3. 等待最终 Head 的 CI 全绿并复核 22 张截图、实际尺寸、Payload A 与 Provenance B。
4. 仅部署 Staging；验证 App/PostgreSQL/MinIO/Worker、六格式解析、搜索、来源、权限、版本/归档/reindex、Lease 与清理。
5. 更新本文件为实际 Run、Artifact、Staging SHA、健康状态和 Production 不变证据，等待产品与安全审查。
