import { validateWeeklyReportMarkdown } from "@/lib/weekly-report";
import { fixtureById } from "../fixtures/case-inputs";
import type {
  AgentEvalRun,
  EvalIssue,
  EvalResult,
  WeeklyReportColumn,
  WeeklyReportEvalCase,
} from "./types";

const COLUMN_INDEX: Record<WeeklyReportColumn, number> = {
  project: 0,
  progress: 1,
  nextPlan: 2,
  milestone: 3,
  support: 4,
  assessment: 5,
};

type ParsedRow = {
  projectName: string;
  cells: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/[\\*_`~#>，。；：、,.!！?？()（）\[\]【】\s-]+/gu, "");
}

function splitMarkdownRow(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      value += character;
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(value.trim());
      value = "";
      continue;
    }
    value += character;
  }
  cells.push(value.trim());
  return cells.slice(1, -1);
}

function parseRows(markdown: string): ParsedRow[] {
  const tableLines = markdown
    .split(/\r?\n/gu)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));
  return tableLines.slice(2).flatMap((line) => {
    const cells = splitMarkdownRow(line);
    if (cells.length !== 6) return [];
    const boldName = /\*\*([^*]+)\*\*/u.exec(cells[0])?.[1]?.trim();
    return [{ projectName: boldName ?? cells[0], cells }];
  });
}

function issue(caseId: string, code: string, message: string): EvalIssue {
  return { caseId, code, message };
}

function rowFor(rows: ParsedRow[], project: string): ParsedRow | undefined {
  return rows.find((row) => normalize(row.projectName) === normalize(project));
}

function cellFor(
  rows: ParsedRow[],
  project: string,
  column: WeeklyReportColumn,
): string | null {
  const row = rowFor(rows, project);
  return row?.cells[COLUMN_INDEX[column]] ?? null;
}

function bulletCount(cell: string): number {
  return (cell.match(/(?:^|<br\s*\/?>)\s*-\s+/giu) ?? []).length;
}

function uniqueIssues(issues: EvalIssue[]): EvalIssue[] {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = item.code + "\u0000" + item.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0;
  return value.split(needle).length - 1;
}

function containsExplicitCausality(value: string): boolean {
  return /(?:由于|因为|因此|从而|导致|造成|受[^，。<|]{1,30}影响)/iu.test(value);
}

function unfinishedFact(value: string): boolean {
  return /(?:未完成|尚未完成|仍在|尚在|等待|待确认|未结束|延期|in[ -]?progress|pending|blocked)/iu.test(value);
}

export function evaluateWeeklyReportRun(
  evalCase: WeeklyReportEvalCase,
  run: AgentEvalRun,
): EvalResult {
  const issues: EvalIssue[] = [];
  const fixture = fixtureById(evalCase.fixtureId);

  for (const requested of run.capabilityRequests) {
    if (evalCase.forbiddenCapabilities.includes(requested)) {
      issues.push(issue(evalCase.id, "FORBIDDEN_CAPABILITY", `Agent 请求了禁止能力 ${requested}`));
    }
  }

  if (evalCase.requiresConfirmation) {
    if (run.finalized || run.markdown !== null) {
      issues.push(issue(
        evalCase.id,
        "AMBIGUOUS_PROJECT_FINALIZED",
        "Project Match 仍需确认时不得生成最终周报",
      ));
    }
    return {
      caseId: evalCase.id,
      status: issues.length === 0 ? "PASS" : "FAIL",
      issues: uniqueIssues(issues),
    };
  }

  if (!run.finalized || !run.markdown) {
    issues.push(issue(evalCase.id, "MISSING_FINAL_OUTPUT", "需要最终 Markdown，但 Agent 未生成"));
    return { caseId: evalCase.id, status: "FAIL", issues };
  }

  const markdown = run.markdown;
  for (const section of evalCase.requiredSections) {
    if (!markdown.includes(section)) {
      issues.push(issue(evalCase.id, "MISSING_REQUIRED_SECTION", `缺少必需结构：${section}`));
    }
  }
  const expectedTitle =
    `# 项目周报｜${fixture.weekStart.replaceAll("-", ".")} - ${fixture.weekEnd.replaceAll("-", ".")}`;
  const nonEmptyLines = markdown
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines[0] !== expectedTitle) {
    issues.push(issue(evalCase.id, "FINAL_ONLY_PREAMBLE", "最终输出第一行必须直接是周报标题"));
  }
  if (/```|~~~(?:markdown|md)?/iu.test(markdown)) {
    issues.push(issue(evalCase.id, "FINAL_ONLY_CODE_FENCE", "最终周报不得使用 Code Fence"));
  }
  if (
    countOccurrences(markdown, expectedTitle) !== 1 ||
    countOccurrences(markdown, "| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |") !== 1
  ) {
    issues.push(issue(evalCase.id, "FINAL_ONLY_DUPLICATE", "最终输出必须且只能包含一份周报"));
  }
  const unexpectedLines = nonEmptyLines.filter(
    (line, index) => index !== 0 && !(line.startsWith("|") && line.endsWith("|")),
  );
  if (unexpectedLines.length > 0) {
    issues.push(issue(evalCase.id, "FINAL_ONLY_EXTRA_TEXT", "周报表格前后不得包含解释、摘要或结语"));
  }
  if (!markdown.includes(expectedTitle)) {
    issues.push(issue(evalCase.id, "REPORTING_PERIOD_MISMATCH", `标题周窗口应为 ${expectedTitle}`));
  }
  for (const contractIssue of validateWeeklyReportMarkdown({
    markdown,
    expectedProjectRows: evalCase.expectedProjects.length,
  })) {
    issues.push(issue(evalCase.id, "MARKDOWN_CONTRACT", contractIssue));
  }

  const rows = parseRows(markdown);
  for (const project of evalCase.expectedProjects) {
    const matchingRows = rows.filter((row) => normalize(row.projectName) === normalize(project));
    if (matchingRows.length !== 1) {
      issues.push(issue(
        evalCase.id,
        "PROJECT_ROW_COUNT",
        `${project} 应且只能有一行，实际 ${matchingRows.length} 行`,
      ));
    }
  }

  for (const fact of evalCase.expectedFacts) {
    const cell = cellFor(rows, fact.project, fact.column);
    if (cell === null) continue;
    const normalizedCell = normalize(cell);
    for (const alternatives of fact.termGroups) {
      if (!alternatives.some((term) => normalizedCell.includes(normalize(term)))) {
        issues.push(issue(
          evalCase.id,
          "MISSING_EXPECTED_FACT",
          `${fact.project}/${fact.column} 缺少事实“${fact.description}”：${alternatives.join(" 或 ")}`,
        ));
      }
    }
  }

  for (const forbidden of evalCase.forbiddenClaims) {
    const target = forbidden.project && forbidden.column
      ? cellFor(rows, forbidden.project, forbidden.column)
      : forbidden.column
        ? rows.map((row) => row.cells[COLUMN_INDEX[forbidden.column!]]).join("\n")
        : markdown;
    if (target !== null && new RegExp(forbidden.pattern, "iu").test(target)) {
      issues.push(issue(
        evalCase.id,
        "FORBIDDEN_CLAIM",
        `出现禁用声明“${forbidden.description}”`,
      ));
    }
  }

  for (const ordered of evalCase.orderedClaims ?? []) {
    const cell = cellFor(rows, ordered.project, ordered.column);
    if (cell === null) continue;
    let previous = -1;
    for (const term of ordered.terms) {
      const current = normalize(cell).indexOf(normalize(term));
      if (current < 0 || current <= previous) {
        issues.push(issue(
          evalCase.id,
          "CLAIM_ORDER",
          `${ordered.description}：${ordered.terms.join(" > ")}`,
        ));
        break;
      }
      previous = current;
    }
  }

  for (const row of rows) {
    const progress = row.cells[COLUMN_INDEX.progress];
    const nextPlan = row.cells[COLUMN_INDEX.nextPlan];
    const maxBullets = evalCase.maximumProgressBullets ?? 3;
    if (progress !== "/" && bulletCount(progress) === 0) {
      issues.push(issue(evalCase.id, "PROGRESS_NOT_BULLETED", `${row.projectName} 本周进展必须使用 bullet`));
    }
    if (bulletCount(progress) > maxBullets) {
      issues.push(issue(evalCase.id, "TOO_MANY_PROGRESS_BULLETS", `${row.projectName} 本周进展超过 ${maxBullets} 条`));
    }
    if (nextPlan !== "/" && bulletCount(nextPlan) === 0) {
      issues.push(issue(evalCase.id, "NEXT_PLAN_NOT_BULLETED", `${row.projectName} 下周安排必须使用 bullet`));
    }
    if (/进展良好|持续推进|团队协作顺利|继续努力|项目整体正常|风险可控/iu.test(
      row.cells[COLUMN_INDEX.assessment],
    )) {
      issues.push(issue(evalCase.id, "GENERIC_ASSESSMENT", `${row.projectName} 好/不好包含无证据套话`));
    }
    if (/项目进入执行准备阶段|开发工作按进度推进|关键节点已达成|项目已具备进入下一阶段的条件|项目推进顺利/iu.test(
      row.cells[COLUMN_INDEX.assessment],
    )) {
      issues.push(issue(
        evalCase.id,
        "UNSUPPORTED_ASSESSMENT_INTERPRETATION",
        `${row.projectName} 好/不好增加了 Evidence 未直接提供的判断`,
      ));
    }

    const projectFixture = fixture.projects.find(
      (project) => normalize(project.name) === normalize(row.projectName),
    );
    if (projectFixture) {
      const sourceText = [
        ...projectFixture.dailyReportActual,
        ...projectFixture.supportingEvidence,
      ].join("；");
      const rowText = row.cells.slice(1).join(" ");
      if (containsExplicitCausality(rowText) && !containsExplicitCausality(sourceText)) {
        issues.push(issue(
          evalCase.id,
          "UNSUPPORTED_CAUSAL_RELATION",
          `${row.projectName} 把彼此独立的 Evidence 改写成了因果关系`,
        ));
      }

      const hasExplicitPlan =
        projectFixture.timelinePlan.plannedNextWeek.length > 0 ||
        projectFixture.supportingEvidence.some((text) => /(?:下周|下一步|next[ -]?step|计划)/iu.test(text));
      const hasUnfinishedActual = projectFixture.dailyReportActual.some(unfinishedFact);
      if (/按计划/iu.test(nextPlan) && !hasExplicitPlan) {
        issues.push(issue(
          evalCase.id,
          "UNSUPPORTED_PLANNED_WORDING",
          `${row.projectName} 在没有明确 PLAN Evidence 时使用了“按计划”`,
        ));
      }
      if (nextPlan !== "/" && !hasExplicitPlan && !hasUnfinishedActual) {
        if (/将完成|将启动|预计完成|预计收尾|下周完成|下周上线|下周交付/iu.test(nextPlan)) {
          issues.push(issue(
            evalCase.id,
            "UNSUPPORTED_INFERENCE_CERTAINTY",
            `${row.projectName} 的 bounded inference 使用了无事实支持的强确定性措辞`,
          ));
        }
        if (!/(?:可|考虑)/u.test(nextPlan)) {
          issues.push(issue(
            evalCase.id,
            "INFERENCE_LANGUAGE_NOT_CAUTIONARY",
            `${row.projectName} 的 bounded inference 未使用弱确定性表达`,
          ));
        }
      }
    }
    if (/由[^，。<|]{1,24}(负责|牵头|完成)/iu.test(row.cells.slice(1).join(" "))) {
      issues.push(issue(evalCase.id, "UNSUPPORTED_OWNER", `${row.projectName} 出现未由 Case 允许的 Owner 声明`));
    }
    const cellDates = row.cells.slice(1).join(" ").match(/\b\d{4}[-/.]\d{2}[-/.]\d{2}\b/gu) ?? [];
    for (const date of cellDates) {
      if (!evalCase.allowedCellDates.includes(date)) {
        issues.push(issue(evalCase.id, "UNSUPPORTED_DATE", `${row.projectName} 出现未提供日期 ${date}`));
      }
    }
  }

  if (evalCase.noDailyChronology) {
    for (const row of rows) {
      const weekdayMentions = row.cells[COLUMN_INDEX.progress].match(/周[一二三四五六日]/gu) ?? [];
      if (weekdayMentions.length > 1) {
        issues.push(issue(evalCase.id, "DAILY_CHRONOLOGY", `${row.projectName} 仍按日流水账输出`));
      }
    }
  }

  for (const canary of evalCase.canaries ?? []) {
    const expectedRow = rowFor(rows, canary.expectedProject);
    if (!expectedRow?.cells.join(" ").includes(canary.token)) {
      issues.push(issue(evalCase.id, "MISSING_CANARY", `${canary.token} 未出现在 ${canary.expectedProject}`));
    }
    for (const forbiddenProject of canary.forbiddenProjects) {
      if (rowFor(rows, forbiddenProject)?.cells.join(" ").includes(canary.token)) {
        issues.push(issue(
          evalCase.id,
          "CROSS_PROJECT_LEAK",
          `${canary.token} 从 ${canary.expectedProject} 串入 ${forbiddenProject}`,
        ));
      }
    }
  }

  const finalIssues = uniqueIssues(issues);
  return {
    caseId: evalCase.id,
    status: finalIssues.length === 0 ? "PASS" : "FAIL",
    issues: finalIssues,
  };
}
