# ProjectAI PR #11 自主联调运行日志

本日志只记录脱敏、可复核的阶段证据。真实 Smart Sheet 地址统一记为
`https://doc.weixin.qq.com/smartsheet/[REDACTED]`；不记录访问参数、Cookie、
Token、浏览器认证状态、原有任务正文或私有 Selector。

## 运行基线

- 开始时间：2026-07-23 01:19 CST（2026-07-22T17:19:18Z）
- Branch：`agent/pm-daily-report-mvp`
- 初始 Head：`16bc23782709b631f5b1b7581c4a39288db7a7a3`
- `origin/main`：`82b516a48141d6cdd68467938573e16cc5b6487a`
- 本地与远端 feature branch：一致（ahead 0 / behind 0）
- PR #11：OPEN / Draft / MERGEABLE / CLEAN
- 开始时存在本轮延续的未提交修复；未重置、未清理、未覆盖。

## 阶段记录

### 1. 仓库与安全边界复核

- 状态：完成
- 完成时间：2026-07-23 01:19 CST
- 命令：`git status`、`git fetch origin --prune`、`git log`、
  `git diff --stat origin/main...HEAD`、`git diff --check`、`gh pr view`、
  tracked-file Secret marker scan。
- 结果：分支和远端基线符合授权；PR 保持 Draft；未发现 tracked 文件包含
  Smart Sheet 访问参数。通用 Secret marker 命中均位于既有安全测试或受控发布工具，
  未输出其内容。
- 修复：补充忽略本地 Selector、隔离浏览器 Profile、认证状态和私有截图目录。

### 2. 真实页面只读审计（第一轮）

- 状态：部分完成 / DOM 通道阻塞
- 环境：用户当前 Chrome 中已打开的唯一授权 Smart Sheet 页面。
- 只读结果：目标文档和工作表可见；八个目标字段标题均可见；未出现登录提示；
  当前可访问性树未暴露唯一的新增行、单元格、下拉或保存控件。
- 页面结构：可访问性层出现单一 frame 边界；未暴露可操作表格语义、Canvas 控件
  或 Shadow DOM。此结果不足以断言底层真实 DOM 类型。
- 阻塞：ChatGPT Chrome Extension 与 native host 当前不可用，无法取得受控 DOM、
  iframe 层级或稳定 Selector。根据“禁止坐标、模糊点击、选择首项”的边界，未执行
  Dry Run 或写入。
- 创建测试记录：0；删除测试记录：0；原有记录：未修改。

### 3. 合并前代码审查与本地修复

- 已识别：确认状态未递增版本、同步 replay 未复验项目 ACL、同步历史后随记可漂移、
  AI 落库前 ACL 时间窗、前端导出可使用未保存本地状态、Service Worker 并发启动竞态、
  Selector 内容校验不足、真实构建 Origin 绑定不足。
- 状态：代码级完成，等待当前 Head CI 数据库门禁与独立复审。
- 已实施并纳入本次变更：服务端 ACL/版本/同步历史/Feature Flag 保护、服务端权威导出、
  单调状态写、八字段安全契约、精确工时/进度证据、重复来源拒绝、旧 hours 兼容、
  分类不写、保存双证据、登录显式恢复、Selector 唯一匹配、精确 Origin 构建、
  完整 URL 仅本地保存且不嵌入产物、真实构建手工入口强制 Dry Run，以及无真实权限 Review ZIP。
- Migration：追加 0017，不修改 0016；升级脚本覆盖非空 0015→0016→0017。

### 4. 依赖与 Workflow

- `npm audit --omit=dev`：2 high（Next→sharp）与 4 moderate（drizzle-kit 旧 loader→esbuild）。
  稳定上游均无安全兼容升级；拒绝 force downgrade，已写限时风险登记，等待 Reviewer 批准。
- GitHub JavaScript Actions 升级到 v7/Node 24；deployment contract 增加 v7 与防回退断言。

### 5. 本地回归

- 通过：typecheck、lint、build、git diff check、timesheets 55、extension E2E 12、
  extension package 5、artifacts 32、assistant 15、embeddings 14、retrieval 10、
  documents 15、files 20、phase1 7、round2 4、round3 5、deployment 23、release 16、
  production-rollout isolated tests 62。
- `npm test`：build 通过；SSR/Proxy 5/7，通过项外的 2 项因本机数据库不可用失败。
- 未执行：Migration upgrade、数据库 integration、ProjectAI authenticated E2E；等待当前 Head CI。

## 当前阻塞

- `PMDR-ENV-005`：Chrome DOM 控制通道缺失，真实 Selector、Dry Run、实写和清理不可安全执行。
- Staging Migration 仍需单独、明确的 Staging 授权；本轮不会自行推断授权。

## 安全计数

- 真实页面创建：0
- 真实页面成功：0
- 真实页面 failed：0
- 真实页面 unknown：0
- 真实页面重复：0
- 真实页面删除：0
- 最终保留：0
