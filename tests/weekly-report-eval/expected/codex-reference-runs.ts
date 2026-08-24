import type { AgentEvalRun } from "../helpers/types";

function report(weekStart: string, weekEnd: string, rows: string[]): string {
  return [
    `# 项目周报｜${weekStart} - ${weekEnd}`,
    "",
    "| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function run(caseId: string, markdown: string): AgentEvalRun {
  return {
    caseId,
    agent: "Codex",
    finalized: true,
    markdown,
    capabilityRequests: [],
  };
}

const STANDARD_WEEK_START = "2026.08.17";
const STANDARD_WEEK_END = "2026.08.21";

export const CODEX_REFERENCE_RUNS: AgentEvalRun[] = [
  run("WR-EVAL-01", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 完成需求梳理，并将连续推进和重复确认的有效结果合并整理。 | / | / | / | / |",
  ])),
  run("WR-EVAL-02", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 持续修改技术方案，本周尚未完成。 | - 继续完成技术方案修改并提交。 | / | / | 不好：技术方案未按本周计划完成，仍需继续修改。 |",
  ])),
  run("WR-EVAL-03", report("2026.08.24", "2026.08.30", [
    "| **Project A**<br><br>**项目状态：进行中** | - 接口联调已开始推进，当前尚未结束。 | - 下周继续接口联调并完成剩余工作。 | / | / | / |",
  ])),
  run("WR-EVAL-04", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 完成测试环境准备。 | - 开展 UAT。<br>- 组织客户评审。<br>- 根据验证与评审结果完成技术修复。 | / | / | / |",
  ])),
  run("WR-EVAL-05", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 等待客户反馈后继续修改；接口联调尚未完成。 | - 继续接口联调。<br>- 根据客户反馈继续修改。 | / | / | / |",
  ])),
  run("WR-EVAL-06", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 完成 UAT 验证并关闭剩余问题。 | / | - UAT Complete，2026-08-21 | / | 好：完成 UAT 验证并关闭剩余问题。 |",
  ])),
  run("WR-EVAL-07", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 完成发布准备清单初审。 | / | - Launch Review，2026-09-15 | / | / |",
  ])),
  run("WR-EVAL-08", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **CHAGEE Valley Fair Campaign**<br><br>**项目状态：进行中** | - 完成门店素材确认、客户反馈确认和上线清单检查。<br>- 更新活动排期。 | / | / | / | / |",
  ])),
  {
    caseId: "WR-EVAL-09",
    agent: "Codex",
    finalized: false,
    markdown: null,
    capabilityRequests: [],
  },
  run("WR-EVAL-10", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 整理会议纪要并归档。 | / | / | / | / |",
  ])),
  run("WR-EVAL-10B", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 客户反馈导致计划延期。 | - 根据客户反馈继续调整计划。 | / | / | 不好：客户反馈导致计划延期。 |",
  ])),
  run("WR-EVAL-MULTI", report(STANDARD_WEEK_START, STANDARD_WEEK_END, [
    "| **Project A**<br><br>**项目状态：进行中** | - 完成 A_ONLY 需求确认。 | / | / | / | / |",
    "| **Project B**<br><br>**项目状态：进行中** | - 完成 B_ONLY 接口联调。 | / | / | / | / |",
    "| **Project C**<br><br>**项目状态：进行中** | - 完成 C_ONLY UAT 准备。 | / | / | / | / |",
  ])),
];

export function codexReferenceRun(caseId: string): AgentEvalRun {
  const run = CODEX_REFERENCE_RUNS.find((item) => item.caseId === caseId);
  if (!run) throw new Error("Missing Codex weekly report eval run: " + caseId);
  return run;
}
