# 依赖安全审计与处置记录

审计日期：2026-07-27。执行 `npm audit --omit=dev`、完整 `npm audit`、`npm outdated` 和精确依赖树核对；未执行 `npm audit fix --force`，未降级 Next、React、Drizzle 或其他核心框架。

## 当前结论

| ID | 路径 | 当前状态 | Runtime 范围 | 处置与后续条件 |
| --- | --- | --- | --- | --- |
| DEP-2026-07-SHARP | `next@16.2.12 → sharp` | **已关闭**。`sharp` 锁定为 0.35.3，`npm audit --omit=dev` 不再报告 GHSA-f88m-g3jw-g9cj | Next 的可选图像处理依赖 | Next 16.2.12 仍声明 `sharp ^0.34.5`，因此使用根级精确 override；Next 16.3 preview 已采用 `sharp ^0.35.3`，本仓库同时以完整 build、测试和 Staging 验收验证兼容性。稳定 Next 原生声明 0.35.x 后移除 override。 |
| DEP-2026-07-RSC | `react-server-dom-webpack@19.2.6` | **已关闭**。升级至 19.2.8；React/React DOM 同步至 19.2.8 | 开发构建与 RSC | 保持 React 三件套 patch 版本一致，并由完整 CI/build 验证。 |
| DEP-2026-07-YAML-GLOB | Babel/YAML、ESLint/minimatch/brace-expansion 工具链 | **Production runtime 已关闭**。YAML/Babel 与可安全更新的 brace-expansion 已升级；完整 audit 仍会将 ESLint 9 的依赖传播标记为 High | 仅 lint/build 工具，不进入 `npm audit --omit=dev` 的 Production 安装图 | ESLint 10.8.0 已实测与 Next 16.2.12 的 React lint 插件不兼容，出现规则加载失败，因此回到 9.39.4。不得将 lint 工具暴露为服务；待 Next 插件支持 ESLint 10 后一起升级。 |
| DEP-2026-07-ESBUILD | `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild@0.18.20` | **开放：4 Moderate**，GHSA-67mh-4wv8-2f99 | `npm audit --omit=dev` 会计入 optional peer 路径，但应用、容器和 Migration runner 不导入 drizzle-kit，也不启动 esbuild dev server | 漏洞利用需要访问已暴露的 esbuild development server；Staging/Production 不运行或发布该端口。npm 唯一自动方案会破坏性降级 drizzle-kit 至 0.18.1，已拒绝。Owner：ProjectAI 依赖维护；复核期限：2026-08-10；上游移除旧 loader 或发布兼容修复后立即升级。若任何环境暴露 esbuild dev server，则重新列为发布阻塞。 |

## 审计边界

- `npm audit --omit=dev`：0 Critical、0 High、4 Moderate。
- 完整 `npm audit` 额外包含开发期 ESLint 依赖传播；它不进入 Production runtime，但仍保留在 CI 工具链跟踪中。
- PR #12 对 2 个 High 的限时接受不沿用到本 PR；本轮通过 `sharp@0.35.3` 和 React 19.2.8 将对应 High 实际关闭。
- 依赖处置只有在 typecheck、lint、unit、database integration、build、Playwright 和 Staging 门禁全部通过后才视为完成。
