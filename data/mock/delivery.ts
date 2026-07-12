import type {
  ActionItem,
  ActionItemStatus,
  Priority,
  Risk,
  RiskLevel,
  RiskStatus,
  RiskType,
  ScopeChange,
  ScopeVersion,
} from "@/types";

export const mockScopeVersions: ScopeVersion[] = [
  {
    id: "scope-001",
    projectId: "project-001",
    version: 1,
    versionLabel: "v1.0",
    sourceIds: ["doc-scope-original"],
    name: "北美旗舰店项目 Scope v1.0",
    status: "superseded",
    summary: "首版范围，包含英文 AI 互动主流程、结果展示与匿名数据采集。",
    content: ["英文 AI 互动主流程", "门店大屏结果展示", "匿名互动事件采集", "纽约旗舰店单店部署"],
    requirementIds: ["req-002", "req-004", "req-005", "req-008"],
    approvedBy: "客户项目委员会",
    approvedAt: "2026-05-18T16:00:00+08:00",
    effectiveFrom: "2026-05-19",
    estimatedPersonDays: 86,
    createdAt: "2026-05-12T09:00:00+08:00",
    updatedAt: "2026-05-19T09:00:00+08:00",
    createdBy: "林夏",
  },
  {
    id: "scope-002",
    projectId: "project-001",
    version: 2,
    versionLabel: "v1.1",
    sourceIds: ["doc-scope-v11", "meeting-001"],
    name: "北美旗舰店项目 Scope v1.1",
    status: "superseded",
    summary: "增加扫码带走结果和运营主题库配置，移除自由提示词输入。",
    content: ["英文 AI 互动主流程", "门店大屏结果展示", "一次性二维码结果页", "审核主题库配置", "匿名互动事件采集"],
    requirementIds: ["req-002", "req-004", "req-005", "req-006", "req-008"],
    approvedBy: "客户项目委员会",
    approvedAt: "2026-06-06T14:00:00+08:00",
    effectiveFrom: "2026-06-07",
    supersedes: "scope-001",
    estimatedPersonDays: 94,
    createdAt: "2026-06-02T10:00:00+08:00",
    updatedAt: "2026-06-07T09:00:00+08:00",
    createdBy: "林夏",
  },
  {
    id: "scope-003",
    projectId: "project-001",
    version: 3,
    versionLabel: "v1.2",
    sourceIds: ["doc-scope-v12", "meeting-002"],
    name: "北美旗舰店项目 Scope v1.2",
    status: "superseded",
    summary: "纳入品牌安全词校验、隐私审计和 WCAG AA 适配。",
    content: ["英文 AI 互动主流程", "品牌安全词校验", "扫码结果页", "审核主题库配置", "隐私审计日志", "WCAG AA 适配"],
    requirementIds: ["req-002", "req-004", "req-005", "req-006", "req-007", "req-008"],
    approvedBy: "客户项目委员会",
    approvedAt: "2026-06-26T15:30:00+08:00",
    effectiveFrom: "2026-06-27",
    supersedes: "scope-002",
    estimatedPersonDays: 103,
    createdAt: "2026-06-21T09:30:00+08:00",
    updatedAt: "2026-06-27T09:00:00+08:00",
    createdBy: "林夏",
  },
  {
    id: "scope-004",
    projectId: "project-001",
    version: 4,
    versionLabel: "v1.3",
    sourceIds: ["doc-001", "doc-002", "meeting-003"],
    name: "北美旗舰店项目 Scope v1.3",
    status: "active",
    summary: "当前有效版本，新增西班牙语互动与弱网静态兜底，保持 8 月 28 日上线窗口。",
    content: ["英语与西班牙语 AI 互动流程", "品牌安全词校验", "弱网静态互动兜底", "扫码结果页", "审核主题库配置", "隐私审计日志", "WCAG AA 适配"],
    requirementIds: ["req-001", "req-002", "req-003", "req-004", "req-005", "req-006", "req-007", "req-008"],
    approvedBy: "客户项目委员会",
    approvedAt: "2026-07-10T16:20:00+08:00",
    effectiveFrom: "2026-07-11",
    supersedes: "scope-003",
    estimatedPersonDays: 112,
    createdAt: "2026-07-08T09:00:00+08:00",
    updatedAt: "2026-07-11T09:00:00+08:00",
    createdBy: "林夏",
  },
];

export const mockScopeChanges: ScopeChange[] = [
  { id: "scope-change-001", projectId: "project-001", fromScopeVersionId: "scope-003", toScopeVersionId: "scope-004", type: "added", title: "新增西班牙语互动", description: "全流程新增西班牙语文案、语音与埋点标签。", after: "英语与西班牙语 AI 互动流程", impactDays: 5, requirementIds: ["req-001"], affectedTaskIds: ["action-002", "action-004"], affectedMilestoneIds: ["milestone-002"], affectsLaunchDate: false, pendingQuestions: [], riskSuggestion: "安排北美市场与法务并行复核译文。", status: "confirmed", version: 1, sourceIds: ["doc-001", "doc-002"], createdAt: "2026-07-08T09:00:00+08:00", updatedAt: "2026-07-10T16:20:00+08:00", createdBy: "AI 助手" },
  { id: "scope-change-002", projectId: "project-001", fromScopeVersionId: "scope-003", toScopeVersionId: "scope-004", type: "added", title: "新增弱网静态兜底", description: "在线服务超时 5 秒后进入静态问答。", after: "弱网静态互动兜底", impactDays: 4, requirementIds: ["req-003"], affectedTaskIds: ["action-005"], affectedMilestoneIds: ["milestone-002"], affectsLaunchDate: false, pendingQuestions: ["静态素材是否需要按语言分别维护？"], riskSuggestion: "在门店验收前完成限速与断网测试。", status: "confirmed", version: 1, sourceIds: ["doc-001", "doc-002"], createdAt: "2026-07-08T09:00:00+08:00", updatedAt: "2026-07-10T16:20:00+08:00", createdBy: "AI 助手" },
  { id: "scope-change-003", projectId: "project-001", fromScopeVersionId: "scope-003", toScopeVersionId: "scope-004", type: "modified", title: "语言选择埋点调整", description: "语言从固定英文改为记录顾客匿名选择。", before: "默认英文，无语言字段", after: "记录 EN/ES 匿名语言标签", impactDays: 1, requirementIds: ["req-001"], affectedTaskIds: ["action-006"], affectedMilestoneIds: [], affectsLaunchDate: false, pendingQuestions: [], status: "confirmed", version: 1, sourceIds: ["doc-002"], createdAt: "2026-07-08T09:00:00+08:00", updatedAt: "2026-07-10T16:20:00+08:00", createdBy: "AI 助手" },
  { id: "scope-change-004", projectId: "project-001", fromScopeVersionId: "scope-003", toScopeVersionId: "scope-004", type: "pending", title: "西班牙语语音是否纳入首期", description: "当前仅确认西班牙语文本，语音播报仍待客户确认。", impactDays: 3, requirementIds: ["req-001"], affectedTaskIds: [], affectedMilestoneIds: ["milestone-003"], affectsLaunchDate: true, pendingQuestions: ["是否必须在首期提供西班牙语语音？"], riskSuggestion: "若 7 月 18 日前未确认，建议首期仅交付文本。", status: "pendingReview", version: 1, sourceIds: ["doc-003"], createdAt: "2026-07-08T18:00:00+08:00", updatedAt: "2026-07-08T18:00:00+08:00", createdBy: "AI 助手" },
];

interface ActionSeed {
  projectId: string;
  title: string;
  owner: string;
  dueDate: string;
  status: ActionItemStatus;
  priority: Priority;
  source: string;
  requirementIds?: string[];
  meetingIds?: string[];
  riskIds?: string[];
  blockerIds?: string[];
}

const actionSeeds: ActionSeed[] = [
  { projectId: "project-001", title: "完成西班牙语 UI 文案复核", owner: "客户北美市场团队", dueDate: "2026-07-15", status: "inProgress", priority: "P0", source: "7 月 8 日客户周会", requirementIds: ["req-001"], meetingIds: ["meeting-003"] },
  { projectId: "project-001", title: "提交剩余 12 项素材授权证明", owner: "客户品牌团队", dueDate: "2026-07-18", status: "blocked", priority: "P0", source: "素材授权清单", riskIds: ["risk-001"], meetingIds: ["meeting-003"] },
  { projectId: "project-001", title: "完成品牌安全词接口联调", owner: "陈墨", dueDate: "2026-07-17", status: "inProgress", priority: "P0", source: "技术方案评审", requirementIds: ["req-002"] },
  { projectId: "project-001", title: "补齐西班牙语异常状态设计", owner: "何静", dueDate: "2026-07-16", status: "todo", priority: "P1", source: "Scope v1.3 影响分析", requirementIds: ["req-001"] },
  { projectId: "project-001", title: "执行门店弱网与断网测试", owner: "徐苏", dueDate: "2026-07-23", status: "todo", priority: "P0", source: "Scope v1.3", requirementIds: ["req-003"], riskIds: ["risk-002"] },
  { projectId: "project-001", title: "更新语言选择埋点字典", owner: "周逸", dueDate: "2026-07-14", status: "overdue", priority: "P1", source: "需求 REQ-001", requirementIds: ["req-001"] },
  { projectId: "project-002", title: "完成日语商品故事迁移", owner: "客户内容团队", dueDate: "2026-07-25", status: "inProgress", priority: "P1", source: "内容迁移清单", requirementIds: ["req-010"] },
  { projectId: "project-002", title: "验证 PIM 下架状态同步", owner: "陈墨", dueDate: "2026-07-19", status: "todo", priority: "P0", source: "集成测试计划", requirementIds: ["req-012"] },
  { projectId: "project-003", title: "修正冻结积分状态映射", owner: "梁柯", dueDate: "2026-07-16", status: "inProgress", priority: "P0", source: "迁移报告 R2", requirementIds: ["req-014"], riskIds: ["risk-003"] },
  { projectId: "project-003", title: "确认差异账户修正规则", owner: "客户会员运营", dueDate: "2026-07-15", status: "blocked", priority: "P0", source: "迁移风险评审", riskIds: ["risk-003"], blockerIds: ["action-009"] },
  { projectId: "project-003", title: "执行第三轮全量迁移演练", owner: "徐苏", dueDate: "2026-07-22", status: "todo", priority: "P0", source: "迁移计划", requirementIds: ["req-014"] },
  { projectId: "project-004", title: "补充服饰类构图一致性样本", owner: "周逸", dueDate: "2026-07-17", status: "inProgress", priority: "P1", source: "灰度运营反馈", requirementIds: ["req-016"] },
  { projectId: "project-004", title: "校准生成质量评分阈值", owner: "梁柯", dueDate: "2026-07-20", status: "todo", priority: "P1", source: "AI 策略评审", requirementIds: ["req-017"] },
  { projectId: "project-005", title: "完成巴西节点资源分片优化", owner: "陈墨", dueDate: "2026-07-16", status: "inProgress", priority: "P0", source: "性能报告 R2", requirementIds: ["req-019"], riskIds: ["risk-005"] },
  { projectId: "project-005", title: "复测南美低端安卓设备", owner: "赵琦", dueDate: "2026-07-18", status: "todo", priority: "P1", source: "全球节点压测", requirementIds: ["req-021"] },
  { projectId: "project-006", title: "确认全部旧款平板设备清单", owner: "客户门店 IT", dueDate: "2026-07-12", status: "overdue", priority: "P0", source: "兼容性测试报告", riskIds: ["risk-006"] },
  { projectId: "project-006", title: "评估轻量 AR 模式视觉差异", owner: "何静", dueDate: "2026-07-18", status: "inProgress", priority: "P1", source: "兼容方案评审", requirementIds: ["req-022"] },
  { projectId: "project-007", title: "组织销售额归属口径决策会", owner: "林夏", dueDate: "2026-07-15", status: "todo", priority: "P0", source: "指标口径工作坊", requirementIds: ["req-025", "req-026"], riskIds: ["risk-007"] },
  { projectId: "project-008", title: "补充欧洲素材授权提醒规则", owner: "赵琦", dueDate: "2026-07-21", status: "todo", priority: "P1", source: "欧洲市场访谈", requirementIds: ["req-028"] },
  { projectId: "project-008", title: "确认地区衍生版本继承边界", owner: "秦雅", dueDate: "2026-07-24", status: "todo", priority: "P1", source: "亚太市场访谈", requirementIds: ["req-030"] },
];

export const mockActionItems: ActionItem[] = actionSeeds.map((seed, index) => {
  const number = String(index + 1).padStart(3, "0");
  return {
    id: `action-${number}`,
    actionId: `ACT-${number}`,
    projectId: seed.projectId,
    version: 1,
    sourceIds: [...(seed.meetingIds ?? []), ...(seed.requirementIds ?? [])],
    title: seed.title,
    description: `跟进“${seed.title}”，完成后需要回填证据并通知项目经理。`,
    source: seed.source,
    owner: seed.owner,
    dueDate: seed.dueDate,
    status: seed.status,
    priority: seed.priority,
    requirementIds: seed.requirementIds ?? [],
    meetingIds: seed.meetingIds ?? [],
    riskIds: seed.riskIds ?? [],
    blockerIds: seed.blockerIds ?? [],
    createdAt: "2026-07-08T18:00:00+08:00",
    updatedAt: `2026-07-${String((index % 5) + 8).padStart(2, "0")}T17:00:00+08:00`,
    createdBy: index < 6 ? "AI 助手" : "项目经理",
  };
});

interface RiskSeed {
  projectId: string;
  name: string;
  level: RiskLevel;
  type: RiskType;
  impact: string;
  evidence: string;
  action: string;
  owner: string;
  dueDate: string;
  status: RiskStatus;
  source: string;
}

const riskSeeds: RiskSeed[] = [
  { projectId: "project-001", name: "素材授权延迟影响联调", level: "high", type: "compliance", impact: "未授权素材无法进入门店验收包，可能压缩验收时间。", evidence: "仍有 12 项素材缺少北美区域授权证明。", action: "客户品牌团队 7 月 18 日前补齐，项目组准备替代素材清单。", owner: "林夏", dueDate: "2026-07-18", status: "open", source: "7 月 8 日客户周会" },
  { projectId: "project-001", name: "门店网络波动导致互动中断", level: "medium", type: "technical", impact: "高峰时段可能出现生成超时，影响顾客体验。", evidence: "门店晚间网络抖动 P95 达 1.8 秒。", action: "完成静态兜底并在真实门店执行限速测试。", owner: "陈墨", dueDate: "2026-07-23", status: "monitoring", source: "门店网络测试报告" },
  { projectId: "project-003", name: "积分迁移余额差异", level: "critical", type: "quality", impact: "若未解决将阻断会员系统切换并产生客诉。", evidence: "第二轮迁移有 0.7% 账户余额不一致。", action: "修正冻结积分映射并完成第三轮全量演练。", owner: "林夏", dueDate: "2026-07-22", status: "open", source: "积分迁移第二轮报告" },
  { projectId: "project-004", name: "服饰类生成一致性不足", level: "medium", type: "quality", impact: "运营返工率高于目标，影响批量生产效率。", evidence: "服饰类灰度返工率为 12%。", action: "补充一致性样本并锁定同批生成参数。", owner: "王菡", dueDate: "2026-07-20", status: "monitoring", source: "商品图灰度运营反馈" },
  { projectId: "project-005", name: "南美节点性能未达标", level: "medium", type: "technical", impact: "巴西用户首屏体验低于验收目标。", evidence: "巴西 LCP P75 为 2.9 秒，目标为 2.5 秒。", action: "调整资源分片并启用区域预加载策略。", owner: "赵琦", dueDate: "2026-07-18", status: "open", source: "海外 H5 第二轮压测报告" },
  { projectId: "project-006", name: "旧款平板帧率不足", level: "high", type: "technical", impact: "约 25% 门店设备无法稳定运行完整 AR 动效。", evidence: "旧款平板开启实时阴影时仅 22 FPS。", action: "启用轻量模式并冻结需更换设备的最小清单。", owner: "王菡", dueDate: "2026-07-18", status: "open", source: "门店设备兼容测试报告" },
  { projectId: "project-007", name: "销售额口径未统一", level: "high", type: "scope", impact: "指标模型和看板验收标准无法冻结。", evidence: "销售与财务分别要求按机会创建月、回款月归属。", action: "由业务负责人组织决策会并形成带生效日期的口径。", owner: "林夏", dueDate: "2026-07-15", status: "open", source: "CRM 指标口径工作坊纪要" },
  { projectId: "project-008", name: "区域素材权限边界不清", level: "medium", type: "compliance", impact: "错误授权可能导致区域团队下载无权使用的素材。", evidence: "权限草案尚未覆盖跨区域代理商场景。", action: "补充代理商角色与授权继承规则并交法务评审。", owner: "赵琦", dueDate: "2026-07-28", status: "monitoring", source: "全球素材权限规则草案" },
];

export const mockRisks: Risk[] = riskSeeds.map((seed, index) => {
  const number = String(index + 1).padStart(3, "0");
  return {
    id: `risk-${number}`,
    riskId: `RSK-${number}`,
    projectId: seed.projectId,
    version: 2,
    sourceIds: [`doc-${String(Math.min(index + 1, 15)).padStart(3, "0")}`],
    name: seed.name,
    level: seed.level,
    type: seed.type,
    impact: seed.impact,
    evidence: seed.evidence,
    recommendedAction: seed.action,
    owner: seed.owner,
    dueDate: seed.dueDate,
    status: seed.status,
    source: seed.source,
    createdAt: "2026-07-08T18:00:00+08:00",
    updatedAt: "2026-07-12T09:10:00+08:00",
    createdBy: "AI 助手",
  };
});
