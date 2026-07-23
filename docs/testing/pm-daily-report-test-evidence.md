# 项目经理日报 MVP 测试证据

本文件只记录稳定的测试范围；最终 Head SHA、CI Run 与 Artifact Digest 写入 PR/CI Provenance，不写入 tracked 文档。

## Local UAT 结论修正（2026-07-23）

此前 `test:uat` 的 4/4 结果混合了 API、数据库、预置随记和渲染页面操作，不能证明普通用户从空状态完成随记 CRUD、AI 整理与人工确认。用户真实操作发现确认按钮因待审核而静默禁用，且 Seed 已预置 3 条随记，因此旧结论已撤回。2026-07-23 的当前门禁从空 Seed 重新建立两组互补证据：`test:uat:ui` 通过全 UI 随记 CRUD、AI 整理、字段错误、整批确认、刷新持久化、JSON 和 401/403/409/422/500 反馈；`test:uat` 的核心浏览器流程进一步通过确认/同步分离、首批 6h、第二批仅 2h、部分成功、failed 单项重试、unknown 人工核对和刷新不重复。Unit、API、Database Integration、Mock AI、Mock SmartSheet、Real Local UAT UI 和人工截图复核是独立证据，互不替代。

本轮 Local UAT 使用 **Mock AI + Mock SmartSheet**。真实 AI 人工质量测试 **NOT RUN**；真实 WeCom Canvas Dry Run/保存 **NOT RUN/BLOCKED**。因此下列 PASS 只证明本地产品流程和确定性 Provider 生命周期，不证明真实 AI 输出质量、真实腾讯文档写入、Staging 或 Production。

## 当前本地结果

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 全仓 TypeScript |
| `npm run lint` | 通过，0 warning/error | 全仓 ESLint |
| `npm run test:timesheets` | 59/59 通过 | API 鉴权合同、整批确认、保存验证、Mock SmartSheet 成功/失败/unknown/timeout/回读不一致/幂等、扩展协议与状态机 |
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
| `npm run test:uat` | 4/4 通过 | 真实浏览器点击核心流程；首批 6h、第二批 2h、逐项 partial、failed 重试、unknown 人工核对、幂等和 ACL |
| `npm run test:uat:ui` | 1/1 通过 | 真实 Local 服务/数据库/Chromium，空 Seed，全 UI 随记 CRUD、Mock AI、字段错误、整批确认、持久化、JSON 与五类错误反馈 |
| `npm run test:uat:flags` | 3/3 通过 | 日报关闭、WeCom 关闭、Real AI 未配置三条 UI/API 安全边界 |
| `npm run test:uat:database` | 113/113 通过 | 临时隔离数据库中的身份、ACL、Phase 1、AI、Embedding、Retrieval、日报生命周期集成 |
| `npm run timesheets:migration-upgrade` | 通过 | 非空 0015→0016→0017→0018→0019，保守历史回填、任务生命周期、保存证据和批次快照 |
| `npm run build` | 通过 | 完整 ProjectAI production build |
| `npm test` | 7/7 通过 | Local 数据库、AI flags=false 下的 build、SSR、Proxy、匿名路由与健康检查 |
| `git diff --check` | 通过 | whitespace |

Local Docker 隔离 PostgreSQL 已启用。UAT 数据库使用固定 Local-only 名称和 loopback 端口；额外数据库集成在随机临时数据库执行并在结束后删除。Migration upgrade、认证 SSR、Local UAT 与日报数据库集成均已本地通过。当前已推送 Head 的 GitHub CI 仍是合并前独立门禁。

`npm audit --omit=dev` 仍报告 6 个传递依赖告警：Next 间接 `sharp` 2 个 high、当前最新版 `drizzle-kit` 的旧 loader 间接 `esbuild` 4 个 moderate。Next 16.2.11 与 drizzle-kit 0.31.10 均为当前稳定最新版；没有使用会降级框架的 `npm audit fix --force`，也没有把超出 Next 支持范围的 override 宣称为修复。路径、runtime 影响、缓解、有效期与升级条件见 `docs/dependency-security.md`，仍需 Reviewer 明确批准。

Actions 已从 checkout/setup-node/upload-artifact v4 升级为官方 v7（Node 24 action runtime），工作流语义和门禁保持不变；deployment contract 23/23 同时验证 v7 与禁止退回 v4。当前 Head 的 GitHub CI 仍需确认 hosted runner 不再产生 Node 20 deprecated warning。

## 关键断言

- 无工作记录不创建 AI execution、不调用 Provider。
- AI 不能使用未授权项目、非法目录、非本用户来源、无依据工时或将计划/讨论改为完成。
- 低置信度始终可见但不再要求逐条点击；一次全局确认校验整批必填字段，异常总工时只警告不修正。
- 同用户/日期 AI 并发唯一，stale execution 可审计恢复。
- 确认与同步完全分离；未确认、旧版本、失去项目权限和已有活动批次不能同步。
- 批次相同 request 幂等，变更 replay 冲突，saved 不回退，伪造终态被拒绝。
- 批次/逐项状态单调，终态批次不可重新打开，unknown/cancelled 不可静默恢复，登录失效只在显式继续后重新入队，状态写回按页面事件顺序串行。
- Review/真实 Origin 构建强制手工 Popup 为 Dry Run；实际保存只能由已认证 ProjectAI 页面发起。
- 扩展拒绝 iframe/恶意 Origin/非法 Schema；restart running 变 unknown 且不自动重试，只有二次确认的人工核对才能转 saved/failed。
- Mock 所有场景最终提交计数为 0；实际模式只点击任务表单内、且不含最终提交语义的单条保存。
- Adapter 永不写 ProjectAI category；正常/加班工时独立，提交人只回读当前登录用户；保存反馈与任务列表回读任一不一致都拒绝成功。
- verified saved 任务转 submitted 并进入只读历史；failed/unknown 留在活动区，重试只包含 failed，unknown 不自动重试。
- submitted 来源随记不再进入 AI，第二批 Payload 不含第一批 task；统计按唯一 submitted 与当前活动任务分别聚合。

## 浏览器证据

Real Local UAT UI E2E 在真实 Chromium 中从登录页和空数据库开始，只通过渲染页面创建、编辑和删除随记，再执行 AI 整理、人工确认、刷新、复制与下载。忽略目录 `test-results/uat-ui/evidence/` 保存 7 张仅含虚构数据的截图、脱敏 JSON 和 `local-uat-ui-trace.sanitized.zip`；人工复核确认入口、错误、成功和刷新状态可见。Trace 在登录后才启动，并在保留前移除密码、Cookie、Session/Authorization 元数据；原始 Trace 随即删除。浏览器未处理 Console/Page Error 为 0，五条预期失败注入的浏览器网络错误单独计数，确认请求为一次 200。

同一 Local UAT 的 4/4 浏览器套件从空 Seed 完成三批流程：首批 3 个任务经一次确认后以 Mock SmartSheet 提交 6h；第二批只生成/发送新增 1 个任务、2h；第三批产生 A=saved、B=failed、C=unknown，B 的显式重试不含 A/C，C 只能人工核对。刷新后 submitted 数量和统计不重复。核心成功路径没有用 API/数据库替代页面创建、AI、确认或同步；API 只用于 ACL 和未确认拒绝等负向边界。

ProjectAI 的上述 PASS 不等于真实 WeCom PASS。真实 WeCom 未保存截图；此前只读 DOM 审计确认 HTTP 200、批准 Origin、1 Canvas、0 table/grid/treegrid。由于没有唯一 DOM Overlay，真实创建、保存、删除与最终提交点击计数均为 0，真实 Dry Run/保存仍不得标记为通过。
