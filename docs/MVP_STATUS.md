# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.7.0-staging`（Embedding and pgvector Foundation / B3-B1） |
| `main` 基线 | `3bc724a3b0c61455b15768719442e38dee50e012`（已合并 v0.6 B3-A） |
| 开发分支 | `agent/vector-embedding-foundation` |
| Draft PR | 标题 `Add vector embedding foundation`；保持 Draft、未 Ready、未合并 |
| 动态交付事实 | PR Head、CI Run、Artifact ID/Digest、Staging image 与 Build Time 只记录在 Draft PR、Provenance Manifest 和受控部署证据 |
| Staging | https://gridworks.cn/tool/projectai-staging/；B3-B1 只允许受控部署此环境 |
| Production | https://gridworks.cn/tool/projectai/；B3-B1 不部署、不迁移、不重启、不增加 pgvector/Worker/Secret |

## 当前结论

v0.7 B3-B1 在已合并 B3-A 之上建立文本向量生成与存储基础：固定 Embedding Profile、`text-embedding-v4`、1024 维 pgvector、Chunk Embedding、持久化 Job/Batch、专用 Worker、Lease/Retry/Recovery、增量生成、安全 Backfill、Probe、Usage 与每日成本上限。

B3-A 的 Grounded Assistant、Citation 与 SEC-006 边界保持不变。用户知识搜索和回答 Evidence 继续使用 B2 词法检索；本轮不实现 Semantic/Hybrid Search、RRF、Rerank 或正式业务写入。

## v0.7 B3-B1 真实能力

- 固定只读 Profile `qwen-text-embedding-cn-v1`：Provider `qwen`、Region `cn-beijing`、Model `text-embedding-v4`、Dimensions `1024`、Distance `cosine`、Profile Version `1`。
- Migration `drizzle/0004_groovy_nightcrawler.sql` 新增 pgvector Extension、Profile、Embedding Job/Batch/Vector 表、跨项目复合约束和 Chunk 失效触发器；不修改历史 Migration。
- 专用 Embedding Worker 与 App 使用同一 immutable image，独立 command、无端口、Lease/Heartbeat/Retry/Stale Recovery/优雅退出；Document Worker 不获得 Qwen Secret，Embedding Worker 不获得对象存储 credential。
- Gateway 单批最多 10 条并限制总字符；严格验证返回数量/顺序/1024 维/有限值。网络、Timeout、429、5xx 可重试；400/401/403、Secret/配置/维度错误不重试。
- 只处理 Active Document + Current/Stored Version + Succeeded Ingestion + Effective/non-empty Chunk；同 Chunk/Profile/Hash 幂等，归档/旧版本/needs_ocr/未完成解析排除。
- Backfill 默认 dry-run，支持 project/limit/current/effective 范围；Profile Version 或内容 Hash 变化生成新 Job。Provider Usage 原样记录，缺失保持 null，成本不估算，并有每日 Job/Token 上限。
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
- 启用顺序固定为：Flag=false 部署 → PostgreSQL/MinIO 备份 → pgvector Migration/Profile 校验 → Chat/Embedding Probe → 分阶段启用 → 虚构向量/Backfill/Lease/范围 Probe → B3-A 词法回归与清理。
- Smoke 只使用虚构文件，并验证真实 Qwen、1024 维向量、Usage、同 Hash 幂等、旧版本/跨项目排除、队列清零和 Production 精确不变。
- 发布前后精确比对 Production 容器身份、running、restart count 和 health；任何变化都使发布失败。

## 明确未实现

- OCR、图片理解、宏/公式执行和外部 URL 抓取。
- 用户语义向量检索、Hybrid Retrieval、RRF、HNSW/IVFFlat 与 Vector RAG。
- `qwen3-rerank`、Reranker 和 B3-B2。
- Tool Calling、Function Calling、Web Search、Agent 自主执行。
- 自动总结、需求提取、Scope/Action/风险生成和任何 AI 正式业务写入。
- Production Qwen Secret、Production Worker 变更、Production Migration 或 Production 部署。

## 验证门禁

| 门禁 | 稳定要求 |
| --- | --- |
| TypeScript / ESLint / Build | 当前 PR Head 全绿 |
| 单元与架构 | Chat 回归；Embedding Adapter/Gateway/维度/有限值/重试/Secret 边界全绿 |
| PostgreSQL 集成 | pgvector/Profile/复合约束、Worker/Lease/Recovery、部分失败、Backfill、幂等、成本上限与项目范围全绿 |
| Playwright | B1/B2 回归和 8 个 B3-A 安全截图流程全绿 |
| Evidence / Provenance | Manifest schema v3，记录实际 PNG 尺寸、AI Gateway Version 与 Profile；强 allowlist 和脱敏通过 |
| Staging | App、两个 Worker、PostgreSQL/pgvector、MinIO Healthy；两个 Probe、真实向量、Backfill/Lease/范围、B3-A 回归与清理全绿 |
| Production | 精确不变 |

## 后续

1. 当前 PR 必须保持 Draft，不自动 Ready 或合并。
2. 完成产品与安全人工复审后才可决定合并。
3. B3-B2 必须独立立项和分支；不得在 B3-B1 中加入 Hybrid Retrieval、ANN 或 Reranker。
