# 项目经理日报 MVP 问题记录

## 已修复

| ID | 严重度 | 问题 | 修复/回归 |
| --- | --- | --- | --- |
| PMDR-QA-001 | P1 | iframe 控件属于另一 Window realm，父页面 `instanceof` 会把合法 input/select 判为错误类型 | 改用标签语义与 ownerDocument；Mock iframe E2E 通过 |
| PMDR-QA-002 | P1 | 32-bit replay checksum 存在碰撞后误认相同 Payload 的风险 | 改为排序后的完整 canonical JSON 精确比较；字段顺序变化仍视为相同 |
| PMDR-QA-003 | P1 | 后端可接受与逐项状态不一致的 `synced` 声明 | 合并持久状态后派生终态，不一致回滚并返回 `SYNC_TERMINAL_MISMATCH` |
| PMDR-QA-004 | P1 | 同 request replay 在草稿进入 syncing 后先被“未确认”拒绝 | 幂等 request 检查前移，并验证 draft/dryRun 参数一致 |
| PMDR-QA-005 | P1 | AI process crash 可留下永久 running execution | 基于现有 stale threshold 受控失败和审计后再开始新 execution |
| PMDR-QA-006 | P2 | Popup 不能收到后台实时状态 | Service Worker 同时向扩展 runtime 和 ProjectAI tabs 广播脱敏状态 |
| PMDR-QA-007 | P2 | 同步中心缺当前项、打开看板和结果下载 | 增加只打开配置看板的独立命令与脱敏结果下载；不执行 Adapter/保存 |
| PMDR-QA-008 | P1 | 已结束批次可被迟到状态回写重新打开，逐项集合也可不完整 | 终态批次/保存/未知/取消项不可逆；要求完整 task 集合、单调 attempt，并串行页面状态写回 |
| PMDR-QA-009 | P1 | Selector 名称禁用不足以阻止误配单条保存按钮 | 保存控件必须位于任务表单内，且文案/aria-label 含最终提交语义时硬拒绝；Mock E2E 验证计数为 0 |
| PMDR-QA-010 | P1 | 暂停/取消与正在执行的 Adapter 并发时可能继续下一条；重复 START 可恢复暂停批次 | 控制请求在当前单条落定后生效；暂停/失败/部分批次只允许显式 resume；unknown 永不自动恢复 |
| PMDR-QA-011 | P1 | 日历日期可被 JS 规范化，人工任务可改成与来源项目冲突 | 日期进行 ISO round-trip；服务端重新核对来源记录项目；Migration 增加 AI execution owner/draft trigger |
| PMDR-QA-012 | P1 | AI 可静默遗漏来源或合并同项目不同交付物，Repair usage 只记录第二次 | 所有来源必须 used/unresolved 二选一；AI 自动合并多来源一律拒绝，交给人工；两次 Gateway usage/latency 聚合 |
| PMDR-QA-013 | P0 | 日报/随记/同步部分入口没有在最终事务中复验项目 ACL，exact replay 可能沿用已失效权限 | 所有读写、AI 落库、确认、导出、创建/replay/更新/列出同步批次均按当前项目 ACL 复验；新增失权回归 |
| PMDR-QA-014 | P1 | 已有同步历史后来源随记仍可漂移；确认与导出存在旧版本/本地脏数据边界 | 同步历史后随记、草稿和重新生成全部锁定；确认递增版本；复制/下载重新走服务端权威导出 |
| PMDR-QA-015 | P1 | 扩展字段仍使用单一 hours 并错误把 ProjectAI category 映射到真实页面 | 增加正常/加班工时、当前登录提交人、可空紧急度/进度；旧 hours 只转正常工时；Adapter 完全不写 category |
| PMDR-QA-016 | P1 | 单靠保存反馈不能证明真实列表已经持久化，auto-save 页面 Dry Run 可能先产生副作用 | 显式保存要求反馈与列表行二次回读；不一致拒绝成功；auto-save 在字段写入前硬停止 |
| PMDR-QA-017 | P1 | WeCom Flag 关闭时 UI 仍探测扩展和读取同步 API | UI 不注册消息/不发 ping/不加载同步历史；同步 UI 操作全部禁用；服务端同步读写统一硬拒绝 |
| PMDR-QA-018 | P2 | Actions v4 使用弃用的 Node 20 runtime | checkout/setup-node/upload-artifact 升级到官方 v7（Node 24），保留全部现有门禁并增加防回退测试 |
| PMDR-QA-019 | P1 | 安全构建错误拒绝真实 Smart Sheet 必需的访问参数，且只按 pathname 复用标签页可能误入其他 View | 完整 URL 仅保存在本地环境/扩展存储，构建只绑定 Origin 且不嵌入路径；运行时精确比较 origin/path/query/fragment；Mock E2E 覆盖本地参数保存 |
| PMDR-QA-020 | P1 | AI 正常/加班工时和进度证据缺数字边界，正常工时只验证“存在某个时长”，同一来源还可能被重复生成 | 正常工时精确绑定 hint、小时、分钟或起止时间；加班/进度使用完整数字边界；同一来源只能用于一个 AI task；新增错误数值和重复来源回归 |
| PMDR-QA-021 | P1 | 登录失效项显式继续后未重新入队；手工 Popup 在真实构建可切到实写，伪造消息来源还可能绕过 ProjectAI 确认链 | resume 仅在用户显式操作时把待登录项恢复 pending；Review/真实构建强制手工 JSON 为 Dry Run；Service Worker 复验 ProjectAI tab/Popup sender 与来源路径，只有隔离 Mock 允许手工实写 |
| PMDR-QA-022 | P1 | saved+cancelled 的批次被错误派生为 partially_synced，且非终态允许迟到消息倒退 | 批次/逐项状态改为单调 allowlist；saved+cancelled 正确派生 cancelled；保留终态、unknown、saved、cancelled 不可逆 |
| PMDR-QA-023 | P1 | Fake Provider 把“验收准备”等名词误判为未来态，且没有稳定保留显式进行中/未开始状态 | 优先使用受信 status hint 与原文事实，补充完成/进行中/未开始回归；Local UAT 三类状态保持正确 |
| PMDR-QA-024 | P1 | Review 扩展依赖动态 `scripting` 注入且缺少企业微信精确 Site Access | 改为分离的声明式 Content Script；只保留 `storage`/`tabs`，精确绑定 ProjectAI 与 `doc.weixin.qq.com`，ZIP 自动拒绝宽泛权限、完整 URL 和认证状态 |
| PMDR-QA-025 | P2 | 本地缺少可重复的三账号、Migration、Feature Flag 与数据库集成 UAT 环境 | 增加 Local-only pgvector Compose、默认拒绝的幂等 Seed/Cleanup、真实 Session E2E、Flag E2E 和临时数据库集成 runner |
| PMDR-QA-026 | P1 | UAT Seed 预置 3 条随记，旧验收绕过空状态和用户创建入口 | Seed 改为 0 条；真实 UI 门禁从空状态完成随记 CRUD、刷新持久化和 AI 整理，1/1 通过 |
| PMDR-QA-027 | P1 | 待审核任务会把“确认工时”直接禁用，点击无请求、无字段错误和无状态反馈 | 点击后执行字段校验并显示五态 UI；真实确认一次 200、重复提交受阻、刷新保持，401/403/409/422/500 均有可读反馈 |
| PMDR-QA-028 | P1 | 0.25 小时任务拆分会把第二条工时变成 `null`，导致后续合并/确认失败 | 拆分保留合法 0 值并由完整 Local UAT 拆分、合并、确认回归覆盖 |

## 环境阻塞

| ID | 类型 | 状态 | 需要 |
| --- | --- | --- | --- |
| PMDR-ENV-001 | 本地数据库 | 已关闭 | Local PostgreSQL 17/pgvector 0.8.1、Migration、UAT 与隔离数据库 integration 均通过 |
| PMDR-ENV-002 | 真实 WeCom DOM | 页面访问/登录已完成；Canvas 无可靠 DOM Overlay，仍阻塞 | 页面需提供可唯一审核的 DOM/iframe 控件；禁止坐标、OCR 或模糊点击 |
| PMDR-ENV-003 | Chrome Web Store | 非代码阻塞 | 法务审核隐私政策、发布者信息和商店账号 |
| PMDR-ENV-004 | 依赖告警 | 合并前需 Reviewer 批准 | `sharp` 2 high、旧 loader `esbuild` 4 moderate；详见 `docs/dependency-security.md`，禁止 force downgrade |
| PMDR-ENV-005 | Chrome DOM 通道 | 已关闭 | 隔离 Playwright 已取得登录后 DOM 计数并关闭 Context，未保存认证状态 |
| PMDR-ENV-006 | Smart Sheet Canvas | 阻塞真实 Dry Run/保存/清理 | 主表为 1 Canvas、0 table/grid；等待稳定 DOM Overlay 或受支持自动化接口，当前创建/删除均为 0 |

## 未发现的范围

当前没有已知未修复 P0/P1 代码缺陷；PMDR-QA-026/027/028 已由真实 Local UI 与既有 UAT 回归关闭。Local 数据库和 Mock 扩展测试不能替代真实 WeCom 验收；当前 Head 的 GitHub CI、依赖风险审批、Staging 和真实 WeCom 验收仍未关闭，因此 PR 不应合并。Mock E2E 不能证明 Canvas 真实页面兼容；在可靠 DOM/受支持接口、真实 Dry Run 和一条虚构任务验收完成前，连接器不得宣称可用于正式页面或发布到商店。
