# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.6.0-staging`（Grounded Qwen Project Assistant / B3-A） |
| `main` 基线 | `672218bc0c2bfe8cf53f0da69749221419307f73`（已合并 v0.5 B2） |
| 开发分支 | `agent/grounded-qwen-assistant` |
| Draft PR | 标题 `Add grounded Qwen project assistant`；保持 Draft、未 Ready、未合并 |
| 动态交付事实 | PR Head、CI Run、Artifact ID/Digest、Staging image 与 Build Time 只记录在 Draft PR、Provenance Manifest 和受控部署证据 |
| Staging | https://gridworks.cn/tool/projectai-staging/；B3-A 只允许受控部署此环境 |
| Production | https://gridworks.cn/tool/projectai/；B3-A 不部署、不迁移、不重启、不配置 Qwen Secret |

## 当前结论

v0.6 B3-A 在已合并 B2 词法索引之上实现真实 Grounded Project Assistant：服务端 AI Gateway、Qwen Adapter、只读 Model Profile、Secret File、Feature Flag、私人 Thread、Message/Execution/Citation 持久化、B2 Evidence、Grounded Prompt、Citation Validation/一次 Repair、资料不足、Prompt Injection 防护、幂等、速率/日 Token/并发限制和审计。

B3-A 关闭 SEC-006：AI 模块只能写入 AI Thread、Message、Execution、Citation 和 Audit，不直接写正式 Requirement、Scope、Action、Risk、Meeting、Project Setting 或 Document，也没有 Tool Calling、Function Calling、Web Search 或 Agent 自主执行。

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
- Qwen Secret 只读挂载到 App；Worker、DB-tools、Migration 和 operations smoke 不获得 Secret。
- 启用顺序固定为：Flag=false 部署并健康 → 固定虚构 Provider Probe → 只重建 App 启用 → 内部/公网真实问答 Smoke。
- Smoke 只使用虚构文件，并验证真实 Qwen、Citation、资料不足、Viewer、私人 Thread、Token Usage、Audit、AI/文档数据清理和 running Execution=0。
- 发布前后精确比对 Production 容器身份、running、restart count 和 health；任何变化都使发布失败。

## 明确未实现

- OCR、图片理解、宏/公式执行和外部 URL 抓取。
- Embedding、`text-embedding-v4`、pgvector、向量字段/索引、语义向量检索、Hybrid Retrieval。
- `qwen3-rerank`、Reranker 和 B3-B。
- Tool Calling、Function Calling、Web Search、Agent 自主执行。
- 自动总结、需求提取、Scope/Action/风险生成和任何 AI 正式业务写入。
- Production Qwen Secret、Production Worker 变更、Production Migration 或 Production 部署。

## 验证门禁

| 门禁 | 稳定要求 |
| --- | --- |
| TypeScript / ESLint / Build | 当前 PR Head 全绿 |
| 单元与架构 | Secret、Qwen Adapter、Gateway、Grounding、Citation、SEC-006 全绿 |
| PostgreSQL 集成 | 权限、私有 Thread、持久化、约束、Retrieval、Repair、幂等、限流/额度/并发全绿 |
| Playwright | B1/B2 回归和 8 个 B3-A 安全截图流程全绿 |
| Evidence / Provenance | Manifest schema v3，记录实际 PNG 尺寸、AI Gateway Version 与 Profile；强 allowlist 和脱敏通过 |
| Staging | 四服务 Healthy，Probe、真实问答/Citation、Viewer/私有 Thread、Token/Audit、清理全绿 |
| Production | 精确不变 |

## 后续

1. 当前 PR 必须保持 Draft，不自动 Ready 或合并。
2. 完成产品与安全人工复审后才可决定合并。
3. B3-B 必须独立立项和分支；不得在 B3-A 中加入 Embedding、pgvector、Hybrid Retrieval 或 Reranker。
