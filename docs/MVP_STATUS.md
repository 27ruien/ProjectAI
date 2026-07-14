# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | `0.3.0-staging`（Identity and Project Isolation） |
| `main` 基线 | `821bdf8d85a009256b04780c725ef2eb5bd2c8cc`（PR #1 Squash Merge） |
| 开发分支 | `agent/auth-project-isolation` |
| Draft PR | [#2 Add authentication and project isolation](https://github.com/27ruien/ProjectAI/pull/2) |
| Staging | https://gridworks.cn/tool/projectai-staging/ |
| Staging 运行 Commit | `ff19049deca065b3dbc4698c3a219980dcd2f47b` |
| Production | https://gridworks.cn/tool/projectai/（本轮未部署、未重启、未迁移） |
| CI | [Run 29313984989](https://github.com/27ruien/ProjectAI/actions/runs/29313984989)，全部通过 |
| 产品审查 Evidence | `product-review-evidence-29313984989-1`（ID `8303225084`，保留 14 天） |
| 权威 Provenance Manifest | `product-review-manifest-29313984989-1`（ID `8303225479`，保留 14 天） |

## v0.3 交付结论

`Project AI OS v0.3 — Identity and Project Isolation` 的代码、CI、产品审查 evidence 和 Staging 验证已经闭环。Draft PR 仍等待产品与安全审查，未经审查不得合并。

- Better Auth 邮箱密码登录、受控预创建账号、PostgreSQL credential 与数据库 Session 已真实化；无公共注册、找回密码或社交登录。
- Session 通过 HttpOnly、SameSite、Secure、独立 Cookie 前缀与 `/tool/projectai-staging` Path 传递，不进入 localStorage、URL、日志或 artifact。
- 用户、credential、项目、项目成员、项目基础信息与身份/项目审计已使用 PostgreSQL；Migration 已提交，Seed 为 insert-only 幂等。
- 集中式服务端授权覆盖管理员、Manager、Member、Viewer、统一 404 防枚举、viewer 写拒绝和跨项目 URL/body/memberId 篡改。
- 每个项目以 `projects` 行作为成员变更互斥锁；唯一 `project_manager` 的降级或删除（包括 system_admin 操作）统一返回 `409 LAST_PROJECT_MANAGER`，拒绝事件在同一事务提交审计。Seed 和 Staging 发布均失败关闭零 Manager 数据。
- Mock 项目业务数据只在服务端确认项目成员关系后按精确 `projectId` 过滤并序列化。
- 反向代理只信任规范 HTTPS Host；Nginx exact basePath 使用固定绝对 URL，应用 `proxy.ts` 对不匹配的 Host、X-Forwarded-Host 或协议返回 404。
- 验证器为每次运行生成唯一 User-Agent，HTTP logout 失败时按该值参数化删除本次 Session；发现泄漏或无法证明清理均失败关闭。

## 自动化与产品审查证据

| 验证 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| ESLint | 通过 |
| Production build + SSR/代理边界 | `7/7` |
| PostgreSQL 身份、授权、审计与隔离集成测试 | `27/27` |
| Artifact sanitizer + provenance contract | `32/32` |
| Staging 部署安全契约 | `8/8` |
| Playwright 身份、隔离与 MVP 流程 | `11/11` |
| 产品审查截图 | `6/6` |
| Evidence 脱敏 | `passed`；review `success`；6/6 截图；unsafe binary/archive removed 均为 `0` |

CI 先上传仅含脱敏证据与 `evidence-index.json` 的 Payload A，再使用 GitHub 返回的真实 Artifact ID/digest 生成独立、权威的 Provenance B。Run `29313984989` 的 manifest 明确记录 `headSha=ff19049...`、`testedMergeSha=b1961b49...`、`workflowRunId=29313984989`、Evidence `artifactId=8303225084`、版本和实际 build time；部署前旧 Staging 尚未提供可信 revision header，因此该轮 `stagingSha` 为 `null`，没有用 Head 冒充。当前 Staging 已通过健康端点公开经校验的完整运行 SHA，后续 CI 会实时记录。

## Staging 验证

- App 与 PostgreSQL 均 `running=true`、`healthy`、restart count `0`；App 容器 ID `f205c58e5077...`，镜像 `project-ai-os-staging:ff19049...`；DB 容器 ID `4ba3776fb587...`。
- Compose project 为 `projectai-staging`；PostgreSQL 不发布宿主机端口，专属网络仅连接 App/DB，数据使用命名卷 `projectai-staging-postgres`。
- App/DB 均限制为 1 CPU、768 MiB、PID 256、json-file `10m × 3`；环境文件为 `root:root 600`，18 个 key 且全部唯一。
- 数据库纯计数：users `5`、accounts `5`、sessions `0`、projects `3`、memberships `5`、audits `120`、零 Manager 项目 `0`。
- 唯一 Manager 的公网 PATCH 与 DELETE 均返回精确 `409 LAST_PROJECT_MANAGER`；成员角色保持 `project_manager`，产生 `2` 条 `project_member_change_denied / denied / last_project_manager` 审计，验证 Session 清理后为 `0`。
- 备份目录为 `root:root 700`；共 5 份 root-only dump，最新 `projectai-staging-20260714T072535Z-ff19049deca065b3dbc4698c3a219980dcd2f47b.dump`，`pg_restore --list` 通过。
- 无部署 marker 或 lock 残留；Migration 当前，Seed 未覆盖既有身份、credential、角色、成员或项目字段。
- 正常入口为绝对 HTTPS：basePath → 尾斜杠 → dashboard → login；login/health、CSS、JS、font、SVG、PNG MIME 与 noindex 均通过。
- 恶意 `Host` 无尾斜杠只能得到 canonical HTTPS；带尾斜杠、login 和 dashboard 均为 404 且无 `Location`。
- 本次未修改或 reload Nginx；发布脚本只执行 `nginx -t`，配置测试通过。

## Production 保护结果

Production 容器状态在 Nginx 最小化修改和 Staging 发布前后均精确为：

```text
c5f98b491e67668139e3b84ccf2c7dbee75556135826eddabf0267382078b0d1 true 0 healthy
```

Production 根路径和 dashboard 均为 200。本轮未在 Production 主机上构建、重启、迁移、修改应用目录或重新部署本应用。

## 能力边界

### 真实能力

用户、`accounts.password_hash` credential、数据库 Session、登录限流、项目、项目成员关系、项目基础信息、身份/项目审计、服务端项目授权和 404 防枚举；前端交互、路由与 basePath；CI/Staging 配置。

### 仍为 Mock

项目资料、知识检索与问答、需求、Scope、Action、会议、风险、审核业务写入和 AI execution。Mock 内容只能在服务端授权后按项目过滤。

### 明确不在 v0.3 范围

- 文件上传、对象存储、解析和 OCR。
- Embedding、pgvector、Hybrid RAG、Reranker、真实模型或 Provider Key。
- 正式需求/Scope/Action/会议/风险持久化和完整 AI 审计。
- 公开注册、密码找回、社交登录与多租户计费。

## 当前风险与待审事项

- P0：真实知识索引/RAG 未实现，禁止上传或导入真实客户资料；当前服务端 Mock 过滤不能解释为真实知识检索已完成。
- P1：Mock Workflow 通过不代表正式业务持久化或真实 AI 能力通过。
- P2：`npm audit --omit=dev` 报告 4 个 moderate，来自 Drizzle Kit 旧 `@esbuild-kit`/esbuild 开发工具链；无 high/critical，不进入 standalone 应用运行镜像。禁止使用破坏性 `audit fix --force` 降级 Drizzle Kit。
- P2：GitHub Actions 提示 `actions/checkout@v4`、`setup-node@v4`、`upload-artifact@v4` 的 Node 20 runtime 已弃用，当前由 runner 强制使用 Node 24；后续应升级到官方兼容版本。
- P2：`nginx -t` 仍显示既有 HTTP `gridworks.cn` server_name 冲突 warning；配置测试成功且 HTTPS/Staging/Production 均通过，本轮未扩大范围修改其他站点。
- P2：vinext 字体仍使用同源 `/assets/_vinext_fonts/` 窄映射；升级字体或 vinext 后必须重新验证 hash，不能增加宽泛 `/assets/` 代理。

当前没有 v0.3 技术阻塞或未解决 P0/P1。剩余动作是 PR #2 的产品/安全审查；PR 保持 Draft，不得自动合并。下一轮真实上传、对象存储、解析和 Project RAG 必须单独设计与审查，不得并入本 PR。

## 最近验证

- 时间：2026-07-14（Asia/Shanghai）。
- CI：Run `29313984989` 全绿；Evidence ID `8303225084` 与 Provenance ID `8303225479` 已下载复核，32/32 provenance/sanitizer 合同通过。
- Staging：Commit `ff19049...` 已部署，内部和公网登录、Session、角色、跨项目隔离、最后 Manager 保护、Host 注入、资源与 noindex 全部通过；健康响应 header 返回完整运行 SHA。
- 基础设施：数据库私网、命名卷、资源限制、5 份备份可读、零 Manager 项目 `0`、测试 Session 清零、marker/lock 清理均通过独立只读审计。
- Production：容器 ID、运行状态、restart count 与 health 精确未变。
