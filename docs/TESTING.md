# Testing

## 项目经理日报与 WeCom Connector

```bash
npm run timesheets:migration-upgrade
npm run test:timesheets
npm run test:timesheets-integration
npm run extension:package
npm run test:extension-package
npm run test:extension-e2e
npm run test:e2e -- --grep "项目经理从随记"
```

`test:timesheets` 使用 Fake Provider，覆盖 API 鉴权/同源合同、事实/Schema/项目/工时/完成状态/来源完整性/低置信度/总工时、消息 Origin、精确 replay、终态不可逆、状态机、restart unknown、日志脱敏和 Selector 禁止项。`test:timesheets-integration` 需要隔离 PostgreSQL 17/pgvector 与 Seed，覆盖 owner 隔离、无记录不调用、stale AI recovery、乐观锁、确认、来源项目冲突、失权、批次 replay、活动批次、伪造终态和 Flag。

扩展 E2E 使用独立本机 HTTP Mock 和 mock-only bundle，不连接 Staging/Production/WeCom。它验证 ProjectAI 消息桥接、Popup JSON 预览、Service Worker 中断恢复、iframe 跨 realm 字段、Dry Run、单条保存、登录/遮罩、重复项目、失败、unknown、DOM 变化、误配最终提交语义和最终提交计数。真实 URL/DOM 未提供时，不得把 Mock 通过解释为真实 WeCom 验收通过。

## v0.8 B3-B2 测试分层

1. TypeScript：`npm run typecheck`。
2. ESLint：`npm run lint`。
3. Production build + SSR/代理：`npm test`。
4. 身份与项目隔离回归：`npm run test:integration`。
5. 文件校验与对象存储：`npm run test:storage`。
6. Parser/Chunker 单元：`npm run test:documents`。
7. PostgreSQL + MinIO + Worker/Queue/Search 集成：`npm run test:document-integration`。
8. Project Assistant 单元/架构：`npm run test:assistant`。
9. Embedding Adapter/Gateway/Worker 单元：`npm run test:embeddings`。
10. pgvector/Job/Lease/Backfill/隔离集成：`npm run test:embedding-integration`。
11. Project Assistant 数据库集成：`npm run test:assistant-integration`。
12. Retrieval/RRF/评测：`npm run test:retrieval`。
13. Retrieval/成本/隔离集成：`npm run test:retrieval-integration`。
14. Artifact/Provenance：`npm run test:artifacts`。
15. Staging/Worker/AI Secret/Probe/备份部署契约：`npm run test:deployment`。
16. Playwright 身份、文件、解析、知识搜索和 Grounded Assistant：`npm run test:e2e`。
17. 完整本地门禁：`npm run qa:mvp`。

B3-A 新增覆盖 Secret File、Profile、私人 Thread、复合归属、幂等、B2 Evidence、Prompt 分区、Prompt Injection、Citation Validation/Repair、无 Evidence 不调用 Provider、Timeout/429/5xx 重试、401/403 不重试、Fallback、Token Usage、速率/日额度/全局并发和 SEC-006 架构扫描。

B3-B1 修复额外覆盖：`npm run embeddings:migration-upgrade` 在临时数据库构造含 succeeded/failed 与重复历史请求的非空 0004 Batch，并在同一受控事务执行历史 `0005` 与新增 `0006`。Unit/Integration 验证发送前 `reserved`、发送时 `calling`、Timeout/网络/HTTP 拒绝/2xx 非法响应统一变为不可自动重试的 `unknown`、confirmed-no-charge 发送前失败安全重排、旧 Unknown Call 不可变、手工恢复新增 Call 与预算、预算不足不产生第二次调用、中文/中英混合/Emoji/代码/英文/10 条硬预留、并发 UTC 日预算、Usage=null/unknown 预算保留、关停 Abort 与 Lease renewal 故障。Health 单测证明 Flag=false 不检查 Embedding Schema/pgvector/Worker/Provider，而 Flag=true 缺少任一依赖时失败关闭。

旧 CI、旧 Staging 和旧截图不能替代当前 Head 的证据。tracked 文档只记录稳定结论；当前 Head、Run、Artifact ID/Digest、tested merge SHA、Staging image 和 Build Time 等动态精确事实记录在 PR 描述与 Provenance Manifest。

## 隔离基础设施

- 集成/E2E 只连接本地或 CI PostgreSQL；测试 Reset 继续要求 `NODE_ENV=test`、显式开关、本地/CI Host 和测试数据库名。
- CI 使用随机 masked MinIO root/app credential、唯一 Bucket 和 tmpfs，绝不连接 Staging/Production 数据。
- CI 不探测 Staging 健康或运行 SHA；`stagingSha` 在 CI Evidence 中保持 `null`，实际部署事实只由受控 Staging 发布记录和最终状态文档提供。
- 所有 PDF/DOCX/XLSX/PPTX/TXT/Markdown fixture 在运行时生成，只含虚构内容。
- CI 结束时无论 E2E 成败都运行受三重开关保护的 cleanup，要求：

```text
sessions = 0
documents = 0
versions = 0
ingestion jobs = 0
sections = 0
chunks = 0
embedding jobs = 0
embedding batches = 0
embedding provider calls = 0
chunk embeddings = 0
objects = 0
running jobs = 0
running embedding jobs = 0
AI threads = 0
AI messages = 0
AI executions = 0
AI citations = 0
running AI executions = 0
projectai temporary files = 0
```

## Parser 与 Chunker

单元测试至少覆盖：

- PDF Page、扫描 PDF `needs_ocr` 和损坏 PDF。
- DOCX Heading/Paragraph/List/Table。
- XLSX 可见 Sheet、行列范围、隐藏 Sheet 排除、不执行公式。
- PPTX Slide 顺序与 Slide Number。
- TXT/Markdown 行号与 Heading Path。
- 确定性分块、Overlap、内容 Hash、Source Locator 保留、超限与 Parser Thread timeout/termination。

## Queue、Lease 与原子激活

真实 PostgreSQL 集成至少覆盖：

- 上传完成创建 pending Job，重复 enqueue 幂等。
- 两个 Worker 使用 `SKIP LOCKED` 不会领取同一 Job。
- Lease 未到期不可重领，过期可重试；Heartbeat 续租。
- 最大尝试次数、可重试/不可重试错误和 `needs_ocr`。
- Worker 丢失 Lease 不能提交；崩溃/失败不留下 `is_effective=true` 半成品。
- 新 Generation 成功后才替换旧 Generation；版本/current/归档变化期间再次校验。

## Search、权限与生命周期

- FTS、contains、中文、英文和 `pg_trgm` 拼写模糊匹配。
- 搜索 SQL 精确限制 `project_id`，文档 filter 必须属于授权项目。
- 只返回 Active + Current + Stored + Succeeded + Effective Chunk。
- PDF/DOCX/XLSX/PPTX/TXT/Markdown Source Locator 可序列化且不含内部字段。
- 新 current 排除旧版本；归档立即排除；恢复/reindex 使用正确 Generation。
- Viewer/Member 可搜索和下载，只有 Manager/Admin 可 reindex。
- 跨项目 project/document/version/filter 统一 404；拒绝与搜索审计不含 query 正文、Object Key、Worker ID 或 Secret。

## Playwright 与截图

浏览器必须监听 `console.error`、`pageerror`、失败请求和未允许的 HTTP 5xx，不能只断言 200。除 B2 六格式流程外，B3-A 覆盖 Feature Disabled、Empty、Grounded Answer、Citation、Repair、Insufficient Evidence、Provider Timeout/Retry、Viewer、私人 Thread 和跨项目 404。

成功 Evidence 保留原有 12 张截图，并新增：

```text
document-processing-pending.png
document-processing-succeeded.png
document-processing-failed.png
document-needs-ocr.png
knowledge-search-results.png
knowledge-search-pdf-citation.png
knowledge-search-docx-citation.png
knowledge-search-xlsx-citation.png
knowledge-search-pptx-citation.png
viewer-knowledge-search.png
ai-assistant-disabled.png
ai-assistant-empty.png
ai-assistant-grounded-answer.png
ai-assistant-citation-expanded.png
ai-assistant-insufficient-evidence.png
ai-assistant-provider-error.png
ai-assistant-viewer.png
ai-assistant-thread-history.png
```

截图只显示虚构资料，不显示完整正文、Object Key、Bucket、Endpoint、Lease、Worker ID、Cookie、Session 或凭据。Manifest 不声明统一 viewport，而是读取每张 PNG 的实际宽高。

## Artifact 与 Provenance

Payload A 继续使用强 allowlist，只允许 `review-artifacts/evidence-index.json`、约定截图和固定名称 UTF-8 日志；禁止 trace、video、HTML report、原始文件、正文/Section/Chunk 导出、数据库 Dump、MinIO Mirror、环境变量和内部存储标识。

Provenance B 在 Payload A 上传成功并获得真实 Artifact ID/Digest 后生成。Manifest schema v3 记录：

```text
headSha
testedMergeSha
stagingSha
branch
workflowRunId
artifactId
version
buildTime
workerVersion
parserVersion
chunkerVersion
aiGatewayVersion
assistantProfileId
screenshots[{filename,width,height}]
```

## Staging

只部署 Staging。验收必须验证 App、PostgreSQL 17/pgvector、MinIO、Document Worker、Embedding Worker Healthy；`pg_trgm`、pgvector 0.8.1、`vector(1024)`、Profile、双 Probe、虚构增量向量、Lease Recovery、Backfill 幂等、精确向量项目范围、B3-A 词法 Grounded Answer/Citation、全量清理和 Production 精确不变。不得部署或修改 Production。

部署脚本通过 scoped operations service 自动运行：

```text
npm run documents:smoke
npm run documents:lease-smoke
npm run assistant:smoke
npm run embeddings:smoke:prepare
npm run embeddings:lease-smoke
npm run embeddings:smoke:verify
npm run retrieval:evaluate
npm run retrieval:probe
npm run retrieval:shadow-report
npm run retrieval:status
```

前者同时走容器内部上游和公网 Nginx 路径；后者只在队列为空、Worker 暂停期间执行。验收失败必须保留部署失败状态并触发既有 Staging App/Worker 回滚，不得跳过清理或 Production baseline 复核。

## 动态验证事实

最终 PR Head、CI Run、Evidence/Provenance ID/Digest、Staging image 与 Build Time 不写入 tracked 文档；它们只记录在当前 Draft PR 描述、Provenance Manifest 和受控部署证据中。

## v0.8 Retrieval 门禁

- `npm run retrieval:migration-upgrade` 在隔离 PostgreSQL 17/pgvector 数据库验证 0004→0005→0006→0007 非空升级和旧 Execution 的 lexical 默认值。
- `npm run test:retrieval` 验证冻结配置、模式拒绝、RRF 去重/加权/稳定排序以及 60 Query 质量门禁。
- `npm run test:retrieval-integration` 验证 lexical 零调用、shadow Evidence 不变、hybrid 语义命中、跨项目/旧版本/归档排除、Coverage/Timeout 回退、unknown 不重试、Usage-null、UTC 日预算、幂等、Profile 禁用与数据库复合约束。
- `npm run retrieval:evaluate` 输出 JSON/Markdown 的 Lexical/Vector/Hybrid 整体及分类 Metrics、距离校准、安全计数和门禁；只使用虚构资料，不使用 LLM Judge。
- Playwright 继续监控 console/page/request/HTTP 500/无限 Loading，并拒绝浏览器出现 Secret、Query Vector、内部 Score 或 Provider Payload。B3-A/B3-B1 全量回归必须保持通过。

## B3-C1 Release Readiness 门禁

`npm run qa:mvp` 串行包含 Migration Upgrade、隔离 Database Backup/Restore/Migration Rehearsal、Release Tool Unit、全部应用 Unit/Integration、Artifact/Deployment Contract 与 Playwright；本地执行必须提供名称含 `test|ci` 的隔离 PostgreSQL/MinIO，CI 使用 Job Service 与临时私有 Bucket。

- `npm run test:release` 验证 canonical digest、Inventory/Diff/Manifest、dry-run 默认、Production apply 硬拒绝、精确基线/低磁盘失败、Backup no-write、Rollback/Go-No-Go fail-closed、命令级 Smoke 检查和 Artifact sanitizer。
- `npm run release:database-rehearsal` 在临时 PostgreSQL 17 + pgvector 0.8.1 中插入纯虚构非空数据，执行 custom dump、Checksum、真实 Restore、0004–0007、Profile/默认值/锁/行计数验证并清理。
- `npm run test:release` 覆盖数据库不存在时 Migration Advisory `not-applicable`、File Lock、Advisory `held/unknown` 失败关闭、Production/Staging Bucket 区分、2 Object Count、Bucket Missing/Inventory Unknown、Git/CI/Image/Clock/Baseline Preflight，以及 Go/No-Go Digest 篡改、SHA/Image 不匹配和缺失报告。
- CI 从 PR Head 的完整 SHA 构建 runner 与 db-tools Image，在无 Qwen Secret、Assistant=false、Embedding=false、Mode=lexical 的独立 Network/tmpfs 数据库中验证 Health、核心路由、零 AI Job/Call/Execution、无公开端口和清理。
- `release:smoke` 的 required matrix 覆盖登录、Session、项目/成员/跨项目 404、文件、解析、词法、Assistant disabled/lexical、Embedding disabled/enabled、Shadow、Hybrid、Citation、Viewer、私有 Thread、幂等、Evidence Insufficient、Health 和 reconciliation；CI 的实际集成/Playwright 门禁失败会使 Evidence 状态失败。
- Release JSON/Markdown 和固定日志加入 Evidence allowlist；成功 v0.8 CI 缺少 database rehearsal、disabled-image 或 smoke report 时 sanitizer/finalizer fail-closed。
- 旧 Production Image 在独立服务器 Network 中验证旁路 0007 数据库存在时登录、Dashboard、项目入口等既有公开路径可运行，且通过 `pg_stat_activity` 未观察到旧 App 数据库连接；结论只覆盖 legacy application shell，不宣称新数据面功能等价。

## 第一阶段：项目知识与管理门禁

- `npm run phase1:migration-upgrade` 在非空隔离数据库执行 `0007 → 0015`，保留旧项目/文件/索引/AI 数据，验证默认知识空间回填、文档/项目部门 Scope Trigger，以及 `system_admin` 也不能绕过匹配的显式内容 Deny。
- `npm run test:phase1-integration` 验证 Organization/Department/Project/Space/File 的 default deny、View/Download 分离、跨组织与跨部门隔离、受限空间、上传目的地、Deny 优先、最后管理员保护和数据库复合约束。
- Round 2 集成验证权限感知的 Lexical/Vector/RRF/Citation 与 Requirement/Scope 人工审核；Round 3 集成验证 Action/Risk/Weekly/Dashboard/Audit/Export、Owner 归属、Dependency Cycle、不可变发布版本和项目隔离。
- Playwright 覆盖 System/Organization/Department Admin、Project Manager/Member/Viewer、Other Department/Outsider 的可见性与写入边界。`phase1:staging-smoke` 通过公网 HTTP 另行验证真实 Worker、真实 Qwen、受限空间上传、项目挂载、AI 来源、人工审核和清理。
- 只有当前完整 Head 的 CI、Evidence/Provenance、Staging Smoke 和 Production 前后只读基线比较全部通过，第一阶段 PR 才可由 Draft 转为 Ready。

## B3-C2A rollout executor

- `npm run test:production-rollout` 覆盖固定 Trust Fingerprint 与完整依赖 bundle Digest、Caller Key/Symlink/权限绕过、单 Phase/Action Marker、带同步 barrier 的真实跨进程原子 Authorization claim、同一 ID 的 1 success/N replay、不同 ID 的并发 Digest-chain append、双重 Replay 的 `already_consumed`、Replay Journal symlink/权限/Digest chain、claim→Journal 中断后的 reconciliation、dead-PID 内部 mutex 保持不变并失败关闭、Wrong Action，以及可注入 transport 的 Image Transfer 行为验证（claim 前零副作用、无效 receipt、重放零副作用、错误 Action、传输中断后 Authorization 已消费）。Lock 测试使用独立 Node 进程竞争同一路径，并覆盖唯一 acquire、Lease Token 轮换、wrong-session/ID/lease/PID/hostname/UID release 保留原锁、heartbeat-vs-release 竞争、no-replace hard-link 中断、expired/dead PID/heartbeat timeout 不自动删除、并发 stale-guard takeover、guard receipt 防 ABA、Lock 已移除后的 orphan-guard review/clear/reacquire、仅空 guard 目录可恢复、损坏 metadata 或未知目录内容失败关闭、精确 idle-Lock cleanup，以及 crash → review → explicit clear → reacquire。Phase Journal 测试覆盖同进程/跨进程并发 append 的完整 Digest chain、dead-owner timeout 后只补写一次 orphan claim、等待时重新采样恢复时间、恢复其他状态事件时中止 stale append，以及 `release-completed` 补写后禁止旧 Finalize 快照继续。Finalize CLI 以仅限 test/rehearsal 的定点注入覆盖 prepared 后 reacquire 失败及 Lock 已释放后 completed pre-commit 持久化失败，断言精确故障点、Authorization 恰好消费一次、`STATE_UNKNOWN`、无成功输出、无 completed，并重算及交叉绑定 Digest-linked prepared/report/inventory recovery metadata；rehearsal state-dir 还必须是系统临时目录内 owner-only 的真实目录，拒绝 symlink escape。Docker Lock 演练由 host 控制 `ready → go → armed → attempt` 两级屏障，动态验证一胜一明确拒绝、无 orphan Lock/guard/temp，并仅在 Compose 容器、Volume、Network 全部清理后成功。其他 Finalize 测试覆盖缺少七份 Verification、报告 Digest 篡改、Journal/报告 Digest 绑定、验证后的 state-preserving Lock recovery、`prepared → release → completed` 顺序、显式 dead-owner recovery 文本、七类 active count、App/双 Worker Manifest Image、Health 与 Restart 门禁。
- `npm run production:lock:rehearsal` 单独运行最小 Docker Lock 验证；`npm run production:rehearsal` 也会执行同一验证，并继续使用独立 Compose Project、Internal/Egress Network、独立 Volume、Fake Qwen、纯虚构数据与 ephemeral key 完成 Phase 0–6 Apply→Verify、Finalize、Resume 和 Rollback→Verify。无网络、只读根文件系统 Lock Probe 在同一隔离 named volume 中以 A/B 两个容器经文件 barrier 同时 acquire，要求恰一成功、另一明确返回 `PRODUCTION_DEPLOYMENT_LOCK_HELD`，由原 winner exact release 后再由第三容器确认无 active Lock、lifecycle guard 或临时发布文件。真实网络 Probe 验证 App/Embedding 可达 Fake Qwen 而 PostgreSQL/MinIO 不可达，结束清理全部隔离资源。
- Apply/Verify 契约测试拒绝 caller Verification、伪造 producer/Digest、过期或错误 Session/Phase Observation、synthetic success 以及未 Verify 的 Apply；Production Verify 重新采集 live Inventory、容器 Image metadata、Egress membership、服务状态和数据库计数，并把 Apply Report、command result、Observation 与 Journal Digest 交叉绑定。
- Phase 4 测试覆盖 App/Document Worker Flag 传播、Embedding Worker Secret scope、真实新文档自动入队与向量生成、累计 `<=100` Chunks backfill、数据库观测值与 mutation 结果一致、rollback stop/disable 和 vector preservation。Rollback 测试覆盖严格 `6 → 0` 次序、非法跳转、trusted baseline image、App/Worker verification、固定 stateDir、数据状态 Digest 与失败后的 Verify recovery。
- CI Evidence 额外要求七组 `production-*` JSON/Markdown 报告。每个文件和 payload Digest、Producer `b3-c2-v2`、Session、Candidate SHA 与 Image Digest 都进入 Artifact Index；缺失或篡改时发布失败关闭。
