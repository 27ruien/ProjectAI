# Testing

## v0.8 B3-B2 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. Production build + SSR/代理：`npm test`。
4. 身份与项目隔离回归：`npm run test:integration`。
5. 文件校验与对象存储：`npm run test:storage`。
6. Parser/Chunker 单元：`npm run test:documents`。
7. PostgreSQL + MinIO + Worker/Queue/Search 集成：`npm run test:document-integration`。
8. Project Assistant 单元/架构：`npm run test:assistant`。
9. Embedding Adapter/Gateway/Worker 单元：`npm run test:embeddings`。
10. pgvector/Job/Lease/Backfill/隔离集成：`npm run test:embedding-integration`。
11. Project Assistant 数据库集成：`npm run test:assistant-integration`。
12. Retrieval/RRF/评测：`npm run test:retrieval`。
13. Retrieval/成本/隔离集成：`npm run test:retrieval-integration`。
14. Artifact/Provenance：`npm run test:artifacts`。
15. Staging/Worker/AI Secret/Probe/备份部署契约：`npm run test:deployment`。
16. Playwright 身份、文件、解析、知识搜索和 Grounded Assistant：`npm run test:e2e`。
17. 完整本地门禁：`npm run qa:mvp`。

B3-A 新增覆盖 Secret File、Profile、私人 Thread、复合归属、幂等、B2 Evidence、Prompt 分区、Prompt Injection、Citation Validation/Repair、无 Evidence 不调用 Provider、Timeout/429/5xx 重试、401/403 不重试、Fallback、Token Usage、速率/日额度/全局并发和 SEC-006 架构扫描。

B3-B1 修复额外覆盖：`npm run embeddings:migration-upgrade` 在临时数据库构造含 succeeded/failed 与重复历史请求的非空 0004 Batch，并在同一受控事务执行历史 `0005` 与新增 `0006`。Unit/Integration 验证发送前 `reserved`、发送时 `calling`、Timeout/网络/HTTP 拒绝/2xx 非法响应统一变为不可自动重试的 `unknown`、confirmed-no-charge 发送前失败安全重排、旧 Unknown Call 不可变、手工恢复新增 Call 与预算、预算不足不产生第二次调用、中文/中英混合/Emoji/代码/英文/10 条硬预留、并发 UTC 日预算、Usage=null/unknown 预算保留、关停 Abort 与 Lease renewal 故障。Health 单测证明 Flag=false 不检查 Embedding Schema/pgvector/Worker/Provider，而 Flag=true 缺少任一依赖时失败关闭。

旧 CI、旧 Staging 和旧截图不能替代当前 Head 的证据。tracked 文档只记录稳定结论；当前 Head、Run、Artifact ID/Digest、tested merge SHA、Staging image 和 Build Time 等动态精确事实记录在 PR 描述与 Provenance Manifest。

## 隔离基础设施

- 集成/E2E 只连接本地或 CI PostgreSQL；测试 Reset 继续要求 `NODE_ENV=test`、显式开关、本地/CI Host 和测试数据库名。
- CI 使用随机 masked MinIO root/app credential、唯一 Bucket 和 tmpfs，绝不连接 Staging/Production 数据。
- CI 不探测 Staging 健康或运行 SHA；`stagingSha` 在 CI Evidence 中保持 `null`，实际部署事实只由受控 Staging 发布记录和最终状态文档提供。
- 所有 PDF/DOCX/XLSX/PPTX/TXT/Markdown fixture 在运行时生成，只含虚构内容。
- CI 结束时无论 E2E 成败都运行受三重开关保护的 cleanup，要求：

```text
sessions = 0
documents = 0
versions = 0
ingestion jobs = 0
sections = 0
chunks = 0
embedding jobs = 0
embedding batches = 0
embedding provider calls = 0
chunk embeddings = 0
objects = 0
running jobs = 0
running embedding jobs = 0
AI threads = 0
AI messages = 0
AI executions = 0
AI citations = 0
running AI executions = 0
projectai temporary files = 0
```

## Parser 与 Chunker

单元测试至少覆盖：

- PDF Page、扫描 PDF `needs_ocr` 和损坏 PDF。
- DOCX Heading/Paragraph/List/Table。
- XLSX 可见 Sheet、行列范围、隐藏 Sheet 排除、不执行公式。
- PPTX Slide 顺序与 Slide Number。
- TXT/Markdown 行号与 Heading Path。
- 确定性分块、Overlap、内容 Hash、Source Locator 保留、超限与 Parser Thread timeout/termination。

## Queue、Lease 与原子激活

真实 PostgreSQL 集成至少覆盖：

- 上传完成创建 pending Job，重复 enqueue 幂等。
- 两个 Worker 使用 `SKIP LOCKED` 不会领取同一 Job。
- Lease 未到期不可重领，过期可重试；Heartbeat 续租。
- 最大尝试次数、可重试/不可重试错误和 `needs_ocr`。
- Worker 丢失 Lease 不能提交；崩溃/失败不留下 `is_effective=true` 半成品。
- 新 Generation 成功后才替换旧 Generation；版本/current/归档变化期间再次校验。

## Search、权限与生命周期

- FTS、contains、中文、英文和 `pg_trgm` 拼写模糊匹配。
- 搜索 SQL 精确限制 `project_id`，文档 filter 必须属于授权项目。
- 只返回 Active + Current + Stored + Succeeded + Effective Chunk。
- PDF/DOCX/XLSX/PPTX/TXT/Markdown Source Locator 可序列化且不含内部字段。
- 新 current 排除旧版本；归档立即排除；恢复/reindex 使用正确 Generation。
- Viewer/Member 可搜索和下载，只有 Manager/Admin 可 reindex。
- 跨项目 project/document/version/filter 统一 404；拒绝与搜索审计不含 query 正文、Object Key、Worker ID 或 Secret。

## Playwright 与截图

浏览器必须监听 `console.error`、`pageerror`、失败请求和未允许的 HTTP 5xx，不能只断言 200。除 B2 六格式流程外，B3-A 覆盖 Feature Disabled、Empty、Grounded Answer、Citation、Repair、Insufficient Evidence、Provider Timeout/Retry、Viewer、私人 Thread 和跨项目 404。

成功 Evidence 保留原有 12 张截图，并新增：

```text
document-processing-pending.png
document-processing-succeeded.png
document-processing-failed.png
document-needs-ocr.png
knowledge-search-results.png
knowledge-search-pdf-citation.png
knowledge-search-docx-citation.png
knowledge-search-xlsx-citation.png
knowledge-search-pptx-citation.png
viewer-knowledge-search.png
ai-assistant-disabled.png
ai-assistant-empty.png
ai-assistant-grounded-answer.png
ai-assistant-citation-expanded.png
ai-assistant-insufficient-evidence.png
ai-assistant-provider-error.png
ai-assistant-viewer.png
ai-assistant-thread-history.png
```

截图只显示虚构资料，不显示完整正文、Object Key、Bucket、Endpoint、Lease、Worker ID、Cookie、Session 或凭据。Manifest 不声明统一 viewport，而是读取每张 PNG 的实际宽高。

## Artifact 与 Provenance

Payload A 继续使用强 allowlist，只允许 `review-artifacts/evidence-index.json`、约定截图和固定名称 UTF-8 日志；禁止 trace、video、HTML report、原始文件、正文/Section/Chunk 导出、数据库 Dump、MinIO Mirror、环境变量和内部存储标识。

Provenance B 在 Payload A 上传成功并获得真实 Artifact ID/Digest 后生成。Manifest schema v3 记录：

```text
headSha
testedMergeSha
stagingSha
branch
workflowRunId
artifactId
version
buildTime
workerVersion
parserVersion
chunkerVersion
aiGatewayVersion
assistantProfileId
screenshots[{filename,width,height}]
```

## Staging

只部署 Staging。验收必须验证 App、PostgreSQL 17/pgvector、MinIO、Document Worker、Embedding Worker Healthy；`pg_trgm`、pgvector 0.8.1、`vector(1024)`、Profile、双 Probe、虚构增量向量、Lease Recovery、Backfill 幂等、精确向量项目范围、B3-A 词法 Grounded Answer/Citation、全量清理和 Production 精确不变。不得部署或修改 Production。

部署脚本通过 scoped operations service 自动运行：

```text
npm run documents:smoke
npm run documents:lease-smoke
npm run assistant:smoke
npm run embeddings:smoke:prepare
npm run embeddings:lease-smoke
npm run embeddings:smoke:verify
npm run retrieval:evaluate
npm run retrieval:probe
npm run retrieval:shadow-report
npm run retrieval:status
```

前者同时走容器内部上游和公网 Nginx 路径；后者只在队列为空、Worker 暂停期间执行。验收失败必须保留部署失败状态并触发既有 Staging App/Worker 回滚，不得跳过清理或 Production baseline 复核。

## 动态验证事实

最终 PR Head、CI Run、Evidence/Provenance ID/Digest、Staging image 与 Build Time 不写入 tracked 文档；它们只记录在当前 Draft PR 描述、Provenance Manifest 和受控部署证据中。

## v0.8 Retrieval 门禁

- `npm run retrieval:migration-upgrade` 在隔离 PostgreSQL 17/pgvector 数据库验证 0004→0005→0006→0007 非空升级和旧 Execution 的 lexical 默认值。
- `npm run test:retrieval` 验证冻结配置、模式拒绝、RRF 去重/加权/稳定排序以及 60 Query 质量门禁。
- `npm run test:retrieval-integration` 验证 lexical 零调用、shadow Evidence 不变、hybrid 语义命中、跨项目/旧版本/归档排除、Coverage/Timeout 回退、unknown 不重试、Usage-null、UTC 日预算、幂等、Profile 禁用与数据库复合约束。
- `npm run retrieval:evaluate` 输出 JSON/Markdown 的 Lexical/Vector/Hybrid 整体及分类 Metrics、距离校准、安全计数和门禁；只使用虚构资料，不使用 LLM Judge。
- Playwright 继续监控 console/page/request/HTTP 500/无限 Loading，并拒绝浏览器出现 Secret、Query Vector、内部 Score 或 Provider Payload。B3-A/B3-B1 全量回归必须保持通过。
