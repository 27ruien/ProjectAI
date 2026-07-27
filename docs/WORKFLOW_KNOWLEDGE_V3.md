# ProjectAI Workflow and Knowledge V3

本版本仍只服务项目经理知识工作，不扩展到其他部门业务。所有 Workflow、检索、生成、审核、发布和导出都绑定服务端 Session、精确 `projectId` 与当前授权来源；AI 产物在人工审核前不进入正式知识库。

## 长任务与工作流

- 日报 AI 整理由 PostgreSQL Job + Worker 执行，具有 Lease、Heartbeat、幂等 Request、阶段时间、失败重试与页面恢复。
- AI 工作流首页只有“搭建需求框架”和“提取会议纪要”两个入口。Requirement Framework 固定产生项目概览、26 节需求文档、GA4 埋点计划和 Action Plan；Meeting 固定产生转写、会议纪要和待办。
- Workflow Source、Artifact、Version、Review、Execution、Export、Audio、Speaker 和 Segment 都持久化。Caller 不能提交 Markdown、Provider、模型或验证结果；服务端校验结构化 Schema 后生成 Markdown/XLSX/DOCX。
- 单产物重新生成只新建该产物版本。发布前重新验证来源权限、版本、内容 Digest 和 Citation，并通过私有对象存储链路写入当前项目知识空间。部分发布失败保存恢复绑定并可幂等继续。
- 每次 AI、Repair、ASR 提交或轮询调用前，都重新校验创建者状态、当前项目角色、组织/部门归属和精确来源版本；授权失败在任何 Provider 调用前停止，数据库故障不会伪装成权限撤销。

## 音频边界

- CI 仅使用 Fake ASR；Staging 真实 Provider 使用 Alibaba Model Studio 异步录音文件识别。提交前先持久化 dispatch marker，只有 task id 安全落库后才轮询；提交结果未知时失败关闭并禁止自动重放。正常 Pending 轮询复用同一个 Execution，不消耗新的尝试次数。
- 原始音视频只在私有对象存储，最大 100 MB；Provider 仅获得一小时短时签名地址。浏览器、日志和 Evidence 不包含对象 Key、签名 URL、Cookie、Token 或原始音频。
- Provider 只给出 `speaker_id`。系统保留 `Speaker 1/2`，真实姓名只能由用户人工重命名；重命名产生新 Artifact Version。AI 待办仍是审核产物，不自动写正式 Action。
- Provider 结果即使缺少 `Content-Length` 也按流式 20 MiB 上限读取；转写 Segment 与总字符数有硬限制，长会议按有界分块生成中间摘要后再合并。上传落库失败删除已写对象，删除失败恢复安全状态并允许幂等重试。

## 结构化知识与管理

- Section 是 Parent Context，Chunk 是 Child。两者保存类型、Heading Path、位置、内容 Hash、解析质量、关键词与摘要；Child 另有 token 估计和 Embedding 状态。XLSX/Table Child 始终携带完整表头/Parent Context。
- Project Manager/Admin 可以查看当前授权文档的分块、版本化 Parser/Chunker、质量和索引状态；修改接口再次校验项目角色、Document ACL、Current/Stored/Active 状态与 expected content hash。
- 禁用 Chunk 会同步失效向量并立即退出 Lexical/Vector/Citation 范围。重新启用或重建 Embedding 通过既有成本、Lease 和幂等队列；Viewer 不获得管理接口。
- 重新解析只使用受审查的版本化策略，新 Generation 成功前保留旧有效 Generation，避免索引空窗。

## 授权检索与回答

严格顺序为：Identity → Organization/Department/Project → Knowledge Space → Document → Version → Chunk → Query Processing → Lexical/Exact Vector → Weighted RRF → Rerank → Parent/Adjacent Expansion → Citation Revalidation → Answer。

- Query Rewrite 只处理复杂/歧义问题，最多三个查询；持久层只保存 hash、数量和时间，不保存完整问题、改写或 Query Vector。
- Rerank 只能排序已经授权的候选，输出必须与输入 Candidate ID 集合完全一致；无效或不可用时保留 Weighted RRF 顺序并记录 fallback。
- Context Expansion 再次调用授权函数，只读取同一当前有效版本的 Parent/Adjacent Chunk。
- 回答区分确定事实、基于证据的推论与待确认内容。没有足够资料时说明已检查范围、缺失项和可补充资料；非法/撤权 Citation 不输出确定结论。
- 用户可快速看到“理解、授权检索、合并、生成、引用校验”状态并可取消；Thread 与后台任务在离开页面后保留。

## 质量与安全门禁

纯虚构检索集由原 60 Query 扩展到 68 Query，增加表格、跨文档、部门共享、无权资料、当前/旧版本、归档和权限撤销。报告 Recall@K、MRR、nDCG、Citation Precision、Citation Authorization、Answer Faithfulness、Evidence Sufficiency、ACL Leakage 和延迟。

硬门禁包括：跨项目/旧版本/归档/无效 Chunk Leakage 为 0，Citation Authorization 为 1，旧 Retrieval 指标不回退，综合问题和 Faithfulness 不低于词法基线。Fake Provider 结果只证明确定性 CI；真实 Qwen 与真实 ASR 必须另在 Staging 受控 Probe/UAT 中验证。

Staging UAT 的 Department、Knowledge Space 和 Project 使用精确 fixture run 与过期时间登记。每个测试结束时物理删除项目数据、对象前缀和部门树；清理接口只接受非 Production、Super Admin、精确登记且过期时间一致的记录，过期 fixture 仍可按原登记值清理。`0035` 同时撤销 `0025` 过宽历史匹配产生的误标记，正常项目不会因名称中包含 UAT 而被隐藏。

## Migration 与回滚

`0026`–`0035` 仅新增 Workflow/Audio/Artifact/结构化 Chunk/隐私安全 Retrieval 字段和约束，并收紧测试 fixture 历史标记；非空升级演练保留旧 Requirement、Action、Risk、Weekly、Thread、Citation、Document 与 Chunk。失败部署使用 Staging 备份和旧镜像恢复；不得对 Staging/Production 使用 schema push、reset 或 drop。Production 本轮只读且不接收这些 Migration。
