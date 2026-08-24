import type { WeeklyReportEvalCase } from "../helpers/types";

const REQUIRED_SECTIONS = [
  "# 项目周报｜",
  "| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |",
];

const FORBIDDEN_CAPABILITIES = [
  "search_project_knowledge",
  "get_project_documents",
  "list_project_documents",
  "retrieve_ragflow_chunks",
  "query_ragflow",
];

const GENERIC_ASSESSMENT =
  "进展良好|持续推进|团队协作顺利|继续努力|项目整体正常|风险可控";

function base(input: Omit<WeeklyReportEvalCase,
  "requiredSections" | "optionalClaims" | "allowedCellDates" | "forbiddenCapabilities"
> & Partial<Pick<WeeklyReportEvalCase,
  "requiredSections" | "optionalClaims" | "allowedCellDates" | "forbiddenCapabilities"
>>): WeeklyReportEvalCase {
  return {
    requiredSections: REQUIRED_SECTIONS,
    optionalClaims: [],
    allowedCellDates: [],
    forbiddenCapabilities: FORBIDDEN_CAPABILITIES,
    ...input,
  };
}

export const WEEKLY_REPORT_EVAL_CASES: WeeklyReportEvalCase[] = [
  base({
    id: "WR-EVAL-01",
    title: "正常项目 / 多日日报聚合",
    fixtureId: "WR-EVAL-01",
    expectedProjects: ["Project A"],
    inputFixtures: ["周一至周五连续推进、完成项、重复项和日常沟通"],
    expectedFacts: [
      {
        project: "Project A",
        column: "progress",
        description: "连续工作被合并为真实结果",
        termGroups: [["需求梳理"], ["完成", "确认"]],
      },
    ],
    forbiddenClaims: [
      {
        project: "Project A",
        column: "progress",
        description: "不得按工作日逐日复述",
        pattern: "周一[\\s\\S]*周二|周二[\\s\\S]*周三|周三[\\s\\S]*周四",
      },
      {
        project: "Project A",
        column: "progress",
        description: "低价值日常沟通不应占据周报",
        pattern: "参加例会|回复消息",
      },
    ],
    evaluationNotes: ["本周进展应聚合为 1 至 3 条，而非 Monday 到 Friday 流水账。"],
    noDailyChronology: true,
    maximumProgressBullets: 3,
  }),
  base({
    id: "WR-EVAL-02",
    title: "PLAN 与 ACTUAL 冲突",
    fixtureId: "WR-EVAL-02",
    expectedProjects: ["Project A"],
    inputFixtures: ["Timeline 计划本周完成技术方案", "Daily Report 明确仍在修改且未完成"],
    expectedFacts: [
      {
        project: "Project A",
        column: "progress",
        description: "ACTUAL 必须保留未完成状态",
        termGroups: [["技术方案"], ["未完成", "尚未完成", "仍在修改"]],
      },
      {
        project: "Project A",
        column: "nextPlan",
        description: "下周继续完成技术方案",
        termGroups: [["技术方案"], ["继续", "完成"], ["提交"]],
      },
    ],
    forbiddenClaims: [
      {
        project: "Project A",
        column: "progress",
        description: "不得把计划完成写成实际完成",
        pattern: "技术方案.{0,12}(已完成|完成了|顺利完成)",
      },
    ],
    optionalClaims: ["可以客观指出计划偏差，但不能泛化成团队评价。"],
    evaluationNotes: ["这是最高优先级的 PLAN/ACTUAL 防混淆门禁。"],
  }),
  base({
    id: "WR-EVAL-03",
    title: "跨周任务与月边界",
    fixtureId: "WR-EVAL-03",
    expectedProjects: ["Project A"],
    inputFixtures: ["2026-08-27 至 2026-09-02 的跨周接口联调任务"],
    expectedFacts: [
      {
        project: "Project A",
        column: "progress",
        description: "本周不能遗漏跨周任务的实际进展",
        termGroups: [["接口联调"], ["推进"]],
      },
      {
        project: "Project A",
        column: "nextPlan",
        description: "下周继续跨周任务",
        termGroups: [["接口联调"], ["继续", "完成"]],
      },
    ],
    forbiddenClaims: [{
      project: "Project A",
      column: "progress",
      description: "尚未完成的跨周任务不得写成完成",
      pattern: "(完成|已完成).{0,10}接口联调|接口联调.{0,10}(已完成|顺利完成)",
    }],
    evaluationNotes: ["Timeline Core 同时把任务放入本周与下周窗口，且跨越 8/31 月边界。"],
  }),
  base({
    id: "WR-EVAL-04",
    title: "明确 plannedNextWeek 的优先级",
    fixtureId: "WR-EVAL-04",
    expectedProjects: ["Project A"],
    inputFixtures: ["Timeline plannedNextWeek 明确包含 UAT、客户评审、技术修复"],
    expectedFacts: [
      { project: "Project A", column: "nextPlan", description: "使用 UAT 计划", termGroups: [["UAT"]] },
      { project: "Project A", column: "nextPlan", description: "使用客户评审计划", termGroups: [["客户评审"]] },
      { project: "Project A", column: "nextPlan", description: "使用技术修复计划", termGroups: [["技术修复"]] },
    ],
    forbiddenClaims: [{
      project: "Project A",
      column: "nextPlan",
      description: "不得凭空增加 Timeline 未提供的工作",
      pattern: "预算审批|招聘|合同签署",
    }],
    orderedClaims: [{
      project: "Project A",
      column: "nextPlan",
      description: "Timeline 中的三个显式计划按给定优先顺序出现",
      terms: ["UAT", "客户评审", "技术修复"],
    }],
    evaluationNotes: ["Timeline plannedNextWeek 优先于 Daily unfinished、Knowledge 和推演。"],
  }),
  base({
    id: "WR-EVAL-05",
    title: "Timeline 无下周任务时使用未完成 ACTUAL",
    fixtureId: "WR-EVAL-05",
    expectedProjects: ["Project A"],
    inputFixtures: ["plannedNextWeek 为空", "Daily Report 有客户反馈等待和未完成接口联调"],
    expectedFacts: [
      {
        project: "Project A",
        column: "nextPlan",
        description: "从未完成事项提取接口联调",
        termGroups: [["接口联调"], ["继续", "完成"]],
      },
      {
        project: "Project A",
        column: "nextPlan",
        description: "从显式等待事项提取客户反馈后修改",
        termGroups: [["客户反馈"], ["修改"]],
      },
    ],
    forbiddenClaims: [{
      project: "Project A",
      column: "nextPlan",
      description: "不得因 Timeline 为空而输出空计划",
      pattern: "^/$",
    }],
    evaluationNotes: ["只允许复用 Daily Report 已明确的未完成或等待事项。"],
  }),
  base({
    id: "WR-EVAL-06",
    title: "Current Milestone 日期保真",
    fixtureId: "WR-EVAL-06",
    expectedProjects: ["Project A"],
    inputFixtures: ["Timeline milestone: UAT Complete / 2026-08-21"],
    expectedFacts: [{
      project: "Project A",
      column: "milestone",
      description: "使用 Timeline 的里程碑名称和原始日期",
      termGroups: [["UAT Complete"], ["2026-08-21"]],
    }],
    forbiddenClaims: [
      { project: "Project A", column: "milestone", description: "不得修改日期", pattern: "2026-08-(20|22)|2026-09" },
      { project: "Project A", column: "milestone", description: "不得新增普通任务里程碑", pattern: "需求确认|接口联调" },
    ],
    allowedCellDates: ["2026-08-21"],
    evaluationNotes: ["里程碑只接受 Timeline 明确值，不接受 Agent 重命名。"],
  }),
  base({
    id: "WR-EVAL-07",
    title: "Future Milestone 与 future clipping",
    fixtureId: "WR-EVAL-07",
    expectedProjects: ["Project A"],
    inputFixtures: ["Timeline future milestone: Launch Review / 2026-09-15", "普通远期任务已被 Core 裁剪"],
    expectedFacts: [{
      project: "Project A",
      column: "milestone",
      description: "按当前 Skill Contract 展示最近未来里程碑",
      termGroups: [["Launch Review"], ["2026-09-15"]],
    }],
    forbiddenClaims: [
      { description: "已裁剪的普通远期任务不能泄露", pattern: "FAR_FUTURE_ORDINARY" },
      { project: "Project A", column: "milestone", description: "不得创造其他里程碑", pattern: "UAT Complete|合同签署" },
    ],
    allowedCellDates: ["2026-09-15"],
    evaluationNotes: ["现有 Skill 允许展示 Timeline 提供的重要未来节点。"],
  }),
  base({
    id: "WR-EVAL-08",
    title: "Project Alias 自动匹配",
    fixtureId: "WR-EVAL-08",
    expectedProjects: ["CHAGEE Valley Fair Campaign"],
    inputFixtures: ["CHAGEE / CHAGEE VF / 茶姬 / Valley Fair 四个已存在 Alias"],
    expectedFacts: [{
      project: "CHAGEE Valley Fair Campaign",
      column: "progress",
      description: "四个 Alias 的 ACTUAL 合并到正式项目名",
      termGroups: [["素材确认"], ["活动排期"], ["客户反馈"], ["上线清单"]],
    }],
    forbiddenClaims: [{
      column: "project",
      description: "不得把 Alias 当成多个正式项目行",
      pattern: "\\*\\*(CHAGEE VF|茶姬|Valley Fair)\\*\\*",
    }],
    evaluationNotes: ["Project Match 必须 deterministic；Agent 只接收正式 Project Name。"],
    maximumProgressBullets: 3,
  }),
  base({
    id: "WR-EVAL-09",
    title: "Ambiguous Project 必须人工确认",
    fixtureId: "WR-EVAL-09",
    expectedProjects: [],
    inputFixtures: ["Project Alpha 同时接近两个授权项目"],
    expectedFacts: [],
    forbiddenClaims: [],
    evaluationNotes: ["needs_confirmation 时不得产生可交给 Agent 的 final Execution Package 或 Markdown。"],
    requiresConfirmation: true,
  }),
  base({
    id: "WR-EVAL-10",
    title: "无评价 Evidence 时好 / 不好为 /",
    fixtureId: "WR-EVAL-10",
    expectedProjects: ["Project A"],
    inputFixtures: ["只有中性会议纪要归档事实，无 Timeline/Knowledge 评价证据"],
    expectedFacts: [{
      project: "Project A",
      column: "progress",
      description: "只陈述中性 ACTUAL",
      termGroups: [["会议纪要"], ["归档"]],
    }],
    forbiddenClaims: [{
      project: "Project A",
      column: "assessment",
      description: "禁止无证据套话",
      pattern: GENERIC_ASSESSMENT,
    }],
    evaluationNotes: ["下周安排、里程碑、需要支持和好/不好均不应凭空补齐。"],
  }),
  base({
    id: "WR-EVAL-10B",
    title: "有明确延期 Evidence 时允许克制评价",
    fixtureId: "WR-EVAL-10B",
    expectedProjects: ["Project A"],
    inputFixtures: ["Daily Report 明确记录客户反馈导致计划延期"],
    expectedFacts: [{
      project: "Project A",
      column: "assessment",
      description: "评价只复述客观延期原因",
      termGroups: [["不好"], ["客户反馈"], ["延期"]],
    }],
    forbiddenClaims: [{
      project: "Project A",
      column: "assessment",
      description: "不得扩展为长篇建议或泛化评价",
      pattern: GENERIC_ASSESSMENT + "|建议团队|应当加强",
    }],
    evaluationNotes: ["允许一句简短、客观评价。"],
  }),
  base({
    id: "WR-EVAL-MULTI",
    title: "CSV/XLSX 多项目组合与事实隔离",
    fixtureId: "WR-EVAL-MULTI",
    expectedProjects: ["Project A", "Project B", "Project C"],
    inputFixtures: ["同一日报包含 Project A/B/C", "A_ONLY / B_ONLY / C_ONLY canary"],
    expectedFacts: [
      { project: "Project A", column: "progress", description: "A canary 保留", termGroups: [["A_ONLY"]] },
      { project: "Project B", column: "progress", description: "B canary 保留", termGroups: [["B_ONLY"]] },
      { project: "Project C", column: "progress", description: "C canary 保留", termGroups: [["C_ONLY"]] },
    ],
    forbiddenClaims: [],
    canaries: [
      { token: "A_ONLY", expectedProject: "Project A", forbiddenProjects: ["Project B", "Project C"] },
      { token: "B_ONLY", expectedProject: "Project B", forbiddenProjects: ["Project A", "Project C"] },
      { token: "C_ONLY", expectedProject: "Project C", forbiddenProjects: ["Project A", "Project B"] },
    ],
    evaluationNotes: ["每个 Project 独立匹配、构建 Context，最终只在 Markdown 表格层合并。"],
  }),
];

export function evalCaseById(id: string): WeeklyReportEvalCase {
  const evalCase = WEEKLY_REPORT_EVAL_CASES.find((item) => item.id === id);
  if (!evalCase) throw new Error("Unknown weekly report eval case: " + id);
  return evalCase;
}
