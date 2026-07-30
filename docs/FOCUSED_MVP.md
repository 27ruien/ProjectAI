# ProjectAI Focused Internal MVP

本版本把普通用户产品面收敛为三个模块：项目、AI 对话、公司知识库。唯一业务闭环是：

`创建项目 → 上传项目资料 → 生成需求文档 → 人工编辑 → 下载 Markdown / DOCX → AI 查询项目和公司资料`

## 产品入口

- `/projects`：项目列表、创建项目和项目详情。
- `/projects/{projectId}`：项目概览。
- `/projects/{projectId}/files`：项目资料及不可变版本。
- `/projects/{projectId}/requirements`：固定模板需求文档。
- `/projects/{projectId}/members`：沿用项目成员权限。
- `/chat`：选择一个项目，在项目资料、公司资料或两者之间切换。
- `/company-knowledge`：公司级制度和规范。

普通用户主导航不再暴露日报、会议纪要、Action Plan、风险、周报、GA4、Workflow、Skill、审核中心和 UAT 工具。组织与系统设置只保留在管理员账户菜单中。历史表和底层实现未做破坏性删除。

## 项目与文件

项目状态固定为 `planning`、`active`、`completed`、`archived`。创建者自动成为项目负责人。项目文件继续使用私有对象存储、不可变版本、受控下载和独立解析 Worker；上传时只选择文件并可填写版本说明，不向业务用户暴露知识空间、Chunk、Embedding、Skill、模型或 Prompt 配置。

文件读取、上传、版本切换、归档和重新解析继续由服务端项目成员关系控制。未邀请用户统一获得 404，Viewer 只读。

## 需求文档

内部固定能力 `focused-requirement-document-v1` 自动选择：

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

## AI 对话

每个会话绑定一个当前用户有权访问的项目。服务端根据用户选择重新计算可检索文件，客户端不能提交 Evidence。公司资料存放在隔离的内部项目中，因此检索审计和消息引用分别保存“对话项目”和 `sourceProjectId`；来源 Chunk 仍受复合外键约束，不放宽跨项目读取。

回答和引用明确标记 `[项目资料]` 或 `[公司资料]`。返回历史消息或打开引用前会重新验证文件仍为当前有效版本且用户仍有权限。资料不足时说明已检索范围、缺失信息和建议补充资料。

## 公司知识库

分类固定为：公司章程、人事制度、项目管理规范、信息安全、财务与采购、标准模板、其他。生命周期固定为 `draft`、`published`、`expired`、`archived`；可见范围固定为全公司、指定部门、管理员。

管理员可以上传、填写版本说明、发布、失效、归档和创建新版本。普通成员只读。新版本自动回到草稿，只有 Published、Current、Active、未过期且满足受众范围的资料可进入 AI。

## 运行与测试边界

- Focused Runtime 只需要 App、PostgreSQL、MinIO、MinIO Init、Document Worker；Embedding Worker 仅在部署配置明确启用 Hybrid/Embedding 时保留。
- Meeting、Timesheet、Workflow、Audio、GA4、Action、Risk 和 Weekly Report Worker 不属于本版本运行集合。
- CI 只运行 Migration、Seed、typecheck、lint、`test:focused`、build、`git diff --check` 和一条 Chromium Happy Path。
- CI 使用运行时生成的虚构凭据、隔离 PostgreSQL/MinIO 和 Fake AI Provider。
- Staging 部署前必须备份并记录运行基线；只允许一次受控部署和一次精确登记测试项目的 Smoke。
- Production 只读，不迁移、不重启、不部署。

## 明确不在范围

工作日报、企业微信同步、会议纪要、Action Plan、GA4、风险台账、周报、通用 Workflow/Skill/Provider 管理、Tool Calling、多模型切换、对话共享、高级 Document Grant UI 和破坏性历史表清理均不在本版本范围。

CI Run、Staging Commit/Image Digest、健康状态和人工验收结果属于动态交付证据，只记录在 Draft PR，不在本文件中声明为已通过。
