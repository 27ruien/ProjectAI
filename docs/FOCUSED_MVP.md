# ProjectAI Focused Internal MVP

本版本把普通用户产品面收敛为一个一级入口“知识库”，内部包含项目、常规模板和会话。唯一业务闭环是：

`创建项目 → 上传并向量化项目资料 → 创建会话 → 项目问答或生成需求文档 → 保存到项目 → 下载 Markdown / DOCX`

## 产品入口

- `/knowledge/projects`：项目列表、创建项目和项目详情。
- `/knowledge/projects/{projectId}`：项目基本信息。
- `/knowledge/projects/{projectId}/files`：项目资料及不可变版本。
- `/knowledge/projects/{projectId}/artifacts`：会话生成并保存到项目的 AI 文档。
- `/knowledge/projects/{projectId}/members`：沿用项目成员权限。
- `/knowledge/templates`：常规模板的分类、版本、发布、归档和可见范围。
- `/knowledge/sessions`：选择项目、创建会话、项目问答、快捷生成和引用。

普通用户主导航只显示“知识库”，不再平铺项目、AI 对话和公司知识库，也不暴露资料开关、模型、Provider、Skill、Chunk、日报、会议纪要、Action Plan、风险、周报、GA4、Workflow、审核中心和 UAT 工具。组织与系统设置只保留在管理员账户菜单中。历史表和底层实现未做破坏性删除。

## 项目与文件

项目状态固定为 `planning`、`active`、`completed`、`archived`。创建者自动成为项目负责人。项目文件继续使用私有对象存储、不可变版本、受控下载和独立解析 Worker；任意文件可作为安全附件上传并填写版本说明，只有 PDF、DOCX、XLSX、PPTX、TXT 和 Markdown 会进入解析、向量化与 AI 检索。业务用户不需要配置知识空间、Chunk、Embedding、Skill、模型或 Prompt。

文件读取、上传、版本切换、归档和重新解析继续由服务端项目成员关系控制。未邀请用户统一获得 404，Viewer 只读。

## 会话与 AI 生成文档

会话绑定一个当前用户有权访问的项目，并自动选择项目最新有效资料和相关常规模板。普通用户无需配置资料开关。快捷操作“生成需求文档”调用内部固定能力 `focused-requirement-document-v1`，生成结果以会话产物卡片展示，并同步保存到项目的“AI 生成文档”。

该能力自动选择：

1. 当前项目中 Active、Current、Stored、解析成功且有效的最新资料版本；
2. 当前用户可访问、已发布、未过期、分类为“项目管理规范”的公司资料当前版本。

生成请求先持久化 `generating` 版本，再在响应结束后的后台任务中检索、生成、校验引用并写入 `draft`。页面轮询已登记任务，所以用户可以离开后再返回。失败记录保留为 `failed`，重试会创建新版本，不覆盖原记录。

固定模板共 17 节：

1. 文档信息与版本
2. 项目背景
3. 项目目标
4. 用户与使用场景
5. 产品范围
6. Out of Scope
7. 用户流程
8. 功能需求
9. 页面与交互要求
10. 平台与兼容性
11. 权限要求
12. 异常与降级
13. 隐私和数据要求
14. 验收标准
15. 风险与依赖
16. 待确认事项
17. 来源

内容必须标记 `[Fact]`、`[Company Standard]`、`[AI Inference]` 或 `[TBD]`。发布前会重新验证引用权限、当前版本和来源摘要。Markdown 与 DOCX 都由服务端真实生成。

服务端为每次提问重新计算可检索文件，客户端不能提交 Evidence。常规模板存放在隔离的内部项目中，因此检索审计和消息引用分别保存“对话项目”和 `sourceProjectId`；来源 Chunk 仍受复合外键约束，不放宽跨项目读取。

回答和引用明确标记 `[项目资料]` 或 `[常规模板]`。返回历史消息或打开引用前会重新验证文件仍为当前有效版本且用户仍有权限。资料不足时说明已检索范围、缺失信息和建议补充资料。

## 常规模板

分类固定为：公司章程、人事制度、项目管理规范、信息安全、财务与采购、标准模板、其他。生命周期固定为 `draft`、`published`、`expired`、`archived`；可见范围固定为全公司、指定部门、管理员。

管理员可以上传、填写版本说明、发布、失效、归档和创建新版本。普通成员只读。新版本自动回到草稿，只有 Published、Current、Active、未过期、满足受众范围且使用当前向量 Profile 完成向量化的资料可进入 AI。

## 模型与向量边界

- 所有真实文本生成固定使用 `qwen3.7-flash`，不自动降级到其他模型；结构化 JSON 请求关闭 Thinking。
- 项目资料、常规模板和查询向量固定使用 `qwen3.7-text-embedding`，显式请求 1024 维。
- 当前 pgvector 列继续使用 `vector(1024)`，不新增 Migration。
- 检索只接受 `qwen3.7-text-embedding-cn-v2` 的当前有效向量；旧 Profile 向量不会参与新检索。
- 解析成功但新向量尚未完成的文件显示向量化状态；失败项支持精确重试，结果不确定项禁止自动重试。

## 运行与测试边界

- Focused Runtime 需要 App、PostgreSQL、MinIO、MinIO Init、Document Worker 和 Embedding Worker。
- Meeting、Timesheet、Workflow、Audio、GA4、Action、Risk 和 Weekly Report Worker 不属于本版本运行集合。
- CI 只运行 Migration、Seed、typecheck、lint、`test:focused`、build、`git diff --check` 和一条 Chromium Happy Path。
- CI 使用运行时生成的虚构凭据、隔离 PostgreSQL/MinIO 和 Fake AI Provider。
- Staging 部署前必须备份并记录运行基线；只允许一次受控部署和一次精确登记测试项目的 Smoke。
- Production 只读，不迁移、不重启、不部署。

## 明确不在范围

工作日报、企业微信同步、会议纪要、Action Plan、GA4、风险台账、周报、通用 Workflow/Skill/Provider 管理、Tool Calling、多模型切换、对话共享、高级 Document Grant UI 和破坏性历史表清理均不在本版本范围。

CI Run、Staging Commit/Image Digest、健康状态和人工验收结果属于动态交付证据，只记录在 Draft PR，不在本文件中声明为已通过。
