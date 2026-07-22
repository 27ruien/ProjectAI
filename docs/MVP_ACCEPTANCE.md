# MVP Acceptance

状态：`通过`、`部分`、`未完成`。`通过` 必须有与该能力同层级的实现和验证；旧版本 CI/Staging 不能替代 v0.8 B3-B2 证据。最终 PR Head、CI Run、Artifact ID/Digest、tested merge SHA 和 Staging image 等动态事实只记录在 Draft PR、Provenance Manifest 与受控部署证据。

| ID | 优先级 | 描述 | 当前状态 | 验证方式 | 自动化覆盖 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | 不同项目数据不得互相访问 | 通过 | PostgreSQL/授权集成、最终 CI 与 v0.4 Staging | 文件 API 的 project/document/version URL 与 body 篡改、上传/下载/版本切换均返回统一 404 | Backend | 集中式服务端授权和复合项目归属链已通过；无未授权 Mock 或真实文件 payload 序列化 |
| SEC-002 | P0 | 未认证用户不能访问真实项目数据 | 通过 | 页面/API/下载未认证测试 | v0.4 真实文件 API 纳入最终回归 | Backend | Session 与服务端守卫来自已合并 v0.3 |
| SEC-003 | P0 | API Key 不进入浏览器 | 通过 | Secret/Bundle/DTO/Health/日志/Artifact 扫描 | Qwen Secret File、App/Embedding Worker-only mount、公开 DTO 与 Evidence 脱敏 | AI Platform | 真实 Qwen Key 只在 Staging Secret File；浏览器、Document Worker、Git、日志和 Artifact 均不可见 |
| SEC-004 | P0 | API Key 不进入 Git | 通过 | Git 与工作区扫描 | CI Secret/Artifact 检查 | DevOps | 示例变量无真实值，受保护环境文件不跟踪 |
| SEC-005 | P0 | 客户文件不进入 Git | 通过 | Git 状态、fixture 与 evidence allowlist 检查 | 测试文件运行时生成，上传原件不发布 | DevOps | 正文只进入私有对象存储；当前验收只使用虚构文件 |
| SEC-006 | P0 | AI 草稿不能直接覆盖正式数据 | 通过 | AI 写入边界、Schema、人工审核与数据库集成 | Assistant 只写 Thread/Message/Execution/Citation；Requirement/Action/Risk/Weekly 只先写 Draft，正式记录必须由项目经理审核 | Product/Backend | 无 Tool/Function Calling；AI 不直接分配正式 Action，也不覆盖 Requirement、Scope、Risk、Document 或项目设置 |
| SEC-007 | P0 | 上传路径不能造成目录穿越 | 通过 | 真实文件名/OOXML 路径安全测试与服务端 Key 审查 | NFKC、分隔符/控制字符/bidi、绝对路径、`..`、ZIP entry/symlink 覆盖 | Backend/Security | Object Key 只含受控 ID 与随机 UUID，不包含用户文件名，也不解压到文件系统 |
| SEC-008 | P0 | 知识查询按 projectId 和权限过滤 | 通过 | 真实搜索服务、SQL/权限集成、最终 CI 与 Staging | Active/Current/Stored/Succeeded/Effective 过滤、document filter 归属、Viewer 和跨项目 404 全绿 | Backend/AI | B2 为真实词法搜索，不代表 RAG |
| MVP-001 | P1 | 项目可以创建 | 部分 | 创建 API/UI 与数据库 | 已有管理员持久化集成测试 | Frontend/Backend | 当前只允许 system_admin 创建 |
| MVP-002 | P1 | 文件可以上传 | 通过 | 真实 API/UI、最终 CI 与内部/公网 Staging smoke | Manager/Member 上传，Viewer/未认证/跨项目拒绝，刷新后仍存在 | Frontend/Backend | PDF/OOXML/TXT/MD；项目资料页不再使用文档 Mock |
| MVP-003 | P1 | 文件上传后可以持久化 | 通过 | PostgreSQL + S3-compatible Object Storage | CI 临时 MinIO 与 Staging 私有 MinIO 的幂等、补偿、SHA 下载和 reconciliation 全绿 | Backend | 文件正文与数据库元数据分离；验收清理后测试记录和对象为 0 |
| MVP-004 | P1 | 文档可以解析 | 通过 | 六格式 Parser、Worker、Section/Chunk、状态 UI | CI 与 Staging 内部/公网六格式解析全绿；6 succeeded、1 failed、1 needs_ocr | AI/Backend | 扫描 PDF 为 needs_ocr，本轮不做 OCR |
| MVP-005 | P1 | 文档有状态和版本 | 通过 | 数据库约束、API/UI、最终 CI 与 Staging v1/v2 流程 | 不可变 version 1/2、历史保留、归档/恢复和并发测试通过 | Product/Backend | `project_documents` + `project_document_versions` 已真实持久化 |
| MVP-006 | P1 | 可以区分当前有效版本 | 通过 | Partial Unique Index、索引有效性事务与并发回归 | current/归档/恢复/reindex 只激活正确 Generation | Product/Backend | 非 current 和 archived 不参与搜索 |
| MVP-007 | P1 | 可以进行项目知识问答 | 通过 | B2 Evidence + Qwen Gateway + 私人 Thread | Grounded Answer、资料不足、Viewer、跨项目/他人 Thread 404 | AI | 使用词法索引，不宣称向量 RAG |
| MVP-008 | P1 | 回答必须带来源 | 通过 | 服务端 Citation Validation/Repair 与来源快照 | 合法引用、E99 Repair、Repair 失败闭合、来源 DTO 不信任模型元数据 | AI/Product | 回答展示文件、版本、Source Locator、Excerpt 与下载 |
| MVP-009 | P1 | 来源含文件、章节、页码或片段 | 通过 | PDF/DOCX/XLSX/PPTX/TXT/MD 来源 E2E 与 Staging | Page/Heading+Paragraph/Sheet+Range/Slide/Line 全绿 | AI/Product | 与具体 immutable version 绑定 |
| MVP-010 | P1 | AI 可以提取结构化需求 | 通过 | 受权 Chunk → Gateway → Requirement Draft | Fake Provider CI、真实 Staging Qwen、非法输出/引用拒绝 | AI | 来源选择与幂等键绑定；AI 不能创建正式 Requirement |
| MVP-011 | P1 | 需求有来源证据 | 通过 | Requirement Source/Version/Citation 数据链 | 当前有效版本、来源权限复核、撤权隐藏 | AI/Product | 浏览器不获得内部 Chunk ID；正式需求保留不可变来源定位 |
| MVP-012 | P1 | 项目经理可以修改 AI 草稿 | 通过 | 持久化审核 UI/API | Edit+Accept 数据库集成与 E2E | Frontend/Backend | 字段校验、Owner 项目归属和来源再授权均由服务端执行 |
| MVP-013 | P1 | 可以提交审核 | 通过 | Requirement Draft 审核队列 | PostgreSQL 状态、幂等并发与 E2E | Product | 刷新后保留，不依赖浏览器 Mock |
| MVP-014 | P1 | 可以通过、修改后通过、驳回 | 通过 | 三类服务端审核决策 | Accept/Edit+Accept/Reject 集成 | Frontend/Backend | Reject 不创建正式数据；重复审核返回冲突 |
| MVP-015 | P1 | 审核通过后写入正式需求 | 通过 | Requirement/Version/Source/Review 事务 | 非空数据库集成与迁移升级 | Backend | 只有项目经理审核事务可写正式 Requirement |
| MVP-016 | P1 | 正式需求与 AI 草稿状态分离 | 通过 | 独立表、状态机和审计 | Draft 为 0 正式写入、审核后单次生成 | Product/Backend | AI Execution/Draft/Review/Formal Version 分层持久化 |
| MVP-017 | P1 | 有审计记录 | 通过 | PostgreSQL 审计集成与最终 CI/Staging 操作链 | 身份、权限、文件、AI、Requirement、Scope、Action、Risk、Weekly 均审计 | AI/Backend | AI 审计保存 Digest/模型/Token/Latency/受控失败码，不保存完整问题、Prompt、Secret、正文或 Provider Response |
| MVP-018 | P1 | 主要流程有 Loading、Error、Retry | 通过 | 页面流程与可恢复失败 | 文档处理/搜索 + Assistant Disabled/Empty/Loading/Insufficient/Error/Retry/Fallback | Frontend/AI | 未经 Citation Validation 的回答不显示 |
| MVP-019 | P1 | Staging 可访问并 noindex | 通过 | 受控 Staging 部署器与公网 HTTP E2E | 双 Flag/Probe、Phase 1 二十项业务/权限验证、清理/noindex 与五服务 Healthy | DevOps | 每次部署前后精确比较 Production 只读基线；不执行 Production 写操作 |
| MVP-020 | P1 | Playwright 产品与安全流程通过 | 通过 | 当前 Head 完整 CI | 身份、项目隔离、文件、检索、Assistant、Requirement、Action/Risk/Weekly 角色路径 | QA | 无 Trace/Video、Prompt、Provider Response、Secret 或客户内容进入 Evidence |
| MVP-021 | P1 | Production build 通过 | 通过 | 最终 CI `npm run build`（由 `npm test` 执行） | production build + SSR `7/7` 通过 | Frontend | 仅本地/CI 构建并部署 Staging；未在 Production 主机执行 |
| OPT-001 | P2 | 更高级搜索过滤 | 部分 | 页面检查 | SSR | Frontend | 资料页有 active/archived 和搜索基础 |
| OPT-002 | P2 | 更完整统计指标 | 通过 | 项目管理 Dashboard API/UI | Requirement、Scope、Action、逾期、Risk、最新周报集成 | Product | 只聚合正式项目数据；会议展示仍为项目隔离 Mock |
| OPT-003 | P2 | 移动端适配 | 部分 | 多视口检查 | 后续 E2E | Frontend | 现有响应式基础 |
| OPT-004 | P2 | 更丰富视觉动效 | 未完成 | 视觉审查 | 无 | Design | 非 MVP 阻塞 |
| OPT-005 | P2 | 自动生成 Scope | 通过 | Baseline/Candidate 对比与人工确认 | Added/Removed/Modified/Not Mentioned/Ambiguous 集成 | Product/AI | 未提及不会自动判为删除；所有结果保留版本与审计 |
| OPT-006 | P2 | 自动生成 Action Plan | 通过 | AI Draft → 项目经理审核 → 正式 Action | Owner/Deadline/依赖/批量/成员更新/循环拒绝 E2E | Product/AI | AI 不直接创建或分配正式 Action |
| OPT-007 | P2 | 自动测试业务模块 | 未完成 | 产品能力验收 | 无 | Product | v0.4 不实现 |
| OPT-008 | P2 | 原型和页面生成 | 未完成 | 产品能力验收 | 无 | Product | 当前不实现 |

## v0.7 B3-B1 交付门禁

| ID | 描述 | 当前状态 | 稳定证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V07-DATA-001 | 历史 `0004/0005` + 非破坏性 `0006`、pgvector 0.8.1、`vector(1024)`、Profile/Job/Batch/不可变 Provider Call/Embedding 与复合约束 | 部分 | 非空 0004→0005→0006 Upgrade、本地 PostgreSQL 17/pgvector 集成、错误维度/Hash/跨项目拒绝 | 当前 Head CI 与 Staging catalog 复核 |
| V07-GATEWAY-001 | `text-embedding-v4` Adapter、Batch≤10、每条≤8192/每请求≤33000 的版本化硬预算、数量/顺序/维度/有限值/Usage 校验 | 部分 | Timeout/网络/HTTP 拒绝/2xx 非法响应在发送后统一 unknown 且不自动重试；Secret/Provider body 不泄露 | 当前 Head CI 与真实 Staging Probe |
| V07-WORKER-001 | 专用 Worker、SKIP LOCKED、Lease/Heartbeat/Retry/Stale Recovery、旧 Worker 拒绝、发送前/发送后收口 | 部分 | 只有 confirmed-no-charge 发送前失败可安全重试；发送后 unknown 保留预算并阻断普通 Worker | 当前 Head CI 与 Staging Lease smoke |
| V07-SCOPE-001 | 只处理 Active/Current/Stored/Succeeded/Effective，Profile/Hash 幂等和跨项目隔离 | 部分 | 归档/旧版本/needs_ocr/non-effective 排除、同 Hash 无重复 Batch、精确 Probe 项目范围 | 当前 Head CI 与 Staging 虚构双项目验证 |
| V07-OPS-001 | Backfill 默认 dry-run、project/limit、Status/Probe、调用级每日 Job/Token 上限和无正文/向量输出 | 部分 | Unknown 手工恢复保留旧调用与预算、新增预留、预算不足拒绝；Usage null/unknown 使用硬预留 | 当前 Head CI 与 Staging 小批量 Backfill |
| V07-REGRESSION-001 | B2 搜索和 B3-A Evidence/Citation 保持词法检索，不接入向量 | 部分 | 未修改 Search/Grounding/Citation 路径；Assistant 回归门禁保留 | 当前 Head CI、Playwright 与 Staging 真实 Qwen 回归 |
| V07-STAGING-001 | Flag=false、备份、pgvector 切换/Migration、双 Probe、专用 Worker、虚构向量、清理、Production 不变 | 部分 | 部署脚本与契约测试 | 精确 PR Head 受控部署证据 |
| V07-PR-001 | 唯一 PR 保持 Draft、未 Ready、未合并 | 部分 | 目标标题 `Add vector embedding foundation` | Draft PR 创建并完成当前 Head 门禁 |

## v0.6 B3-A 交付门禁

| ID | 描述 | 当前状态 | 稳定证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V06-DATA-001 | Profile、Thread、Message、Execution、Citation Migration 与复合约束 | 通过 | 空库 Migration、数据库约束和跨项目 Citation 拒绝 | 已关闭 |
| V06-GATEWAY-001 | Secret Reader、Qwen Adapter、重试/Fallback、受控错误与 Usage | 通过 | 单元、Fake Provider 和真实 Staging Probe/Smoke | 已关闭 |
| V06-GROUNDING-001 | B2 Evidence、Prompt 分区、Prompt Injection、Citation Validation/Repair | 通过 | 单元/集成/Playwright 与真实 Staging Citation | 已关闭 |
| V06-AUTHZ-001 | 项目读取角色可用、Thread 创建者私有、跨项目/篡改统一 404 | 通过 | Admin/Manager/Member/Viewer、未认证与私有 Thread 回归 | 已关闭 |
| V06-LIMITS-001 | 请求指纹幂等、分钟限流、失败/成功 Token 日额度、stale 回收与全局并发 | 通过 | PostgreSQL 指纹冲突、并发锁、stale 回收、失败 Usage 与限流 Audit 集成 | 已关闭 |
| V06-SEC006-001 | AI 不写正式业务数据，无 Tool/Function Calling | 通过 | 架构扫描、模块依赖与 Staging 行为 | 已关闭 |
| V06-EVIDENCE-001 | 8 张 B3-A 截图、AI Manifest 字段与 Qwen/Prompt 脱敏 | 通过 | 当前 Head Evidence/Provenance；动态 ID/Digest 见 Draft PR | 已关闭 |
| V06-STAGING-001 | App-only Secret、Flag=false→Probe→App-only enable、真实问答与清理 | 通过 | 受控 Staging 部署证据；Production 前后精确一致 | 已关闭 |
| V06-PR-001 | 唯一 PR 保持 Draft、未 Ready、未合并 | 通过 | 当前 Draft PR | 人工复审前保持 |

## v0.5 B2 交付门禁

| ID | 描述 | 当前状态 | 当前证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V05-DATA-001 | Job/Section/Chunk Migration、`pg_trgm`、FTS/trigram Index 和项目复合约束 | 通过 | `drizzle/0002_easy_scarlet_witch.sql`；CI 空库 Migration 与 Staging `pg_trgm` 验证 | 已关闭 |
| V05-WORKER-001 | 独立 Worker、SKIP LOCKED、Lease/Heartbeat、Retry/Generation 原子激活 | 通过 | CI 集成；Staging Worker Healthy、Lease 恢复/旧 Worker 拒绝/`SKIP LOCKED` 全绿 | 已关闭 |
| V05-PARSER-001 | 六格式有界 Parser、needs_ocr、Source Locator 与 Chunker | 通过 | Parser/Chunker `15/15`；内部/公网 Staging 六格式 smoke | 已关闭 |
| V05-SEARCH-001 | project-scoped FTS/contains/pg_trgm、当前版本/归档过滤与公开 DTO | 通过 | 中文/英文/错拼、来源、Viewer、跨项目、current/archive/reindex 全绿 | 已关闭 |
| V05-UI-001 | 状态、Polling、Retry、reindex 和真实知识搜索 UI | 通过 | Playwright `18/18`，10 张新增 B2 截图 | 已关闭 |
| V05-EVIDENCE-001 | Manifest v3、实际 PNG 尺寸、Worker/Parser/Chunker Version 与强 allowlist | 通过 | PR #4 当前 Head 的 Evidence/Provenance 已生成且清洗 `passed`；精确名称、ID 与 Digest 见 PR 描述 | 已关闭 |
| V05-STAGING-001 | 备份、`pg_trgm`、Worker→App、业务 smoke、全量清理和 Production 不变 | 通过 | PR #4 当前最终 Head 已受控部署；四服务 Healthy、内外网 smoke/Lease/清理全绿、Production 精确不变；动态部署事实见 PR 描述及部署证据 | 已关闭 |
| V05-PR-001 | Draft PR OPEN/Draft/未合并 | 通过 | [PR #4](https://github.com/27ruien/ProjectAI/pull/4) OPEN / Draft / MERGEABLE | 已关闭交付动作；人工审查前不得 Ready 或合并 |

## v0.4 历史交付门禁

以下状态记录 B1 工程交付门禁。产品与安全复审仍是合并前独立人工门禁；“通过”不授权合并或开始 B2。

| ID | 描述 | 当前状态 | 当前证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V04-DATA-001 | 文件 Schema/Migration、外键、唯一/Partial Unique/状态检查约束 | 通过 | 最终 CI 空库 Migration、约束集成与 Staging catalog 独立复核 | 已关闭；禁止以 destructive schema push 替代 Migration |
| V04-FILE-001 | 允许类型、50 MiB、文件名/签名/OOXML 安全和 SHA-256 | 通过 | `test:files` `20/20`、`test:storage` `38/38`；Staging 真实 PDF v1/v2 与 SHA 下载通过 | 已关闭；解析正文仍不在范围内 |
| V04-AUTHZ-001 | 上传/下载/版本/归档服务端角色和跨项目归属链 | 通过 | 最终 CI Manager/Member/Viewer/Admin、未认证及跨项目矩阵；Staging 内外网角色/隔离回归 | 已关闭；客户端 role/projectId 始终不可信 |
| V04-VERSION-001 | 不可变版本、单 current、并发递增/切换、归档/恢复 | 通过 | 最终 CI 并发与 E2E；Staging v1/v2、current、归档/恢复通过 | 已关闭；历史对象未覆盖或物理删除 |
| V04-STORAGE-001 | S3-compatible 存储、私有 Bucket、幂等上传与完整性下载 | 通过 | CI 临时 MinIO；Staging 私网 MinIO、anonymous 403、真实上传/下载与 0 finding verify | 已关闭；无对象存储端口或凭据暴露 |
| V04-COMP-001 | 三段式补偿、failed/quarantined 与默认 dry-run reconciliation | 通过 | 最终 CI 补偿/orphan/missing；Staging verify 与 reconciliation dry-run 均 0，0 删除 | 已关闭；apply 仍受显式环境/Bucket/年龄/二次引用保护 |
| V04-UI-001 | 真实资料页、状态反馈、版本历史和权限显示 | 通过 | 最终 CI Playwright `15/15`、12 张截图、pending 有界轮询和 Evidence allowlist | 已关闭；知识问答继续 Mock |
| V04-CI-001 | PostgreSQL + 临时 MinIO、完整门禁、强 Evidence allowlist | 通过 | PR #3 最新 Head CI 全绿；Payload A/Provenance B 经下载复核且 `stagingSha` 与健康 Header 一致 | 已关闭；精确 Run/Artifact ID 见 PR 描述 |
| V04-STAGING-001 | 私网 MinIO、卷、跨存储备份/恢复、健康与 Production 不变 | 通过 | App/DB/MinIO healthy；root-only dump/inventory/mirror、临时 Bucket 恢复、测试清理和 Production 精确比对通过 | 已关闭；Production 未部署，Staging 卷均保留 |
| V04-PR-001 | Draft PR 已创建并保持 OPEN/Draft/未合并，等待产品与安全复审 | 通过 | [PR #3](https://github.com/27ruien/ProjectAI/pull/3) | 已关闭当前交付动作；正式复审通过前不得 Ready 或合并 |

## 统计

- P0：8 条；通过 8，部分 0，未完成 0。
- P1：21 条；通过 20，部分 1，未完成 0。
- P2：8 条；通过 3，部分 2，未完成 3。

统计只计算第一张长期 MVP 表。v0.8 B3-B2、v0.7 B3-B1、v0.6 B3-A、v0.5 B2 与 v0.4 历史门禁单独跟踪；MVP-007/008 已由 Grounded Qwen + 服务端 Citation 闭环。

## v0.8 B3-B2 门禁

| ID | 验收项 | 标准 |
| --- | --- | --- |
| B3B2-001 | 统一 Evidence Retrieval | Assistant 只调用统一服务；客户端不可提交 Mode/Profile/Provider/阈值/向量 |
| B3B2-002 | 项目与有效性隔离 | Exact Vector 与 Candidate 的跨项目、旧版本、归档、无效 Chunk 泄漏均为 0 |
| B3B2-003 | Query 成本一致性 | 单 Execution 单 Run/Call；硬预留、Usage-null、unknown、不自动重试与 UTC 日上限通过 |
| B3B2-004 | RRF 与回退 | 冻结 v1 参数；Coverage/Timeout/配置/预算失败回退原 Lexical；无 Evidence 不调用 Answer Model |
| B3B2-005 | 评测质量 | 60 条虚构 Query；Hybrid Recall@10/nDCG 不低于 Lexical，MRR 容差 0.01，语义 Recall 提升至少 0.15，精确事实与无答案门禁通过 |
| B3B2-006 | 性能 | Exact Vector P95 ≤1500ms；Hybrid Retrieval P95 ≤8000ms |
| B3B2-007 | Staging 发布 | lexical→0007→评测→shadow→报告→hybrid；仅 Mode 切换时只重建 App，清理和 Production 精确不变 |
| B3B2-008 | 边界 | 用户搜索仍词法；无 ANN、HNSW、IVFFlat、Rerank、`qwen3-rerank` 或 Production 发布 |

## B3-C1 Production Readiness 门禁

| ID | 门禁 | 验收 |
| --- | --- | --- |
| B3C1-001 | Production/Staging Inventory 与分类差异 | 白名单、脱敏、Digest、unknown fail-closed |
| B3C1-002 | Manifest/Preflight | 完整 SHA/Image/Base Digest；精确 Production 基线、空间、锁、CI/Evidence 门禁 |
| B3C1-003 | Production 写保护 | 所有 `--environment=production --apply` 返回 `PRODUCTION_APPLY_NOT_AUTHORIZED` |
| B3C1-004 | Backup/Restore/Migration | 当前无数据面时 not-applicable；隔离虚构非空 dump/Checksum/Restore/0004–0007/pgvector 通过 |
| B3C1-005 | Compatibility | 旧 Production Image 在旁路 0007 数据库存在时的 legacy application shell Smoke；明确无数据库依赖/连接观察、回滚后新数据面功能不可用；新 Image AI 全关闭证据 |
| B3C1-010 | Evidence-derived readiness | Migration File/Advisory Lock、环境感知 MinIO Count、Git/CI/Image/Clock/Baseline Preflight 与跨 Digest Go/No-Go 全部由工具事实和绑定报告产生；Checklist-only 输入被拒绝 |
| B3C1-006 | Smoke/Regression | B3-A/B3-B1/B3-B2、集成、Playwright、Release matrix 和清理全绿 |
| B3C1-007 | Runbook/Go-No-Go | Phase 0–6、Secret、Rollback、RPO/RTO、监控、成本和 Stop Conditions 可审查 |
| B3C1-008 | Production 不变 | Container/Image/StartedAt/Restart/Health/Compose/Nginx/服务/Migration/Secret/HTTP 前后精确一致 |
| B3C1-009 | 范围 | Draft PR；无 Production Rollout、Rerank、HNSW、IVFFlat 或 ANN |
