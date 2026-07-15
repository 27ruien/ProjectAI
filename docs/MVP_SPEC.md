# Project AI OS MVP Spec

## 第一阶段产品定义

核心用户是项目经理，第一阶段只验证三个问题：编写项目文档耗时过长、项目信息分散难以查找、需求容易遗漏/重复/误解。

目标主流程仍是：

```text
登录 → 选择授权项目 → 上传项目资料 → 安全持久化与版本管理
→ 文档解析 → 项目知识问答与来源引用
→ AI 提取需求草稿 → 人工修改与审核 → 写入正式需求
```

该流程必须分迭代真实化。v0.4 只完成第二个可信边界：

```text
上传 → 安全存储 → 文件记录 → 版本管理 → 权限下载
```

上传后的解析、检索、AI 和正式业务写入不属于本轮。

## v0.4 — Project Files Foundation

v0.4 在已合并的 v0.3 身份、PostgreSQL Session 和项目隔离基础上增加：

- `project_documents` 逻辑资料与 `project_document_versions` 不可变文件版本。
- AWS SDK for JavaScript v3 驱动的 S3-compatible Object Storage；Staging 使用独立私有 MinIO。
- 真实上传、下载、版本历史、当前版本切换、归档和恢复。
- 文件元数据、SHA-256、对象 ETag、存储状态和文件操作审计持久化到 PostgreSQL；正文只进入对象存储。
- 服务端生成 Object Key、文件类型/签名/大小校验、OOXML 容器安全检查和 UUID `Idempotency-Key`。
- PostgreSQL 与对象存储之间的补偿、一致性只读检查和默认 dry-run reconciliation。
- CI 独立 PostgreSQL + 临时 MinIO；Staging 数据库与对象存储备份/恢复演练。

本轮实现代码、Migration、测试和部署契约后，仍必须经过完整 CI、产品 Evidence、Staging 发布与产品/安全审查，才能宣告 B1 完成。

## 数据与对象边界

PostgreSQL 是业务状态事实来源，保存：

- 逻辑资料状态：`pending`、`active`、`archived`、`failed`。
- 文件版本号、`is_current`、上传幂等标识、原始文件名（受控元数据）、MIME、大小、SHA-256、ETag、存储状态与审计。
- `(document_id, version_number)`、`upload_id`、`object_key` 唯一；Partial Unique Index 保证每个文档最多一个 current。

对象存储只保存不可变文件正文。文件不写入 Next.js 容器、本地公开目录、Git 或 PostgreSQL；Bucket、Endpoint、Object Key 和凭据均不序列化到浏览器。

Object Key 仅由服务端生成：

```text
projects/{projectId}/documents/{documentId}/versions/{versionId}/{randomUuid}
```

Key 不包含原文件名、邮箱、客户/项目名称、Session、绝对路径或用户提供的路径片段。原文件名经过 NFKC、控制字符/双向字符和路径分隔符清理，只在下载时作为安全 `attachment` 文件名返回。

## 文件合同

- 允许：`.pdf`、`.docx`、`.xlsx`、`.pptx`、`.txt`、`.md`。
- 默认单文件最大 `50 MiB`（`MAX_UPLOAD_BYTES=52428800`），服务端强制执行。
- 同时检查扩展名、声明 MIME、实际大小和文件签名；TXT/Markdown 必须为有效 UTF-8。
- DOCX/XLSX/PPTX 必须是合法 OOXML ZIP，包含对应核心部件及 `[Content_Types].xml`；拒绝路径穿越、绝对路径、symlink、加密条目、重复条目、宏/ActiveX、异常压缩比和超限目录/解压大小。
- 本轮只验证容器，不读取或解析文档正文。

## 权限与资源归属

| 角色 | 列表/版本/下载 | 上传资料/新版本 | 切换 current | 归档/恢复 |
| --- | --- | --- | --- | --- |
| `system_admin` | 允许 | 允许 | 允许 | 允许 |
| `project_manager` | 允许 | 允许 | 允许 | 允许 |
| `project_member` | 允许 | 允许 | 禁止 | 禁止 |
| `viewer` | 允许 | 禁止 | 禁止 | 禁止 |

每个页面和 API 都从服务端 Session 恢复身份，并验证 `projectId → documentId → versionId` 的完整归属链。不存在和跨项目资源统一返回 404；已授权项目内角色不足的写请求返回 403。前端隐藏按钮只用于体验，不承担授权。

## 上传、版本与补偿

上传采用三段式状态机：

1. PostgreSQL 事务锁定项目/逻辑文档，创建 `pending` 版本和 `document_upload_started` 审计；同一用户、项目和 `Idempotency-Key` 只对应一个 `upload_id`。
2. 将已验证字节写入新的不可变 Object Key，核对大小、SHA-256 metadata 与 ETag。
3. PostgreSQL 事务把版本置为 `stored`，原 current 取消，新版本成为 current，逻辑资料变为 `active`，并提交创建/版本审计。

对象写入失败时尝试删除目标对象并把版本标记为 `failed`；对象可能无法确认删除时标记为 `quarantined`。对象已写入但数据库最终确认失败时再次补偿删除并记录受控 failure code。补偿本身失败不会隐藏，由 `storage:verify` 和 reconciliation 报告 stale pending、缺失对象或 orphan。

新版本在事务中锁定逻辑文档并递增版本号，永不覆盖或删除历史对象。只有 `stored` 版本可以设为 current；切换 current 与归档/恢复都在锁内完成并写审计。归档只改变逻辑状态，不物理删除任何版本，默认 active 列表不返回归档资料。

## 一致性与运维

`npm run storage:verify` 是只读检查，覆盖 stored 对象存在性、大小、ETag、SHA-256 metadata、单 current、active/current、超时 pending 和 orphan object，输出只含计数和脱敏标识。

`npm run storage:reconcile` 默认 dry-run，不删除对象。`--apply` 还必须同时满足非 Production、显式开关、精确 Bucket 确认和 orphan 最小年龄；删除前再次查询数据库引用并写脱敏审计。

Staging 保留 PostgreSQL custom-format dump，并增加 MinIO inventory 与 Bucket mirror。部署短暂停止唯一应用写入者以取得跨存储快照；备份经对象数/字节数核对后原子完成，并恢复到全新临时 Bucket 验证，绝不覆盖正式 Bucket。数据库卷、MinIO 卷与备份在普通部署和应用镜像回滚中保留。

## 真实与 Mock 边界

### v0.4 真实能力

- v0.3 的身份、credential、数据库 Session、项目、成员、服务端授权与审计。
- 项目资料元数据、真实文件上传、S3-compatible 存储、版本/current、归档/恢复、权限下载、文件审计和一致性工具。

### 仍为 Mock

- 项目知识检索/问答及引用内容。
- 需求、Scope、Action、会议、风险、业务审核写入和 AI execution。

上传成功只表示文件被安全保存，不表示文件已解析或进入知识库。页面必须显示“文件已真实存储；文档解析和 AI 知识索引尚未启用”。

### 明确不在 v0.4 范围

- PDF/Office 正文解析、OCR、分块和内容摘要。
- 全文检索、Embedding、pgvector、Hybrid Search、Reranker 和 Project RAG。
- 真实 LLM/Provider、API Key、需求提取、Scope 对比、Action/风险/周报生成。
- Production 构建、迁移、重启或部署。

## 本轮交付门禁

开发分支固定为 `agent/project-files-foundation`，版本为 `0.4.0-staging`，Draft PR 不得自动合并。代码完成不等于交付完成；最终 CI、12 张审查截图、脱敏 Evidence/Provenance、Staging App/PostgreSQL/MinIO 健康、真实文件流程、备份恢复、Session/测试对象清理和 Production 精确不变均需提供实际证据。当前进度以 `MVP_STATUS.md` 为准。
