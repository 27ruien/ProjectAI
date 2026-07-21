# Production Observability and Release Gates

## 目标

Production 观察必须回答三个问题：服务是否稳定、项目隔离/引用是否安全、Provider 使用是否在预算内。B3-C1 只定义门禁，不连接或修改 Production 监控。

## 服务与容量

每个阶段记录 App/PostgreSQL/MinIO/Document Worker/Embedding Worker 的 Health、Restart Count、CPU、Memory、连接数、磁盘、inode 和时钟偏差。硬停止条件：任一必需服务 unhealthy；Restart Count 增加；filesystem/inode 达 85%；可用空间低于发布公式；数据库连接/锁异常；MinIO 不可读；公网或本地 Health 非预期。

## Assistant

监控 Execution success/failure、P50/P95 latency、Citation validation/repair failure、`insufficient_evidence`、stale recovery、rate limit、Answer Token 与每日预算。Citation 缺失、跨项目 Evidence、完整问题/Prompt 出现在日志或错误率显著上升时立即关闭 Assistant。

## Embedding

监控 pending/running/failed Job、Batch、Provider Call、unknown、Token、首批/回填吞吐、Worker heartbeat、Lease/Stale Recovery 和重试分布。unknown 异常增长、队列持续积压、每日 Job/Token 逼近硬上限、Profile/维度错误时关闭 Embedding 并停止 Worker；保留向量和账本。

## Retrieval

监控 requested/effective Mode、Fallback 原因和分布、Coverage bps、Query Embedding unknown/Token、Vector SQL P95、Hybrid P95、Candidate 数、No-evidence、Citation 与跨项目泄漏探针。Shadow 只允许 Lexical Prompt；Hybrid 任一失败必须回退 Lexical。出现跨项目 Candidate/Evidence 为 P0，立即停止上线。

## 成本门禁

分别统计 Answer、Document Embedding 和 Query Embedding Token；使用数据库硬预算而不是日志估算。Provider Usage 缺失保留预留，发送后不确定记 unknown，不自动重试。每日预算 80% 告警、90% 停止继续扩大流量、100% 由数据库拒绝新调用。任何非预期斜率增长都停止当前阶段。

## 观察窗口

| 阶段 | 最小窗口 | 必需样本 |
| --- | --- | --- |
| Phase 2 全关闭 | 15 分钟 | 核心业务 Smoke、无 AI 调用/Job |
| Assistant Lexical | 30 分钟 | Grounded/Citation、Viewer、私有 Thread、Usage/Audit |
| Embedding | 首批 100 Chunk + 30 分钟 | Job/Lease/unknown/成本/范围 Probe |
| Shadow | 至少 30 个受控请求或批准窗口 | Lexical Prompt、Hybrid Candidate、Fallback/Latency |
| Hybrid | 30–60 分钟 | 语义/精确事实/无答案/Citation/成本/泄漏 |

每个窗口结束记录开始/结束时间、样本数、P50/P95、错误/回退/unknown、Token、预算占比、容量和批准人。未知或缺失指标不得视为通过。

## 告警与响应

- P0：跨项目数据、Secret/客户内容泄漏，立即关闭 AI、冻结发布并进入事故响应；
- P1：核心 Smoke、Citation、Health、Restart、Migration/Restore 失败，回退当前阶段；
- 容量/成本：停止扩大流量，保持 Lexical 或全关闭，人工清理只列候选不自动删除；
- Provider：Assistant 关闭或 Retrieval 回 Lexical；Embedding 关闭并停 Worker；不得通过无限重试扩大费用。

Evidence 只保留 Hash、Digest、计数、大小、时长、排名、聚合延迟、Usage 和受控失败码。Rerank 与 ANN 指标尚未定义，因为这两项未开始。

## Rollout observation gates

B3-C2A 的 Journal/Status 记录 Phase 状态、时长、受控请求数、Answer/Embedding/Query Embedding Usage、UTC 日预算、Provider unknown、Rate Limit、Job backlog、错误率、Fallback 和泄漏计数。Phase 2 默认观察 15 分钟，Phase 3/4/5 默认 30 分钟，Phase 5/6 至少 30 次受控请求；正式默认值不得为 0。未知值、异常成本、跨项目泄漏、Cleanup 失败或 backlog 超限立即停止，不自动进入下一 Phase。
