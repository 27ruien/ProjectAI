# Testing

## 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. PostgreSQL Migration + insert-only 幂等 Seed：`npm run db:migrate`、`npm run db:seed`。
4. 身份/项目授权集成：`npm run test:integration`。
5. Production build + SSR/路由/反向代理 Host 边界：`npm test`（已经包含一次 `npm run build`）。
6. 浏览器身份、隔离和原 MVP 主流程：`npm run test:e2e`。
7. 完整 MVP 验证：`npm run qa:mvp`；CI 额外显式运行数据库集成测试。
8. Staging：数据库/应用健康、认证 Cookie、Session 刷新/退出、角色与跨项目边界、canonical HTTPS、恶意 Host、HTTP/MIME/Nginx 和 Production 不变回归。

## 独立测试数据库

- 集成和 E2E 只允许连接本地/CI PostgreSQL，数据库名称必须包含 `test` 或 `ci`；不得连接 Staging/Production。
- `npm run db:reset:test` 还要求 `ALLOW_TEST_DATABASE_RESET=true`，脚本会重建 `public` schema、执行已提交 Migration，再由 npm 命令运行 insert-only Seed。
- Seed 创建 1 个 system admin、Manager A/B、Member A、Viewer A 和 3 个项目；密码必须由未跟踪的本地环境或 CI 临时 Secret 提供。
- CI 使用 PostgreSQL `17-alpine` Service 和测试专用数据库凭据；Seed 密码与 Better Auth Secret 每次运行随机生成、写入 GitHub 环境并 mask，不进入仓库或 artifact。

## 身份与项目隔离集成测试

当前 `tests/integration/identity-project-isolation.test.ts` 共 26 条，覆盖：

- Manager A/B 只得到自己的项目，system admin 得到 3 个项目。
- 跨项目 ID 和不存在 ID 使用相同 404，并写入脱敏拒绝审计。
- viewer 可读但不能使用写角色。
- 嵌套 audit metadata 会移除 password、token、cookie、database URL 与文件正文等敏感键，同时保留安全字段。
- 重复成员唯一约束、非法 PostgreSQL enum、被项目/成员引用用户的删除约束。
- 登录创建数据库 Session、Session 查询、HttpOnly/SameSite/Path Cookie 与退出撤销；Auth JSON 不返回 token 且统一 `no-store`；恶意 Origin 或非 JSON 写请求在任何 Session/业务变更前被拒绝。
- 公共注册关闭；未纳入白名单的 Better Auth 账户/Session 管理端点统一 404 且不返回 token；disabled 用户不能产生 Session，既有 Session 在查询时撤销；未知邮箱和错误密码返回相同错误。
- 基于受信客户端 IP 的登录频率限制。
- URL/body `projectId` 与跨项目 `memberId` 篡改、viewer 写入和普通用户创建项目均被服务端拒绝。
- Seed 重跑保持已有身份状态、项目编辑、成员角色和 credential hash。
- Seed 保证每个项目至少一名 Manager；已有零 Manager 数据会失败关闭且不覆盖既有角色。
- 成员 CRUD 与管理员项目创建把业务写入和审计放在同一数据库事务。
- 唯一 Manager 不能降级为 member/viewer 或删除，system admin 不绕过；添加第二 Manager 后允许变更；两个不同 Manager 并发降级或删除最终严格保留一名。
- 健康端点只在完整 40 位运行 SHA 存在时设置 provenance header，响应体不泄露数据库细节。
- credential hash 只存在于 `accounts.password_hash`，不等于明文，`users` 无重复 hash 列。

`tests/integration/review-project-permissions.test.ts` 另有 1 条混合角色边界：同一用户在项目 A 可编辑、项目 B 仅 viewer 时，每条审核任务必须按自身 `projectId` 获得可审核或只读标记，未授权项目记录不会序列化。因此完整 integration suite 当前为 27 条。

2026-07-14 本地已从空测试库执行受保护 Reset/Migration/Seed，并验证 Seed 非破坏性和零 Manager 失败关闭；当前 27/27 集成测试通过。GitHub Run `29313984989` 已在空 PostgreSQL Service 重复通过，Staging Commit `ff19049...` 的公网角色、隔离和最后 Manager 409/拒绝审计矩阵也已独立验证。

## Playwright 环境

- 默认本地 basePath：`/tool/projectai`。
- Staging basePath：`/tool/projectai-staging`。
- 使用 `PLAYWRIGHT_BASE_URL` 指向已运行环境；未设置时 Playwright 启动本地 vinext server。
- 浏览器只安装 Chromium；Node.js 版本为 22。

## MVP E2E 清单

### 身份、Session 与权限

- 未登录访问 dashboard 和项目深层路由跳转 `/login`；登录页 label、键盘表单和密码显示切换可用。
- 登录后刷新仍保持 Session；退出后旧 Session 无法继续访问受保护页面。
- system admin API 返回全部 3 个 Seed 项目。
- Manager A 页面与 API 只包含项目 A；直接输入项目 B URL 或修改 API `projectId` 被拒绝。
- Viewer A 可读项目 A，页面无写入口，PATCH 和项目创建 API 均被服务端拒绝。
- 以 `1440 × 1000` 生成 login、admin dashboard、Manager A projects、项目 A overview、access denied、viewer readonly 六张审查截图。

### 项目知识问答

进入项目 → 项目知识 → 预设问题 → 回答 → 来源文件/章节/页码/版本 → 来源详情。

### 需求提取与审核

选择 Mock 文件 → 启动 → 可恢复失败 → Retry → 完成 → 审核中心 → 编辑草稿/备注 → 修改后通过 → 状态反馈。

### Action 状态持久化

进入 Action Plan → 修改 ACT-001 → 刷新 → 验证恢复 → 清理测试 key，避免污染后续测试。

前三条业务主流程仍为 Mock，并且测试身份必须先拥有对应 Seed 项目；通过不代表上传、RAG 或正式业务持久化已实现。

## 运行时错误契约

每条 E2E 监听：

- `console.error`。
- `pageerror` 与未处理 Promise rejection。
- `requestfailed`。
- HTTP 500 及以上响应。

失败附件：screenshot、video、trace、HTML report、console/network log。不得通过全局忽略错误让测试“变绿”；若允许第三方失败，必须按 URL 精确写明原因。Seed 密码通过隔离的 API Context 换取 Cookie；原始证据只留在 CI 工作区，发布前还必须经过下述独立脱敏和复核，不能仅依赖测试代码避免记录凭据。

## 选择器原则

- 优先 role、accessible name、label、heading 和稳定业务 ID。
- 不依赖 Tailwind class、DOM 层级或随机时间戳。
- 组件新增交互时同步维护可访问名称和 E2E。

## 本地命令

```bash
npm ci
npx playwright install chromium
npm run db:migrate
npm run db:seed
npm run typecheck
npm run lint
npm run test:integration
npm test
npm run test:e2e
npm run qa:mvp
```

测试输出目录 `test-results/`、`playwright-report/`、trace、video 和 screenshot 不得提交。

## CI 与产品审查 artifacts

PR 与 main push 运行 Node 22、npm cache、Chromium、PostgreSQL 17、Migration、Seed、typecheck、lint、一次 production build + SSR/反向代理边界、当前 27 条授权/审计/最后 Manager/逐项目审核权限集成测试、8 条部署契约和 Playwright；新提交取消同分支旧任务，不进行部署。

`PLAYWRIGHT_REVIEW_ARTIFACTS=1` 时生成：

```text
review-artifacts/
  evidence-index.json
  screenshots/
    login.png
    dashboard-admin.png
    projects-manager-a.png
    project-a-overview.png
    project-access-denied.png
    viewer-readonly.png
```

`evidence-index.json` 是 Payload A 的预上传索引，不是权威发布 Manifest。它记录运行身份、截图合同和审查状态，但不得包含 `artifactId`、旧的单一 `commit` 字段、密码、Cookie、Session Token 或数据库连接。CI 缺少必需的 Head、PR merge、branch、workflow、version 或 build 时间元数据时失败关闭；本地运行以明确的 `null` / `local` 语义表示未进入 GitHub 发布链路。

产品审查 revision 字段不得混用：

- `headSha`：PR 分支实际 Head；main push 为被推送 Commit；普通本地索引为 `null`。
- `testedMergeSha`：PR runner 实际 checkout 并执行测试的 GitHub 临时 merge Commit，来自 `git rev-parse HEAD` 且必须等于该 PR run 的 `github.sha`；main push 和本地索引为 `null`。
- `stagingSha`：本次 CI 通过公网 Staging `/api/health` 的 `x-projectai-commit-sha` 响应头实际观测到的运行 Commit。只有 body 为 `status: ok` 且响应头是完整合法 SHA 时记录；网络失败、缺失或非法值均为 `null`，绝不能回填 `headSha` 或 `testedMergeSha`。
- `branch`：PR head ref 或 push ref name。
- `workflowRunId`：生成并上传该证据的 GitHub Actions Run ID，以十进制字符串保存；本地为 `null`。
- `artifactId`：GitHub 为已上传的 Payload A 分配的数字 Artifact ID，以十进制字符串保存。该值只存在于上传后生成的权威 Manifest。
- `version`：通过 `NEXT_PUBLIC_APP_VERSION` 注入受测 build 的应用版本。
- `buildTime`：通过 `NEXT_PUBLIC_BUILD_TIME` 注入受测 build 的 ISO-8601 时间；不是 PR 更新时间、Commit 时间或 Manifest 生成时间。

CI 的 `if: always()` 收尾在成功或失败时都执行，但原始目录不直接上传：

1. 写入 `review-artifacts/evidence-index.json`，并把 `playwright-report/`、`review-artifacts/`、`test-results/`、`test-logs/` 复制到 `product-review-evidence/`。
2. 从当前 CI 数据库读取 Session Token，并把它们与 `DATABASE_URL`、从 URL 单独解析的数据库密码、Better Auth Secret、数据库密码和 Seed 密码的精确值及组合编码变体加入敏感值集合；配置了数据库但无法完成查询时整个 sanitizer 失败关闭，不上传无法证明安全的证据。
3. 对 Cookie、Set-Cookie、Authorization、Session、password 和数据库连接字段做结构化脱敏；文件扩展名不作为信任边界，改名/嵌套 ZIP、gzip、归档 entry 名，以及任意文本内大小写、空白、Base64 或原始 percent-encoding 变体的 ZIP Data URI 都必须递归处理、复核并重建。无法安全处理的二进制/普通归档会先删除或以 omission 文件替代，并让整个脱敏步骤失败关闭，绝不发布不完整副本。
4. 对最终目录再次执行精确 Secret、折行编码和未脱敏 Session Cookie 扫描，并验证 evidence index 一致性。运行状态为 success/local 时强制 6 张必需截图均存在且非空；failure/cancelled 可缺图，但 `evidence-index.json` 与 `sanitization-report.json` 必须明确列出缺失项。通过后才写脱敏报告。
5. 上传不可变 Payload A：`product-review-evidence-${workflowRunId}-${runAttempt}`。脱敏失败会使 CI 失败并跳过上传，未经确认的原始证据不会离开 runner。
6. Payload A 上传成功后，读取 `actions/upload-artifact` 返回的真实 `artifact-id` 和 SHA-256 digest，生成唯一权威 `product-review-manifest/manifest.json`；Manifest 的 `artifactId` 明确指向 Payload A，而不是承载 Manifest 的 Artifact 自身。
7. 将权威 Manifest 作为独立 Provenance B：`product-review-manifest-${workflowRunId}-${runAttempt}` 上传。GitHub Artifact 在上传前没有 ID 且上传后不可变，因此不得把占位 ID 写入 Payload A，也不得覆盖上传制造新的不匹配 ID。A/B 均保留 14 天。

`npm run test:artifacts` 当前合并运行 sanitizer 与 Manifest 合同共 32 条测试，覆盖归档/编码/Session 脱敏、截图完整性、legacy `commit` 拒绝、CI 字段失败关闭、local/null 语义，以及 Artifact ID/name/digest/Run 的上传后绑定。

## 当前验证状态

- 本地与 CI 已通过：typecheck、lint、PostgreSQL/权限集成 27/27、production build + SSR/代理 7/7、部署契约 8/8、artifact/provenance 32/32 和 Playwright 11/11。
- Run `29313984989` 已同时产出并下载复核 Payload A `product-review-evidence-29313984989-1`（ID `8303225084`）与 Provenance B `product-review-manifest-29313984989-1`（ID `8303225479`）；A 含 6/6 截图和 `passed` 脱敏报告，B 正确区分 Head `ff19049...` 与 tested merge `b1961b49...`。
- Staging Commit `ff19049...` 已通过内部与公网登录、Session、角色、跨项目隔离、最后 Manager 409/审计约束、Secure/Path Cookie、Host 注入、资源 MIME、noindex、数据库/应用 Healthy、备份解析和 Production 精确不变验证；健康响应 header 返回完整运行 SHA。
- 详细运行证据见 `MVP_STATUS.md`。后续任何应用代码、Migration、Compose、Nginx snippet 或运行脚本变化都必须重新执行完整门禁，不能复用本次 Staging 结论。
