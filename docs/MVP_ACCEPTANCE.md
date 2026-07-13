# MVP Acceptance

状态：`通过`、`部分`、`未完成`、`不适用（当前 Mock）`。自动化列描述本分支完成后的覆盖目标。

| ID | 优先级 | 描述 | 当前状态 | 验证方式 | 自动化覆盖 | 负责人 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | P0 | 不同项目数据不得互相访问 | 未完成 | 权限集成测试 | 待真实权限层 | Backend | 当前只有 Mock projectId 过滤 |
| SEC-002 | P0 | 未认证用户不能访问真实项目数据 | 未完成 | 未登录访问测试 | 待认证实现 | Backend | 当前无正式登录 |
| SEC-003 | P0 | API Key 不进入浏览器 | 通过 | Bundle/源码扫描 | CI 密钥扫描建议 | AI Platform | 当前无真实 Key |
| SEC-004 | P0 | API Key 不进入 Git | 通过 | Git 与工作区扫描 | CI 可扩展 | DevOps | `.env*` 已忽略，示例无密钥 |
| SEC-005 | P0 | 客户文件不进入 Git | 通过 | Git 状态与忽略规则 | CI artifact 检查建议 | DevOps | Mock 上传不保存内容 |
| SEC-006 | P0 | AI 草稿不能直接覆盖正式数据 | 部分 | 审核流程与数据契约审查 | E2E 覆盖人工审核 | Product/Backend | Mock UI 已分离，真实写入未实现 |
| SEC-007 | P0 | 上传路径不能造成目录穿越 | 不适用（当前 Mock） | 上传 API 安全测试 | 待真实上传 | Backend/Security | 当前不写文件系统 |
| SEC-008 | P0 | 知识查询按 projectId 和权限过滤 | 部分 | 跨项目检索测试 | 待权限层 | Backend/AI | Mock 按 projectId，暂无权限过滤 |
| MVP-001 | P1 | 项目可以创建 | 部分 | 创建项目交互 | SSR/后续 E2E | Frontend | Mock 内存态，不持久化真实资料 |
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
| MVP-017 | P1 | 有审计记录 | 部分 | execution/review 日志 | 后续集成测试 | AI/Backend | 当前为 Mock execution log |
| MVP-018 | P1 | 主要流程有 Loading、Error、Retry | 通过 | 可恢复失败演示 | Workflow E2E | Frontend/AI | 本轮自动验证 |
| MVP-019 | P1 | Staging 可访问并 noindex | 本轮交付 | HTTP/页面/Nginx 检查 | 部署脚本 | DevOps | 独立目录、容器、端口、basePath |
| MVP-020 | P1 | Playwright 三条主流程通过 | 通过 | `npm run test:e2e` | Playwright | QA | 3/3 通过，捕获 console/page/network/500 |
| MVP-021 | P1 | Production build 通过 | 通过 | `npm run build` | CI | Frontend | vinext standalone |
| OPT-001 | P2 | 更高级搜索过滤 | 部分 | 页面检查 | SSR | Frontend | 已有基础过滤 |
| OPT-002 | P2 | 更完整统计指标 | 部分 | 数据看板检查 | SSR | Product | Mock 指标 |
| OPT-003 | P2 | 移动端适配 | 部分 | 多视口检查 | 后续 E2E | Frontend | 现有响应式基础 |
| OPT-004 | P2 | 更丰富视觉动效 | 未完成 | 视觉审查 | 无 | Design | 非 MVP 阻塞 |
| OPT-005 | P2 | 自动生成 Scope | 部分 | Scope 页面检查 | SSR | Product/AI | Mock |
| OPT-006 | P2 | 自动生成 Action Plan | 部分 | Action 页面检查 | 持久化 E2E | Product/AI | Mock |
| OPT-007 | P2 | 自动测试业务模块 | 未完成 | 产品能力验收 | 无 | Product | 本轮明确禁止 |
| OPT-008 | P2 | 原型和页面生成 | 未完成 | 产品能力验收 | 无 | Product | 本轮明确禁止 |

## 统计

- P0：8 条；通过 3，部分 2，未完成 2，不适用 1。
- P1：21 条；通过 5，部分 13，未完成 2，本轮交付 1。
- P2：8 条；部分 5，未完成 3。

P0 未完成项在真实试点前必须关闭；Mock 演示通过不代表真实能力通过。
