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

### 2. 真实页面只读审计

- 状态：页面访问与登录完成 / Canvas DOM 阻塞
- 环境：独立、临时 Playwright Chromium；用户手动登录，Context 随检查结束关闭，
  未导出或保存 Cookie、Token、二维码、Storage State 或 Profile。
- 只读结果：HTTP 200、批准 Origin 保持、登录失效提示消失、存在编辑控件。
- 页面结构：0 iframe、1 Canvas、0 Shadow Root、0 table/grid/treegrid、4 个普通可编辑
  控件、88 个按钮。主表没有暴露可唯一审核的行、单元格和八字段 DOM。
- 阻塞：`CANVAS_WITHOUT_SEMANTIC_GRID`。根据“禁止坐标、OCR、模糊点击、选择首项”的
  边界，未生成猜测 Selector，未执行真实 Dry Run 或写入。
- 创建测试记录：0；删除测试记录：0；原有记录：未修改。

### 3. 合并前代码审查与本地修复

- 已识别：确认状态未递增版本、同步 replay 未复验项目 ACL、同步历史后随记可漂移、
  AI 落库前 ACL 时间窗、前端导出可使用未保存本地状态、Service Worker 并发启动竞态、
  Selector 内容校验不足、真实构建 Origin 绑定不足。
- 状态：代码级完成，等待当前 Head CI 数据库门禁与独立复审。
- 已实施并纳入本次变更：服务端 ACL/版本/同步历史/Feature Flag 保护、服务端权威导出、
  单调状态写、八字段安全契约、精确工时/进度证据、重复来源拒绝、旧 hours 兼容、
  分类不写、保存双证据、登录显式恢复、Selector 唯一匹配、精确 Origin 构建、
  完整 URL 仅本地保存且不嵌入产物、真实构建手工入口强制 Dry Run，以及只含精确
  Origin、无私有 URL/Selector/认证状态的 Review ZIP。
- Migration：追加 0017，不修改 0016；升级脚本覆盖非空 0015→0016→0017。

### 4. 依赖与 Workflow

- `npm audit --omit=dev`：2 high（Next→sharp）与 4 moderate（drizzle-kit 旧 loader→esbuild）。
  稳定上游均无安全兼容升级；拒绝 force downgrade，已写限时风险登记，等待 Reviewer 批准。
- GitHub JavaScript Actions 升级到 v7/Node 24；deployment contract 增加 v7 与防回退断言。

### 5. 本地回归

- 通过：typecheck、lint、build、git diff check、timesheets 57、extension E2E 16、
  extension package 5、artifacts 32、assistant 16、embeddings 14、retrieval 10、
  documents 15、files 20、phase1 11、round2 4、round3 5、deployment 23、release 16、
  production-rollout isolated tests 62。
- `npm test`：build 与 SSR/Proxy 7/7 通过。
- Local UAT 历史 4/4 结论已于 2026-07-23 撤回并重新建立：Seed 现在为 0 条随记；
  专用 `test:uat:ui` 在真实 Local 服务、数据库和 Chromium 中从空状态完成全 UI 随记
  CRUD、AI、字段校验、确认、刷新持久化、JSON 和五类错误反馈，1/1 通过；人工复核
  7 张虚构数据截图和脱敏 Trace，未处理 Console/Page Error 为 0。既有 `test:uat`
  4/4 与 Feature Flag 2/2 仍分别只代表各自边界，不替代该真实 UI 门禁。
- 数据库：非空 0015→0016→0017 upgrade 通过；临时隔离数据库中 identity/ACL、Phase 1、
  AI、Embedding、Retrieval、Timesheet 共 111/111 integration 通过，临时数据库已删除。
- UAT 保护：Production/未授权 Seed/Cleanup/错误本地数据库拒绝用例均通过。

### 6. 继续执行基线

- 继续时 Head：`32d47dee82087dccae80e17b4133a3a99fc2cfdb`
- `origin/main`：`82b516a48141d6cdd68467938573e16cc5b6487a`
- Docker daemon 与隔离 PostgreSQL 可用；此前“本机数据库不可用”已关闭。
- 完整真实 Smart Sheet URL 只保存在 `.local/wecom-uat.env`，四个本地私有文件均为
  `0600` 且被 Git 忽略。

## 当前阻塞

- `PMDR-ENV-006`：真实 Smart Sheet 主表为 Canvas 且无可靠 DOM Overlay，真实 Selector、
  Dry Run、实写、刷新幂等和清理不可安全执行。
- Staging Migration 仍需单独、明确的 Staging 授权；本轮不会自行推断授权。

## 安全计数

- 真实页面创建：0
- 真实页面成功：0
- 真实页面 failed：0
- 真实页面 unknown：0
- 真实页面重复：0
- 真实页面删除：0
- 最终保留：0
