# Project AI OS Agent Rules

本文件是 Codex、ChatGPT 与开发人员在本仓库工作的强制约束。若实现与本文件冲突，先修正文档或实现，不得静默扩大产品范围。

## 产品规则

- 第一阶段核心用户是项目经理。
- 当前只解决：项目经理编写文档耗时过长；项目信息分散、查找困难；需求遗漏、重复或理解错误。
- 不得擅自扩大到其他部门，不得为了展示 AI 增加无明确价值的功能。
- 项目是平台的核心数据隔离单位；任何查询、检索、生成、审核和正式写入都必须绑定 `projectId`。
- 知识库不是普通文件管理器，它负责版本、有效性、来源、证据和项目上下文。
- 所有关键 AI 结论必须显示来源引用；已失效文档不得被当作当前有效知识。
- AI 草稿不得直接覆盖正式业务数据；正式数据必须经过人工审核。

## AI 架构规则

- 页面不得直接调用具体模型或 Provider。
- Skill 不得保存具体供应商模型名称，只能使用 `modelProfileId`。
- 所有模型调用统一经过 AI Gateway。
- API Key 只能存入服务端环境变量或 Secret Manager。
- AI 调用必须记录：`executionId`、`skillId`、`modelProfileId`、`latency`、token usage、cost、status。
- AI Workflow 必须具备 Loading、Success、Failure、Retry、Review、Audit 状态。
- `ProjectKnowledgeService` 与 `AIGateway` 是稳定边界；真实实现替换 Mock 时不得让业务页面感知 Provider。

## 安全规则

- 跨项目数据访问属于 P0。
- 提交真实密钥、暴露客户资料属于 P0。
- 正式身份只允许由服务端认证；Session 必须持久化到数据库并通过 `HttpOnly` Cookie 传递，不得写入 localStorage、URL 或客户端 Mock。
- 禁止公共注册、密码找回和社交登录。账号只能由受控 Seed 或后续管理员流程预创建。
- 密码只能由认证库的安全算法哈希后保存在 `accounts.password_hash` credential account；`users` 不得保存密码副本，日志、审计和测试证据不得出现密码或 Session Token。
- 客户端角色和 `projectId` 均不可信。页面、Route Handler 和 Mock 业务数据序列化前，必须通过集中式服务端 Session 与项目成员关系校验。
- 不存在的项目和当前用户无权访问的项目统一返回 404，防止项目 ID 枚举；拒绝事件必须写入已脱敏的审计记录。
- `system_admin` 绕过项目成员关系的规则只能存在于集中授权层；`viewer` 的只读限制必须由服务端写接口执行，不能只隐藏按钮。
- 未认证前不得上传真实项目文件；不得将上传文件提交到 Git 或放入 `public/`。
- 不得在日志中输出完整 API Key、密码、私钥或客户文件内容。
- PostgreSQL Migration 必须提交并以受控命令执行；禁止对 Staging/Production 使用 destructive schema push。
- Seed 必须 insert-only 幂等、凭据来自环境变量，且不得重新激活身份或覆盖已有角色/项目/credential；测试重置必须同时校验 `NODE_ENV=test`、显式开关、本地/CI 主机和测试数据库名称。
- 不得修改与本项目无关的服务器服务，不得覆盖现有 Nginx 配置。
- 修改 Nginx 前必须备份，且只有 `nginx -t` 通过后才能 reload。
- Staging 与 Production 必须使用独立目录、容器、端口、basePath、Cookie 前缀/路径、浏览器存储命名空间和数据库；Staging PostgreSQL 不得发布宿主机端口。

## v0.4 范围规则

- v0.4 只在 v0.3 的身份、项目和审计基础上，真实化项目资料、文件版本、私有 S3-compatible 对象存储、完整性校验、授权下载、归档/恢复和存储一致性检查。
- 本轮文件链路只包含：上传 → 安全存储 → 文件记录 → 版本管理 → 权限下载。项目知识问答、需求、Scope、Action、会议、风险和 AI execution 仍为 Mock；必须在服务端确认项目访问权后按精确 `projectId` 过滤，再传给客户端。
- 文件正文不得写入 PostgreSQL、Git、`public/` 或应用容器本地持久目录；对象 Key 只能由服务端生成且不得包含原始文件名、用户/客户/项目名称、Session 或路径片段。
- 对象存储必须私有，凭据仅存服务端 Secret；浏览器不得获得 Bucket、Object Key、内部 Endpoint、Access Key、Secret 或可绕过应用授权的对象 URL。
- 允许上传的第一版类型仅为 PDF、DOCX、XLSX、PPTX、TXT、Markdown；必须同时验证扩展名、声明 MIME、文件签名、大小和 Office Open XML 容器结构，不执行宏或解析正文。
- `system_admin`、`project_manager`、`project_member` 可上传；`viewer` 只可查看和下载。只有 `system_admin` 与 `project_manager` 可归档、恢复和切换当前版本；所有限制必须由服务端执行。
- PostgreSQL 与对象存储的写入必须采用 pending/stored/failed 状态与补偿逻辑；reconciliation 默认只读，显式 apply 也不得针对 Production 自动执行或删除仍被数据库引用的对象。
- 本轮禁止文档正文解析、OCR、分块、全文检索、Embedding、pgvector、Hybrid Search、RAG、Reranker、真实模型、Provider Key、自动总结、自动 Action/风险/周报。
- 本轮只允许部署 Staging，并为 Staging 使用独立私有 MinIO、Bucket、命名卷和备份；允许在本地/CI 生成 production build 做验证，但不得在 Production 主机上构建、重启、迁移、修改或重新部署本应用。

## Review Guidelines

- P0：跨项目数据泄露；密钥或客户资料暴露。
- P0：认证、Session、项目授权只在客户端实现；未授权项目的 Mock 数据被序列化到浏览器。
- P1：AI 草稿直接写入正式数据；AI 回答缺少来源引用；深层路由或静态资源失效。
- P1：typecheck、lint、test、E2E 或 build 失败。
- P1：Workflow 缺少 Loading、Error、Retry 或 Review。
- P1：页面明显不符合现有 Design System；只增加静态展示、没有实际交互。
- P2：不阻塞试点的视觉、性能、可维护性或代码优化。

PR 审查必须核对 `docs/MVP_ACCEPTANCE.md`、Staging 验证、回滚方式和 Mock/真实能力边界。未经产品审查不得合并。
