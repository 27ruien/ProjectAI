# Summary

Project AI Slim Phase 1 UI Refactor 已完成并发布到独立 UAT。重构只调整信息架构、展示层和交互入口；Auth、Project、ProjectMember、Knowledge、RAGFlow、AI Gateway、Evidence Guard 与 Citation 后端逻辑未修改。

- UAT: https://gridworks.cn/tool/projectai-slim-uat/
- Runtime: standalone Node
- Final UAT image: `projectai-slim-uat:20260821T095402Z-ui-v1`
- Image digest: `sha256:c4d3c601aa4b0592f5c0620fee3e9d14f272ef626df6c48f05954a7b9e8562e6`
- Production: 未部署、未迁移、未重启、未修改 Nginx

# Information Architecture Changes

- Project、Knowledge、Members 作为产品资产页面保留在主体区域。
- AI 从 Projects 与 Knowledge 页面主体移除，统一变为全局 Floating Button + Right Drawer。
- 主导航只保留真实可用的 Projects；Conversation 不再作为一级入口。
- 删除全局长 Breadcrumb；项目页只保留单一的 `Projects → Project` 层级表达。
- Projects 成为高密度项目资产列表，Knowledge 聚焦文档资产，Members 聚焦访问关系。

# Components Changed

- 新增 `components/ai/GlobalAiAssistant.tsx`，包含 Launcher、Drawer、授权 Context、当前会话和 Composer。
- 重构 `KnowledgeAnswerView`，将回答、来源数量、来源列表和片段展开分层展示。
- 调整 AppShell、Sidebar、Topbar、PageShell、ProjectContextHeader。
- 调整 ProjectsPage、ProjectKnowledgePage、ProjectMembersPage、ProjectEditDialog。
- 简化 LoginPage、AccessDeniedPage 和 NotFoundPage。
- Sheet / Dialog overlay 移除背景模糊；保留轻量遮罩与 focus trap。

# Pages Changed

- Login：保留左右分栏和真实认证逻辑，移除版本、Cookie 和内部认证说明，弱化 Staging 标记。
- Projects：移除内嵌 Cross-project AI Card，改为紧凑、可点击的项目表格。
- Project Detail：去 Card 化标题区，Edit 降级为 secondary action，Tabs 简化为下划线状态。
- Knowledge：移除页面内问答区，保留真实 Upload、Parse、Retry、Delete 与文档列表。
- Members：去 Card 化筛选区和表格，保留真实成员与角色操作。
- 404：移除会话入口，统一使用 `Page not found` 和 `Back to projects`。

# AI Drawer

- 右下角全局 `Ask AI` 按钮，默认收起。
- Desktop 与 1024px viewport 实测宽度均为 440px；窄屏使用 `min(440px, 100vw)`。
- Projects 页面默认 Context 为 `All my projects`。
- Project 的 Knowledge / Members 页面默认 Context 为当前项目。
- Context 选项只来自服务端已经授权给当前 Viewer 的项目。
- Single-project 与 Cross-project 请求继续调用原有真实 API；没有引入 Fake RAGFlow。
- History 为本次浏览器会话内的最小入口，没有新增持久化数据结构。

# Citation UX

- 回答默认先展示自然语言答案。
- 默认只显示 `Sources · n`，来源列表保持折叠。
- 展开后显示真实文件名、项目名和 Citation label。
- 再点击单个来源才展开真实 excerpt；不显示 token、latency、context chars 等 Debug 指标。
- `insufficient_evidence` 继续使用原有后端行为，不产生空来源容器。

# Design Tokens

- Main: `#FFFFFF`
- Sidebar: `#F7F7F8`
- Border: `#E7E7EA`
- Primary text: `#18181B`
- Secondary text: `#71717A`
- Accent: `#4F46E5`
- Base radius: 8px；Modal 约 12px。
- 普通页面无 shadow；只有 Floating AI、Drawer、Dialog、Dropdown 使用轻 shadow。
- 状态 Badge 使用低饱和语义色。

# Responsive

- 主要截图 viewport：1440 × 1000。
- 1024 × 768 实测 Projects 与 Knowledge 均无页面级横向 overflow。
- AI Drawer 在 1440 和 1024 下均为 440px。
- 表格在自身容器内允许横向滚动，不撑破页面。

# Accessibility

- Sheet 与 Dialog 继续使用 Radix focus trap。
- Drawer 实测可通过 Escape 关闭。
- Icon-only actions具备 aria-label；AI Context、Composer、筛选输入均有可访问名称。
- 全局 focus-visible 样式保留。
- 状态不只依靠颜色，均保留文字标签。

# Tests

- Exact deployed UI release `npm test`: PASS，25/25（18 unit + 7 rendered/proxy）。
- Exact deployed UI release `npm run typecheck`: PASS。
- Exact deployed UI release `npm run lint`: PASS。
- Exact deployed UI release standalone build: PASS。
- 当前共享工作树 `npm run typecheck`: PASS。
- 当前共享工作树 `npm run lint`: PASS。
- `git diff --check`: PASS。
- Live UAT Playwright：PASS，28 项断言。
- Admin Login、Session reload、Projects A/B/C：PASS。
- Project A 浏览器 Upload → RAGFlow Parse Ready → Ask → Answer → Citation：PASS；测试文档已清理。
- Projects → AI Drawer → All my projects → Cross-project real answer：PASS。
- `pm-a` 只能看到 A，Project B/C API 返回 404，Project B URL 显示 404：PASS。
- `pm-ab` 只能看到 A/B，Project C API 返回 404：PASS。
- 1024 no-overflow、440px Drawer、Escape、Logout：PASS。
- Public health：PASS。
- Production 与旧 Staging image、startedAt、restart count 在发布前后保持不变：PASS。

# Visual Screenshots

全部来自真实 UAT，尺寸均为 1440 × 1000：

- `docs/ui-audit/refactor-v1/01-login.png`
- `docs/ui-audit/refactor-v1/02-projects.png`
- `docs/ui-audit/refactor-v1/03-project-detail.png`
- `docs/ui-audit/refactor-v1/04-knowledge.png`
- `docs/ui-audit/refactor-v1/05-ai-drawer-empty.png`
- `docs/ui-audit/refactor-v1/06-ai-drawer-answer.png`
- `docs/ui-audit/refactor-v1/07-ai-sources.png`
- `docs/ui-audit/refactor-v1/08-members.png`
- `docs/ui-audit/refactor-v1/09-edit-project.png`
- `docs/ui-audit/refactor-v1/10-404.png`

人工对比 `docs/ui-audit/current/` 后确认：页面主体不再被 AI 占据；Projects / Knowledge / Members 更高密度；大型 Card、重复导航、技术 Debug 信息和装饰性模糊明显减少；Drawer Context 与 Citation 层级清晰。

# Known Issues

- 当前产品没有独立 Project Overview route；`03-project-detail.png` 与 `04-knowledge.png` 来自同一 Project A Knowledge route，分别记录项目头部和完成真实上传/解析后的资产状态。
- History 仅保存当前前端会话；本轮没有新增持久化 Conversation 能力。
- 顶层 Next.js 404 不在已认证 AppShell 内，因此 404 页面不显示 Floating AI；权限仍按原要求返回统一 404。
- 当前共享工作树在执行期间出现了未纳入本轮发布的 Weekly Report 文件和测试。它们没有同步到 UI release，也没有部署到 UAT；整棵工作树打包时这组并发代码导致 rendered/proxy 5 项失败，而相同时间的 32 个 unit 通过。最终 UAT 的 exact release source 已独立验证 25/25 全通过。
- UAT 主机发布后根分区约余 5 GiB，高于 3 GiB 门禁；本轮未执行任何 Docker prune，旧 UAT images 保留用于回滚。

# Deferred

本轮明确未做：

- Skills UI
- Resources UI
- RAGFlow Admin
- 企业通讯录
- LDAP / SSO
- Production 部署
- 新 Agent、Workflow 或业务模块
