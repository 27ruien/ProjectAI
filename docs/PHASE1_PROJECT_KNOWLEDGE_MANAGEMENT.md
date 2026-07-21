# 第一阶段：项目知识与管理

## 范围与边界

第一阶段面向项目经理，交付组织/部门知识权限、权限感知的项目助手、需求与 Scope、Action、Risk、周报、Dashboard 和审计。项目仍是所有业务读写、检索、AI 执行、审核和导出的隔离单位。

会议与决策页面仍为项目隔离 Mock；OCR、Rerank、ANN/HNSW/IVFFlat、Tool Calling 和 Agent Execution 未开始。第一阶段只部署 Staging，不授权任何 Production Rollout、Migration、Secret、配置或数据写入。

## 数据与 Migration

- `0008`：Organization、Department、Knowledge Space、Space/File Grant、Project Knowledge Source、Permission Audit、旧 Project/Document 安全回填和统一数据库 ACL。
- `0009`–`0010`：Requirement Draft/Formal/Version/Source/Review/Audit、Scope Version/Comparison/Diff/Review，以及 AI Source Selection Digest。
- `0011`–`0012`：Action/Dependency/Source/History/Review、Risk/Source/History/Review、Weekly Draft/Immutable Version、Management Audit 和脱敏 AI Execution。
- `0013`：数据库触发器拒绝 Document 与 Knowledge Space 的跨 Organization、跨 Project-owned Space 或跨 Department 绑定。
- `0014`：统一数据库 ACL 的显式 Deny 对所有 Actor 生效，`system_admin` 只绕过项目成员关系，不绕过内容拒绝规则。
- `0015`：项目所属部门变更前检查现有文档与仍处于 active 的挂载来源，拒绝产生跨部门漂移；外部来源可由项目经理显式移除并保留审计。

Migration 只允许按 ledger 执行 committed SQL。禁止 schema push、修改历史 Migration 或在 Production 执行第一阶段 Migration。非空 `0007 → 0015` 演练会保留旧 Project、Membership、Document、Chunk、Embedding、Thread 和 Citation，并验证旧项目自动获得 Project Knowledge Space。

## 授权模型

角色可叠加：`system_admin`、`organization_admin/member`、`department_admin/member`、`project_manager/member/viewer`。客户端提交的角色、Project ID、Department ID、Knowledge Space、Document ID 和 AI Source 均不可信。

统一 ACL 由 PostgreSQL `projectai_authorized_documents(actor, project, permission)` 提供，Lexical、Exact Vector、RRF、Citation、文件读取和下载使用同一范围。规则为 default deny、显式 deny 优先、View/Download 分离；Citation 和旧 Thread 每次读取都会重新授权。

新文件上传必须选择服务端返回的可上传 Knowledge Space。目标空间与 idempotency key 绑定，并在项目锁内再次授权；Department/Role grant 只匹配目标项目所属 Department。Document 与 Space 的组织、项目和部门归属同时受数据库触发器保护。

## 人工审核边界

- Requirement：AI 只创建 Draft；项目经理 Accept、Edit+Accept 或 Reject 后，事务才创建 Formal Requirement、Version 和 Source。
- Scope：Baseline/Candidate 与 Diff 持久化；`not_mentioned` 与显式 `removed` 分离，结果必须人工确认。
- Action/Risk：AI 只创建 Draft，不自动分配 Owner；项目经理审核后才生成正式记录。
- Weekly：只读取正式 Requirement、Scope、Action 和 Risk；先生成 Draft，人工发布后形成不可静默覆盖的版本。

管理类 AI 调用记录 execution id、skill、profile、provider/model、source digest、数量、usage、latency、status、受控失败码和可获得时的 cost；不保存完整 Prompt、正文、Secret、向量或 Provider 原始响应。Provider 未提供可验证成本时 cost 保持 `null`，不得估算。

## 测试账号

非生产 Seed 提供 System Admin、Organization Admin、Department Admin、Project Manager、Project Member、Viewer、Other Department 和 Outsider 身份。Production 会在数据库访问前拒绝 Seed。

密码不进入 Git、日志、Evidence 或报告。Staging 密码只来自受保护环境文件；使用 `npm run db:test-account:reset-password` 并同时提供 Staging 环境、目标账号和受控密码变量进行初始化/重置。Seed 是 insert-only 幂等，不覆盖已有角色、项目或 credential。

## 验证门禁

CI 必须通过 lint、typecheck、production build、unit、PostgreSQL/pgvector、MinIO、非空 Migration、授权矩阵、Lexical/Vector/RRF/Citation leakage、Requirement/Scope/Action/Risk/Weekly 数据库集成、Playwright、Production Seed Guard、Artifact Sanitizer、Release/Production Rollout 隔离演练和清理。

Staging 部署使用 `scripts/deploy-staging.sh`：固定分支、clean worktree、完整 SHA、本地 immutable image build、远端 Image ID/architecture 复核、PostgreSQL+MinIO 一致备份/恢复演练、pending Migration、真实 Qwen Probe/Smoke、Phase 1 公网 HTTP E2E、测试数据/对象/Session 清理、Nginx/HTTP/noindex 验证以及部署前后 Production 只读状态精确比较。

动态 CI Run、Artifact/Digest、Staging Commit/Image Digest 和部署时间只记录在 PR 与受控 Evidence/Provenance，不写入本文件。
