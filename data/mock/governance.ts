import type {
  Decision,
  Meeting,
  ReviewTask,
  Workflow,
  WorkflowExecution,
} from "@/types";

export const mockMeetings: Meeting[] = [
  {
    id: "meeting-001", projectId: "project-001", version: 2, sourceIds: ["doc-meeting-001"], title: "北美旗舰店项目启动会", startAt: "2026-05-12T09:30:00+08:00", durationMinutes: 90, participants: ["林夏", "周逸", "客户品牌负责人", "客户 IT 负责人"], type: "kickoff", rawNotes: "确认首期单店上线、项目沟通机制和原始资料交付计划。", aiSummary: "项目以 8 月底单店上线为目标，所有正式范围变更需项目委员会确认。", decisionIds: ["decision-001", "decision-002"], requirementIds: ["req-004"], scopeChangeIds: [], actionItemIds: [], riskIds: [], openQuestions: [], reviewStatus: "approved", createdAt: "2026-05-12T09:30:00+08:00", updatedAt: "2026-05-12T15:00:00+08:00", createdBy: "林夏",
  },
  {
    id: "meeting-002", projectId: "project-001", version: 2, sourceIds: ["doc-meeting-002"], title: "品牌安全与隐私评审", startAt: "2026-06-24T14:00:00+08:00", durationMinutes: 60, participants: ["林夏", "陈墨", "客户法务", "客户信息安全"], type: "internalReview", rawNotes: "讨论生成内容校验、人脸数据、日志保留与审计字段。", aiSummary: "确认不采集人脸特征，所有对客生成结果必须经过安全词校验，日志仅记录匿名执行信息。", decisionIds: ["decision-003", "decision-004"], requirementIds: ["req-002", "req-004", "req-008"], scopeChangeIds: [], actionItemIds: ["action-003"], riskIds: [], openQuestions: ["审计日志在线保留期限由客户信息安全后续确认。"], reviewStatus: "approvedWithChanges", createdAt: "2026-06-24T14:00:00+08:00", updatedAt: "2026-06-25T10:00:00+08:00", createdBy: "林夏",
  },
  {
    id: "meeting-003", projectId: "project-001", version: 1, sourceIds: ["doc-003"], title: "北美旗舰店客户周会（7 月 8 日）", startAt: "2026-07-08T16:00:00+08:00", durationMinutes: 55, participants: ["林夏", "周逸", "客户北美市场团队", "客户品牌团队"], type: "weeklySync", rawNotes: "确认 Scope v1.3 内容；上线日不变；授权清单和西班牙语文案需加速。", aiSummary: "会议确认新增西班牙语与弱网兜底，不调整 8 月 28 日上线；授权和译文复核是本周关键路径。", decisionIds: ["decision-005", "decision-006", "decision-007"], requirementIds: ["req-001", "req-003"], scopeChangeIds: ["scope-change-001", "scope-change-002", "scope-change-004"], actionItemIds: ["action-001", "action-002"], riskIds: ["risk-001"], openQuestions: ["西班牙语语音是否纳入首期？"], reviewStatus: "pendingReview", createdAt: "2026-07-08T16:00:00+08:00", updatedAt: "2026-07-08T17:55:00+08:00", createdBy: "AI 助手",
  },
  {
    id: "meeting-004", projectId: "project-003", version: 1, sourceIds: ["doc-007"], title: "会员积分迁移风险评审", startAt: "2026-07-11T10:00:00+08:00", durationMinutes: 45, participants: ["林夏", "梁柯", "徐苏", "客户会员运营"], type: "riskReview", rawNotes: "复盘第二轮迁移 0.7% 差异，确定先修状态映射再做全量演练。", aiSummary: "冻结积分映射是主要原因，修正完成前不进入业务验收。", decisionIds: ["decision-008"], requirementIds: ["req-014"], scopeChangeIds: [], actionItemIds: ["action-009", "action-010", "action-011"], riskIds: ["risk-003"], openQuestions: ["历史异常账户是否需要单独客户通知？"], reviewStatus: "pendingReview", createdAt: "2026-07-11T10:00:00+08:00", updatedAt: "2026-07-11T11:00:00+08:00", createdBy: "AI 助手",
  },
  {
    id: "meeting-005", projectId: "project-007", version: 1, sourceIds: ["doc-012"], title: "CRM 指标口径工作坊", startAt: "2026-07-07T14:00:00+08:00", durationMinutes: 120, participants: ["林夏", "秦雅", "客户销售负责人", "客户财务负责人"], type: "clientWorkshop", rawNotes: "逐项确认漏斗、销售额和客户健康度指标，销售额归属月份未达成一致。", aiSummary: "多数指标已确认，销售额归属口径仍存在直接冲突，需要业务负责人决策。", decisionIds: ["decision-009"], requirementIds: ["req-025", "req-026", "req-027"], scopeChangeIds: [], actionItemIds: ["action-018"], riskIds: ["risk-007"], openQuestions: ["销售额按机会创建月还是首次回款月归属？"], reviewStatus: "pendingReview", createdAt: "2026-07-07T14:00:00+08:00", updatedAt: "2026-07-07T17:00:00+08:00", createdBy: "AI 助手",
  },
  {
    id: "meeting-006", projectId: "project-008", version: 1, sourceIds: ["doc-015"], title: "全球素材平台区域访谈复盘", startAt: "2026-07-08T10:00:00+08:00", durationMinutes: 75, participants: ["赵琦", "秦雅", "欧洲市场负责人", "亚太市场负责人"], type: "clientWorkshop", rawNotes: "欧洲团队强调授权到期，亚太团队强调本地化衍生版本关系。", aiSummary: "首期需优先解决授权提醒、下载权限过滤和全球母版关联。", decisionIds: ["decision-010"], requirementIds: ["req-028", "req-029", "req-030"], scopeChangeIds: [], actionItemIds: ["action-019", "action-020"], riskIds: ["risk-008"], openQuestions: ["代理商用户是否继承区域团队权限？"], reviewStatus: "generated", createdAt: "2026-07-08T10:00:00+08:00", updatedAt: "2026-07-08T11:25:00+08:00", createdBy: "AI 助手",
  },
];

export const mockDecisions: Decision[] = [
  ["decision-001", "project-001", "meeting-001", "首期仅在纽约旗舰店部署", "先验证单店业务价值与运维稳定性，再决定复制计划。", "降低跨门店设备与网络差异风险。", ["客户品牌负责人"], "2026-05-12T10:20:00+08:00", ["req-004"], ["scope-001"]],
  ["decision-002", "project-001", "meeting-001", "正式范围变更需项目委员会批准", "AI 识别的变更只形成草稿，不直接写入正式 Scope。", "确保对外承诺可审计。", ["林夏", "客户品牌负责人"], "2026-05-12T10:30:00+08:00", [], ["scope-001"]],
  ["decision-003", "project-001", "meeting-002", "不采集人脸特征", "系统不存储原始照片和任何生物特征，仅记录匿名互动事件。", "满足北美隐私合规原则。", ["客户法务", "客户信息安全"], "2026-06-24T14:35:00+08:00", ["req-004"], ["scope-003"]],
  ["decision-004", "project-001", "meeting-002", "生成内容先校验后展示", "所有面向顾客的 AI 输出必须通过品牌安全词服务。", "避免不符合品牌规范的内容曝光。", ["客户法务", "林夏"], "2026-06-24T14:50:00+08:00", ["req-002"], ["scope-003"]],
  ["decision-005", "project-001", "meeting-003", "Scope v1.3 纳入西班牙语", "首期互动流程支持英语与西班牙语文本。", "纽约门店西语客群占比较高。", ["客户北美市场团队"], "2026-07-08T16:20:00+08:00", ["req-001"], ["scope-004"]],
  ["decision-006", "project-001", "meeting-003", "增加弱网静态兜底", "在线请求超时五秒后自动进入静态问答。", "门店网络高峰时段存在波动。", ["林夏", "客户品牌团队"], "2026-07-08T16:35:00+08:00", ["req-003"], ["scope-004"]],
  ["decision-007", "project-001", "meeting-003", "上线日期保持不变", "项目仍以 2026 年 8 月 28 日为正式上线日期。", "新增范围通过并行执行吸收。", ["客户品牌负责人"], "2026-07-08T16:45:00+08:00", [], ["scope-004"]],
  ["decision-008", "project-003", "meeting-004", "第三轮迁移前冻结业务验收", "修正冻结积分映射并通过全量演练后再进入业务验收。", "余额差异属于上线阻断项。", ["客户会员运营", "林夏"], "2026-07-11T10:30:00+08:00", ["req-014"], []],
  ["decision-009", "project-007", "meeting-005", "客户健康度权重由管理员配置", "各业务线可以配置指标权重，但基础指标定义保持一致。", "兼顾统一治理和业务差异。", ["客户销售负责人", "秦雅"], "2026-07-07T16:10:00+08:00", ["req-027"], []],
  ["decision-010", "project-008", "meeting-006", "授权到期提醒纳入首期", "平台在到期前 30、14、7 天触发站内提醒。", "这是欧洲市场最高优先级痛点。", ["欧洲市场负责人", "赵琦"], "2026-07-08T10:50:00+08:00", ["req-028"], []],
].map(([id, projectId, meetingId, title, content, rationale, decidedBy, decidedAt, relatedRequirementIds, relatedScopeIds], index) => ({
  id: id as string,
  projectId: projectId as string,
  meetingId: meetingId as string,
  decisionId: `DEC-${String(index + 1).padStart(3, "0")}`,
  title: title as string,
  content: content as string,
  rationale: rationale as string,
  decidedBy: decidedBy as string[],
  decidedAt: decidedAt as string,
  status: "confirmed" as const,
  relatedRequirementIds: relatedRequirementIds as string[],
  relatedScopeIds: relatedScopeIds as string[],
  version: 1,
  sourceIds: [meetingId as string],
  createdAt: decidedAt as string,
  updatedAt: decidedAt as string,
  createdBy: (decidedBy as string[])[0] ?? "项目委员会",
}));

export const mockReviewTasks: ReviewTask[] = [
  { id: "review-001", projectId: "project-001", type: "requirementExtraction", title: "客户需求确认稿 v1.3 · 需求提取", status: "pendingReview", generatedContent: "新增 8 条结构化需求，其中西班牙语互动和弱网兜底属于新增 Scope。", editableContent: "新增 8 条结构化需求，其中西班牙语互动和弱网兜底属于新增 Scope。", changeSummary: ["新增 REQ-001 西班牙语互动", "新增 REQ-003 弱网静态兜底", "识别 1 个待确认问题"], sourceIds: ["doc-001", "doc-002"], citationIds: ["citation-001", "citation-003"], skillId: "requirement-extraction", modelProfileId: "requirement-analysis", aiExecutionId: "ai-exec-001", confidence: 0.92, assignee: "林夏", version: 1, createdAt: "2026-07-12T10:20:00+08:00", updatedAt: "2026-07-12T10:20:00+08:00", createdBy: "AI 助手" },
  { id: "review-002", projectId: "project-001", type: "scopeChange", title: "Scope v1.2 → v1.3 变更分析", status: "pendingReview", generatedContent: "新增 2 项、修改 1 项、待确认 1 项，预计增加 9 人日，当前推断不影响上线日期。", editableContent: "新增 2 项、修改 1 项、待确认 1 项，预计增加 9 人日；需在 7 月 18 日前确认西班牙语语音范围。", changeSummary: ["新增 9 人日", "影响 3 个任务", "可能影响门店验收里程碑"], sourceIds: ["scope-003", "scope-004"], citationIds: ["citation-001", "citation-002"], skillId: "scope-diff", modelProfileId: "scope-comparison", aiExecutionId: "ai-exec-002", confidence: 0.9, assignee: "林夏", version: 1, createdAt: "2026-07-11T18:10:00+08:00", updatedAt: "2026-07-12T09:00:00+08:00", createdBy: "AI 助手" },
  { id: "review-003", projectId: "project-003", type: "projectRisk", title: "积分迁移风险升级建议", status: "pendingReview", generatedContent: "建议将积分迁移风险从高升级为严重风险，并在修正前冻结业务验收。", editableContent: "建议将积分迁移风险升级为严重风险，并在第三轮全量演练通过前冻结业务验收。", changeSummary: ["风险等级 high → critical", "新增阻断条件"], sourceIds: ["doc-007"], citationIds: ["citation-010"], skillId: "project-risk-analysis", modelProfileId: "risk-analysis", aiExecutionId: "ai-exec-003", confidence: 0.94, assignee: "林夏", version: 1, createdAt: "2026-07-12T09:10:00+08:00", updatedAt: "2026-07-12T09:10:00+08:00", createdBy: "AI 助手" },
  { id: "review-004", projectId: "project-001", type: "actionPlan", title: "Scope v1.3 Action Plan", status: "generated", generatedContent: "生成 6 项 Action，覆盖翻译、安全词联调、弱网测试和埋点更新。", editableContent: "生成 6 项 Action，覆盖翻译、安全词联调、弱网测试和埋点更新。", changeSummary: ["新增 6 项 Action", "2 项 P0", "1 项已逾期"], sourceIds: ["scope-004", "meeting-003"], citationIds: ["citation-005", "citation-006"], skillId: "action-plan-extraction", modelProfileId: "action-plan-generation", aiExecutionId: "ai-exec-004", confidence: 0.89, assignee: "林夏", version: 1, createdAt: "2026-07-11T18:25:00+08:00", updatedAt: "2026-07-11T18:25:00+08:00", createdBy: "AI 助手" },
  { id: "review-005", projectId: "project-001", type: "meetingMinutes", title: "7 月 8 日客户周会 · 会议决策", status: "pendingReview", generatedContent: "会议确认三项决策：西班牙语纳入首期、增加弱网兜底、上线日期保持不变。", editableContent: "会议确认三项决策：西班牙语文本纳入首期、增加弱网兜底、上线日期保持不变；西班牙语语音待确认。", changeSummary: ["新增 3 项决策", "新增 2 项 Action", "新增 1 个待确认问题"], sourceIds: ["doc-003"], citationIds: ["citation-005", "citation-006"], skillId: "meeting-summary", modelProfileId: "fast-summary", aiExecutionId: "ai-exec-005", confidence: 0.93, assignee: "林夏", version: 1, createdAt: "2026-07-08T17:55:00+08:00", updatedAt: "2026-07-08T17:55:00+08:00", createdBy: "AI 助手" },
  { id: "review-006", projectId: "project-002", type: "weeklyReport", title: "品牌官网项目周报 · W28", status: "approvedWithChanges", generatedContent: "项目整体健康，内容迁移完成 62%，日语内容进度偏低。", editableContent: "项目整体健康，内容迁移完成 62%；日语商品故事仅完成 41%，需在下周作为重点跟进。", changeSummary: ["补充日语内容具体进度", "明确下周重点"], sourceIds: ["doc-004", "doc-005"], citationIds: ["citation-007", "citation-008"], skillId: "weekly-status-report", modelProfileId: "fast-summary", aiExecutionId: "ai-exec-006", confidence: 0.88, assignee: "赵琦", reviewNote: "数据准确，补充了日语内容风险。", reviewedAt: "2026-07-11T17:20:00+08:00", reviewedBy: "赵琦", version: 2, createdAt: "2026-07-11T16:30:00+08:00", updatedAt: "2026-07-11T17:20:00+08:00", createdBy: "AI 助手" },
  { id: "review-007", projectId: "project-007", type: "requirementExtraction", title: "CRM 指标口径 · 冲突需求", status: "pendingReview", generatedContent: "识别到销售额归属月份的两条直接冲突需求，需要业务负责人决策。", editableContent: "识别到销售额按机会创建月与首次回款月归属的直接冲突，需要业务负责人在口径冻结前决策。", changeSummary: ["标记 REQ-025 与 REQ-026 冲突", "新增 1 个待确认问题"], sourceIds: ["doc-012"], citationIds: ["citation-015"], skillId: "requirement-deduplication", modelProfileId: "requirement-analysis", aiExecutionId: "ai-exec-007", confidence: 0.97, assignee: "林夏", version: 1, createdAt: "2026-07-09T16:45:00+08:00", updatedAt: "2026-07-09T16:45:00+08:00", createdBy: "AI 助手" },
  { id: "review-008", projectId: "project-008", type: "projectSummary", title: "全球素材平台 · 项目背景摘要", status: "generated", generatedContent: "项目旨在统一全球素材的版本、授权和分发，首期核心问题为授权到期、区域下载权限和衍生版本关联。", editableContent: "项目旨在统一全球素材的版本、授权和分发，首期核心问题为授权到期、区域下载权限和衍生版本关联。", changeSummary: ["提炼 3 个核心问题", "引用 2 份区域访谈资料"], sourceIds: ["doc-014", "doc-015"], citationIds: ["citation-017", "citation-018", "citation-019"], skillId: "project-document-summary", modelProfileId: "fast-summary", aiExecutionId: "ai-exec-008", confidence: 0.91, assignee: "赵琦", version: 1, createdAt: "2026-07-08T11:25:00+08:00", updatedAt: "2026-07-08T11:25:00+08:00", createdBy: "AI 助手" },
];

const requirementWorkflowSteps = [
  ["wf-step-01", "选择项目资料", "选择需要参与提取的当前有效资料"],
  ["wf-step-02", "文档解析", "解析正文、表格与基础元数据"],
  ["wf-step-03", "内容分类", "区分需求、决策、约束和背景信息"],
  ["wf-step-04", "AI 提取需求", "生成结构化需求草稿"],
  ["wf-step-05", "识别重复需求", "与当前需求中心进行语义比对"],
  ["wf-step-06", "识别冲突需求", "定位规则、范围与时间冲突"],
  ["wf-step-07", "生成待确认问题", "为不完整或矛盾信息生成问题"],
  ["wf-step-08", "生成验收标准", "为每条需求补充可验证的验收条件"],
  ["wf-step-09", "生成来源引用", "绑定文档章节、页码和引用片段"],
  ["wf-step-10", "进入人工审核", "正式写入前由项目经理审核"],
  ["wf-step-11", "写入需求中心", "仅写入已通过的正式需求"],
].map(([id, name, description], index) => ({ id, name, description, order: index + 1, skillId: index >= 3 && index <= 8 ? "requirement-extraction" : undefined }));

export const mockWorkflows: Workflow[] = [
  { id: "workflow-requirement-extraction", name: "requirement-extraction-workflow", displayName: "AI 需求提取", description: "从项目资料提取、去重、识别冲突并生成人工审核任务。", status: "active", skillIds: ["requirement-extraction", "requirement-deduplication", "requirement-clarification"], steps: requirementWorkflowSteps, approvalRequired: true, createdAt: "2026-01-05T09:00:00+08:00", updatedAt: "2026-07-01T09:00:00+08:00", createdBy: "AI 平台组" },
  { id: "workflow-meeting-processing", name: "meeting-processing-workflow", displayName: "会议纪要处理", description: "提炼会议摘要、决策、需求、Action 与风险。", status: "active", skillIds: ["meeting-summary", "requirement-extraction", "action-plan-extraction", "project-risk-analysis"], steps: [{ id: "meeting-step-1", name: "解析会议记录", description: "识别发言与议题", order: 1 }, { id: "meeting-step-2", name: "提取结构化信息", description: "提取决策、需求、Action 与风险", order: 2 }, { id: "meeting-step-3", name: "人工审核", description: "审核后写入正式数据", order: 3 }], approvalRequired: true, createdAt: "2026-02-05T09:00:00+08:00", updatedAt: "2026-06-20T09:00:00+08:00", createdBy: "AI 平台组" },
  { id: "workflow-weekly-report", name: "weekly-status-report-workflow", displayName: "项目周报生成", description: "汇总本周进展、风险、决策和下周计划。", status: "active", skillIds: ["weekly-status-report", "project-risk-analysis"], steps: [{ id: "weekly-step-1", name: "聚合本周变化", description: "读取当前有效项目数据", order: 1 }, { id: "weekly-step-2", name: "生成周报草稿", description: "生成可编辑周报", order: 2 }, { id: "weekly-step-3", name: "人工审核", description: "审核后发布", order: 3 }], approvalRequired: true, createdAt: "2026-03-05T09:00:00+08:00", updatedAt: "2026-07-02T09:00:00+08:00", createdBy: "AI 平台组" },
];

export const mockWorkflowExecutions: WorkflowExecution[] = [
  {
    id: "workflow-execution-001", projectId: "project-001", version: 1, sourceIds: ["doc-001", "doc-002"], workflowId: "workflow-requirement-extraction", status: "completed", steps: requirementWorkflowSteps.map((step) => ({ ...step, status: "completed" as const })), currentStepId: "wf-step-11", inputDocumentIds: ["doc-001", "doc-002"], processedDocumentIds: ["doc-001", "doc-002"], extractedRequirementCount: 8, duplicateCount: 1, conflictCount: 0, pendingQuestionCount: 1, startedAt: "2026-07-12T10:18:12+08:00", completedAt: "2026-07-12T10:20:00+08:00", durationMs: 108000, modelProfileId: "requirement-analysis", skillIds: ["requirement-extraction", "requirement-deduplication", "requirement-clarification"], executionLogIds: ["ai-exec-001"], createdAt: "2026-07-12T10:18:12+08:00", updatedAt: "2026-07-12T10:20:00+08:00", createdBy: "林夏",
  },
];
