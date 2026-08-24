# Project AI Staging

URL:

https://gridworks.cn/tool/projectai-slim-uat/

Access mode: `REMOTE`

Runtime: standalone Node + isolated PostgreSQL + real RAGFlow

## Account 1

Email: `admin@test.local`

Role: UAT Admin

Projects: Project A, Project B, Project C

Password: `<provided separately>`

## Account 2

Email: `pm-a@test.local`

Role: Project Manager

Projects: Project A only

Password: `<provided separately>`

## Account 3

Email: `pm-ab@test.local`

Role: Project Manager

Projects: Project A, Project B

Password: `<provided separately>`

## 测试流程

1. 打开 URL。
2. 使用单独提供的测试账号登录。
3. 进入 Project A。
4. 打开 Knowledge，上传只包含虚构内容的 PDF、DOCX、XLSX、PPTX、TXT 或 Markdown 文件。
5. 等待解析状态变为 Ready。
6. 输入一个只能由上传文件回答的问题。
7. 检查回答中的 `[E1]` 引用和 Citation 来源文件名。
8. 返回 Projects 并切换 Project。
9. 使用 `pm-a@test.local` 直接访问 Project B URL。
10. 确认页面和 API 均返回无权限/404，且 Projects 中不显示 Project B 或 Project C。

测试资料不得包含真实客户内容、密码、API Key 或其他敏感数据。
