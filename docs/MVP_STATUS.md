# MVP Status

## 版本信息

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | `0.3.0-staging`（Identity and Project Isolation） |
| 当前 main Commit | `821bdf8d85a009256b04780c725ef2eb5bd2c8cc`（PR #1 Squash Merge） |
| 当前开发分支 | `agent/auth-project-isolation` |
| 当前 Draft PR | 尚未创建；计划标题 `Add authentication and project isolation` |
| 生产地址 | https://gridworks.cn/tool/projectai/ |
| Staging 地址 | https://gridworks.cn/tool/projectai-staging/（0.2 基线在线；v0.3 尚未部署验收） |

## 已完成

- 完整 Mock 项目业务体验：知识、需求提取、审核、Scope、Action、会议、风险、Skills 与模型配置；项目身份、列表、创建、基础信息和成员关系已改为 PostgreSQL 真实数据。
- `AIGateway`、`ProjectKnowledgeService` Mock 契约与来源引用展示。
- Better Auth `1.6.23` + Drizzle PostgreSQL 认证配置：邮箱密码登录、禁用公共注册、数据库 Session、HttpOnly/SameSite Cookie、token 最小化/no-store Auth 响应、停用 Session 撤销、Staging/Production Secure 与 basePath/Cookie 前缀隔离、数据库登录限流。
- PostgreSQL Schema、Migration 和 Repository：`users`、`accounts`、`sessions`、`verifications`、`rate_limits`、`projects`、`project_members`、`audit_events`。
- 服务端身份和项目授权：集中式管理员绕过、项目角色校验、无权/不存在统一 404、防枚举拒绝审计、普通写权限 403，以及所有状态变更在数据库操作前执行精确可信 Origin/JSON 校验。
- 数据库项目列表、项目创建、项目基础信息、项目成员管理与身份/项目审计 API。
- 授权后的 Mock 映射：项目详情先查询数据库成员关系，再按精确 `projectId` 在服务端过滤；全局项目业务数组只保留当前用户可访问项目。
- 5 个环境变量 Seed 用户、3 个项目和 insert-only 幂等 Seed；重跑保持已有身份状态、角色、项目编辑与 credential，测试 Reset 同时限制环境、显式开关、主机和数据库名称。
- CI PostgreSQL 17 Service、临时凭据、Migration/Seed、当前 20 条授权/审计/逐项目审核权限集成用例和身份/隔离 E2E；成功/失败均尝试生成 `product-review-evidence/` 脱敏副本，只有数据库 Session 可核验且最终复核通过才上传，失败关闭。
- Staging Compose 已定义独立 PostgreSQL 容器、私有网络、命名卷、最小化 Secret 注入、受控 Migration/Seed 操作容器，以及查询数据库和四张身份/项目核心表的 `/api/health` 健康检查。
- Staging 部署脚本以唯一 token 原子锁串行发布，只从当前 Commit tracked files 在本地按远端平台构建应用/`db-tools` 镜像并流式传输，远端所有 Compose 操作显式 `--no-build`；脚本拒绝目录 symlink、重复/保留环境覆盖并严格校验数据库命名卷。每次 Migration 前检查空间并流式、原子生成且解析验证 root-only `pg_dump`（保留最近 10 份），替换应用后如验收失败按 immutable image ID 恢复并核对。数据库卷保持不动，Production baseline 后的所有退出路径必须不变；运行容器设有 CPU/内存/PID/日志上限。
- Production Docker Compose、standalone、Nginx 子路径部署与健康检查。
- Production 地址已上线；本轮不重新部署生产。

## 待运行确认

- 本地 `typecheck`、`lint`、PostgreSQL/权限集成测试 20/20、v0.3 production build、SSR 路由 4/4 和 Playwright E2E 11/11 已通过。
- 本地已生成并目检 6/6 产品审查截图，`manifest.json` 完整，真实附件的脱敏副本与内容识别归档重建/复核已在本地验证；SFX/MIME/原始 percent Data URI/折行 Base64/超长 Session JSON/二进制结构化数据/缺失证据/数据库失败关闭在内的 sanitizer fixture 为 10/10。CI 中的实际生成、脱敏报告与上传仍需 Draft PR Workflow 证明。
- v0.3 尚未部署 Staging，因此数据库容器 Healthy、Secure/Path Cookie、刷新/退出、Manager/Viewer/Admin 公网边界和 Production 不变证据均待采集。
- Draft PR 和 GitHub Actions 结果尚未创建。

## 不在 v0.3 范围 / 未完成

- 对象存储、真实文件上传和解析/OCR。
- Embedding、Hybrid RAG、Reranker、真实模型调用。
- 正式需求/Scope/Action/会议/风险持久化和完整业务审计。
- 公开注册、找回密码、社交登录和多租户计费。

## Mock 能力

文件处理、知识检索、AI 回答、需求提取、审核写入、Scope、Action Plan、风险、会议处理和 AI execution。Mock 业务内容只能在服务端授权后按项目过滤。

## 真实能力

用户、只存于 `accounts.password_hash` 的 credential hash（`users` 无重复列）、数据库 Session、登录限流、项目、项目成员关系、项目基础信息、身份/项目审计、服务端项目授权和 404 防枚举；前端交互、路由与 basePath；AI/知识服务接口边界；CI/Staging 配置。

## 当前风险

- P0：`SEC-008` 的本轮服务端 Mock 项目过滤已通过本地 build/E2E，但真实知识索引/RAG 仍未实现；禁止真实客户资料。
- P0：GitHub CI 与 v0.3 Staging 公网身份/项目边界尚未形成外部运行证据。
- P0：知识内容仍为 Mock，没有真实文件/索引/RAG；服务端过滤不能被解释为真实知识检索已完成。
- P1：Mock 流程通过不代表持久化和真实 AI 能力通过。
- Staging 与 Production 同域，必须保持独立 Cookie 前缀、Cookie Path、认证 URL 和 localStorage key；反向代理必须覆盖可信 `x-real-ip`。
- Better Auth 与 vinext 的本地 production build/E2E 兼容性已验证；Staging 结果仍是外部关闭条件。
- P2：`npm audit --omit=dev` 当前报告 4 个 moderate，来源是 Better Auth/Drizzle Kit 的旧 `@esbuild-kit` 开发服务器链；无 high/critical，且该链未进入 `dist/standalone` 应用运行镜像，只存在于短生命周期数据库工具依赖。待上游提供兼容升级后移除，禁止用破坏性 `audit fix --force` 降级 Drizzle Kit。
- P2：当前 vinext 字体 URL 使用同源 `/assets/_vinext_fonts/`；本次与 Production 字体 hash 相同，未来升级字体依赖时需解除该共享映射。

## 当前阻塞

- 本轮交付仍被 Draft PR、GitHub CI artifact 和 v0.3 Staging 部署证据阻塞；本地 build、SSR/E2E 与产品截图已闭环。
- 真实资料试点仍被文件上传、对象存储、解析、知识权限索引和真实 RAG 的安全设计阻塞；不得因为身份层完成而提前上传资料。

## 本轮目标

完成 `Project AI OS v0.3 — Identity and Project Isolation` 的 build/E2E/CI/Staging 验证、产品审查 artifacts 和 Draft PR；Production 保持不变。

## 下一优先级

先完成 v0.3 产品与安全审查，再单独设计真实上传、对象存储、解析和 Project RAG；不得把下一轮能力并入本 PR。

## 最近验证

- 时间：2026-07-14（Asia/Shanghai）。
- v0.3 本地已确认：两次空库 Reset/Migration/Seed、第三次 insert-only Seed、PostgreSQL 授权/审计/逐项目审核权限集成 20/20、`npm run typecheck`、`npm run lint`、`npm test`（production build + SSR 4/4）和 Playwright 11/11 全部通过；Action 持久化/水合并发压力 5/5 通过。
- v0.3 本地 artifacts：6/6 review screenshots 与完整 manifest 已生成并目检，客户端构建 Seed 业务内容扫描通过；真实失败附件的 `product-review-evidence/` 脱敏与 ZIP 复核已通过本地验证。
- v0.3 当前待确认：Draft PR GitHub Actions、CI artifact 内容、Staging 数据库/应用健康与公网身份边界。
- 历史 0.2 基线：PR #1 已以 Squash 方式合并为 `821bdf8`；当时的 Staging/noindex/静态资源与 Production 回归证据不能作为 v0.3 运行结果复用。
