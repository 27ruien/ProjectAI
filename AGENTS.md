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
- 未认证前不得上传真实项目文件；不得将上传文件提交到 Git 或放入 `public/`。
- 不得在日志中输出完整 API Key、密码、私钥或客户文件内容。
- 不得修改与本项目无关的服务器服务，不得覆盖现有 Nginx 配置。
- 修改 Nginx 前必须备份，且只有 `nginx -t` 通过后才能 reload。
- Staging 与 Production 必须使用独立目录、容器、端口、basePath 和浏览器存储命名空间。

## Review Guidelines

- P0：跨项目数据泄露；密钥或客户资料暴露。
- P1：AI 草稿直接写入正式数据；AI 回答缺少来源引用；深层路由或静态资源失效。
- P1：typecheck、lint、test、E2E 或 build 失败。
- P1：Workflow 缺少 Loading、Error、Retry 或 Review。
- P1：页面明显不符合现有 Design System；只增加静态展示、没有实际交互。
- P2：不阻塞试点的视觉、性能、可维护性或代码优化。

PR 审查必须核对 `docs/MVP_ACCEPTANCE.md`、Staging 验证、回滚方式和 Mock/真实能力边界。未经产品审查不得合并。
