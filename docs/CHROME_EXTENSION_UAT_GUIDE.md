# 浏览器插件真实全链路 UAT 指南

最后更新：2026-08-25

## 从这里开始：业务质量 UAT

技术全链路已经通过 Computer Use 人工验证。业务用户只需要判断输出是否满足业务
要求，不需要寻找适配器问题、收集控制台日志或自行编写缺陷记录。

1. 打开 `https://gridworks.cn/tool/projectai-slim-uat/`，使用测试环境账号正常登录。
2. 在 `chrome://extensions` 重新加载以下目录中的浏览器插件：
   `/Users/ryan/Documents/ProjectAI-Focused-MVP/chrome-extension`。
3. 在 Project AI 页面同步 Skill，并选择
   `项目需求分析 · v0.2.1`（canonical ID：`project-requirement-analyst`）。
4. 在新的 ChatGPT、DeepSeek 和 Qwen 对话中使用同一份已批准、已脱敏的任务与材料；
   先检查注入内容，再通过网站自己的发送按钮人工发送。
5. 读取、复制、下载并保存每个平台的结果，最后导出 UAT 结果，判断业务质量。

如果某个技术步骤失败或第三方页面结构变化，请停止该平台的测试并交还给
Codex/技术人员处理。不要让业务用户寻找选择器、复现问题或整理技术日志。既有技术
证据和问题记录见 `docs/CHROME_EXTENSION_REAL_UAT_REPORT.md` 与
`docs/CHROME_EXTENSION_REAL_UAT_ISSUES.md`。

## 验证边界

本指南覆盖以下人工链路：

```text
Project AI 登录态 Skill 读取
  → 浏览器插件同步与选择
  → 注入网页 AI 平台
  → 用户人工发送
  → 读取最新 AI 回复
  → 用户明确触发本地保存与导出
```

当前 Staging `staging-validation-v1.4.1` 与浏览器插件 `v0.1.4` 已在登录状态下
完成 ChatGPT、DeepSeek、Qwen 真实链路检查。Requirement Analyst `v0.2.1` 还在
三个平台完成了一条中文结构化输出 smoke：核心业务概念、用户流程、功能范围表、
文字信息架构、待确认备注及中文状态显示均通过。

这不等于八个正式业务用例已完成。第三方页面和登录状态可能变化；后续技术失败应
记录为新的 UAT 问题，不应转交给业务用户排查。

## 安装或重新加载浏览器插件

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 首次安装时，点击“加载已解压的扩展程序”，选择仓库中的
   `chrome-extension/` 目录。
4. 已安装时，在“Project AI 助手”卡片上点击“重新加载”。
5. 如有需要，将浏览器插件固定在工具栏。

预期：Chrome 接受 Manifest。插件只申请 `activeTab`、`storage`、三个指定 AI
平台域名和已审核的 Project AI Staging 路径，不申请 `cookies` 权限。

## 第 1 步：打开并登录 Project AI Staging

打开：`https://gridworks.cn/tool/projectai-slim-uat/`

使用单独提供的测试账号登录。不要在 UAT 证据中记录密码、Cookie、Session token、
API key 或客户敏感数据。

预期：Project AI 页面完成登录，页面导航或刷新后登录状态仍有效。

## 第 2 步：从 Project AI 同步正式 Skill

保持当前标签页为已登录的 Project AI Staging 页面：

1. 打开“Project AI 助手”。
2. 确认状态显示“Project AI：可以同步”。
3. 点击“从 Project AI 同步 Skill”。

预期：下拉列表显示仓库提供的四个正式 Skill：

- 项目周报 `project-weekly-report` v1.2.0；
- 项目时间线生成 `project-timeline-maker` v0.1.0；
- 项目需求分析 `project-requirement-analyst` v0.2.1；
- 项目可行性研究 `project-feasibility-research` v0.1.0。

Popup 同时显示上次同步时间、当前 Skill 状态以及来源 Project AI。

如果显示错误代码 `PROJECT_AI_UNAUTHENTICATED`，请在同一个 Staging 页面完成
登录后重新同步。不要把 Cookie 或 token 复制进插件。如果出现 API 或响应格式诊断，
停止全链路测试并记录准确的中文错误信息与错误代码；“手动备用模式”只能用于定位，
不能代替 Project AI 同步验收。

## 第 3 步：选择项目需求分析

选择：`项目需求分析 · v0.2.1`

预期：选择结果保存在 `chrome.storage.session`。在同一浏览器 Session 中，关闭并
重新打开 Popup 或切换标签页后，所选 Skill 仍然保持。Skill 正文不会写入长期 UAT
结果存储。

## 第 4 步：新建网页 AI 对话

分别在以下平台运行同一流程：

- ChatGPT：`https://chatgpt.com/`
- DeepSeek：`https://chat.deepseek.com/`
- Qwen：`https://chat.qwen.ai/`

通过平台自己的界面登录并新建空白对话。若用例需要附件，请使用平台自身的上传控件；
浏览器插件不负责上传文件。

预期：重新打开插件后，当前站点显示“已支持”，并保留同一个已同步 Skill。

## 第 5 步：输入真实脱敏任务并注入

1. 在“任务说明”中输入同一份真实或已脱敏的需求。
2. 点击“注入当前对话”。
3. 在发送前检查网页 AI 平台的输入框。

预期 wrapper 结构保持不变：

```text
<SKILL>
{Project AI 返回的原始 SKILL.md}
</SKILL>

<USER_TASK>
请使用简体中文回复，包括所有标题、表头、状态说明和正文；仅保留 canonical ID、
error code、版本号、证据标签及不可变技术标识。

{用户输入的任务说明}
</USER_TASK>
```

插件不得改写或缩短 Skill 正文，不得自动发送。若用例需要附件，请在确认三个平台
使用同一份已批准、已脱敏材料后，通过平台自身界面上传。

## 第 6 步：人工发送

检查输入框中的完整内容后，点击网页 AI 平台自身的“发送”按钮或使用其正常键盘
操作。

预期：消息只由用户操作发送；浏览器插件没有自动发送入口。

## 第 7 步：检查项目需求分析产物

等待网页 AI 完成回复，确认至少包含：

1. 需求摘要；
2. 核心业务概念表；
3. 用户流程文字与表格；
4. 功能范围 Markdown 表格，固定列为
   `序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注`；
5. 文字信息架构，以 Markdown 嵌套列表呈现，不生成图片；
6. 没有材料证据但核心链路需要考虑的功能，显示“待确认”，备注包含
   “核心链路待确认，不作为已确认范围”；
7. 需求矩阵、依据与覆盖、待确认信息、问题、依赖、风险、范围边界及下一步建议。

用户可见领域名与状态应为自然简体中文，不应显示 `Functional Scope`、`COMPLETE`、
`PARTIAL`、`MISSING`、`ASSUMED`、`NOT_APPLICABLE`、`UNRESOLVED` 等内部英文值。
证据标签 `[FACT:*]`、`[GAP:*]`、`[ASSUMPTION:*]`、canonical ID、版本号与错误码
可以保留。

## 第 8 步：读取、复制、下载和保存最新回复

重新打开浏览器插件：

1. 点击“读取最新回复”。
2. 确认预览只包含最新一条非空 AI 回复。
3. 点击“复制结果”，确认剪贴板内容未被改写。
4. 点击“下载 Markdown”，确认下载正文未被改写。
5. 如有需要，填写简短的“任务标签”和“备注”。
6. 点击“保存 UAT 结果”。

预期保存字段包含 `skillId = project-requirement-analyst`、
`skillVersion = 0.2.1`、`skillSource = project_ai`、当前平台、时间戳、已脱敏的
origin/path 和 `rawResponse`。关闭 Popup 不应令已同步 Skill 元数据变成 `null`。

Skill 正文与任务说明不会随结果长期保存。

## 第 9 步：在另外两个平台重复

在下一个网页 AI 平台新建对话，保持同一个 Skill、任务说明和附件，重复第 5 至
第 8 步。

预期：只有平台与返回内容允许不同；Skill ID、版本、来源、任务和附件保持可比较。

## 第 10 步：导出跨平台 UAT 结果

完成选定平台后：

1. 点击“导出 JSON”，确认包含 `schemaVersion`、`resultCount` 和完整保存结果。
2. 点击“导出摘要”，确认 Markdown 表格包含时间、平台、Skill、来源、任务标签、
   回复长度和备注。

预期：JSON 包含原始回复；摘要保持简洁。两种导出都不包含 Cookie、token、Skill
正文、任务说明、URL query 或 fragment。

## 仅用于诊断的手动备用模式

展开“高级 / 手动备用模式”，开启手动开关并粘贴一份原始 `SKILL.md`。这可以帮助
区分 Project AI 同步问题与第三方平台适配问题。手动备用模式成功不计为 Project AI
同步全链路通过。

## 当前各平台验收记录

| 平台 | 状态 | Project AI 同步 | 精确注入 | 仅人工发送 | 最新回复 | 复制 | 下载 | 保存 | 导出 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| ChatGPT | 已人工验证 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | Computer Use，登录态真实页面，2026-08-25 |
| DeepSeek | 修复后已人工验证 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 历史问题 `EXT-UAT-001` 已修复并重新验证 |
| Qwen | 已人工验证 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | 通过 | Computer Use，登录态真实页面，2026-08-25 |

仅在真实登录链路完整通过后记录“通过”。登录失败、Staging 不可用或第三方 DOM
变化导致无法继续时，记录“阻塞”。确定性测试不能替代本表的真实浏览器证据。
