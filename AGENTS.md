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

## v0.3 范围规则

- v0.3 只真实化用户、credential、Session、项目、项目成员关系、项目基础信息和审计事件。
- 项目资料、知识问答、需求、Scope、Action、会议、风险和 AI execution 仍为 Mock；必须在服务端确认项目访问权后按精确 `projectId` 过滤，再传给客户端。
- 本轮禁止接入文件上传、对象存储、解析、OCR、Embedding、pgvector、RAG、Reranker、真实模型或 Provider Key。
- 本轮只允许部署 Staging；允许在本地/CI 生成 production build 做验证，但不得在 Production 主机上构建、重启、修改或重新部署本应用。

## Review Guidelines

- P0：跨项目数据泄露；密钥或客户资料暴露。
- P0：认证、Session、项目授权只在客户端实现；未授权项目的 Mock 数据被序列化到浏览器。
- P1：AI 草稿直接写入正式数据；AI 回答缺少来源引用；深层路由或静态资源失效。
- P1：typecheck、lint、test、E2E 或 build 失败。
- P1：Workflow 缺少 Loading、Error、Retry 或 Review。
- P1：页面明显不符合现有 Design System；只增加静态展示、没有实际交互。
- P2：不阻塞试点的视觉、性能、可维护性或代码优化。

PR 审查必须核对 `docs/MVP_ACCEPTANCE.md`、Staging 验证、回滚方式和 Mock/真实能力边界。未经产品审查不得合并。
