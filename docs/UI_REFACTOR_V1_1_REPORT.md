# Project AI UI Refactor V1.1

## 结果

V1.1 已完成并发布到独立 UAT。本轮只精修视觉和交互，没有调整信息架构、业务 API、认证、项目权限、数据库或 RAGFlow 集成。

- UAT: https://gridworks.cn/tool/projectai-slim-uat/
- Runtime: standalone Node
- Image: `projectai-slim-uat:20260821T103512Z-ui-v1.1`
- Image digest: `sha256:70d84e20e02c7880b1385794929959eaee238dca9abbef07744a5f6e8de7b330`
- Rollback image: `projectai-slim-uat:20260821T095402Z-ui-v1`
- Production: 未部署、未迁移、未重启、未修改 Nginx

## V1.1 精修

- AI Drawer 改为非 Modal：无 backdrop、无背景变暗；Drawer 打开时主页面仍可查看和操作。
- UI 固定使用中文；`Project AI`、项目名、文件名和测试数据中的专有内容保留原文。
- 统一页面标题、Section、正文、表头与 metadata 的字号、字重和行高。
- Knowledge 与 Members Tab 下不再重复显示同名 Section Title，直接进入数量、搜索、筛选和表格。
- AI Empty State 改为轻量文本建议列表，降低大面积空洞感。
- AI Answer 增加更清晰的段落、标题和列表间距，并提供轻量复制操作。
- Citation 默认突出文件名、项目与相关片段；移除 similarity 等 Debug 信息。
- Button、Input、Select、Table Header、Table Row、Badge、Border 与 spacing 使用统一规格。

## 范围边界

本轮没有修改：

- Sidebar IA
- Project / Knowledge / Members 结构
- Floating AI 与 Context selector 业务逻辑
- Auth / Session
- ProjectMember / Authorization
- RAGFlow / Citation backend
- API / Database
- Production

Citation 后端当前没有提供文档更新时间字段，因此 UI 没有伪造日期；已展示后端真实提供的文件名、项目和相关片段。

## 验证

- 当前共享工作树 `npm run typecheck`: PASS。
- 当前共享工作树 `npm run lint`: PASS。
- `git diff --check`: PASS。
- Exact deployed V1.1 release standalone build: PASS。
- Exact deployed V1.1 release `npm run typecheck`: PASS。
- Exact deployed V1.1 release `npm run lint`: PASS。
- Exact deployed V1.1 release existing tests: PASS，25/25。
- 当前共享工作树 `npm test`: 37 个 unit PASS；5 个 rendered/proxy 测试受本轮未部署的并发 Weekly Report 工作树文件影响而失败。该组文件未进入 V1.1 release source。
- Live Playwright UAT: PASS。
- AI Drawer overlay 数量为 0；打开时主页面搜索可操作，Drawer 保持打开：PASS。
- Admin Login、Session reload、Projects A/B/C：PASS。
- Project A Upload → RAGFlow Parse Ready → Ask → Answer → Citation：PASS；虚构测试文档已清理。
- Answer Copy：PASS。
- `pm-a` 仅可访问 A；B/C API 和 URL 均返回 404：PASS。
- `pm-ab` 仅可访问 A/B；C API 和 URL 均返回 404：PASS。
- Public health：PASS。
- UAT App 与 PostgreSQL healthy、restart count 0：PASS。
- Production 与既有 Staging 的 image、startedAt、restart count 保持不变：PASS。

## Visual Audit

以下截图全部来自真实 UAT，尺寸均为 1440 × 1000：

- `docs/ui-audit/refactor-v1.1/01-login.png`
- `docs/ui-audit/refactor-v1.1/02-projects.png`
- `docs/ui-audit/refactor-v1.1/03-project-detail.png`
- `docs/ui-audit/refactor-v1.1/04-knowledge.png`
- `docs/ui-audit/refactor-v1.1/05-ai-drawer-empty.png`
- `docs/ui-audit/refactor-v1.1/06-ai-drawer-answer.png`
- `docs/ui-audit/refactor-v1.1/07-ai-sources.png`
- `docs/ui-audit/refactor-v1.1/08-members.png`
- `docs/ui-audit/refactor-v1.1/09-edit-project.png`
- `docs/ui-audit/refactor-v1.1/10-404.png`
- `docs/ui-audit/refactor-v1.1/11-upload-parsing.png`

`03-project-detail.png` 与 `04-knowledge.png` 来自当前既有的同一个 Project A Knowledge route。产品当前没有独立 Project Overview route，本轮未改变信息架构。

## 部署与回滚

- 当前 UAT image 与上一个 V1 rollback image 均已保留。
- 发布未重建 PostgreSQL，数据库容器 startedAt 未变化。
- 发布后根分区可用空间为 4,074,672 KiB，高于 3 GiB 门禁。
- 清理仅删除了用户明确批准、且未被当前或 rollback 容器引用的两个旧 UAT image；没有执行全局 Docker prune。
