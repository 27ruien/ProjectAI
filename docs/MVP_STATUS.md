# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.4.0-staging`（Project Files Foundation） |
| `main` 基线 | `acd403b009bd788a59d2157936ce24fb89bd4dba`（包含已合并的 v0.3） |
| 开发分支 | `agent/project-files-foundation` |
| Draft PR | 尚未创建 |
| v0.4 PR Head | 尚未产生提交 |
| 最终 v0.4 CI | 尚未运行 |
| v0.4 Evidence / Provenance | 尚未生成 |
| Staging | https://gridworks.cn/tool/projectai-staging/ |
| Staging 当前已知运行版本 | v0.3，Commit `ff19049deca065b3dbc4698c3a219980dcd2f47b`；不是 v0.4 验收证据 |
| v0.4 Staging SHA | 尚未部署、尚未观测 |
| Production | https://gridworks.cn/tool/projectai/；v0.4 禁止部署 |

## v0.4 当前结论

`Project AI OS v0.4 — Project Files Foundation` 已完成本地实现与完整门禁：代码树包含文件数据模型、S3-compatible 存储适配、真实资料 API/UI、版本/current、归档/恢复、审计、一致性工具、Staging MinIO/备份契约和 CI MinIO 配置。

本状态仍不等于 B1 已交付：GitHub CI、产品审查 artifacts、Draft PR、v0.4 Staging 部署与独立验证尚待执行。不得复用 v0.3 的 CI、Artifact、Staging SHA 或 Production baseline 冒充 v0.4 证据。

## 本分支实现边界

### 已形成的真实能力

- `project_documents` 与 `project_document_versions` PostgreSQL 模型、Migration 和约束。
- S3-compatible Object Storage；正文与数据库元数据分离，不写入容器目录、Git、`public/` 或 PostgreSQL。
- PDF、DOCX、XLSX、PPTX、TXT、Markdown；默认上限 50 MiB；扩展名、MIME、签名、UTF-8 与受限 OOXML 容器校验。
- 服务端生成不可变 Object Key；Object Key 和 Bucket/Endpoint/凭据不进入客户端 DTO。
- UUID `Idempotency-Key`、pending → object put → stored/current 三段式上传、失败补偿与受控重试。
- `system_admin`/Manager 全部资料操作，Member 可上传/下载，Viewer 只读下载；项目/document/version 归属均由服务端校验。
- 不覆盖历史对象的版本管理、Partial Unique Index 单 current、Manager/Admin 手动切换 current。
- 归档/恢复不物理删除文件；默认 active 列表与 archived 列表分离。
- 下载使用 `attachment`、`nosniff`、`private, no-store`，并在响应前核对大小、ETag 和 SHA-256 metadata。
- `storage:verify` 只读一致性检查；`storage:reconcile` 默认 dry-run，apply 受环境、Bucket 确认、最小对象年龄和二次数据库引用检查保护。
- Staging Compose 中的私有 MinIO、独立命名卷、幂等 Bucket 初始化、最小权限应用凭据；PostgreSQL + MinIO 跨存储备份与临时 Bucket 恢复演练契约。

### 仍为 Mock

- 项目知识检索、问答和引用内容。
- 需求、Scope、Action、会议、风险、业务审核写入和 AI execution。

真实上传文件不会被解析、分块、索引或提供给 AI。解析/OCR、Embedding、pgvector、RAG、Reranker、真实模型和 Provider Key 均未接入。

## 验证状态

| 门禁 | 当前状态 | 说明 |
| --- | --- | --- |
| Migration 与空库应用 | 本地通过 | 独立 PostgreSQL 应用 Migration、Reset/Seed 与约束测试通过；仍待 CI 复核 |
| TypeScript / ESLint / build | 本地通过 | TypeScript、ESLint、production build 与 SSR `7/7` 通过 |
| v0.3 身份与项目隔离回归 | 本地 `27/27` 通过 | Session、项目隔离、最后 Manager 与并发保护继续通过 |
| 文件路径/OOXML/UI 状态单元验证 | 本地 `19/19` 通过 | 包含 SEC-007、OOXML 和 `202 pending` 有界轮询；不替代 CI/Staging |
| 文件存储集成测试 | 本地 `17/17` 通过 | 使用独立 PostgreSQL 与隔离 MinIO；`test:storage` 合计 `36/36` |
| Playwright 真实文件流程 | 本地 `15/15` 通过 | 上传、刷新、SHA 下载、v2、Viewer、跨项目、拒绝流程与 12 张截图 |
| Evidence sanitizer / provenance | 本地 `29/29` 通过 | 强 allowlist、无标签/编码 Object Key 脱敏；本地 Payload 仅含 12 张截图和 index |
| Staging 部署安全契约 | 本地 `14/14` 通过 | PostgreSQL + MinIO 备份/恢复、公网 Nginx 文件 smoke 和 Production 保护合同 |
| GitHub CI / Draft PR | 待执行 | 当前没有可引用的 Run、Artifact ID 或 PR URL |
| v0.4 Staging | 未部署 | 当前在线环境仍是 v0.3，不代表 v0.4 |
| Production 不变 | 待本轮前后复核 | v0.4 明确禁止 Production 部署 |

## Staging 目标状态（尚未验证）

- 应用：`project-ai-os-staging`，`127.0.0.1:3101`，basePath `/tool/projectai-staging`。
- PostgreSQL：`project-ai-os-staging-postgres` + `projectai-staging-postgres`，无宿主机端口。
- MinIO：`project-ai-os-staging-minio` + `projectai-staging-minio`，Bucket `projectai-staging-files`，无宿主机/Console 端口、无匿名策略。
- Compose project/network：`projectai-staging` / `projectai-staging-internal`。
- 受保护环境文件：`/srv/projectai-staging/.env.auth-staging`，`root:root 600`；MinIO root 与应用凭据必须不同。
- 部署前取得 PostgreSQL custom dump、MinIO JSONL inventory 与 root-only mirror；恢复演练只能使用临时 Bucket。
- 部署后运行两次只读 `storage:verify`，完成真实上传/下载/版本/归档验收，清理测试 Session 和测试对象，再证明 Production 容器状态精确不变。

以上均为目标合同，必须在部署后以实际容器、Bucket policy、备份、请求和数据库结果关闭，当前不得标记为通过。

## 当前风险与待审事项

- 本地代码与门禁复审未发现未关闭的 P0/P1；最终 GitHub CI 与 Staging 独立验证仍是发布门禁，不得用本地结果替代。
- P0 发布门禁：跨项目文件上传、列表、版本切换和下载已本地通过，但尚未形成最终 CI/Staging 证据。
- P0 发布门禁：Bucket 私有、Object Key 不受文件名影响、Artifact 不携带正文/对象地址/凭据尚待最终 CI 与 Staging 独立复核。
- P1 发布门禁：Migration、build、真实 MinIO、并发 current、补偿和 dry-run reconciliation 已本地通过，尚待最终 CI 复核。
- P1 门禁：Staging PostgreSQL/MinIO 备份和临时 Bucket 恢复演练尚未执行。
- P1 产品边界：知识问答仍是授权后按项目过滤的 Mock；真实文件不能被解释为已建立知识索引。
- P2：`npm audit --omit=dev --audit-level=high` 无 High/Critical，仍报告 Drizzle Kit 工具链旧 `esbuild` 的 4 个 Moderate；自动修复要求 breaking downgrade，因此本轮不强制改写 Migration 工具链。
- P2：production build 仍有单个大于 500 kB 的 chunk 警告；不阻塞 B1，后续可按页面拆分动态 import。
- P2：GitHub Action runtime 提示、Nginx 既有 warning 与 vinext 字体窄映射继续在最终复核中跟踪。

## 下一步

1. 创建有意图明确的 Commit，推送 `agent/project-files-foundation` 并创建 Draft PR。
2. 等待最终 GitHub CI，下载复核 Payload A 与 Provenance B，记录真实 Run/Artifact ID。
3. 只部署 Staging，执行跨存储备份恢复、公网真实文件验收、清理和 Production 不变检查。
4. 用实际 SHA、CI、Artifact、Staging 与风险结论更新本文件；未经产品/安全审查不得合并，也不得开始 B2。

## 历史基线

v0.3 的身份与项目隔离曾在 GitHub Run `29313984989` 和 Staging Commit `ff19049...` 完成验证。它只作为回归基线，不是 v0.4 的 CI、Evidence、Staging 或 Production 不变证据。
