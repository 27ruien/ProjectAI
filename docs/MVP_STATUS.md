# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.8.0-staging`（B3-C1 Production Release Readiness） |
| `main` 基线 | 已合并 B3-A、B3-B1、B3-B2 |
| 开发分支 | `agent/production-release-readiness` |
| Draft PR | 标题 `Add production release readiness`；必须保持 Draft、未 Ready、未合并 |
| 动态交付事实 | PR Head、CI Run、Artifact ID/Digest、Staging image 与 Build Time 只记录在 Draft PR、Provenance Manifest 和受控部署证据 |
| Staging | https://gridworks.cn/tool/projectai-staging/；保持已验证 hybrid，不重复制造真实 Provider 费用 |
| Production | https://gridworks.cn/tool/projectai/；B3-C1 只读审计，不部署、不迁移、不重启、不创建 Secret |

## 当前结论

B3-C1 在已合并 B3-B2 上建立 Production Inventory/Diff、Release Manifest、Preflight、隔离 Backup/Restore/Migration/兼容性演练、Smoke、Rollback、Go/No-Go、监控和 Evidence/Provenance。本轮只调整 Release Control Plane 与镜像元数据 Label，没有业务 Runtime 行为或 Production 外部状态变更。

B3-A/B3-B1/B3-B2 的 Runtime、Prompt、Grounding、Citation、项目隔离和 SEC-006 边界保持不变。用户知识搜索继续使用 B2 词法检索；只有 Assistant Evidence 可使用 Hybrid。本轮不实现 ANN、Rerank 或正式业务写入。

## B3-C1 Readiness 能力

- Production/Staging 只读白名单 Inventory、分类差异和 canonical SHA-256；
- 固定 SHA/Image/Node/Base Digest/Phase/Backup/Evidence 的 Release Manifest Schema；
- 精确基线、CI、空间、锁、活动任务、Nginx/Compose 和 Manifest Preflight；
- 全部 Production apply 硬拒绝；当前无数据面时 Backup 为 dry-run/not-applicable；
- 虚构非空 Backup/Checksum/Restore/0004–0007/pgvector 演练；
- 旧 Image 在旁路 0007 数据库存在时继续运行 legacy application shell，以及新 Image AI 全关闭兼容性合同；
- 真实 Migration File/Advisory Lock、环境感知 MinIO Inventory、Git/CI/Image/Clock/Baseline Preflight；
- 跨 Digest、SHA 与 Image 绑定的机器可读 Smoke、Rollback、Go/No-Go、成本和监控门禁；机器 Readiness 与独立审查/上线授权分离；
- 固定 Release Evidence allowlist 与上传后 Provenance。

## v0.8 B3-B2 真实能力

- 固定 `hybrid-rrf-v1`：候选 30/30/30、Evidence 10、RRF K=60、权重 1:1、cosine 最大距离 0.55、Coverage 9800 bps。
- `lexical` 不计费；`shadow` 记录 Hybrid 但 Prompt 使用 Lexical；`hybrid` 使用 RRF 最终 Evidence。Mode 和 Profile 仅服务端可控。
- Query Embedding 走既有 Gateway，向量只驻留请求内存；调用使用独立不可变成本账本、8192 Token 硬预留、Usage 结算、UTC 日限额和 unknown 不自动重试。
- Exact Vector SQL 使用 `embedding <=> query_vector`，强制项目、当前版本、归档、解析成功、有效 Chunk、内容 Hash 和 Profile 过滤；不建立 ANN 索引。
- 60 条纯虚构 Query 分别评测 Lexical、Vector、Hybrid 的 Recall、MRR、nDCG、无答案、安全泄漏和延迟，并冻结通过门禁的 v1 参数。
- Coverage/配置/Profile/预算/Timeout/Provider 异常回退原 Lexical；无 Evidence 不调用 Answer Model。Execution 关联唯一 Retrieval Run 并记录脱敏 Candidate、Usage 与时延。

## v0.7 B3-B1 真实能力

- 固定只读 Profile `qwen-text-embedding-cn-v1`：Provider `qwen`、Region `cn-beijing`、Model `text-embedding-v4`、Dimensions `1024`、Distance `cosine`、Profile Version `1`。
- 历史 Migration `0004_groovy_nightcrawler.sql` 与 `0005_durable_embedding_calls.sql` 保持不变；本轮只新增 `0006_closed_genesis.sql`，以非破坏方式增加不可变 Provider Call Attempt、调用级预算、跨项目复合约束与旧 Batch 回填。
- 专用 Embedding Worker 与 App 使用同一 immutable image，独立 command、无端口、Lease/Heartbeat/Retry/Stale Recovery/优雅退出；Document Worker 不获得 Qwen Secret，Embedding Worker 不获得对象存储 credential。
- Gateway 单批最多 10 条并限制总字符；北京区 `text-embedding-v4` 预算按每条 8192、每请求 33000 的版本化硬上限预留。只有发送前可确认不计费的失败可重试；进入 `fetch` 后的 Timeout、网络、HTTP 拒绝及 2xx 解析/校验失败都终止为 `PROVIDER_RESULT_UNKNOWN`，保留预算且不得自动重试。
- 只处理 Active Document + Current/Stored Version + Succeeded Ingestion + Effective/non-empty Chunk；同 Chunk/Profile/Hash 幂等，归档/旧版本/needs_ocr/未完成解析排除。
- Backfill 默认 dry-run，支持 project/limit/current/effective 范围；Profile Version 或内容 Hash 变化生成新 Job。Provider Usage 原样记录，缺失或 unknown 使用完整硬预留，明确 confirmed-no-charge 才释放；手工 Unknown 恢复保留旧 Call 并为新 Call 单独预留预算。
- 只提供测试/受保护运维的精确 cosine Probe，普通浏览器 API 不返回向量，项目知识页和 B3-A Evidence 不接入该函数。

## v0.6 B3-A 真实能力

- Profile 固定为 `qwen-project-assistant-cn-v1`；主模型 `qwen3.7-plus`，Fallback `qwen3.6-flash`，区域 `cn-beijing`。
- 页面只提交问题和 `modelProfileId`；Provider、模型、Base URL、Secret、Region、Evidence 与 Prompt 都由服务端控制。
- Qwen 使用 OpenAI-compatible `/chat/completions` 非流式调用；主模型只对网络、Timeout、429 和 5xx 执行初始调用加最多 2 次重试，之后 Fallback 一次。
- Thread 默认创建者私有。Admin、Manager、Member、Viewer 均可在授权项目中使用自己的助手；跨项目和他人 Thread 统一 404。
- Evidence 复用 B2 `Active + Current + Stored + Succeeded + Effective` Chunk，候选最多 30、最终最多 10、总字符最多 24000。
- 没有合格 Evidence 时不调用 Provider，Execution 为 `insufficient_evidence` 且没有 Token Usage、actual model 或 Provider Request ID。
- 模型只可引用本次 `[E1]`–`[E10]`；服务端生成公开 `[1]` Citation 和来源快照。非法引用只 Repair 一次，仍失败不返回回答。
- Execution 保存 Profile、requested/actual model、Fallback、状态、版本、Evidence 数、Token Usage、Latency、问题 Hash、幂等键和受控失败码，不保存完整 Prompt 或原始 Provider Payload。
- PostgreSQL 默认限制：每用户每分钟 6 次、用户每日 100000 Token、项目每日 500000 Token、全局同时运行 3 个 Execution。
- UI 提供新建/历史/归档、Loading、Empty、Disabled、Insufficient、Provider Error、Retry、Fallback、引用卡片、Source Locator、Excerpt、下载和免责声明。

## Staging 与 Secret 合同

- `/srv/projectai-staging/.env.ai` 保存非密钥 AI 配置；`/srv/projectai-staging/secrets/qwen_api_key` 保存真实 Key。
- Qwen Secret 只读挂载到 App 与专用 Embedding Worker；Document Worker、DB-tools、Migration 和 operations smoke 不获得 Secret。
- 启用顺序固定为：PostgreSQL/MinIO 备份 → 新代码 Flag=false 在旧 Schema 健康 → 只执行新增 `0006` Migration/pgvector/Profile/Provider Call 校验 → Chat/Embedding Probe → 分阶段启用 → 虚构向量/Backfill/Lease/范围 Probe → B3-A 词法回归与清理。
- Smoke 只使用虚构文件，并验证真实 Qwen、1024 维向量、Usage、同 Hash 幂等、旧版本/跨项目排除、队列清零和 Production 精确不变。
- 发布前后精确比对 Production 容器身份、running、restart count 和 health；任何变化都使发布失败。

## 明确未实现

- OCR、图片理解、宏/公式执行和外部 URL 抓取。
- 用户知识搜索的语义/Hybrid Retrieval、HNSW/IVFFlat/其他 ANN 与 Vector RAG。
- `qwen3-rerank`、Reranker 和 B3-B3。
- Tool Calling、Function Calling、Web Search、Agent 自主执行。
- 自动总结、需求提取、Scope/Action/风险生成和任何 AI 正式业务写入。
- Production Qwen Secret、Production Worker 变更、Production Migration 或 Production 部署。

## 验证门禁

| 门禁 | 稳定要求 |
| --- | --- |
| TypeScript / ESLint / Build | 当前 PR Head 全绿 |
| 单元与架构 | Chat/Embedding 回归；Retrieval Profile、RRF、模式、评测门禁全绿 |
| PostgreSQL 集成 | Exact Vector、复合约束、Coverage/Fallback、成本账本、幂等、unknown 与项目范围全绿 |
| Playwright | B1/B2 回归和 8 个 B3-A 安全截图流程全绿 |
| Evidence / Provenance | Manifest schema v3，记录实际 PNG 尺寸、AI Gateway Version 与 Profile；强 allowlist 和脱敏通过 |
| Staging | 五服务 Healthy；lexical→评测→shadow→报告→hybrid；Probe、Assistant/B3-B1 回归、清理全绿 |
| Production | 精确不变 |

## 后续

1. B3-C1 已完成并合并；Production 仍保持旧 Container/Image，B3 数据面与 AI 尚未上线。
2. 当前 B3-C2A 只开发和隔离演练 Production Rollout Executor，PR 必须保持 Draft，不自动 Ready 或合并。
3. 正式 Production Phase 0–6 只能在 B3-C2A 独立复审并合并后的 B3-C2B 中授权和执行。
4. C1/C2/D 冻结；Rerank、ANN、OCR、Tool Calling 与 Agent Execution 未开始。
