# Architecture and Product Decisions

## ADR-001：以项目作为数据隔离边界

- 状态：Accepted。
- 决策：所有业务对象、文件 Key、知识查询、AI execution 和审核任务必须绑定 `projectId`。v0.4 文件 API 还必须验证 `projectId → documentId → versionId` 归属；完整 CI、Staging 和安全审查完成前只使用虚构测试文件。
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
- 决策：Production 使用 3100/`project-ai-os`；Staging 使用 3101/`project-ai-os-staging`、独立 PostgreSQL 与 MinIO 容器/卷、认证 URL 与 Cookie scope。Staging MinIO 不发布 API/Console 端口，Nginx 只代理应用并设置 52 MiB request body 上限。
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
- 原因：这是已合并 v0.2 的范围；v0.3 已真实化身份、项目和 PostgreSQL，v0.4 继续真实化文件存储，但解析、RAG 和模型仍不进入本轮。

## ADR-009：Better Auth 1.6.23 负责身份协议

- 状态：Accepted。
- 决策：使用 Better Auth `1.6.23`、官方 Drizzle Adapter 与邮箱/密码 credential；关闭公共注册、账号关联和 cookie cache，使用 PostgreSQL Session 与数据库 rate limit。
- 原因：使用持续维护的认证库处理密码验证、Session Token 生成/轮换、Cookie 和退出失效，避免自建密码学或 Session 协议；其 Next.js Route Handler、Node.js 22、React 19、Drizzle PostgreSQL 用法与当前架构匹配。
- 限制：不提供公开注册、找回密码、邮件、社交登录或客户端角色判断。disabled 用户在 Session 创建前被拒绝，外部只收到与错误密码相同的通用错误。

## ADR-010：PostgreSQL + Drizzle 是业务状态持久化基础

- 状态：Accepted。
- 决策：身份、Session、登录限流、项目、成员关系、文件元数据/current/归档状态和审计使用 PostgreSQL；Schema 在 `lib/db/schema/`，SQL 访问集中于 Repository/领域服务，Migration 提交在 `drizzle/`。文件正文明确不写入 PostgreSQL。
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
- 决策：Server Component 先恢复 Session、查询授权项目，再调用 `getAuthorizedMockProjectPayload(authorizedProject.id)`；项目数组数据用授权 ID Set 在服务端过滤，只有非项目全局配置可原样序列化。v0.4 资料页不再使用该 Mock mapper，改为受授权的文件 Repository/S3 服务。
- 原因：业务内容虽为 Mock，跨项目泄露仍是 P0；客户端过滤会把不可见项目数据送入浏览器，破坏下一轮文件/RAG 的可信边界。
- 演进：v0.5 B2 已让资料页和项目知识搜索脱离该 Mock 文档能力；需求、Scope、Action、会议、风险和 AI execution 仍按本决策精确过滤 Mock。

## ADR-016：Seed 幂等，测试 Reset fail-closed

- 状态：Accepted。
- 决策：Seed 凭据只来自环境变量并规范化 email；5 个身份、3 个项目和预定成员关系均采用 insert-only 初始化。已有身份状态/系统角色、项目字段、成员角色和 credential hash 在部署重跑时保持不变；Seed 完成前必须查询零 Manager 项目，发现任何一项即失败，不自动提升或覆盖已有角色。需要刷新 fixture 时只能使用受保护的测试 Reset；`db:reset:test` 必须同时满足 `NODE_ENV=test`、`ALLOW_TEST_DATABASE_RESET=true`、本地/CI 主机和数据库名包含 `test` / `ci`。
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
- 决策：CI 原始 Playwright report、test results、trace/video 和运行时上传 fixture 永不直接进入 Evidence。Payload A 采用强 allowlist，只接受 `evidence-index.json`、脱敏报告、30 张约定 PNG 及固定名称/大小的 UTF-8 文本日志；PDF、归档、未知二进制、未列名路径和上传原件必须拒绝/移除。
- 两阶段发布：成功运行必须具备 30 张截图。Manifest schema v3 从 PNG 读取实际尺寸，并记录 Worker/Parser/Chunker/AI Gateway Version 与 Assistant Profile；GitHub 返回 Payload A 的真实 Artifact ID 与 SHA-256 digest 后才生成独立 Provenance B。
- 原因：trace、network、HAR、上传原件和失败日志可能携带 HttpOnly Session、文件正文、Object Key 或临时凭据；“测试数据是虚构/临时值”不能替代最小发布边界。GitHub Artifact ID 在上传前不存在且上传后不可变，占位或自指 ID 无法形成自洽 provenance。
- 失败策略：数据库 Session 无法核验、任一 allowlist 违规、Secret/对象元数据残留、成功截图不完整、index 自相矛盾或上传后 ID/name/digest/Run 绑定失败都会使 CI 失败并阻止后续发布。Staging 不可观测时只能记录 `stagingSha: null`。

## ADR-020：项目成员变更以项目行为互斥锁并保留最后一名 Manager

- 状态：Accepted。
- 决策：所有成员 POST/PATCH/DELETE 在 PostgreSQL 事务内先对对应 `projects` 行执行 `FOR UPDATE`，锁后重新读取操作者成员关系，再锁目标成员。目标是 `project_manager` 且将被降级或删除时，必须在同一事务检查另一名 Manager；不存在时不修改成员，提交 `project_member_change_denied / denied / last_project_manager` 审计并由 API 返回 `409 LAST_PROJECT_MANAGER`。`system_admin` 只绕过项目成员授权，不绕过该领域约束；原始 update/delete 不对路由公开。
- 原因：只锁操作者或目标 membership 会让两个 Manager 在 `READ COMMITTED` 下发生 write skew，分别看到另一名 Manager 后同时提交，最终归零。统一的 project row mutex 把同项目成员变更串行化，并固定 `project → 锁后授权 → target → guard → mutation/audit` 锁序以避免反序死锁与陈旧授权快照。
- 验证：集成测试覆盖唯一 Manager 降级为 member/viewer、Manager 与 system_admin 删除、添加第二 Manager 后允许降级/删除、拒绝状态/审计/API 合同，以及两名不同 Manager 的并发降级与并发删除；Seed 和 Staging 发布独立断言零 Manager 项目数为 0。

## ADR-021：文件正文使用 S3-compatible Object Storage，Staging 使用 MinIO

- 状态：Accepted。
- 决策：应用通过 AWS SDK for JavaScript v3 的 S3 协议访问对象存储。Staging 使用固定容器 `project-ai-os-staging-minio`、命名卷 `projectai-staging-minio`、私有 Bucket `projectai-staging-files` 和现有内部网络，不发布 API 或 Console 端口。初始化任务使用 root credential 幂等创建 Bucket/应用用户/`projects/*` 最小策略，应用只持有不同的 scoped credential。
- 原因：S3 协议允许将来替换托管实现而不改页面/领域服务；MinIO 能在共享 Staging 主机和 GitHub runner 中提供可重复的真实对象语义。Next.js 容器本地磁盘不是持久化边界，公开目录或 Public Bucket 会绕过授权。
- 限制：Production 本轮不增加对象存储。root/app credential 只存在于 root-only 环境文件或 CI 临时 masked 值，不写入示例、日志、Artifact 或客户端。

## ADR-022：PostgreSQL 管业务状态，对象存储管不可变正文

- 状态：Accepted。
- 决策：`project_documents` 保存逻辑资料，`project_document_versions` 保存版本/current、幂等、文件元数据、SHA-256、ETag 和存储状态；正文只保存到对象存储。Object Key 固定为 `projects/{projectId}/documents/{documentId}/versions/{versionId}/{randomUuid}`，所有段由服务端生成，新版本永远使用新 Key。
- 原因：关系约束、事务、角色和审计属于数据库；大文件正文与 S3 完整性/生命周期属于对象存储。不可变 Key 防止覆盖历史版本，也避免原文件名、客户/项目名称、邮箱、路径和 Session 泄露到对象命名空间。
- 数据约束：版本号/uploadId/objectKey 唯一，复合项目归属外键防止 document/project 拼接，Partial Unique Index 保证单 current；current 必须 stored。归档仅改变逻辑状态，不删除对象。

## ADR-023：上传执行多层内容校验，下载固定为安全附件

- 状态：Accepted。
- 决策：允许 PDF、DOCX、XLSX、PPTX、TXT、Markdown，默认上限 50 MiB。服务端同时检查扩展名、声明 MIME、实际字节数与签名；OOXML 在内存中检查 `[Content_Types].xml`、核心部件、路径、加密/symlink/宏/ActiveX、entry 数、central directory、解压量和压缩比，不把归档解压到文件系统。下载前核对 size/ETag/SHA-256 metadata，并固定 `attachment`、`nosniff`、`private, no-store`。
- 原因：扩展名和浏览器 MIME 均可伪造；Office 文件本质为 ZIP，未经界限检查会引入路径穿越和压缩炸弹风险。附件响应避免 HTML/SVG/脚本以内联内容执行。
- 权限：Admin/Manager/Member 可上传，Viewer 禁止；Admin/Manager 可切换 current 和归档/恢复；所有授权角色可下载。前端能力标记不替代 Route Handler 的 Session、项目与资源归属校验。

## ADR-024：跨存储写入使用三段式补偿，reconciliation 默认 dry-run

- 状态：Accepted。
- 决策：上传依次执行数据库 pending reservation、对象 put/metadata 核对、数据库 stored/current finalize。put 或 finalize 失败均尝试删除目标对象并把版本标记 failed；无法确认补偿删除时标记 quarantined。相同 actor/project/UUID Idempotency-Key 只映射一个 uploadId，失败重试只允许相同文件元数据。
- 原因：PostgreSQL 与 S3 不共享事务；假装原子会留下 orphan、缺失对象或重复版本。显式状态机让请求失败、重试和后台核对可观察，且不向客户端泄露 Provider 错误。
- Reconciliation：`storage:verify` 只读检查 missing/size/ETag/SHA metadata、current、active/current、stale pending 和 orphan。`storage:reconcile` 默认 dry-run；apply 必须非 Production、显式开关、精确 Bucket 确认和最小对象年龄，删除前再次查数据库引用，只删除 orphan 并写脱敏审计。

## ADR-025：Staging 使用跨存储快照和临时 Bucket 恢复演练

- 状态：Accepted。
- 决策：部署在 Migration 前短暂停止唯一 Staging 应用写入者，在同一时间边界创建 PostgreSQL custom-format dump、MinIO JSONL inventory 和 Bucket mirror。dump 必须可被 `pg_restore --list` 解析；mirror 的对象数/字节数必须与 inventory 一致且无 partial。对象恢复只进入唯一临时 Bucket，复核后删除，不覆盖正式 Bucket。
- 原因：只备份数据库会丢失正文，只备份 Bucket 会失去版本/current/权限元数据；跨存储静默漂移必须在变更前后由只读验证发现。临时 Bucket 演练证明备份可读取，同时把破坏正式 Staging 的风险限制在独立命名空间。
- 回滚：应用镜像可自动回滚，但数据库和对象存储恢复必须在维护窗口人工决策；普通部署、失败和回滚都不得执行 `down -v` 或删除 PostgreSQL/MinIO 命名卷。Production 不参与 v0.4 发布或恢复。

## ADR-026：文档解析使用 PostgreSQL Queue、Lease 和独立 Worker

- 状态：Accepted。
- 决策：上传请求只创建持久化 `document_ingestion_jobs`，不在 Web 请求内解析。Worker 使用 `FOR UPDATE SKIP LOCKED` 领取、实例级随机 ID、Lease/Heartbeat、最大尝试次数和新 Generation；解析在线程中受硬超时控制。完成事务再次验证 Lease、Worker、project/document/version/current/active 后才激活索引。
- 原因：解析时间和资源不可预测；Web 进程内同步解析会造成超时、重复执行和无法恢复的半成品。数据库 Queue 复用现有一致性边界，支持多 Worker 并发且不引入未审查的外部消息系统。

## ADR-027：Section/Chunk 保存来源，B2 只使用 PostgreSQL 词法检索

- 状态：Accepted。
- 决策：Parser 先输出自然 Section，再由确定性 Chunker 生成带内容 Hash、Parser/Chunker Version 和 Source Locator 的 Chunk。PostgreSQL 使用 generated `tsvector`、GIN 与 `pg_trgm`，仅搜索 Active/Current/Stored/Succeeded/Effective 数据。
- 原因：来源可追溯和版本有效性必须在 Embedding/RAG 之前成为稳定数据合同。B2 的目标是可审计词法基础，不为展示 AI 而提前引入向量、模型或 Provider。

## ADR-028：Staging App 与 Worker 同镜像、独立进程并共同停写备份

- 状态：Accepted。
- 决策：`project-ai-os-staging-worker` 与 App 使用同一 immutable image，独立 command、无端口、内部网络、scoped credential、资源限制、日志轮转、优雅退出与心跳健康。Migration 前同时停止 App/Worker；回滚按发布前 Worker 是否存在条件恢复或移除。
- 原因：同镜像保证 Parser/Schema/Version 与 App 创建的 Job 合同一致，独立进程避免解析资源影响请求服务；共同 quiesce 保持 PostgreSQL/MinIO 备份边界。

## ADR-029：B3-A 使用非流式 Grounded Qwen Gateway

- 状态：Accepted。
- 决策：项目助手通过服务端 AI Gateway 调用 OpenAI-compatible Qwen Chat Completions，主模型 `qwen3.7-plus`、Fallback `qwen3.6-flash`，第一版不 Streaming。
- 原因：回答返回浏览器前必须完整验证 Evidence 引用；流式 Token 会破坏失败闭合、幂等和 Citation 安全边界。

## ADR-030：Thread 私有，Citation 由服务端来源生成

- 状态：Accepted。
- 决策：Thread 默认只对创建者可见；模型只返回 Evidence 标记，文件名、版本、Source Locator 和 Excerpt 必须来自服务端本次检索快照。
- 原因：项目成员关系只证明项目读取权，不代表可读取其他用户对话；模型返回的来源元数据不可信。

## ADR-031：无 Evidence 不调用 Provider，引用失败只 Repair 一次

- 状态：Accepted。
- 决策：检索为空或低于相关性门槛时直接进入 `insufficient_evidence`；非法 Evidence 标记只允许一次不新增事实的 Repair。
- 原因：这是防幻觉和成本控制的最小 fail-closed 合同，不能用重复调用掩盖不可靠回答。

## ADR-032：B3-A 不引入向量或正式业务 Mutation

- 状态：Accepted。
- 决策：B3-A 继续使用 B2 PostgreSQL 词法检索，禁止 Embedding、pgvector、Hybrid Retrieval、Rerank、Tool/Function Calling 和正式业务写入。
- 原因：先闭环项目隔离、来源、Secret、幂等、限流、审计和真实 Provider，再由 B3-B 独立评审检索质量扩展。

## ADR-033：B3-B1 只建立 pgvector Embedding 基础，不改变用户检索

- 状态：Accepted。
- 决策：CI/Staging 使用 PostgreSQL 17 + pgvector 0.8.1；固定只读 Profile `qwen-text-embedding-cn-v1`、模型 `text-embedding-v4`、1024 维 cosine。Chunk 向量通过独立 PostgreSQL Job/Batch、专用 Worker、Lease/Heartbeat/Retry/Recovery 与安全 Backfill 生成，普通浏览器 API 不返回向量。
- 隔离：Job 和向量都以 project/document/version/chunk 复合约束绑定，且只处理 Active/Current/Stored/Succeeded/Effective Chunk。Document Worker 不获得 Qwen Secret；专用 Embedding Worker 不获得对象存储凭据。Secret 只读挂载到 Staging App 与专用 Worker。
- 检索：B2 搜索和 B3-A Evidence 继续使用原有词法 SQL。B3-B1 只提供自动测试/受保护运维的精确 cosine Probe，不建立 ANN 索引，不实现 Hybrid Retrieval、RRF 或 Rerank。
- 原因：先验证向量定义、数据有效性、项目隔离、成本和运维恢复，再由 B3-B2 以真实数据量、Recall 与延迟评测决定融合与索引策略。
