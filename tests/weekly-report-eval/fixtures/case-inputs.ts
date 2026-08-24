import type { EvalFixture, EvalProjectFixture, EvalTimelineTask } from "../helpers/types";

function project(input: {
  id: string;
  name: string;
  actual: string[];
  thisWeek?: EvalTimelineTask[];
  nextWeek?: EvalTimelineTask[];
  milestones?: Array<{ name: string; date: string }>;
  evidence?: string[];
  statusLabel?: string;
}): EvalProjectFixture {
  return {
    id: input.id,
    name: input.name,
    statusLabel: input.statusLabel ?? "进行中",
    dailyReportActual: input.actual,
    timelinePlan: {
      plannedThisWeek: input.thisWeek ?? [],
      plannedNextWeek: input.nextWeek ?? [],
      milestones: input.milestones ?? [],
    },
    supportingEvidence: input.evidence ?? [],
  };
}

const standardWeek = { weekStart: "2026-08-17", weekEnd: "2026-08-21" };

export const WEEKLY_REPORT_EVAL_FIXTURES: EvalFixture[] = [
  {
    id: "WR-EVAL-01",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: [
        "周一：推进需求梳理",
        "周二：继续推进需求梳理",
        "周三：完成需求梳理",
        "周四：同步并重复确认需求资料",
        "周五：同步并重复确认需求资料",
        "日常沟通：参加例会并回复消息",
      ],
      thisWeek: [
        { name: "需求梳理", startDate: "2026-08-17", endDate: "2026-08-19", status: "done" },
        { name: "需求资料确认", startDate: "2026-08-20", endDate: "2026-08-21", status: "done" },
        { name: "项目例会", startDate: "2026-08-21", endDate: "2026-08-21", status: "done" },
      ],
    })],
  },
  {
    id: "WR-EVAL-02",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["技术方案仍在修改，本周未完成"],
      thisWeek: [{
        name: "技术方案完成",
        startDate: "2026-08-17",
        endDate: "2026-08-21",
        status: "incomplete",
      }],
    })],
  },
  {
    id: "WR-EVAL-03",
    weekStart: "2026-08-24",
    weekEnd: "2026-08-30",
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["接口联调从周四开始并持续推进，尚未完成"],
      thisWeek: [{
        name: "跨周接口联调",
        startDate: "2026-08-27",
        endDate: "2026-09-02",
        status: "incomplete",
      }],
      nextWeek: [{
        name: "跨周接口联调",
        startDate: "2026-08-27",
        endDate: "2026-09-02",
        status: "incomplete",
      }],
    })],
  },
  {
    id: "WR-EVAL-04",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["完成测试环境准备"],
      nextWeek: [
        { name: "UAT", startDate: "2026-08-24", endDate: "2026-08-25", status: "incomplete" },
        { name: "客户评审", startDate: "2026-08-26", endDate: "2026-08-26", status: "incomplete" },
        { name: "技术修复", startDate: "2026-08-27", endDate: "2026-08-28", status: "incomplete" },
      ],
    })],
  },
  {
    id: "WR-EVAL-05",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["等待客户反馈后继续修改", "接口联调尚未完成"],
    })],
  },
  {
    id: "WR-EVAL-06",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["完成 UAT 验证并关闭剩余问题"],
      milestones: [{ name: "UAT Complete", date: "2026-08-21" }],
    })],
  },
  {
    id: "WR-EVAL-07",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["完成发布准备清单初审"],
      milestones: [{ name: "Launch Review", date: "2026-09-15" }],
      evidence: ["普通远期任务 FAR_FUTURE_ORDINARY 已被 Timeline Core 裁剪，不应进入 Execution Package"],
    })],
  },
  {
    id: "WR-EVAL-08",
    ...standardWeek,
    projects: [project({
      id: "chagee-vf",
      name: "CHAGEE Valley Fair Campaign",
      actual: [
        "CHAGEE：完成门店素材确认",
        "CHAGEE VF：更新活动排期",
        "茶姬：确认客户反馈",
        "Valley Fair：完成上线清单检查",
      ],
    })],
    aliases: [
      { sourceName: "CHAGEE", projectId: "chagee-vf" },
      { sourceName: "CHAGEE VF", projectId: "chagee-vf" },
      { sourceName: "茶姬", projectId: "chagee-vf" },
      { sourceName: "Valley Fair", projectId: "chagee-vf" },
    ],
  },
  {
    id: "WR-EVAL-09",
    ...standardWeek,
    projects: [],
    ambiguousMatch: {
      sourceName: "Project Alpha",
      candidateProjectIds: ["project-alpha-cn", "project-alpha-global"],
    },
  },
  {
    id: "WR-EVAL-10",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["整理会议纪要并归档"],
    })],
  },
  {
    id: "WR-EVAL-10B",
    ...standardWeek,
    projects: [project({
      id: "project-a",
      name: "Project A",
      actual: ["客户反馈导致计划延期"],
    })],
  },
  {
    id: "WR-EVAL-MULTI",
    ...standardWeek,
    projects: [
      project({ id: "project-a", name: "Project A", actual: ["完成 A_ONLY 需求确认"] }),
      project({ id: "project-b", name: "Project B", actual: ["完成 B_ONLY 接口联调"] }),
      project({ id: "project-c", name: "Project C", actual: ["完成 C_ONLY UAT 准备"] }),
    ],
  },
];

export function fixtureById(id: string): EvalFixture {
  const fixture = WEEKLY_REPORT_EVAL_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error("Unknown weekly report eval fixture: " + id);
  return fixture;
}
