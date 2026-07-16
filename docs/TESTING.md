# Testing

## v0.4 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. PostgreSQL Migration + insert-only Seed：`npm run db:migrate`、`npm run db:seed`。
4. v0.3 身份/项目授权回归：`npm run test:integration`。
5. 文件名、类型、签名与 OOXML 安全：`npm run test:files`。
6. PostgreSQL + S3-compatible 文件集成：`npm run test:storage`。
7. Production build + SSR/路由/反向代理边界：`npm test`。
8. Artifact allowlist / provenance：`npm run test:artifacts`。
9. Staging/MinIO/备份安全契约：`npm run test:deployment`。
10. 浏览器身份、隔离、真实资料和其余 Mock 流程：`npm run test:e2e`。
11. 完整本地门禁：`npm run qa:mvp`。
12. Staging：App/PostgreSQL/MinIO、私有 Bucket、真实文件流程、跨存储备份恢复、清理和 Production 不变。

代码或单层测试完成不能替代后续层级。当前 v0.4 最终全套、CI 和 Staging 尚待执行，结果只在 `MVP_STATUS.md` 记录。

## 隔离测试基础设施

- 集成和 E2E 只允许连接本地/CI PostgreSQL，数据库名必须包含 `test` 或 `ci`；不得连接 Staging/Production。
- `db:reset:test` 还要求 `NODE_ENV=test` 与 `ALLOW_TEST_DATABASE_RESET=true`，并拒绝远程主机。
- 文件集成测试只允许使用本地/CI S3-compatible 存储。CI 在运行时生成 MinIO root/app credential 和唯一 Bucket，全部 mask；数据位于 tmpfs，任务结束后无论成功失败都删除 MinIO 容器、网络和 root-only 临时凭据文件。
- CI 不连接 Staging PostgreSQL、Staging MinIO、Production 或任何远程真实 Bucket。
- PDF、DOCX、XLSX、PPTX、TXT 和 Markdown fixture 在运行时生成，只含虚构内容；不得提交客户文件或大量二进制 fixture。
- Better Auth Secret、Seed 密码与对象存储凭据每次 CI 随机生成，不进入仓库、日志或 Artifact。

## 身份与项目隔离回归

既有集成测试必须继续覆盖：

- Manager/Admin/Member/Viewer 项目列表和写权限。
- 跨项目与不存在项目统一 404、拒绝审计和 metadata 脱敏。
- 未认证、disabled、Session 刷新/退出、HttpOnly/SameSite/Secure/Path 和 Origin/JSON 边界。
- 项目成员增删改、唯一 Manager 409、system admin 不绕过、并发降级/删除仍保留 Manager。
- Seed insert-only 幂等、零 Manager 失败关闭、credential hash 只在 `accounts.password_hash`。

文件 API 在这些边界上增加 `documentId` 和 `versionId`，不得降低 v0.3 的 404 防枚举、审计或 Session 合同。

## 文件校验测试

`tests/file-validation.test.ts` 至少验证：

- 服务端 NFKC/basename 文件名清理，移除路径分隔符、控制/bidi 字符、尾点和超长内容。
- Object Key 只含 project/document/version ID 和随机 UUID，不包含原文件名、`..`、绝对路径、邮箱或客户/项目名称。
- PDF magic、UTF-8 文本、声明 MIME/扩展名/签名一致性和实际字节数。
- DOCX/XLSX/PPTX 的 ZIP signature、`[Content_Types].xml` 和对应核心部件。
- OOXML 路径穿越、绝对/Windows 路径、symlink、加密/重复 entry、宏/ActiveX、异常压缩比、entry/central directory/解压总量上限。
- 空文件、超过 `MAX_UPLOAD_BYTES`、未知/旧 Office/可执行/HTML/SVG/压缩包类型被拒绝。

SEC-007 只有上述真实路径与 Key 安全测试通过后才成立；它不代表解析或 RAG 完成。

## 文件存储集成测试

`tests/integration/project-files.test.ts` 使用真实 PostgreSQL 和隔离对象存储语义，必须覆盖：

### 上传和幂等

- Manager、Member 可上传；Viewer 403、未认证 401、跨项目 404。
- 50 MiB/配置上限、类型、签名和非法 OOXML 拒绝。
- 相同 actor/project/UUID Idempotency-Key 不重复创建版本或对象；不同内容复用 key 返回冲突。
- 成功后数据库为 stored、对象存在且 size/SHA-256/ETag 一致。
- object put、对象 metadata、数据库 finalize 和补偿删除失败产生受控 failed/quarantined 状态，不泄露 Provider 错误。

### 版本、current 和归档

- 第一次为 version 1；新版本递增且使用新 Key，旧版本保留。
- 成功的新版本成为 current，旧 current 取消；同一文档最多一个 current。
- 并发上传无重复版本号；并发切换 current 不产生两个 current。
- 只有 stored 且属于同一 project/document 的版本可设 current；Manager/Admin 可切换，Member/Viewer 不可。
- Manager/Admin 可归档/恢复；Member/Viewer 不可。归档不删除历史对象且默认 active 列表排除。

### 下载和一致性

- 所有授权角色可下载，跨项目/篡改 ID 404。
- 下载正文 SHA-256 等于上传内容，响应含准确 type/length、`attachment`、`nosniff`、`private, no-store`。
- 客户端 DTO/响应头/错误不暴露 Object Key、Endpoint、Bucket 或 credential。
- 缺失对象、size/ETag/SHA metadata mismatch、stale pending、active without current、multiple current 和 orphan 可被只读检查发现。
- reconciliation 默认 dry-run，不删除对象；apply 保护与二次引用检查单独验证。

## Playwright 真实资料流程

浏览器继续监听 `console.error`、`pageerror`、未处理 rejection、`requestfailed` 和 HTTP 500+，不能只断言 200。

### Manager

登录 → 授权项目 → 真实资料页 → 上传虚构文件 → 成功 → 刷新仍存在 → 下载 → 上传新版本 → 版本历史 → 新版本 current → 归档/恢复。

### Viewer

登录 → 可查看/下载 → 无上传/current/归档/恢复入口 → 直接上传 API 仍返回 403。

### 跨项目与拒绝

- Manager A 篡改 project/document/version ID 不能查看、切换或下载 Project B 文件。
- 伪造扩展名/签名文件显示明确错误；数据库没有 stored 版本，对象存储没有可用对象。

### 仍为 Mock 的回归

项目知识、需求提取/审核和 Action 状态流程继续按原契约运行，但不得把真实文件发送到 Mock AI。测试通过也不代表解析、RAG、正式需求或真实模型完成。

## 产品审查截图

成功 CI 必须生成 12 张 `1440 × 1000` 中文界面截图：

```text
login.png
dashboard-admin.png
projects-manager-a.png
project-a-overview.png
project-access-denied.png
viewer-readonly.png
documents-empty.png
documents-upload-dialog.png
documents-uploaded.png
document-version-history.png
viewer-documents-readonly.png
document-upload-rejected.png
```

截图只显示虚构文件名，不显示正文、Bucket、Endpoint、Object Key、Cookie 或凭据。

## 本地命令

```bash
npm ci
npx playwright install chromium
npm run db:migrate
npm run db:seed
npm run typecheck
npm run lint
npm run test:integration
npm run test:files
npm run test:storage
npm run storage:verify
npm run storage:reconcile
npm test
npm run test:artifacts
npm run test:deployment
npm run test:e2e
npm run qa:mvp
```

`storage:reconcile` 在没有参数时必须输出 `dry-run` 且不删除对象。只有显式 `--apply` 加非 Production、`ALLOW_STORAGE_RECONCILE_APPLY=1`、精确 Bucket 确认和合法最小年龄才能执行 orphan 清理。

## CI 与产品审查 artifacts

CI 顺序包含 PostgreSQL/MinIO 初始化、Migration/Seed、typecheck、lint、build/SSR、身份集成、文件存储集成、两次只读 storage verify/reconcile、artifact/deployment 合同和 E2E。新提交取消同分支旧任务；CI 不部署环境。

Payload A 使用强 allowlist，允许来源仅为：

- `review-artifacts/evidence-index.json` 和约定的 12 张图片。
- 固定名称的 UTF-8 纯文本日志：typecheck、lint、build/SSR、integration、storage integration/verify、artifact sanitizer、deployment contract 和 Playwright。
- sanitizer 最终生成的 `sanitization-report.json`。

以下内容不得发布：`playwright-report/`、`test-results/`、trace、video、HTML report、任意 PDF/归档、上传测试原件、数据库/对象备份、未列名文件、`.env`、Cookie/Session、MinIO/S3 credential、内部 Bucket/Endpoint/Object Key。文件扩展名不作为信任边界；允许的日志必须是有大小上限的有效 UTF-8 文本且不得含二进制 magic/NUL。

sanitizer 从 CI 环境、root-only MinIO 临时文件和测试数据库收集需要清理的精确 Secret/Session，覆盖明文、URL/JSON、标准/URL-safe/折行 Base64 和 percent-encoding；无法查询数据库 Session、发现 storage metadata、allowlist 违规或成功截图缺失时失败关闭并跳过上传。

`evidence-index.json` 是预上传索引，不含 `artifactId` 或 legacy `commit`。字段含义：

- `headSha`：PR Head；main push 为被推送 Commit。
- `testedMergeSha`：PR runner 实际 checkout 的临时 merge Commit；main/local 为 `null`。
- `stagingSha`：本次 CI 从公网健康端点实际观测的合法完整 SHA；不可观测则为 `null`，不得回填。
- `branch`、`workflowRunId`、`version`、`buildTime`：本次测试身份与 build 元数据。

CI 先上传不可变 Payload A `product-review-evidence-*`；GitHub 返回真实 artifact ID/digest 后，才生成权威 `product-review-manifest/manifest.json` 并上传独立 Provenance B `product-review-manifest-*`。A 未成功时不得生成 B。

## 当前验证状态

- v0.3 的历史 CI/Staging 结果只作为回归基线。
- v0.4 的完整本地门禁、最终 GitHub Run、12 张截图、Artifact ID/digest、Staging App/PostgreSQL/MinIO 与备份恢复尚未记录。
- 任何 v0.4 运行结果只能在实际完成并复核后写入 `MVP_STATUS.md`；不得复制旧 Run、旧 6 张截图或旧 Staging SHA。
