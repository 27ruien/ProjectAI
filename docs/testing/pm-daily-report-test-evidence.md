# 项目经理日报 MVP 测试证据

本文件只记录稳定的测试范围；最终 Head SHA、CI Run 与 Artifact Digest 写入 PR/CI Provenance，不写入 tracked 文档。

## 当前本地结果

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 全仓 TypeScript |
| `npm run lint` | 通过，0 warning/error | 全仓 ESLint |
| `npm run test:timesheets` | 42/42 通过 | API 鉴权合同、日报 AI 信任边界、扩展协议/状态机 |
| `npm run extension:package` | 通过 | `v0.1.0` ZIP，manifest 位于根目录 |
| `npm run test:extension-package` | 3/3 通过 | MV3 权限、包内容、无最终提交 Selector |
| `npm run test:extension-e2e` | 9/9 通过 | ProjectAI bridge、Popup、restart、Mock WeCom iframe/Dry Run/保存/异常/DOM 变化 |
| `npm run test:artifacts` | 32/32 通过 | Evidence allowlist、脱敏与 provenance |
| `npm run test:assistant` | 15/15 通过 | 既有 AI Gateway/Qwen/SEC-006 回归 |
| `npm run test:embeddings` | 14/14 通过 | Embedding 边界回归 |
| `npm run test:retrieval` | 10/10 通过 | Retrieval/RRF 回归 |
| `npm run test:documents` | 15/15 通过 | Parser/Chunking 回归 |
| `npm run test:deployment` | 23/23 通过 | Staging/Production 配置保护回归 |
| `npm run test:release` | 16/16 通过 | Release tooling 回归 |
| `npm run test:production-rollout` | 62/62 通过 | B3-C2A executor/authorization/lock 回归 |
| `npm run build` | 通过 | 完整 ProjectAI production build |
| `git diff --check` | 通过 | whitespace |

数据库升级/集成、需要认证数据的 SSR 断言与 ProjectAI E2E 需要隔离 PostgreSQL。本机 Docker daemon 未运行且无 `DATABASE_URL`，因此尚未本地执行；`npm test` 已完成 build，7 个 SSR/Proxy 测试中 5 个通过，health 与受保护路由 2 个因数据库不可用失败。CI 已增加 PostgreSQL 17/pgvector 下的强制步骤，合并前必须以当前 Head 的 CI 结果关闭这些环境门禁。

`npm audit --omit=dev` 仍报告 6 个传递依赖告警：Next 间接 `sharp` 2 个 high、当前最新版 `drizzle-kit` 的旧 loader 间接 `esbuild` 4 个 moderate。已将 Next 升至当前 16.2 patch `16.2.11`，但其官方依赖范围仍固定 `sharp ^0.34.5`；没有使用会降级 Next/Drizzle 的 `npm audit fix --force`。合并前需由依赖维护者给出处置或升级路径。

## 关键断言

- 无工作记录不创建 AI execution、不调用 Provider。
- AI 不能使用未授权项目、非法目录、非本用户来源、无依据工时或将计划/讨论改为完成。
- 每个 AI 任务始终需要人工审核；异常总工时只警告不修正。
- 同用户/日期 AI 并发唯一，stale execution 可审计恢复。
- 未确认、旧版本、失去项目权限和已有活动批次不能同步。
- 批次相同 request 幂等，变更 replay 冲突，saved 不回退，伪造终态被拒绝。
- 终态批次不可重新打开，unknown/cancelled 不可静默恢复，状态写回按页面事件顺序串行。
- 扩展拒绝 iframe/恶意 Origin/非法 Schema；restart running 变 unknown 且不自动重试，只有二次确认的人工核对才能转 saved/failed。
- Mock 所有场景最终提交计数为 0；实际模式只点击任务表单内、且不含最终提交语义的单条保存。

## 浏览器证据

ProjectAI E2E 在 `PLAYWRIGHT_REVIEW_ARTIFACTS=1` 时生成 `daily-report-confirmed.png`，仅含虚构随记。真实 WeCom 截图尚未生成；首次真实验收必须由用户手动登录并排除二维码、凭据和客户资料。
