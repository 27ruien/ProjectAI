# Project AI 简体中文 UI 审计

最后更新：2026-08-25

## 结论

**CHINESE UI LOCALIZATION STATUS: PASS WITH CONDITIONS**

- Project AI Web：**PASS**
- 浏览器插件：**PASS**
- Skill 显示名称：**PASS**
- 用户可见错误与状态标签：**PASS**
- Manifest 用户可见信息：**PASS**
- ChatGPT / DeepSeek / Qwen 简体中文回复：**PASS**
- Requirement Analyst 实际产品分析产物：**PASS（真实三平台 smoke）**
- UI 英文漏翻：**0**
- Production：**NOT TOUCHED**

条件：Requirement Analyst 的八个正式 portable web-AI 用例仍为
`NOT_TESTED`，本轮三平台结果是一条受控真实 smoke，不等同于完整业务质量评估；
Staging 根分区部署后仅余约 `439 MiB`，未获得清理授权，因此没有删除历史镜像、
构建缓存或发布资产。

## 范围与授权边界

最初范围是 Project AI Web 与浏览器插件的纯 UI 中文化，不修改 Skill。执行期间用户
随后明确要求：

1. 外部 AI 最终回复必须是简体中文；
2. 只升级 `project-requirement-analyst`，让它先形成核心业务概念、用户流程、功能范围
   Markdown 表格与文字信息架构；
3. 没有材料证据、但核心链路需要考虑的候选功能必须标记待确认；
4. 不生成图片。

因此最终允许的 Skill 例外仅为 Requirement Analyst `0.2.1`。以下三个 Skill 的
`SKILL.md` 未修改：

- `project-weekly-report`
- `project-timeline-maker`
- `project-feasibility-research`

以下边界保持不变：API 路由与对外协议、认证/会话、数据库、RAGFlow、Project
Knowledge、Timeline 数据、UAT Result JSON schema、插件 Project AI Sync 与注入
wrapper、适配器选择器、安全边界和禁止自动发送行为。Production 未部署、未重启、
未写入。

预先存在且未跟踪的 `chrome-extension.crx` 原样保留，不是本轮验证来源。

## 实现结果

### Project AI Web

当前用户可见导航、标题、按钮、输入提示、对话框、空状态、加载/错误/成功反馈、
状态、登录与权限提示、项目、项目知识、成员及问 AI 界面统一为自然简体中文。
当前产品没有 Timeline 页面或标签，因此没有把不存在的 Timeline UI 计为已验证能力。

### 浏览器插件

插件版本为 `0.1.4`。Popup、Manifest、同步、Skill 选择、站点/Session 状态、任务
说明、注入、回复预览、复制、下载、保存、导出、空状态和诊断信息均使用简体中文。
用户界面统一称“浏览器插件”。

每次注入仍保留原始 wrapper：

```text
<SKILL>
...
</SKILL>

<USER_TASK>
...
</USER_TASK>
```

插件只在 `<USER_TASK>` 内加入固定中文回复要求，不改写已同步 Skill 内容，也不会
自动点击第三方平台的发送按钮。

### Skill 显示映射

| Canonical ID | 中文显示名称 |
|---|---|
| `project-weekly-report` | 项目周报 |
| `project-timeline-maker` | 项目时间线生成 |
| `project-requirement-analyst` | 项目需求分析 |
| `project-feasibility-research` | 项目可行性研究 |

canonical ID、版本和底层状态值保持不变，仅在 UI 显示层映射。

### Requirement Analyst `0.2.1`

最终 Markdown 固定先输出：需求摘要、核心业务概念、用户流程、功能范围、信息架构，
再输出需求矩阵、证据/覆盖、问题、依赖、风险、范围边界和建议下一步。

功能范围表固定为：

`序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注`

没有事实证据的核心链路候选保持 `ASSUMPTION + GAP`，最终显示状态为“待确认”，
备注明确说明“核心链路待确认，不作为已确认范围”。信息架构只使用功能范围中已有
节点，以 Markdown 嵌套列表输出，不生成图片、Mermaid 或 JSON。

内部 domain 与 enum 不变；最终 Markdown 显示层使用中文领域名和中文状态。真实
三平台复测未发现 `Business Goal`、`Functional Scope`、`COMPLETE`、`PARTIAL`、
`MISSING`、`ASSUMED`、`NOT_APPLICABLE`、`UNRESOLVED` 等英文展示残留。

## Computer Use 真实审计

### Project AI Web

在部署后的真实 Staging 会话检查了登录相关界面、主导航、项目列表与搜索/状态筛选、
新建项目对话框、项目知识、成员、问 AI 抽屉及相关状态。当前 Web UI 的非必要英文
残留为 `0`。

### 浏览器插件与外部 AI

以 Chrome“加载已解压的扩展程序”运行当前 `chrome-extension/`：

- Project AI：成功同步 4 个正式 Skill；Requirement Analyst 显示为
  `项目需求分析 · v0.2.1`，次级信息保留 canonical ID；
- ChatGPT：注入成功、未自动发送；人工触发发送后输出中文核心业务概念、用户流程、
  功能范围表、信息架构及中文覆盖状态；英文 domain/enum 残留 `0`；
- DeepSeek：同样通过；英文 domain/enum 残留 `0`；
- Qwen：同样通过；英文 domain/enum 残留 `0`；
- 最新回复读取、复制、Markdown 下载、本地 UAT 保存、JSON/摘要导出已在真实链路
  验证；三个适配器仍保持 no-auto-send。

第三方站点自身的英文导航、模型名或系统免责声明不属于 Project AI UI。Mac 在 Qwen
最终可访问性树审计完成后自动锁屏，因此 v0.2.1 的 Qwen 最终截图未新增；Qwen 的
v0.2.0 结构化输出截图和 v0.2.1 最终 AX 文本审计均已完成。

截图证据保存在 `docs/ui-audit/chinese-ui-localization/`，包括 Project AI、插件同步、
三平台中文回复、操作按钮、功能范围、待确认备注和信息架构。

## English residue audit

### A. 有意保留

- `Project AI`、`Skill`、`UAT`、`AI`、`API`、`RAGFlow`；
- `ChatGPT`、`DeepSeek`、`Qwen`；
- `Markdown`、`JSON`、`URL`、`HTTP`、`HTTPS`；
- canonical Skill ID、version、SHA、时间戳、error code；
- `[FACT:*]`、`[GAP:*]`、`[ASSUMPTION:*]`、`P0/P1/P2` 证据与优先级标签；
- 项目数据、用户名、邮箱、文件名、第三方站点内容及不可变技术标识；
- 不作为界面文案渲染的源码变量、选择器、路由、存储键和协议字段。

### B. UI 漏翻

**0**

## 问题与复测

| ID | 发现 | 结果 |
|---|---|---|
| `LOC-001` | 插件 Popup、Manifest、操作与导出文案为英文 | **FIXED / REAL BROWSER VERIFIED** |
| `LOC-002` | Web 登录、设置、环境与无障碍标签含非必要英文 | **FIXED / REAL BROWSER VERIFIED** |
| `LOC-003` | 诊断可能透传英文运行时消息 | **FIXED / DETERMINISTIC + REAL UI VERIFIED** |
| `LOC-004` | 组织架构校验可能显示 `No changes supplied` | **FIXED** |
| `LOC-005` | 英文 Skill 令外部 AI 默认英文回复 | **FIXED / THREE-SITE VERIFIED** |
| `LOC-006` | Requirement Analyst 只罗列缺口，没有实际产品产物 | **FIXED IN 0.2.0 / THREE-SITE VERIFIED** |
| `LOC-007` | 外部 AI 仍显示英文领域名与状态 enum | **FIXED IN 0.2.1 / THREE-SITE VERIFIED** |

## 测试、CI 与部署来源

| 检查 | 结果 |
|---|---|
| Requirement Analyst 模块 | **12/12 PASS** |
| 浏览器插件确定性测试 | **23/23 PASS** |
| 完整 `npm test` | **105/105 PASS**（98 unit + 7 rendered/proxy） |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |
| `git diff --check` | **PASS** |
| 分支精确 SHA CI | **PASS** — `32838451483` |
| 标签精确 SHA CI | **PASS** — `32838648294` |

最终 Staging 来源：

- tag：`staging-validation-v1.4.1`；
- SHA：`119ab621eeea8ac8790e1270305c6dadc0a168ee`；
- release：`20260825T104820Z`；
- image：`projectai-slim-uat:20260825T104820Z-staging-validation-v1.4.1`；
- image ID：`sha256:8f801ca45a66292ec3b889376caa2541512f4c9ce0daa3e8f1f97bd8f7bad5cb`；
- source archive SHA-256：`6dba77cc7884d68756e71310f1f7d7592d1c1cc23f15fba65f7735bb269ae0dc`；
- image archive SHA-256：`9095083adf46742608cba52ae0d9d1d33019c632293fe93ead1ce4c4808f57fe`；
- 公共健康接口：HTTP 200，version 与 commit header 均匹配精确标签；
- 应用容器：running / healthy / restart `0`；
- PostgreSQL：镜像、启动时间、健康状态与重启次数均未改变；
- Production：镜像仍为
  `sha256:a4b6d41941ebb8f995cf2ecaba65a595990187b8b93d03758287f42443cb5469`，
  running / healthy / restart `0`，启动时间未改变。

旧标签 `staging-validation-v1.1`、`staging-validation-v1.2`、
`staging-validation-v1.2.1`、`staging-validation-v1.3`、
`staging-validation-v1.3.1` 和 `staging-validation-v1.4` 均未移动。

## 最终边界声明

- Skill 文件修改：**YES — 仅 Requirement Analyst，来自用户后续明确授权**
- 其他三个 Skill 内容：**UNCHANGED**
- 业务逻辑修改：**YES — 仅 Requirement Analyst Pack/renderer 与输出规则**
- API 路由/认证/数据库/RAGFlow/Timeline/Knowledge：**UNCHANGED**
- 插件注入与同步 contract：**UNCHANGED**
- Production：**NOT TOUCHED**

推荐：**READY FOR CHINESE FULL-CHAIN UAT，WITH CONDITIONS**。下一步是执行八个正式
Requirement Analyst portable 用例，并在获得单独授权后处理 Staging 磁盘容量。
