# 依赖安全审计与限时风险登记

审计日期：2026-07-26。命令：`npm audit --omit=dev`、`npm outdated`、`npm ls next sharp drizzle-kit esbuild @esbuild-kit/esm-loader @esbuild-kit/core-utils --all`，并通过 npm registry 核对当前稳定版本的依赖声明。

## 当前结果

| ID | 路径 | 等级/范围 | 是否进入 Production runtime | 当前影响与缓解 | 有效期与关闭条件 |
| --- | --- | --- | --- | --- | --- |
| DEP-2026-07-SHARP | `next@16.2.11 → sharp@0.34.5` | 2 high；`sharp <0.35.0`，GHSA-f88m-g3jw-g9cj | 是，作为 Next 可选图像处理依赖进入安装图 | 本仓库没有 `next/image`、远程 image pattern 或本轮新增的图片处理入口；日报/知识附件不调用 sharp。2026-07-26 的最新稳定 Next 16.2.12 仍声明 `sharp ^0.34.5`，而最新 sharp 已是 0.35.3；强制跨越 Next 声明范围不是受支持升级，npm 自动方案会降级 Next 14，均已拒绝 | ProjectAI 项目负责人已对 PR #12 接受该 2 个 High，有效至 2026-08-06；风险跟踪 Owner 为 ProjectAI 项目负责人。Next 发布兼容 `sharp >=0.35` 的稳定版后立即升级；若新增图片处理入口、出现可利用性证据或到期仍无上游修复，则重新阻塞后续发布 |
| DEP-2026-07-ESBUILD | `better-auth@1.6.25` 的 optional peer 与根开发依赖共同保留 `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20` | 4 moderate；`esbuild <=0.24.2`，GHSA-67mh-4wv8-2f99 | `npm audit --omit=dev` 会计入该 optional peer 路径，但应用运行时代码、容器启动和 Migration 执行均不导入 drizzle-kit 或启动 esbuild development server | 漏洞需要用户浏览恶意网站并访问一个对外暴露的 esbuild development server；Production/Staging 不运行该服务，Migration 只用受控 `tsx` runner，且端口不发布。2026-07-26 的最新稳定 drizzle-kit 仍是 0.31.10，旧 loader 的 core-utils 明确锁定 `esbuild ~0.18.20`；npm 提议降级 drizzle-kit 到 0.18.1，属于破坏性方案，已拒绝 | 风险接受仅建议有效至 2026-08-06，且必须由 Security/依赖维护 Reviewer 明确批准。drizzle-kit 移除旧 loader、better-auth 不再声明该 optional peer，或上游发布无漏洞兼容版本时立即升级；若任何环境开始运行或暴露 esbuild dev server，则立即阻塞发布 |

## 决策边界

- 未执行 `npm audit fix --force`，未降级 Next、React、Drizzle 或核心框架。
- 未使用越过 Next 声明范围的 `overrides` 冒充已修复。稳定上游兼容升级出现前，审计仍会如实报告 2 high、4 moderate（`--omit=dev`）。
- 2026-07-26T17:47:36+08:00，ProjectAI 项目负责人明确接受 `DEP-2026-07-SHARP` 登记的 2 个 High，有效期截止到 2026-08-06。依据是：当前没有安全的非破坏性升级路径；没有使用 `npm audit fix --force`；精确 Head `02daac0344101c42cfff4f1d76ff8f96a5354c62` 的完整 CI、Staging Product V2 9/9 UAT 和独立安全检查已通过；本文已登记缓解、Owner、截止日期和升级条件。
- 该接受决定仅适用于 PR #12 Product V2 的 Ready 与合并判定，不授权 Production 部署、Migration、Restart 或 B3-C2B。本次 Reviewer=0 不再作为 PR #12 Ready 阻塞项。
- `DEP-2026-07-ESBUILD` 的 4 个 Moderate 继续按表中缓解和升级条件跟踪；它们不在本次“2 个 High”风险接受范围内。
