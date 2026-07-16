# Testing

## v0.5 B2 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. Production build + SSR/代理：`npm test`。
4. 身份与项目隔离回归：`npm run test:integration`。
5. 文件校验与对象存储：`npm run test:storage`。
6. Parser/Chunker 单元：`npm run test:documents`。
7. PostgreSQL + MinIO + Worker/Queue/Search 集成：`npm run test:document-integration`。
8. Artifact/Provenance：`npm run test:artifacts`。
9. Staging/Worker/备份部署契约：`npm run test:deployment`。
10. Playwright 身份、文件、解析和知识搜索：`npm run test:e2e`。
11. 完整本地门禁：`npm run qa:mvp`。

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
objects = 0
running jobs = 0
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

浏览器必须监听 `console.error`、`pageerror`、失败请求和 HTTP 500，不能只断言 200。B2 覆盖六格式上传、pending/running/succeeded/failed/needs_ocr、搜索来源、中文/英文/模糊匹配、Viewer、跨项目、新版本、归档和 reindex。

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
screenshots[{filename,width,height}]
```

## Staging

只部署 Staging。验收必须验证 App/PostgreSQL/MinIO/Document Worker Healthy、同一 immutable App/Worker image、`pg_trgm`、六格式解析、Section/Chunk、搜索/来源、Viewer、跨项目、needs_ocr、版本/归档/reindex、Lease、全量清理和 Production 精确不变。不得部署或修改 Production。

部署脚本通过 scoped operations service 自动运行：

```text
npm run documents:smoke
npm run documents:lease-smoke
```

前者同时走容器内部上游和公网 Nginx 路径；后者只在队列为空、Worker 暂停期间执行。验收失败必须保留部署失败状态并触发既有 Staging App/Worker 回滚，不得跳过清理或 Production baseline 复核。

## 最近验证事实

- PR #4 当前 Head 对应完整 CI 全绿：包含空库 Migration、隔离 PostgreSQL/MinIO、15 项 Parser/Chunker、身份/项目隔离、文件存储、文档队列/Lease/搜索集成、16 项部署契约和 18 项 Playwright。
- 最终 Evidence 包含 22 张实际 PNG；Provenance 绑定 Head、tested merge SHA、Run、Artifact ID/Digest 和 Worker/Parser/Chunker Version。精确名称、ID 与 Digest 记录在 PR 描述。
- CI 按隔离规则保持 `stagingSha: null`，不连接 Staging。随后同一最终 Head 通过受控部署完成内部和公网六格式 smoke，并验证 App/Worker/Parser/Chunker Version `1`、Lease 恢复、`SKIP LOCKED`、全量清理和 Production 精确不变。
- 文档事实一致性提交只改变文档；最终 CI 以 PR #4 当前 Head 检查为准，最终 Staging SHA 以 PR 描述、部署证据和 `/api/health` 响应头为准。
