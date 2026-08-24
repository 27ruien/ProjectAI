export const WEEKLY_REPORT_TABLE_HEADER =
  "| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |";

export function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, "<br>");
}

function unescapedPipeCount(line: string): number {
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "|") continue;
    let backslashes = 0;
    for (let previous = index - 1; previous >= 0 && line[previous] === "\\"; previous -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) count += 1;
  }
  return count;
}

export function validateWeeklyReportMarkdown(input: {
  markdown: string;
  expectedProjectRows: number;
}): string[] {
  const issues: string[] = [];
  if (!/^# 项目周报｜\d{4}\.\d{2}\.\d{2} - \d{4}\.\d{2}\.\d{2}$/mu.test(input.markdown)) {
    issues.push("标题或日期格式不符合约定");
  }
  if (!input.markdown.includes(WEEKLY_REPORT_TABLE_HEADER)) {
    issues.push("缺少固定六列表头");
  }
  const tableLines = input.markdown
    .split(/\r?\n/gu)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));
  const dataLines = tableLines.slice(2);
  if (dataLines.length !== input.expectedProjectRows) {
    issues.push("项目行数与执行包不一致");
  }
  for (const line of dataLines) {
    if (unescapedPipeCount(line) !== 7) issues.push("表格行不是六列或含未转义竖线");
    const cells = line.split(/(?<!\\)\|/gu).slice(1, -1).map((cell) => cell.trim());
    if (cells[4] !== "/") issues.push("需要支持列必须为 /");
  }
  return [...new Set(issues)];
}
