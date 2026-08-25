# Project AI 简体中文 UI 审计

最后更新：2026-08-25

## 1. 范围与边界

本审计覆盖当前 Project AI Web 与以“加载已解压的扩展程序”方式运行的浏览器插件中的用户可见文案。实现范围仅限界面文案、无障碍标签、用户可见诊断信息、Markdown 摘要标签，以及 Skill 名称和机器可读状态的显示映射。

以下内容保持不变：

- 所有 `skills/**/SKILL.md` 文件，以及 Skill 内容、版本和协议数据；
- canonical Skill ID 和机器可读状态值；
- `<SKILL>...</SKILL>` 与 `<USER_TASK>...</USER_TASK>` 注入边界；
- API 路由与协议、JSON schema、数据库、RAGFlow、认证和会话行为；
- ChatGPT、DeepSeek、Qwen 适配器选择器和“禁止自动发送”行为；
- UAT Result JSON schema 与保存的原始回复数据；
- `<USER_TASK>` 标签结构保持不变；插件仅在其内容前统一加入“请使用简体中文回复”，不修改 Skill；
- Production.

变更前仓库基线：

- 分支：`refactor/project-ai-slim`；
- HEAD：`90f0cafdc96943bea853319479ae067feaff0b4d`；
- 服务器测试环境基线：`staging-validation-v1.2`，对应
  `9fe4eab20390a312c1f9300f18e8525e83fca60c`;
- 浏览器插件修复基线：`staging-validation-v1.2.1`，对应
  `9327c16e578f5ed63e9a54b5841553a05ad63d1e`;
- 预先存在且未跟踪的 `chrome-extension.crx`：已原样保留，未作为本轮验证来源。

## 2. 审计方法

1. 读取 `PROJECT_AI_CURRENT_STATE.md`、仓库规则、当前路由、组件、消息、浏览器插件 Popup/content/shared 脚本、Manifest，以及当前 Git、CI 和 tag 状态。
2. 变更前使用 Computer Use 检查当时真实运行的测试环境页面和已安装的浏览器插件 Popup。
3. 扫描 Web JSX 文案与无障碍属性，以及浏览器插件的界面、错误和导出文案；区分用户可见文案与代码标识、选择器、协议字段、业务数据和外部输入内容。
4. 增加确定性回归检查，覆盖中文 Manifest/Popup、canonical Skill ID 保留、中文 Skill 显示名称和中文状态映射。
5. 运行完整仓库验证门禁。
6. 创建新的不可变候选版本，仅部署测试环境，核验在线来源，并使用 Computer Use 检查 Web 和浏览器插件的正常及非正常状态。

第 6 步将在实际执行后记录；本文不会提前把在线检查标记为通过。

## 3. 英文界面发现

### A. Project AI Web

当前 Web 主流程原本已以中文为主。静态审计发现并修复了以下英文残留类型：

- 外观按钮无障碍标签直接显示底层主题值；
- 测试环境提示中的 `Commit`；
- 登录说明中的 `Mock Provider`、`Seed`、`Staging`、`Local`、`OAuth`；
- 系统设置中的 `Dataset`、`Prompt`、`Provider`、`Secret`、`Secret File`；
- Sonner 默认容器标签 `Notifications`；
- 仅屏幕阅读器可见的对话框和导航标签中不一致的 `ProjectAI`；
- 未知项目状态直接暴露底层机器值；
- 组织架构校验错误 `No changes supplied` 可能直接显示给用户。

这些内容均在 UI 层映射为自然的简体中文。项目数据、用户名、邮箱、文件名和 AI 回复属于业务或外部数据，不是产品界面文案，因此不改写。

### B. Chrome Extension

变更前 Popup、Manifest、诊断信息、空状态、操作反馈和 Markdown 摘要以英文为主。现已改为简体中文，同时保留 `Project AI`、`Skill` 和 `UAT` 等约定术语。

仅用于显示的 Skill 映射：

| Canonical ID | 界面显示名称 |
|---|---|
| `project-weekly-report` | 项目周报 |
| `project-timeline-maker` | 项目时间线生成 |
| `project-requirement-analyst` | 项目需求分析 |
| `project-feasibility-research` | 项目可行性研究 |

仅用于显示的状态映射包括：

| 机器可读值 | 界面标签 |
|---|---|
| `PASS` | 通过 |
| `FAIL` | 失败 |
| `BLOCKED` | 阻塞 |
| `IMPLEMENTED` | 已实现 |
| `MANUAL_VERIFIED` / `MANUAL VERIFIED` | 已人工验证 |
| `NOT_VERIFIED` / `NOT VERIFIED` | 未验证 |
| `NEEDS_MANUAL_VERIFICATION` / `NEEDS MANUAL VERIFICATION` | 待人工验证 |
| `active` | 已启用 |
| `experimental` | 实验版 |

canonical ID 仍作为次级信息显示。Project AI 返回的状态值和 Skill 元数据不被改写，也不会以中文语义重新持久化。

浏览器插件的用户可见诊断信息现统一使用中文。当存在结构化错误码时，Popup 分别以 `错误：...` 和 `错误代码：...` 展示中文消息与机器码。未预期的浏览器或运行时英文错误不会直接透传给用户。

Markdown UAT 摘要使用中文标题和标签。JSON 导出及其 schema、字段名保持不变。

## 4. 有意保留的英文术语

以下内容属于产品名、约定技术术语、文件或协议格式、不可变标识或机器可读数据，因此保留：

- `Project AI`, `Skill`, `UAT`, `AI`, `API`, `RAGFlow`, `Kivisense`;
- `ChatGPT`, `DeepSeek`, `Qwen`;
- `Markdown`, `JSON`, `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`;
- `URL`, `HTTP`, `HTTPS`, email addresses, versions, SHAs, and timestamps;
- canonical Skill IDs and machine-readable error/status codes;
- 外部站点内容、项目/用户/测试夹具数据、文件名和 AI 回复；
- 不作为界面文案渲染的源码标识、CSS 类、选择器、存储键、路由和内部协议字段。

`chrome-extension/README.md` 等开发者文档不属于本次纯 UI 中文化范围。任何 `SKILL.md` 内的英文均不视为 UI 漏翻，也未被修改。

## 5. 问题与复测记录

| ID | 严重度 | 发现 | 期望 | 修复 | 复测 |
|---|---|---|---|---|---|
| `LOC-001` | S3 | 浏览器插件 Popup、Manifest 和操作文案为英文 | 简体中文界面 | 中文化可见文案与 Manifest 元数据 | 静态回归通过；在线复测待执行 |
| `LOC-002` | S4 | Web 登录、设置、环境和无障碍标签含不必要英文 | 自然中文标签 | 中文化纯 UI 标签和回退文案 | 类型检查与代码规范检查通过；在线复测待执行 |
| `LOC-003` | S3 | 浏览器插件诊断可能透传英文运行时消息 | 中文消息并保留错误码 | 增加受控中文回退和结构化错误码显示 | 确定性测试通过；在线复测待执行 |
| `LOC-004` | S4 | 组织架构校验可能显示 `No changes supplied` | 中文校验提示 | UI 层精确映射为“请至少修改一项部门信息” | 完整验证待最终运行 |
| `LOC-005` | S2 | 英文 Skill 可能令外部 AI 平台默认使用英文回复 | 三个平台均以简体中文回复 | Popup 在每次注入的 `<USER_TASK>` 中固定加入中文回复要求，Skill 原文不变 | v0.1.3 真实三平台复测待执行 |

## 6. 验证状态

| 验证项 | 结果 |
|---|---|
| 浏览器插件确定性测试 | **通过 — 23/23** |
| 完整 `npm test` | **通过 — 104/104** |
| 类型检查 | **通过** |
| 代码规范检查 | **通过** |
| 构建 | **通过（`npm test` 内一次，独立命令一次）** |
| `git diff --check` | **通过** |
| 精确 HEAD CI | **待执行** |
| 测试环境来源核验 | **待执行** |
| 真实 Project AI Web 中文化检查 | **待执行** |
| 真实浏览器插件中文化检查 | **待执行** |
| UI 英文漏翻 | **待真实界面复核** |

## 7. 最终验收

最终状态将在新候选版本运行于测试环境并完成 Computer Use 复核后填写，不提前标记为通过。

- Production: **NOT TOUCHED**
- Skill 文件修改：**NO**
- 业务逻辑修改：**NO**
- API contract 修改：**NO**
