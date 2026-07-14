# Architecture and Product Decisions

## ADR-001：以项目作为数据隔离边界

- 状态：Accepted。
- 决策：所有业务对象、知识查询、AI execution 和审核任务必须绑定 projectId；即使 v0.3 权限层已实现，在 CI/Staging/安全审查完成及文件边界建立前也不得处理客户数据。
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
- 决策：Production 使用 3100/`project-ai-os`，Staging 使用 3101/`project-ai-os-staging`、独立 PostgreSQL 容器/卷、认证 URL 与 Cookie scope；Nginx 只增加窄范围 location。
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

- 状态：Superseded by ADR-009—ADR-017。
- 决策：本轮只建设文档、自动验证、Staging、反馈和 PR 闭环。
- 原因：这是已合并 v0.2 的范围；v0.3 只真实化身份、项目和 PostgreSQL，文件/RAG/模型仍不进入本轮。

## ADR-009：Better Auth 1.6.23 负责身份协议

- 状态：Accepted。
- 决策：使用 Better Auth `1.6.23`、官方 Drizzle Adapter 与邮箱/密码 credential；关闭公共注册、账号关联和 cookie cache，使用 PostgreSQL Session 与数据库 rate limit。
- 原因：使用持续维护的认证库处理密码验证、Session Token 生成/轮换、Cookie 和退出失效，避免自建密码学或 Session 协议；其 Next.js Route Handler、Node.js 22、React 19、Drizzle PostgreSQL 用法与当前架构匹配。
- 限制：不提供公开注册、找回密码、邮件、社交登录或客户端角色判断。disabled 用户在 Session 创建前被拒绝，外部只收到与错误密码相同的通用错误。

## ADR-010：PostgreSQL + Drizzle 是 v0.3 的持久化基础

- 状态：Accepted。
- 决策：身份、Session、登录限流、项目、成员关系和身份/项目审计使用 PostgreSQL；Schema 在 `lib/db/schema/`，SQL 访问集中于 Repository，Migration 提交在 `drizzle/`。
- 原因：项目级关系、唯一约束、角色 enum、事务和跨项目集成测试需要关系数据库的明确边界；页面内散落 SQL 会绕过授权和审计。
- 运维：只执行已提交 Migration，不对 Staging/Production 使用 `drizzle-kit push` 或 destructive 自动同步。

## ADR-011：credential hash 存在 `accounts.password_hash`，不复制到 `users`

- 状态：Accepted（对原字段清单的显式规范化调整）。
- 决策：`users` 只保存身份与状态；Better Auth credential account 的 `password` 属性映射到数据库列 `accounts.password_hash`。不得再增加或同步 `users.password_hash`。
- 原因：认证库以 account 表区分身份和认证材料；复制 hash 会产生双写、漂移和错误验证来源。安全意图仍满足：Seed 通过 Better Auth 的安全密码哈希生成 credential，明文不进入数据库、日志、Mock、artifact 或 Git。
- 验证：集成测试断言 credential hash 存在、不同于明文，并检查 `users` 没有 `password_hash` 列。

## ADR-012：统一 404 防项目 ID 枚举并审计拒绝

- 状态：Accepted。
- 决策：`requireProjectAccess` 对“不存在”和“已认证但无权访问”统一返回 `404 NOT_FOUND`；只有已确认用户能访问该项目、但项目角色不允许写操作时返回 403。每次拒绝写 `project_access_denied`，metadata 只保存通用 reason 和允许角色等非敏感信息。
- 原因：如果缺失返回 404、无权限返回 403，攻击者可以枚举项目 ID。已建立资源访问关系后返回 403 不再泄露项目是否存在，且能给合法成员明确的写权限错误。
- 审计：metadata 递归过滤 password、secret、token、cookie、authorization、API key、database URL、connection string、文件正文等键，并限制深度、条目数和字符串长度。项目创建、成员增删改、登录成功状态更新和退出撤销都把状态变更与对应审计写入同一 PostgreSQL 事务；登录收尾失败会撤销刚创建的 Session 并清除响应 Cookie。

## ADR-013：Session Cookie 按环境和 basePath 隔离

- 状态：Accepted。
- 决策：Session Cookie 始终 `HttpOnly`、`SameSite=Lax`；Staging/Production 强制 `Secure`。Cookie Path 等于应用 basePath，Cookie Prefix 按环境独立；Better Auth URL 包含对应 basePath 和 `/api/auth`。所有状态变更 API 在认证或数据库写入前必须精确匹配可信 Origin；POST/PUT/PATCH 只接受 JSON，避免同站其他来源利用 Cookie 发起写请求。Session 最长 7 天、15 分钟更新、退出立即删除数据库 Session，不启用 cookie cache。认证路由统一 `no-store`，并在 v0.3 只允许登录、Session 查询和退出；登录和 Session 查询只返回 UI 必需字段，不向同源 JavaScript 返回原始 Session token，Better Auth 其余内置账户/Session 端点在建立显式脱敏契约前统一 404。身份停用后下一次 Session 查询会事务性撤销其全部 Session。
- 原因：Production 与 Staging 同域，不同 Path/Prefix 可避免互相覆盖；数据库 Session 支持刷新后保持、服务端失效和退出撤销，不依赖 localStorage。
- 代理信任：只读取由受控 Nginx 覆写的 `x-real-ip`，不信任原始 `X-Forwarded-For`。Staging/Production 部署必须验证该代理前提。

## ADR-014：系统角色与项目角色分离

- 状态：Accepted。
- 决策：系统角色为 `system_admin` / `standard_user`；项目角色为 `project_manager` / `project_member` / `viewer`。`system_admin` 可读全部项目、创建项目、管理成员、查看审计与系统设置；`project_manager` 可编辑所属项目并管理成员；`project_member` 可编辑所属项目但不能管理成员；`viewer` 只读。当前项目创建只允许 `system_admin`。
- 原因：系统治理和单项目协作是不同权限域；客户端展示权限只能由服务端计算结果派生，不能作为授权来源。
- 集中点：管理员绕过和项目权限集合只在 `lib/auth/authorization.ts` 管理，Route Handler 不接受客户端角色。

## ADR-015：项目 Mock 采用 server-first 精确过滤

- 状态：Accepted。
- 决策：Server Component 先恢复 Session、查询授权项目，再调用 `getAuthorizedMockProjectPayload(authorizedProject.id)`；项目数组数据用授权 ID Set 在服务端过滤，只有非项目全局配置可原样序列化。
- 原因：业务内容虽为 Mock，跨项目泄露仍是 P0；客户端过滤会把不可见项目数据送入浏览器，破坏下一轮文件/RAG 的可信边界。
- 限制：这不代表真实检索或知识权限索引已经完成，页面必须继续标注业务内容为 Mock。

## ADR-016：Seed 幂等，测试 Reset fail-closed

- 状态：Accepted。
- 决策：Seed 凭据只来自环境变量并规范化 email；5 个身份、3 个项目和预定成员关系均采用 insert-only 初始化。已有身份状态/系统角色、项目字段、成员角色和 credential hash 在部署重跑时保持不变。需要刷新 fixture 时只能使用受保护的测试 Reset；`db:reset:test` 必须同时满足 `NODE_ENV=test`、`ALLOW_TEST_DATABASE_RESET=true`、本地/CI 主机和数据库名包含 `test` / `ci`。
- 原因：Staging 发布不得复活停用账号、覆盖已编辑项目/成员角色或清空 Volume；测试需要可重复状态，但 fixture 刷新必须拒绝远程或非测试数据库。

## ADR-017：Staging PostgreSQL 私网持久化并受控迁移

- 状态：Accepted。
- 决策：Staging 使用固定 Compose project `projectai-staging`、容器 `project-ai-os-staging-postgres`、命名卷 `projectai-staging-postgres` 和内部网络，不发布数据库端口。`.env.auth-staging` 留在 `/srv/projectai-staging`、权限 `600`；发布只同步当前 Commit 的 tracked-file archive，并保护远端环境文件、备份、锁和事务标记。Compose 按服务最小化注入环境变量：数据库只接收 PostgreSQL 初始化值，operations 容器按任务接收数据库/认证/Seed 值，应用不接收 Seed 密码或 `POSTGRES_PASSWORD`。
- 原因：Staging 数据必须与 Production 独立，部署失败不得清空持久卷或泄露不必要的凭据。Migration/Seed 由显式 operations 容器执行，应用在数据库 Healthy 后启动。

## ADR-018：Staging 发布以备份、健康端点和应用镜像回滚失败关闭

- 状态：Accepted。
- 决策：发布必须原子取得 Staging 专属锁，并且只从当前 Commit 的 tracked-file archive 构造 release；已有数据库挂载必须严格匹配固定命名卷。每次 Migration 前由部署脚本检查空间，将 custom-format `pg_dump` 流式写入 root-only `/srv/projectai-staging/backups/`，验证后原子完成并保留最近 10 份；应用健康检查必须通过 `/api/health` 验证 PostgreSQL 连接和 `users`、`sessions`、`projects`、`project_members` 关键表。替换应用前保存上一容器实际使用的 immutable image ID，替换后的本地/公网验收失败时自动恢复该镜像；不得自动删除或重建数据库卷。
- 原因：仅检查端口或登录页不能证明身份/项目 Schema 可用；应用代码回滚应自动且可验证，而数据库回退具有更高破坏性，必须依赖发布前 dump 在维护窗口人工决策。
- 限制：自动回滚只恢复 Staging 应用镜像，不自动执行 `pg_restore`。首次部署没有上一镜像时停止失败应用并保留 PostgreSQL；Production baseline 采集后的所有发布、失败和回滚退出路径都必须与 baseline 完全一致，更早的预检失败不得执行 Production 写操作。

## ADR-019：CI 只上传经过独立脱敏与复核的产品证据副本

- 状态：Accepted。
- 决策：Playwright Report、review screenshots、test results 和 logs 先作为 CI 工作区原始输入，再复制到 `product-review-evidence/`。脱敏器结合运行时 Secret 与必须可查询的数据库 Session Token 做精确值清除，并结构化处理 Cookie、Authorization、password、Session 与数据库连接信息；按文件 magic 处理改名/嵌套/SFX ZIP 与 gzip，清理归档 entry 路径，并在任意文本中识别 MIME、大小写、空白、Base64 或原始 percent-encoding 变体的 ZIP Data URI 和折行编码 Secret。归档必须递归处理、复核并重建；Session 无法核验或 manifest 自相矛盾则失败关闭。成功运行必须具备 6 张必需截图；失败/取消运行可缺图，但 manifest 和脱敏报告必须精确列出缺失项，仍可上传安全日志供审查。GitHub Actions 只在脱敏成功时上传 `product-review-evidence/`，同时保留 `sanitization-report.json`。
- 原因：trace、network、HAR 和失败日志可能携带 HttpOnly Session 或临时凭据；“测试密码是临时值”不能替代证据发布边界。
- 失败策略：无法安全处理的二进制/归档必须删除或留下 omission 说明，并立即使 sanitizer 失败；任何最终内容、成功运行的截图完整性或 manifest 一致性复核失败都会使 CI 失败。测试失败本身不隐藏已安全清洗的日志，但未经确认的目录不得作为 artifact 上传。
