# MVP Acceptance

状态：`通过`、`部分`、`未完成`、`不适用（当前 Mock）`。自动化列描述本分支完成后的覆盖目标。

| ID | 优先级 | 描述 | 当前状态 | 验证方式 | 自动化覆盖 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | 不同项目数据不得互相访问 | 通过 | 20 条 PostgreSQL/权限集成测试 + E2E | Manager A/B 列表、统一 404、防 URL/body/memberId tamper、viewer 写入、混合角色逐项目审核权限 | Backend | 本地集成 20/20 与 E2E 11/11 已通过；Staging 仍是 v0.3 发布门禁 |
| SEC-002 | P0 | 未认证用户不能访问真实项目数据 | 通过 | 未登录 SSR/页面/API 测试 | SSR 4/4 与 E2E 未登录深层路由 | Backend | 本地 production build 与浏览器 Session 守卫已通过；Staging 另行验收 |
| SEC-003 | P0 | API Key 不进入浏览器 | 通过 | Bundle/源码扫描 | CI 密钥扫描建议 | AI Platform | 当前无真实 Key |
| SEC-004 | P0 | API Key 不进入 Git | 通过 | Git 与工作区扫描 | CI 可扩展 | DevOps | `.env*` 已忽略，示例无密钥 |
| SEC-005 | P0 | 客户文件不进入 Git | 通过 | Git 状态与忽略规则 | CI artifact 检查建议 | DevOps | Mock 上传不保存内容 |
| SEC-006 | P0 | AI 草稿不能直接覆盖正式数据 | 部分 | 审核流程与数据契约审查 | E2E 覆盖人工审核 | Product/Backend | Mock UI 已分离，真实写入未实现 |
| SEC-007 | P0 | 上传路径不能造成目录穿越 | 不适用（当前 Mock） | 上传 API 安全测试 | 待真实上传 | Backend/Security | 当前不写文件系统 |
| SEC-008 | P0 | 知识查询按 projectId 和权限过滤 | 部分 | 授权后服务端 Mock 映射与跨项目 E2E | 项目 API 隔离与 Mock payload 精确过滤已本地通过 | Backend/AI | 本轮 Mock 边界已验证；真实检索/RAG 不在本轮，不能承载客户资料 |
| MVP-001 | P1 | 项目可以创建 | 部分 | 创建项目 API/UI 与数据库检查 | 管理员持久化集成测试已通过；创建 UI 尚无专门 E2E | Frontend/Backend | PostgreSQL 持久化；当前只允许 system_admin 创建 |
| MVP-002 | P1 | 文件可以上传 | 部分 | 上传区交互 | 后续 E2E | Frontend | 仅文件元数据 Mock |
| MVP-003 | P1 | 文件上传后可以持久化 | 未完成 | 刷新与对象存储检查 | 待对象存储 | Backend | 本轮禁止接入存储 |
| MVP-004 | P1 | 文档可以解析 | 部分 | 解析状态与输出 | 后续 E2E | AI/Backend | 当前为 Mock 解析结果 |
| MVP-005 | P1 | 文档有状态和版本 | 部分 | 资料列表检查 | SSR | Product | 当前为 Mock 数据 |
| MVP-006 | P1 | 可以区分当前有效版本 | 部分 | 有效版本标识 | 知识 E2E | Product | 当前为 Mock 数据 |
| MVP-007 | P1 | 可以进行项目知识问答 | 部分 | 预设问题问答 | 知识 E2E | AI | Mock Knowledge Service |
| MVP-008 | P1 | 回答必须带来源 | 部分 | 回答引用断言 | 知识 E2E | AI/Product | Mock 引用 |
| MVP-009 | P1 | 来源含文件、章节、页码或片段 | 部分 | 来源详情断言 | 知识 E2E | AI/Product | Mock 引用元数据 |
| MVP-010 | P1 | AI 可以提取结构化需求 | 部分 | Workflow 完整执行 | Workflow E2E | AI | Mock AI Gateway |
| MVP-011 | P1 | 需求有来源证据 | 部分 | 审核来源区检查 | Workflow E2E | AI/Product | Mock 证据 |
| MVP-012 | P1 | 项目经理可以修改 AI 草稿 | 通过 | 审核文本编辑 | Workflow E2E | Frontend | 仅浏览器内状态 |
| MVP-013 | P1 | 可以提交审核 | 部分 | Workflow 进入审核中心 | Workflow E2E | Product | Mock 任务未持久化 |
| MVP-014 | P1 | 可以通过、修改后通过、驳回 | 通过 | 三类按钮状态 | Workflow E2E 覆盖修改后通过 | Frontend | Mock 状态 |
| MVP-015 | P1 | 审核通过后写入正式需求 | 未完成 | 数据层集成测试 | 待正式数据层 | Backend | UI 仅显示写入队列反馈 |
| MVP-016 | P1 | 正式需求与 AI 草稿状态分离 | 部分 | 契约与页面审查 | Workflow E2E | Product/Backend | Mock 分离，真实数据未实现 |
| MVP-017 | P1 | 有审计记录 | 部分 | 身份/项目审计集成测试 | 拒绝访问审计已通过集成测试 | AI/Backend | 登录、退出、项目/成员审计为 PostgreSQL；AI execution/review 仍为 Mock |
| MVP-018 | P1 | 主要流程有 Loading、Error、Retry | 通过 | 可恢复失败演示 | Workflow E2E | Frontend/AI | 本轮自动验证 |
| MVP-019 | P1 | Staging 可访问并 noindex | 部分 | v0.3 HTTP/页面/DB/Nginx 检查 | 部署脚本已扩展，部署运行待完成 | DevOps | 0.2 基线在线；不能代替 v0.3 独立 PostgreSQL 与认证验收 |
| MVP-020 | P1 | Playwright 产品与安全流程通过 | 通过 | `npm run test:e2e` | 身份/隔离及原三条流程 11/11 | QA | 本地首轮全绿，6/6 截图与 manifest 完整；CI 结果另列 v0.3 门禁 |
| MVP-021 | P1 | Production build 通过 | 通过 | `npm run build`（由 `npm test` 执行） | CI | Frontend | v0.3 本地 production build 与 SSR 4/4 已通过 |
| OPT-001 | P2 | 更高级搜索过滤 | 部分 | 页面检查 | SSR | Frontend | 已有基础过滤 |
| OPT-002 | P2 | 更完整统计指标 | 部分 | 数据看板检查 | SSR | Product | Mock 指标 |
| OPT-003 | P2 | 移动端适配 | 部分 | 多视口检查 | 后续 E2E | Frontend | 现有响应式基础 |
| OPT-004 | P2 | 更丰富视觉动效 | 未完成 | 视觉审查 | 无 | Design | 非 MVP 阻塞 |
| OPT-005 | P2 | 自动生成 Scope | 部分 | Scope 页面检查 | SSR | Product/AI | Mock |
| OPT-006 | P2 | 自动生成 Action Plan | 部分 | Action 页面检查 | 持久化 E2E | Product/AI | Mock |
| OPT-007 | P2 | 自动测试业务模块 | 未完成 | 产品能力验收 | 无 | Product | 本轮明确禁止 |
| OPT-008 | P2 | 原型和页面生成 | 未完成 | 产品能力验收 | 无 | Product | 本轮明确禁止 |

## v0.3 交付门禁

下表用于跟踪 Identity and Project Isolation 本轮交付，不改变上方长期 MVP 统计。`部分` 表示代码或测试已存在，但本分支全部运行证据尚未闭环。

| ID | 描述 | 当前状态 | 已有证据 | 关闭条件 |
| --- | --- | --- | --- | --- |
| V03-IDENT-001 | Better Auth 登录/退出、端点白名单、无公共注册、disabled 拒绝/撤销、token 最小响应、通用错误、数据库限流与写请求 Origin/JSON 边界 | 部分 | 本地集成 20/20（含恶意 Origin/媒体类型）、build/SSR 与 E2E 11/11 已通过 | Staging 登录矩阵与 GitHub CI 全部通过 |
| V03-SESSION-001 | PostgreSQL Session、刷新保持、退出撤销、HttpOnly/SameSite/Secure/Path Cookie | 部分 | DB/Cookie、token/no-store 集成通过；浏览器刷新/退出通过 | Staging Secure/Path 验证通过 |
| V03-DATA-001 | PostgreSQL Schema、提交 Migration、幂等 Seed、受保护测试 Reset | 部分 | 本地空库连续两次 Reset/Migration/Seed、第三次 Seed 幂等，约束测试通过 | CI 从空 PostgreSQL 完整执行并保存结果 |
| V03-AUTHZ-001 | 系统/项目角色、集中授权、404 防枚举、viewer 服务端只读、混合角色逐项目审核权限 | 部分 | 本地集成 20/20、跨项目/Viewer E2E 与 6 张审查截图通过 | Staging 角色矩阵与 GitHub CI 全部通过 |
| V03-AUDIT-001 | 身份/项目审计、mutation 同事务与敏感 metadata 清理 | 部分 | 拒绝审计、项目/成员事务和嵌套敏感 metadata 脱敏已在 20/20 集成套件通过 | Staging 管理员只读查询验证通过 |
| V03-CI-001 | CI PostgreSQL 及成功/失败产品审查 artifacts | 部分 | Workflow、6 张截图用例和 manifest 脚本已实现 | Draft PR CI 成功且 artifact 内容完整、无 Secret |
| V03-STAGING-001 | 独立私网 PostgreSQL、受控 Migration/Seed、应用/数据库 Healthy 与 Production 不变 | 部分 | Compose 与部署验证脚本已实现 | v0.3 Staging 部署、身份边界、备份/回滚与 Production 回归证据完成 |

## 统计

- P0：8 条；通过 5，部分 2，未完成 0，不适用 1。
- P1：21 条；通过 5，部分 14，未完成 2。
- P2：8 条；部分 5，未完成 3。

以上 P0/P1/P2 统计只计算第一张长期 MVP 表，不计算 v0.3 交付门禁。当前本地证据为 PostgreSQL/权限集成 20/20、SSR 4/4、E2E 11/11 和 6/6 审查截图；GitHub CI 与 Staging 仍在 `MVP_STATUS.md` 中单独跟踪。P0 部分项在真实试点前必须关闭；Mock 演示通过不代表真实能力通过。
