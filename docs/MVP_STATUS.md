# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.4.0-staging`（Project Files Foundation / 交付包 B1） |
| `main` 基线 | `acd403b009bd788a59d2157936ce24fb89bd4dba`（包含已合并的 v0.3） |
| 开发分支 | `agent/project-files-foundation` |
| Draft PR | [#3 Add project file storage foundation](https://github.com/27ruien/ProjectAI/pull/3)，`OPEN`、Draft、未合并 |
| 最终 v0.4 CI | PR #3 最新 Head 对应 CI 全绿；精确 Run 与 Artifact ID 记录在 PR 描述和 Provenance B |
| v0.4 Evidence / Provenance | Payload A `product-review-evidence-*` 与 Provenance B `product-review-manifest-*` 均由最终 CI 生成并通过强 allowlist/脱敏检查 |
| Staging | https://gridworks.cn/tool/projectai-staging/；运行 PR #3 最新 Head，`/api/health` Header 与 Provenance B 精确校验 |
| Production | https://gridworks.cn/tool/projectai/；本轮未构建、迁移、重启或部署 |

## v0.4 结论

`Project AI OS v0.4 — Project Files Foundation` 已完成 B1 的实现、CI、Staging 和证据闭环。真实能力覆盖 PostgreSQL 文件元数据、私有 S3-compatible 对象存储、上传/下载、不可变版本、单一 current、归档/恢复、项目级授权、审计、补偿与只读一致性检查。

Draft PR #3 必须继续保持未合并，等待产品与安全复审。本轮到此停止；不得开始解析、Embedding、RAG、真实模型或 B2，也不得部署 Production。

## 已形成的真实能力

- `project_documents` 与 `project_document_versions` 已通过受控 Migration 建立；项目/文档复合外键、版本号、`upload_id`、Object Key 唯一约束和单 current Partial Unique Index 均在 PostgreSQL 生效。
- 文件正文只写入 S3-compatible Object Storage；数据库仅保存受控元数据，正文不进入容器目录、Git、`public/` 或 PostgreSQL。
- 支持 PDF、DOCX、XLSX、PPTX、TXT、Markdown，默认上限 50 MiB；同时校验扩展名、声明 MIME、签名、实际大小、UTF-8 和受限 OOXML 结构。
- Object Key 由服务端按 `projects/{projectId}/documents/{documentId}/versions/{versionId}/{UUID}` 生成；不含原文件名、客户信息、用户邮箱或路径片段，且不进入客户端 DTO、日志或产品 Artifact。
- 上传使用 UUID `Idempotency-Key` 和 pending → object put → stored/current 三段式流程；对象或数据库失败均有补偿、受控 failure code 与 dry-run reconciliation。
- `system_admin`/Manager 可执行全部文件操作，Member 可上传/下载，Viewer 只读；所有 project/document/version 归属与写权限均由服务端重新校验，未授权与不存在资源统一 404。
- 新版本不覆盖历史对象；事务锁、版本唯一约束和 Partial Unique Index 保护并发版本号与单 current。只有 Manager/Admin 可切换 current、归档和恢复。
- 下载固定为 `attachment`，包含 `nosniff`、`private, no-store`，并在响应前核对大小、ETag 与 SHA-256 metadata。
- 文件创建、上传开始/成功/失败、下载、current 切换、归档/恢复、拒绝与 reconciliation 均写入脱敏审计。

## 仍为 Mock 或未实现

- 项目知识检索、问答和引用内容。
- 需求、Scope、Action、会议、风险、业务审核写入和 AI execution。
- PDF/Office 正文解析、OCR、分块、全文检索、Embedding、pgvector、Hybrid Search、Reranker、RAG、真实模型、Provider Key 和文件自动总结。

真实上传文件不会被解析、索引或提供给 AI；页面明确提示“文件已真实存储；文档解析和 AI 知识索引尚未启用”。

## 验证结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| Migration / PostgreSQL 约束 | 通过 | CI PostgreSQL 17 从空库执行已提交 Migration；Staging 可见两张文件表、复合外键、状态检查、三类唯一索引和单 current Partial Unique Index |
| TypeScript / ESLint / build | 通过 | 最终 CI 的 typecheck、lint、production build 与 SSR `7/7` 全绿 |
| v0.3 身份与项目隔离回归 | `27/27` 通过 | Session、角色、跨项目 404、最后 Manager 和并发保护继续全绿 |
| 文件单元与存储集成 | `37/37` 通过 | `test:files` `20/20`；真实 PostgreSQL + MinIO 集成 `17/17` |
| Playwright | `15/15` 通过 | Manager 文件闭环、Viewer 只读、跨项目篡改、拒绝流程和 12 张中文截图 |
| Evidence sanitizer / provenance | `29/29` 通过 | Payload A 仅含 allowlist 截图/index；无原文件、Object Key、Bucket/Endpoint、Cookie、Session 或凭据 |
| Staging 部署安全契约 | `15/15` 通过 | 备份/恢复、私网 MinIO、代理上传限制、公网文件 smoke、回滚和 Production 保护合同 |
| Staging 业务验收 | 通过 | 内部与公网各完成登录、Session、角色、跨项目、上传 v1/v2、SHA 下载、current、归档/恢复与清理 |
| `storage:verify` / reconciliation | 通过 | 部署前后及独立复核均为 0 finding；reconciliation 为 dry-run、0 orphan、0 删除 |
| Production 不变 | 通过 | 容器 ID `c5f98b491e67668139e3b84ccf2c7dbee75556135826eddabf0267382078b0d1`、镜像 `sha256:a4b6d41941ebb8f995cf2ecaba65a595990187b8b93d03758287f42443cb5469`、StartedAt `2026-07-13T01:53:13.452401053Z`、restart `0`、healthy 与部署前一致；根路径和 Dashboard 均为 200 |

## Staging 已验证状态

- App：`project-ai-os-staging`，仅绑定 `127.0.0.1:3101 → 3000`，健康，restart `0`。
- PostgreSQL：`project-ai-os-staging-postgres`，健康、无宿主机端口；文件表与 Migration 已生效。
- MinIO：`project-ai-os-staging-minio`，健康、无宿主机/Console 端口；网络 `projectai-staging-internal`，命名卷 `projectai-staging-minio`。
- Bucket：`projectai-staging-files`，anonymous policy 为 private，未认证列表请求返回 403。
- 环境文件：`/srv/projectai-staging/.env.auth-staging` 为 `root:root 600`，发布同步不会覆盖，也不会进入 Artifact。
- Nginx：Staging 精确 location 的 `client_max_body_size 52m` 已验证，`nginx -t` 通过；未覆盖既有站点配置。
- 清理：文件 verifier Session、边界 verifier Session、虚构验收文档/版本与对象均为 0。
- 备份：每次部署前生成 root-only PostgreSQL custom dump、MinIO JSONL inventory 与 mirror；最新 dump 的 `pg_restore --list` 有 89 个 TOC 条目，inventory/mirror 均为 0 对象/0 bytes，数量一致，无 partial 文件；隔离临时 Bucket 恢复演练通过且临时 Bucket 为 0。

## 已知风险

- 未关闭 P0：无。
- 未关闭 P1：无。产品与安全复审仍是合并前人工门禁，不得因此自动合并。
- P2：`npm audit --omit=dev --audit-level=high` 无 High/Critical，仍报告 Drizzle Kit 工具链旧 `esbuild` 的 4 个 Moderate；自动修复会造成 breaking downgrade，本轮不改写 Migration 工具链。
- P2：production build 仍提示单个 chunk 大于 500 kB，后续可按页面拆分动态 import。
- P2：GitHub Actions 的 Node 20 action runtime 弃用提示、服务器既有 Nginx conflicting server-name warning 和 vinext 字体窄映射继续跟踪；均未导致本轮门禁失败。

## 下一步

1. 由产品与安全人员复核 Draft PR #3、Payload A、Provenance B、Staging 和回滚证据。
2. 未经明确批准不得合并 PR，不得重新部署 Production。
3. 等待独立 B2 提示词后再讨论解析、索引或 RAG。

## 历史基线

v0.3 的身份与项目隔离曾在 GitHub Run `29313984989` 和 Staging Commit `ff19049...` 完成验证。它只作为回归基线；v0.4 使用 PR #3 最新 Head 自己的 CI、Evidence、Staging 和 Production 不变证据。
