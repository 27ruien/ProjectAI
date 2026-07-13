# Architecture and Product Decisions

## ADR-001：以项目作为数据隔离边界

- 状态：Accepted。
- 决策：所有业务对象、知识查询、AI execution 和审核任务必须绑定 projectId；真实权限层完成前不得处理客户数据。
- 原因：跨项目泄露是 P0，后补过滤无法替代数据模型约束。

## ADR-002：AI 页面不直接调用 Provider

- 状态：Accepted。
- 决策：页面 → Workflow/Skill → Model Profile → AI Gateway → Provider Adapter。
- 原因：允许替换供应商、统一日志/成本/重试，并防止 API Key 进入浏览器。

## ADR-003：Mock 实现遵循真实接口

- 状态：Accepted。
- 决策：保留 `AIGateway` 和 `ProjectKnowledgeService` 接口，Mock 与真实实现返回相同核心契约。
- 原因：逐步真实化时减少页面重写和行为漂移。

## ADR-004：AI Draft 与 Formal Data 分离

- 状态：Accepted。
- 决策：AI 输出只能创建可审核草稿；修改、决定和正式写入分别记录。
- 原因：人工审核、可追溯性和防止错误覆盖是 MVP 必须条件。

## ADR-005：Production 与 Staging 使用不同 basePath 和运行资源

- 状态：Accepted。
- 决策：Production 使用 3100/`project-ai-os`，Staging 使用 3101/`project-ai-os-staging`；Nginx 只增加窄范围 location。
- 原因：功能分支审查不能影响生产，也不能复用生产容器或环境变量。

## ADR-006：Staging 浏览器状态按环境隔离

- 状态：Accepted。
- 决策：localStorage key 由统一 helper 生成；Production 保持既有 key，Staging 增加 `staging` 命名空间。
- 原因：两套环境同域，裸 localStorage key 会互相污染。

## ADR-007：E2E 同时检查业务结果和运行时错误

- 状态：Accepted。
- 决策：Playwright 每条测试捕获 console.error、pageerror、requestfailed、HTTP 500 和未处理 rejection，并保留报告、trace、video、screenshot 与日志。
- 原因：只断言页面文本会漏掉白屏、资源失败和后台异常。

## ADR-008：本轮不引入真实后端

- 状态：Accepted。
- 决策：本轮只建设文档、自动验证、Staging、反馈和 PR 闭环。
- 原因：先建立可审查基线，再按认证/权限/数据/文件/RAG 顺序真实化。
