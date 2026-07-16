# User Flows

## 项目资料上传与版本管理（v0.4 真实流程）

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
  I --> J["刷新后仍显示真实资料"]
  J --> K["下载或上传新版本"]
```

页面必须具备 Empty、Loading、Error、Retry、上传进度、成功/失败反馈、active/archived 列表、版本历史、current 标识与权限禁用状态。上传请求携带 UUID `Idempotency-Key`；相同用户/项目/key 重试不得重复创建版本或对象。

第一次上传创建逻辑资料和 version 1。新版本锁定同一逻辑资料并使用新的 Object Key；成功后成为 current，历史版本仍可下载且不被覆盖。Manager 或 system admin 可以把任一 `stored` 历史版本重新设为 current；Member 和 Viewer 不可切换。

上传失败时页面可重试，但失败版本保持可审计状态。对象写入失败或数据库最终确认失败都会尝试补偿删除；无法确认删除时由只读一致性检查报告，不在请求中暴露对象存储错误。

## 下载（v0.4 真实流程）

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

## 归档与恢复（v0.4 真实流程）

只有 `project_manager` 和 `system_admin` 可以归档/恢复。归档只改变逻辑资料状态，不删除任何版本对象，不允许未来知识索引把它当作当前有效资料；恢复后继续使用归档前的 current 版本。`project_member` 和 `viewer` 的直接写 API 请求必须由服务端拒绝。

| 角色 | 查看/下载 | 上传资料/版本 | 切换 current | 归档/恢复 |
| --- | --- | --- | --- | --- |
| System Admin | 是 | 是 | 是 | 是 |
| Project Manager | 是 | 是 | 是 | 是 |
| Project Member | 是 | 是 | 否 | 否 |
| Viewer | 是 | 否 | 否 | 否 |

## 项目知识问答（目标流程，当前仍为 Mock）

真实上传文件尚未解析、分块或建立索引。知识页继续只使用服务端授权后按 `projectId` 精确过滤的 Mock 知识与引用，不能读取 v0.4 对象存储正文。

```mermaid
flowchart LR
  A["进入项目"] --> B["打开项目知识"]
  B --> C["输入问题"]
  C --> D["项目与权限过滤"]
  D --> E["Mock 版本过滤与检索"]
  E --> F["Mock 回答"]
  F --> G["展示 Mock 来源引用"]
```

页面必须明确区分“文件已真实存储”和“文档解析与 AI 知识索引尚未启用”。SEC-008 仍只能是部分完成。

## 需求提取与审核（目标流程，当前 Mock）

```mermaid
flowchart LR
  A["选择项目文件（目标）"] --> B["文档解析（未实现）"]
  B --> C["需求提取（Mock）"]
  C --> D["形成 AI 草稿"]
  D --> E["人工修改与审核"]
  E --> F["正式需求写入（未实现）"]
```

v0.4 不会把真实上传文件交给 Mock AI，也不实现解析、RAG、真实模型或正式需求数据层。已有审核交互仍只产生 Mock 状态反馈。

## 会议到 Action Plan（目标流程，当前 Mock）

会议、决策和 Action 数据仍为 Mock；本轮不接受会议文件进行解析，不自动摘要、提取 Action、识别风险或生成周报。
