# 依赖安全审计与限时风险登记

审计日期：2026-07-23。命令：`npm audit --omit=dev`、`npm outdated`、`npm ls sharp esbuild @esbuild-kit/esm-loader @esbuild-kit/core-utils --all`。

## 当前结果

| ID | 路径 | 等级/范围 | 是否进入 Production runtime | 当前影响与缓解 | 有效期与关闭条件 |
| --- | --- | --- | --- | --- | --- |
| DEP-2026-07-SHARP | `next@16.2.11 → sharp@0.34.5` | 2 high；`sharp <0.35.0`，GHSA-f88m-g3jw-g9cj | 是，作为 Next 可选图像处理依赖进入安装图 | 本仓库没有 `next/image`、远程 image pattern 或本轮新增的图片处理入口；日报/扩展不接收图片。Next 16.2.11 已是稳定最新版且声明 `sharp ^0.34.5`，强制 0.35.3 超出上游支持范围；npm 的自动方案会降级 Next 14，已拒绝 | 风险接受仅建议有效至 2026-08-06，且必须由 Security/依赖维护 Reviewer 明确批准。Next 发布兼容 `sharp >=0.35` 的稳定版后立即升级；若新增图片处理入口、出现可利用性证据或到期仍无上游修复，则阻塞合并/发布 |
| DEP-2026-07-ESBUILD | `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20` | 4 moderate；`esbuild <=0.24.2`，GHSA-67mh-4wv8-2f99 | 否；drizzle-kit 是开发/Migration 生成工具，不进入应用运行镜像入口 | 不在不受信网络上启动该旧 esbuild development server；Migration 生成只在受控本地/CI 执行。drizzle-kit 0.31.10 已是稳定最新版；npm 的自动方案会降级至 0.18.1，已拒绝 | 风险接受建议有效至 2026-08-22，并需 Reviewer 批准。drizzle-kit 移除旧 loader 或提供安全依赖链后升级；若工具暴露网络服务或进入 runtime，立即阻塞 |

## 决策边界

- 未执行 `npm audit fix --force`，未降级 Next、React、Drizzle 或核心框架。
- 未使用越过 Next 声明范围的 `overrides` 冒充已修复。稳定上游兼容升级出现前，审计仍会如实报告 2 high、4 moderate。
- 上表是待批准的限时风险接受记录，不等于安全 Reviewer 已批准。PR 在批准、真实联调、Staging 与 Reviewer 门禁完成前保持 Draft。
