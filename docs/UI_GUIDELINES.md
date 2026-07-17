# UI Guidelines

## 视觉基础

- 使用 shadcn/ui 风格和 Tailwind Design Tokens。
- 主色为低饱和紫色或蓝紫色，背景为浅灰白。
- 数据页面优先表格、分栏和 Drawer，不使用传统重型后台布局。
- 不滥用渐变、玻璃拟态、大阴影；阴影只表达浮层层级。
- 圆角、间距、边框、状态颜色必须复用现有 token 和公共组件。

## 信息与交互

- AI 结果必须显示来源、状态、置信度；关键结论不得只有生成文本。
- AI 草稿、人工审核、正式数据使用明确的状态和视觉边界。
- Loading、Empty、Error、Retry 必须复用统一组件，不以静态占位代替交互。
- 新页面优先复用现有业务组件；没有明确价值时不要新增页面。
- 表单必须有可访问 label；图标按钮必须有 `aria-label`；Drawer/Dialog 支持 Escape 和焦点可识别名称。

## Staging

- Staging 全局显示醒目的 `STAGING` 标识。
- 同时显示环境、版本、Commit 短码和构建时间，并保留完整 SHA 的可查询信息。
- 固定提示这是 Staging 试运行环境，仅允许上传虚构或已脱敏的验证资料；资料正文会真实保存并建立词法索引，项目助手会调用真实 Qwen，但 OCR、Embedding、向量 RAG、Hybrid Retrieval 和 Rerank 仍未启用。
- Staging 设置 robots noindex，并由 Nginx 添加 `X-Robots-Tag`。

## 文档处理与知识搜索

- 资料页和版本抽屉统一显示等待解析、正在解析、知识索引已建立、解析失败和需要 OCR；不显示 Worker ID、Lease 或内部错误堆栈。
- Pending/Running 使用有界轮询；失败提供明确重试/reindex，页面不得无限 Loading。
- 知识页保留“搜索结果/原始资料片段”区域；项目助手是独立区域，必须说明“基于当前项目知识索引生成回答”，不得称为向量 RAG。
- 每个结果显示文件名、current version、受控 excerpt 和 Page/Heading/Sheet/Slide/Line Source Locator，并提供授权下载。

## Grounded 项目助手

- 左侧只显示当前用户的 Thread，明确“默认仅自己可见”；新建、历史和归档状态可识别。
- 回答正文、`[1]` 引用、来源卡片、文件名、版本、Source Locator、Excerpt 和原文件下载必须同时可审核。
- Disabled、Empty、Loading、Insufficient Evidence、Provider Error、Retry 和 Fallback 必须是不同状态，不能无限 Loading 或把失败伪装成空答案。
- 固定免责声明：“AI 回答仅基于当前项目资料生成，请结合引用来源核对关键信息。”
- 固定边界提示：“当前回答基于项目全文知识索引；语义向量检索将在后续版本启用。”
- 不显示 Base URL、Provider Request ID、Object Key、Bucket、完整 Prompt、Evidence ID、Chunk ID、Secret 或敏感限流明细。

## 反馈入口

- 全局入口使用轻量 Drawer，不遮挡主流程。
- 只自动收集 pathname、环境、版本、Commit、User Agent 和时间。
- 不读取页面正文、项目数据、URL query、上传文件或其他业务 localStorage。
- 反馈描述需提示用户主动去除客户资料和密钥。
