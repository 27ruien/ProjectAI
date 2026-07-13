# MVP Status

## 版本信息

| 项目 | 当前值 |
| --- | --- |
| 当前版本 | `0.2.0-staging`（验证基础迭代） |
| 当前 main Commit | `e09663c16cd186703d6a7e565d75bfbdfdec7db7` |
| 当前开发分支 | `agent/mvp-validation-foundation` |
| 当前 Draft PR | [#1 Add MVP validation and staging foundation](https://github.com/27ruien/ProjectAI/pull/1)（Draft） |
| 生产地址 | https://gridworks.cn/tool/projectai/ |
| Staging 地址 | https://gridworks.cn/tool/projectai-staging/（已验收） |

## 已完成

- 完整 Mock 项目管理、项目知识、需求提取、审核、Scope、Action、会议、风险、Skills 与模型配置体验。
- `AIGateway`、`ProjectKnowledgeService` Mock 契约与来源引用展示。
- Production Docker Compose、standalone、Nginx 子路径部署与健康检查。
- Production 地址已上线；本轮不重新部署生产。

## 部分完成

- projectId 级 Mock 数据过滤存在，但没有正式认证与权限隔离。
- 文件选择、解析、检索、AI 调用、审核写入均为 Mock。
- AI 草稿和审核交互已分离，正式数据写入尚未实现。
- Action Plan 仅使用环境隔离的浏览器本地状态。

## 未完成

- 正式登录、RBAC、跨项目权限测试。
- PostgreSQL、对象存储、真实文件上传和解析。
- Embedding、Hybrid RAG、Reranker、真实模型调用。
- 正式审核、审计与需求持久化。

## Mock 能力

用户身份、项目权限、文件处理、知识检索、AI 回答、需求提取、审核写入、Scope、Action Plan、风险与会议处理。

## 真实能力

前端交互、路由与 basePath；AI/知识服务接口边界；本地/CI 自动验证；Docker/Nginx 部署结构；Staging 环境隔离和审查流程。

## 当前风险

- P0：无正式认证与项目权限隔离，禁止真实客户资料。
- P0：真实知识查询尚不能执行权限过滤。
- P1：Mock 流程通过不代表持久化和真实 AI 能力通过。
- Staging 与 Production 同域，必须使用环境隔离的 localStorage key。
- P2：当前 vinext 字体 URL 使用同源 `/assets/_vinext_fonts/`；本次与 Production 字体 hash 相同，未来升级字体依赖时需解除该共享映射。

## 当前阻塞

- 真实试点被认证、权限、数据存储和文件安全能力阻塞。
- 真实业务能力的 P0/P1 阻塞不影响 Mock MVP 验证环境，但在进入真实试点前必须关闭。

## 本轮目标

建立权威文档、Playwright 三条主流程、运行时错误监控、GitHub Actions、独立 Staging、反馈入口和 Draft PR 审查闭环。

## 下一优先级

先完成认证与项目级权限模型，再引入 PostgreSQL、对象存储、文件解析和真实 Project RAG；不得跳过安全基础直接接入客户资料或模型 API。

## 最近验证

- 时间：2026-07-13（Asia/Shanghai）。
- 本地结果：`npm ci`、typecheck、lint、4 条 SSR/架构测试、3 条 Playwright 主流程和 `npm run qa:mvp` 全部通过。
- 本地 Staging 容器预检：独立 3101 健康，STAGING/Commit/noindex 可见，CSS/JS/font/favicon/OG MIME 正确；验证后已清理本地临时容器。
- 公网 Staging：候选代码基线 `b72b423e` 已通过根路由、深层路由、重定向、noindex、静态资源 MIME 和公网 3 条 Playwright 主流程；最终状态文档提交按相同门禁再次部署，页面横幅与容器镜像标签必须等于 Draft PR HEAD。
- Nginx：新增 Staging 专用 location 前已备份为 `/etc/nginx/sites-available/timeline-maker.backup.20260713030110`；`nginx -t` 成功后才 reload，服务保持 active。
- Production 回归：容器 ID `c5f98b491e67668139e3b84ccf2c7dbee75556135826eddabf0267382078b0d1`、healthy、restart 0；Production 及既有站点均为 200，本轮未重建或重启 Production。
- Draft PR CI：最终 HEAD 的 typecheck、lint、SSR/路由测试、3 条 Playwright 主流程和 Production build 必须全部成功；PR 保持 Draft，不在本轮合并。
