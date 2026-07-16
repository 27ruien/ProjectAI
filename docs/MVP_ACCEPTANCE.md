# MVP Acceptance

状态：`通过`、`部分`、`未完成`。`通过` 必须有与该能力同层级的实现和验证；旧版本 CI/Staging 不能替代 v0.5 B2 证据。

| ID | 优先级 | 描述 | 当前状态 | 验证方式 | 自动化覆盖 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | 不同项目数据不得互相访问 | 通过 | PostgreSQL/授权集成、最终 CI 与 v0.4 Staging | 文件 API 的 project/document/version URL 与 body 篡改、上传/下载/版本切换均返回统一 404 | Backend | 集中式服务端授权和复合项目归属链已通过；无未授权 Mock 或真实文件 payload 序列化 |
| SEC-002 | P0 | 未认证用户不能访问真实项目数据 | 通过 | 页面/API/下载未认证测试 | v0.4 真实文件 API 纳入最终回归 | Backend | Session 与服务端守卫来自已合并 v0.3 |
| SEC-003 | P0 | API Key 不进入浏览器 | 通过 | Bundle/DTO/源码扫描 | Artifact 存储元数据扫描 | AI Platform | 无真实模型 Key；对象存储凭据也只在服务端 |
| SEC-004 | P0 | API Key 不进入 Git | 通过 | Git 与工作区扫描 | CI Secret/Artifact 检查 | DevOps | 示例变量无真实值，受保护环境文件不跟踪 |
| SEC-005 | P0 | 客户文件不进入 Git | 通过 | Git 状态、fixture 与 evidence allowlist 检查 | 测试文件运行时生成，上传原件不发布 | DevOps | 正文只进入私有对象存储；当前验收只使用虚构文件 |
| SEC-006 | P0 | AI 草稿不能直接覆盖正式数据 | 部分 | 审核契约与页面审查 | Mock Workflow E2E | Product/Backend | AI/正式需求仍为 Mock；v0.4 文件写入不属于 AI 正式写入 |
| SEC-007 | P0 | 上传路径不能造成目录穿越 | 通过 | 真实文件名/OOXML 路径安全测试与服务端 Key 审查 | NFKC、分隔符/控制字符/bidi、绝对路径、`..`、ZIP entry/symlink 覆盖 | Backend/Security | Object Key 只含受控 ID 与随机 UUID，不包含用户文件名，也不解压到文件系统 |
| SEC-008 | P0 | 知识查询按 projectId 和权限过滤 | 通过 | 真实搜索服务、SQL/权限集成、最终 CI 与 Staging | Active/Current/Stored/Succeeded/Effective 过滤、document filter 归属、Viewer 和跨项目 404 全绿 | Backend/AI | B2 为真实词法搜索，不代表 RAG |
| MVP-001 | P1 | 项目可以创建 | 部分 | 创建 API/UI 与数据库 | 已有管理员持久化集成测试 | Frontend/Backend | 当前只允许 system_admin 创建 |
| MVP-002 | P1 | 文件可以上传 | 通过 | 真实 API/UI、最终 CI 与内部/公网 Staging smoke | Manager/Member 上传，Viewer/未认证/跨项目拒绝，刷新后仍存在 | Frontend/Backend | PDF/OOXML/TXT/MD；项目资料页不再使用文档 Mock |
| MVP-003 | P1 | 文件上传后可以持久化 | 通过 | PostgreSQL + S3-compatible Object Storage | CI 临时 MinIO 与 Staging 私有 MinIO 的幂等、补偿、SHA 下载和 reconciliation 全绿 | Backend | 文件正文与数据库元数据分离；验收清理后测试记录和对象为 0 |
| MVP-004 | P1 | 文档可以解析 | 通过 | 六格式 Parser、Worker、Section/Chunk、状态 UI | CI 与 Staging 内部/公网六格式解析全绿；6 succeeded、1 failed、1 needs_ocr | AI/Backend | 扫描 PDF 为 needs_ocr，本轮不做 OCR |
| MVP-005 | P1 | 文档有状态和版本 | 通过 | 数据库约束、API/UI、最终 CI 与 Staging v1/v2 流程 | 不可变 version 1/2、历史保留、归档/恢复和并发测试通过 | Product/Backend | `project_documents` + `project_document_versions` 已真实持久化 |
| MVP-006 | P1 | 可以区分当前有效版本 | 通过 | Partial Unique Index、索引有效性事务与并发回归 | current/归档/恢复/reindex 只激活正确 Generation | Product/Backend | 非 current 和 archived 不参与搜索 |
| MVP-007 | P1 | 可以进行项目知识问答 | 部分 | 真实项目知识搜索 | 六格式词法搜索已实现；AI 综合回答未实现 | AI | 页面明确不把搜索结果称为 AI 回答 |
| MVP-008 | P1 | 回答必须带来源 | 部分 | 真实搜索来源断言 | 每条词法命中带文件/版本/Source Locator；AI 回答未实现 | AI/Product | 为后续回答来源奠定基础 |
| MVP-009 | P1 | 来源含文件、章节、页码或片段 | 通过 | PDF/DOCX/XLSX/PPTX/TXT/MD 来源 E2E 与 Staging | Page/Heading+Paragraph/Sheet+Range/Slide/Line 全绿 | AI/Product | 与具体 immutable version 绑定 |
| MVP-010 | P1 | AI 可以提取结构化需求 | 部分 | Workflow 执行 | Mock AI Gateway | AI | 不把真实上传文件交给 AI |
| MVP-011 | P1 | 需求有来源证据 | 部分 | 审核来源区 | Mock Workflow E2E | AI/Product | 仅 Mock 证据 |
| MVP-012 | P1 | 项目经理可以修改 AI 草稿 | 通过 | 审核文本编辑 | Mock Workflow E2E | Frontend | 仅浏览器 Mock 状态 |
| MVP-013 | P1 | 可以提交审核 | 部分 | Workflow 进入审核中心 | Mock Workflow E2E | Product | 任务未持久化 |
| MVP-014 | P1 | 可以通过、修改后通过、驳回 | 通过 | 三类按钮状态 | Mock Workflow E2E | Frontend | 仍为 Mock 状态 |
| MVP-015 | P1 | 审核通过后写入正式需求 | 未完成 | 正式数据层集成测试 | 无 | Backend | v0.5 B2 明确不实现 |
| MVP-016 | P1 | 正式需求与 AI 草稿状态分离 | 部分 | 契约与页面审查 | Mock Workflow E2E | Product/Backend | 数据层未实现 |
| MVP-017 | P1 | 有审计记录 | 通过 | PostgreSQL 审计集成与最终 CI/Staging 操作链 | 文件创建/上传/下载/current/归档/恢复/reindex/search/拒绝/reconciliation 均写审计 | AI/Backend | 审计不含 Object Key、Endpoint、凭据、Session、完整搜索词或正文；AI execution 仍 Mock |
| MVP-018 | P1 | 主要流程有 Loading、Error、Retry | 通过 | 页面流程与可恢复失败 | 文件处理状态轮询/reindex + 搜索 Loading/Error/Retry/Empty | Frontend/AI | Workflow 仍保留 Review/Audit 边界 |
| MVP-019 | P1 | Staging 可访问并 noindex | 通过 | v0.5 公网 Staging、App/DB/MinIO/Worker 健康 | 公网登录/受保护路由/静态资源/noindex 和四服务 Healthy 已验证 | DevOps | Production 精确不变 |
| MVP-020 | P1 | Playwright 产品与安全流程通过 | 通过 | CI Run `29483198249` | `18/18`；22 张截图完整且记录实际 PNG 尺寸 | QA | 无 Trace/Video 进入 Evidence |
| MVP-021 | P1 | Production build 通过 | 通过 | 最终 CI `npm run build`（由 `npm test` 执行） | production build + SSR `7/7` 通过 | Frontend | 仅本地/CI 构建并部署 Staging；未在 Production 主机执行 |
| OPT-001 | P2 | 更高级搜索过滤 | 部分 | 页面检查 | SSR | Frontend | 资料页有 active/archived 和搜索基础 |
| OPT-002 | P2 | 更完整统计指标 | 部分 | 数据看板检查 | SSR | Product | 大部分仍为 Mock |
| OPT-003 | P2 | 移动端适配 | 部分 | 多视口检查 | 后续 E2E | Frontend | 现有响应式基础 |
| OPT-004 | P2 | 更丰富视觉动效 | 未完成 | 视觉审查 | 无 | Design | 非 MVP 阻塞 |
| OPT-005 | P2 | 自动生成 Scope | 部分 | Scope 页面检查 | SSR | Product/AI | Mock |
| OPT-006 | P2 | 自动生成 Action Plan | 部分 | Action 页面检查 | 持久化 E2E | Product/AI | Mock |
| OPT-007 | P2 | 自动测试业务模块 | 未完成 | 产品能力验收 | 无 | Product | v0.4 不实现 |
| OPT-008 | P2 | 原型和页面生成 | 未完成 | 产品能力验收 | 无 | Product | v0.4 不实现 |

## v0.5 B2 交付门禁

| ID | 描述 | 当前状态 | 当前证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V05-DATA-001 | Job/Section/Chunk Migration、`pg_trgm`、FTS/trigram Index 和项目复合约束 | 通过 | `drizzle/0002_easy_scarlet_witch.sql`；CI 空库 Migration 与 Staging `pg_trgm` 验证 | 已关闭 |
| V05-WORKER-001 | 独立 Worker、SKIP LOCKED、Lease/Heartbeat、Retry/Generation 原子激活 | 通过 | CI 集成；Staging Worker Healthy、Lease 恢复/旧 Worker 拒绝/`SKIP LOCKED` 全绿 | 已关闭 |
| V05-PARSER-001 | 六格式有界 Parser、needs_ocr、Source Locator 与 Chunker | 通过 | Parser/Chunker `15/15`；内部/公网 Staging 六格式 smoke | 已关闭 |
| V05-SEARCH-001 | project-scoped FTS/contains/pg_trgm、当前版本/归档过滤与公开 DTO | 通过 | 中文/英文/错拼、来源、Viewer、跨项目、current/archive/reindex 全绿 | 已关闭 |
| V05-UI-001 | 状态、Polling、Retry、reindex 和真实知识搜索 UI | 通过 | Playwright `18/18`，10 张新增 B2 截图 | 已关闭 |
| V05-EVIDENCE-001 | Manifest v3、实际 PNG 尺寸、Worker/Parser/Chunker Version 与强 allowlist | 通过 | Evidence ID `8369380379`；Provenance ID `8369380755`；清洗 `passed` | 已关闭 |
| V05-STAGING-001 | 备份、`pg_trgm`、Worker→App、业务 smoke、全量清理和 Production 不变 | 通过 | 2026-07-16 受控部署；四服务 Healthy、内外网 smoke/Lease/清理全绿、Production 精确不变 | 已关闭 |
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

- P0：8 条；通过 7，部分 1，未完成 0。
- P1：21 条；通过 13，部分 7，未完成 1。
- P2：8 条；通过 0，部分 5，未完成 3。

统计只计算第一张长期 MVP 表。v0.5 B2 与 v0.4 历史门禁单独跟踪；SEC-008 已由真实词法索引权限证据闭环，但 B2 通过仍不代表 AI 综合回答或 RAG 已实现。
