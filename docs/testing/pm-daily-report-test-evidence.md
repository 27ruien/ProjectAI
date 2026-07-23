# 项目经理日报 MVP 测试证据

本文件只记录稳定的测试范围；最终 Head SHA、CI Run 与 Artifact Digest 写入 PR/CI Provenance，不写入 tracked 文档。

## 当前本地结果

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 全仓 TypeScript |
| `npm run lint` | 通过，0 warning/error | 全仓 ESLint |
| `npm run test:timesheets` | 57/57 通过 | API 鉴权合同、精确工时/进度证据、重复来源拒绝、手工 UAT Payload、旧/新扩展协议、状态机与登录恢复 |
| `npm run extension:package` | 通过 | `v0.1.0` ZIP，manifest 位于根目录 |
| `npm run test:extension-package` | 5/5 通过 | MV3 精确权限、无完整 URL/认证状态、构建绑定、无最终提交 Selector |
| `npm run test:extension-e2e` | 16/16 通过 | 八字段、双工时/提交人、分类不写、Portal/虚拟选项、只读进度、刷新持久化、清理、列表回读、auto-save 前置停止及恢复场景 |
| `npm run test:artifacts` | 32/32 通过 | Evidence allowlist、脱敏与 provenance |
| `npm run test:assistant` | 16/16 通过 | 既有 AI Gateway/Qwen/SEC-006 与日报 Fake Provider 状态回归 |
| `npm run test:embeddings` | 14/14 通过 | Embedding 边界回归 |
| `npm run test:retrieval` | 10/10 通过 | Retrieval/RRF 回归 |
| `npm run test:documents` | 15/15 通过 | Parser/Chunking 回归 |
| `npm run test:deployment` | 23/23 通过 | Staging/Production 配置保护回归 |
| `npm run test:release` | 16/16 通过 | Release tooling 回归 |
| `npm run test:production-rollout` | 62/62 通过 | B3-C2A executor/authorization/lock 回归 |
| `npm run test:uat` | 4/4 通过 | 三账号真实认证、Session、项目 ACL、日报 CRUD/AI/拆分/合并/确认/JSON/同步幂等 |
| `npm run test:uat:flags` | 2/2 通过 | 日报与 WeCom Flag 分别关闭时 UI/API 都拒绝 |
| `npm run test:uat:database` | 111/111 通过 | 临时隔离数据库中的身份、ACL、Phase 1、AI、Embedding、Retrieval、日报集成 |
| `npm run timesheets:migration-upgrade` | 通过 | 非空 0015→0016→0017，旧 hours 与新八字段约束 |
| `npm run build` | 通过 | 完整 ProjectAI production build |
| `npm test` | 7/7 通过 | build、SSR、Proxy、匿名路由与健康检查 |
| `git diff --check` | 通过 | whitespace |

Local Docker 隔离 PostgreSQL 已启用。UAT 数据库使用固定 Local-only 名称和 loopback 端口；额外数据库集成在随机临时数据库执行并在结束后删除。Migration upgrade、认证 SSR、Local UAT 与日报数据库集成均已本地通过。当前未提交 Head 推送后的 GitHub CI 仍是合并前独立门禁。

`npm audit --omit=dev` 仍报告 6 个传递依赖告警：Next 间接 `sharp` 2 个 high、当前最新版 `drizzle-kit` 的旧 loader 间接 `esbuild` 4 个 moderate。Next 16.2.11 与 drizzle-kit 0.31.10 均为当前稳定最新版；没有使用会降级框架的 `npm audit fix --force`，也没有把超出 Next 支持范围的 override 宣称为修复。路径、runtime 影响、缓解、有效期与升级条件见 `docs/dependency-security.md`，仍需 Reviewer 明确批准。

Actions 已从 checkout/setup-node/upload-artifact v4 升级为官方 v7（Node 24 action runtime），工作流语义和门禁保持不变；deployment contract 23/23 同时验证 v7 与禁止退回 v4。当前 Head 的 GitHub CI 仍需确认 hosted runner 不再产生 Node 20 deprecated warning。

## 关键断言

- 无工作记录不创建 AI execution、不调用 Provider。
- AI 不能使用未授权项目、非法目录、非本用户来源、无依据工时或将计划/讨论改为完成。
- 每个 AI 任务始终需要人工审核；异常总工时只警告不修正。
- 同用户/日期 AI 并发唯一，stale execution 可审计恢复。
- 未确认、旧版本、失去项目权限和已有活动批次不能同步。
- 批次相同 request 幂等，变更 replay 冲突，saved 不回退，伪造终态被拒绝。
- 批次/逐项状态单调，终态批次不可重新打开，unknown/cancelled 不可静默恢复，登录失效只在显式继续后重新入队，状态写回按页面事件顺序串行。
- Review/真实 Origin 构建强制手工 Popup 为 Dry Run；实际保存只能由已认证 ProjectAI 页面发起。
- 扩展拒绝 iframe/恶意 Origin/非法 Schema；restart running 变 unknown 且不自动重试，只有二次确认的人工核对才能转 saved/failed。
- Mock 所有场景最终提交计数为 0；实际模式只点击任务表单内、且不含最终提交语义的单条保存。
- Adapter 永不写 ProjectAI category；正常/加班工时独立，提交人只回读当前登录用户；保存反馈与任务列表回读任一不一致都拒绝成功。

## 浏览器证据

ProjectAI E2E 在 `PLAYWRIGHT_REVIEW_ARTIFACTS=1` 时生成 `daily-report-confirmed.png`，仅含虚构随记。真实 WeCom 未保存截图。用户已在隔离临时 Chromium 中手动登录；只读 DOM 审计确认 HTTP 200、批准 Origin、1 Canvas、0 table/grid/treegrid。由于没有唯一 DOM Overlay，真实创建、保存、删除与最终提交点击计数均为 0，真实 Dry Run/保存不得标记为通过。
