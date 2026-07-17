# User Flows

## 项目资料上传、版本与处理（v0.5 真实流程）

```mermaid
flowchart LR
  A["进入授权项目"] --> B["打开项目资料"]
  B --> C["选择允许的文件"]
  C --> D["服务端身份、项目与写角色校验"]
  D --> E["文件名、50 MiB、MIME、签名与容器校验"]
  E --> F["创建 pending 版本"]
  F --> G["写入私有对象存储"]
  G --> H["核对大小、SHA-256 与 ETag"]
  H --> I["事务设置 stored/current 并审计"]
  I --> J["同一事务创建解析 Job"]
  J --> K["独立 Worker 读取并校验对象"]
  K --> L["Parser → Section → Chunk"]
  L --> M["当前有效索引原子激活"]
  M --> N["下载、搜索或上传新版本"]
```

页面必须具备 Empty、Loading、Error、Retry、上传进度、成功/失败反馈、active/archived 列表、版本历史、current 标识与权限禁用状态。上传请求携带 UUID `Idempotency-Key`；相同用户/项目/key 重试不得重复创建版本或对象。

第一次上传创建逻辑资料和 version 1。新版本锁定同一逻辑资料并使用新的 Object Key；成功后成为 current，历史版本仍可下载且不被覆盖。Manager 或 system admin 可以把任一 `stored` 历史版本重新设为 current；Member 和 Viewer 不可切换。

上传失败时页面可重试，但失败版本保持可审计状态。对象写入失败或数据库最终确认失败都会尝试补偿删除；无法确认删除时由只读一致性检查报告，不在请求中暴露对象存储错误。

资料页显示等待解析、正在解析、索引成功、解析失败和需要 OCR。Manager/Admin 可重新解析；任何处理失败都不影响原文件下载，也不会产生有效半成品索引。

## 下载（v0.5 真实流程）

```mermaid
flowchart LR
  A["选择文件版本"] --> B["服务端恢复 Session"]
  B --> C["校验 projectId/documentId/versionId 归属"]
  C --> D["确认版本为 stored"]
  D --> E["读取私有对象"]
  E --> F["核对大小、ETag 与 SHA-256"]
  F --> G["写下载审计"]
  G --> H["attachment + nosniff + no-store 响应"]
```

所有项目角色都可下载其授权项目的 stored 版本。跨项目或被篡改的资源 ID 统一 404；浏览器永远看不到 Bucket、Endpoint、Object Key 或凭据。归档资料仍保留历史和授权下载能力，但不出现在默认 active 列表。

## 归档与恢复（v0.5 真实流程）

只有 `project_manager` 和 `system_admin` 可以归档/恢复。归档立即停用该资料的有效 Chunk，不删除版本对象；恢复后只激活 current 版本已有的成功索引，否则创建新 Job。

| 角色 | 查看/下载/搜索 | 上传资料/版本 | reindex | 切换 current | 归档/恢复 |
| --- | --- | --- | --- | --- |
| System Admin | 是 | 是 | 是 | 是 | 是 |
| Project Manager | 是 | 是 | 是 | 是 | 是 |
| Project Member | 是 | 是 | 否 | 否 | 否 |
| Viewer | 是 | 否 | 否 | 否 | 否 |

## 项目知识搜索（v0.5 真实流程，B3-A 继续保留）

项目知识页读取真实文件的当前有效词法索引，继续提供原始片段和来源；B3-A 的 AI 回答通过独立服务端流程复用该索引，不替代原始搜索。

```mermaid
flowchart LR
  A["进入项目"] --> B["打开项目知识"]
  B --> C["输入搜索词或选择资料"]
  C --> D["项目与权限过滤"]
  D --> E["Active + Current + Succeeded 过滤"]
  E --> F["FTS + contains + pg_trgm"]
  F --> G["展示文件、版本、片段与 Source Locator"]
  G --> H["下载原文件"]
```

PDF 显示页码，DOCX 显示标题路径/段落，XLSX 显示 Sheet/行列，PPTX 显示 Slide，TXT/Markdown 显示行号或标题。

## Grounded 项目助手（v0.6 B3-A 真实流程）

```mermaid
flowchart LR
  A["进入授权项目"] --> B["打开私人 Thread"]
  B --> C["输入问题 + Idempotency-Key"]
  C --> D["Session / Project / Thread Owner 校验"]
  D --> E["B2 Active + Current + Stored + Succeeded + Effective Evidence"]
  E -->|"无合格 Evidence"| F["insufficient_evidence，不调用 Qwen"]
  E -->|"有 Evidence"| G["Grounded Prompt"]
  G --> H["AI Gateway → Qwen"]
  H --> I["服务端 Citation Validation"]
  I -->|"非法标记"| J["一次 Citation Repair"]
  I -->|"合法"| K["持久化 Answer + Citation + Execution + Audit"]
  J -->|"仍非法"| L["受控失败，不返回回答"]
  J -->|"合法"| K
  K --> M["显示 [1]、来源卡片与原文件下载"]
```

- Admin、Manager、Member、Viewer 都可使用自己的 Thread；同项目其他成员不能读取该 Thread。
- 最近最多 6 条已完成消息仅用于理解上下文，每次提问都重新检索，旧回答不能替代 Evidence。
- 页面包含 Loading、Empty、Disabled、Insufficient、Provider Error、Retry、Fallback、历史、引用和免责声明。
- 回答只写 AI Thread/Message/Execution/Citation/Audit，不写正式 Requirement、Scope、Action、Risk 或 Meeting。
- 页面必须准确提示“基于项目全文知识索引”；不得宣称向量 RAG、Hybrid Search 或 Rerank。

## 需求提取与审核（目标流程，当前 Mock）

```mermaid
flowchart LR
  A["选择项目文件（目标）"] --> B["读取已解析 Chunk（真实基础）"]
  B --> C["需求提取（Mock）"]
  C --> D["形成 AI 草稿"]
  D --> E["人工修改与审核"]
  E --> F["正式需求写入（未实现）"]
```

B3-A 项目助手不等于需求提取。已有审核交互仍只产生 Mock 状态反馈，正式需求数据层和 AI 写入尚未实现。

## 会议到 Action Plan（目标流程，当前 Mock）

会议、决策和 Action 数据仍为 Mock；本轮不接受会议文件进行解析，不自动摘要、提取 Action、识别风险或生成周报。
