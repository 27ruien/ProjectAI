# MVP Status

## 版本与发布信息

| 项目 | 当前值 |
| --- | --- |
| 当前开发版本 | `0.8.0-staging`（Workflow and Knowledge V3 Draft） |
| `main` 基线 | 已合并 Product V2；本分支在该基线上新增 V3 Workflow、会议音频与授权检索能力 |
| 开发分支 | `agent/projectai-workflows-knowledge-v3` |
| 当前功能 PR | PR #13；在全部动态门禁关闭前保持 Draft |
| 动态交付事实 | PR Head、CI Run、Artifact/Digest、Staging image、UAT 时间与最终结论只记录在 PR 和受控证据中 |
| Staging | https://gridworks.cn/tool/projectai-staging/；只允许 exact-head、受控 Migration、真实 Provider Probe/UAT 与可回滚发布 |
| Production | https://gridworks.cn/tool/projectai/；本分支只读核对，不部署、不迁移、不重启、不创建 Secret |

## 当前结论

V3 仍只服务项目经理。所有 Workflow、知识来源、检索、生成、审核、发布和导出都绑定服务端 Session、精确 `projectId` 与当前 ACL；AI 草稿在人工审核前不得写入正式知识库。页面只保留“搭建需求框架”和“提取会议纪要”两个工作流入口。

搭建需求框架以受权资料为来源，生成可版本化的项目概览、26 节需求文档、GA4 埋点计划和 Action Plan。提取会议纪要使用私有音频、异步 ASR、说话人分离、人工命名和审核，生成转写、会议纪要与待办。Caller 不能提交 Provider、模型、生成 Markdown 或验证结果；服务端校验结构化输出后生成 Markdown、XLSX 和 DOCX。

项目助手在统一 ACL 后执行有界 Query Rewrite、Lexical/Exact Vector、Weighted RRF、Provider-neutral 受控 Rerank、Parent/Adjacent Context 与 Citation Revalidation。Rerank 只能重排已授权 Candidate；失败时回退 RRF，不得引入新来源。用户知识搜索仍为词法搜索；ANN/HNSW/IVFFlat、专用 `qwen3-rerank`、OCR、Tool Calling 与 Agent Execution 未实现。

Staging 的真实 Qwen、Alibaba 异步 ASR、结构化知识、Shadow/Hybrid 和浏览器 UAT 必须在每个最终 exact Head 重新核对。上一 Head 的成功不能替代当前 Head 的 CI、部署、UAT、独立复审和清理门禁，因此本文件不提前声明最终 Ready 或合并。

正式企业微信 OAuth/扫码尚未实现。Production 配置继续硬拒绝 Mock WeCom 与 Staging 测试登录；Production 不接收 V3 Migration、Qwen Secret、Worker 或 Retrieval Mode 变更。

## Workflow and Knowledge V3 真实能力

- 日报 AI 整理由 PostgreSQL Job + Worker 执行，具有 Lease、Heartbeat、幂等 Request、阶段时间、失败重试与页面恢复。
- Workflow Source、Run、Artifact、Version、Review、Execution、Export、Audio、Speaker 与 Segment 持久化；单产物重新生成只创建该产物的新版本。
- 发布前重新验证来源权限、版本、内容 Digest 与 Citation；部分发布失败保存恢复绑定并可幂等继续。
- 原始音视频只进入私有对象存储；Provider 只获得短时签名地址，浏览器、日志和 Evidence 不包含对象 Key、签名 URL、Cookie、Token 或原始音频。
- Section 作为 Parent Context，Chunk 作为 Child；表格 Chunk 携带表头，禁用 Chunk 同步失效向量并立即退出 Lexical、Vector 与 Citation 范围。
- 检索顺序固定为 Identity → Organization/Department/Project → Knowledge Space → Document → Version → Chunk → Query Processing → Lexical/Exact Vector → Weighted RRF → Rerank → Context Expansion → Citation Revalidation → Answer。
- 68 条纯虚构 Query 覆盖表格、跨文档、部门共享、无权资料、当前/旧版本、归档和权限撤销；Fake Provider 结果只证明确定性 CI，真实 Provider 另行在 Staging 验证。
- 非生产测试 Fixture 由显式注册表和过期清理控制；普通组织/项目/知识来源列表不展示已停用或已登记 Fixture。

## 数据与 Migration

- 历史 `0001`–`0025` 保持不可变。
- `0026`–`0034` 仅新增 Workflow、Audio、Artifact、结构化 Chunk、私有检索元数据与约束。
- 非空升级演练必须保留旧 Requirement、Action、Risk、Weekly、Thread、Citation、Document 与 Chunk。
- Migration 只允许按 ledger 执行 committed SQL；Staging/Production 禁止 schema push、reset、drop 或修改历史 Migration。
- V3 Migration 只允许 Staging。Production 本轮不执行任何 Migration。

## 安全与人工审核边界

- 客户端角色、`projectId`、来源、Candidate、Provider、模型、评分和验证结果均不可信。
- 所有文档、Chunk、Vector Candidate、Context、Citation、下载、发布和导出在使用点重新执行统一 ACL；显式 Deny 优先。
- Requirement、Scope、Action、Risk、Weekly、Workflow Artifact 与 Meeting Action 均先形成草稿或待审核版本；正式写入必须由有权用户人工批准。
- Qwen/ASR Secret 只来自 Staging 受保护 Secret File，不进入 Git、镜像、浏览器、日志、Evidence 或 Provenance。
- 测试证据只能使用虚构内容，不保存客户资料、完整 Prompt、Provider Payload、音频、向量、Cookie、Session 或 credential。

## 验证门禁

| 门禁 | 稳定要求 |
| --- | --- |
| TypeScript / ESLint / Build | 当前 PR exact Head 全绿 |
| 单元与架构 | V3 Round 1/2/3、Product V2、Deployment、Release/Artifact 与安全合同全绿 |
| PostgreSQL / Object Storage | 非空 Migration、Workflow/Audio、ACL、Fixture、检索、发布/恢复和清理全绿 |
| Retrieval | 68 Query；ACL Leakage=0；Citation Authorization=1；Shadow 后才允许 Hybrid；Rerank 失败可审计回退 |
| 浏览器 UAT | 24 项真实 Staging 门禁逐项留证；HTTP health 不能替代产品验收 |
| Provider | Fake 只用于 CI；真实 Qwen 与真实 ASR 只在 Staging 虚构数据下验收 |
| Evidence / Provenance | 强 allowlist 和脱敏；动态事实只记录在 PR/受控 Evidence |
| 独立复审 | 无未解决 P0/P1/P2，且复审针对最终 exact Head |
| Production | 发布前后只读基线精确不变 |

## 明确未实现

- 正式企业微信 OAuth/扫码与真实企业微信写入验收。
- OCR、图片理解、宏/公式执行和外部 URL 抓取。
- 用户知识搜索的语义/Hybrid Retrieval、HNSW/IVFFlat/其他 ANN 与 Vector RAG。
- 专用 `qwen3-rerank` Provider；V3 仅实现服务端、ACL 后、严格 Candidate 集合内的受控 Rerank。
- Tool Calling、Function Calling、Web Search 与 Agent 自主执行。
- 未经人工审核的正式业务写入。
- Production Qwen/ASR Secret、Production Worker、Production Migration 或 Production 部署。

## 下一步

1. 对最终 exact Head 完成 CI、Staging 部署、24 项浏览器 UAT、测试 Fixture 清理和 Production 只读不变核对。
2. 对最终 exact Head 完成独立产品、安全和代码复审；任何 P0/P1/P2 都必须先修复并重新经过门禁。
3. 只有全部门禁通过后才可把 PR #13 从 Draft 标记为 Ready，并使用仓库允许的正常方式合并。
4. 本任务不授权 Production Rollout，也不授权 B3-C2B。
