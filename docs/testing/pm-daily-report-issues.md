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

## 环境阻塞

| ID | 类型 | 状态 | 需要 |
| --- | --- | --- | --- |
| PMDR-ENV-001 | 本地数据库 | 阻塞本地验证，不阻塞代码继续 | 运行中的 Docker 或隔离本地 PostgreSQL 17/pgvector |
| PMDR-ENV-002 | 真实 WeCom URL/DOM | 阻塞真实连接器验收与可发布包 | 用户提供精确 URL、手动登录并演示一条任务流程 |
| PMDR-ENV-003 | Chrome Web Store | 非代码阻塞 | 法务审核隐私政策、发布者信息和商店账号 |
| PMDR-ENV-004 | 依赖告警 | 合并前需处置 | `sharp` 2 high、旧 loader `esbuild` 4 moderate；上游兼容升级或书面风险接受，禁止 force downgrade |

## 未发现的范围

当前没有已知 P0 代码缺陷。数据库 CI、当前 Head 的完整 ProjectAI E2E、依赖告警处置和真实 WeCom 验收仍未关闭，因此 PR 不应合并。Mock E2E 不能证明真实 WeCom DOM 兼容；在真实 Selector 审核、Dry Run 和一条虚构任务验收完成前，连接器不得宣称可用于正式页面或发布到商店。
