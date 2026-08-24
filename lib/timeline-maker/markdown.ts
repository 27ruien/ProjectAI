import {
  timelineMakerDraftSchema,
  timelineMakerDraftToWorkbenchData,
  type TimelineMakerDraft,
} from "./contracts";

export const TIMELINE_MAKER_MARKDOWN_TITLE = "# Project Timeline";
export const TIMELINE_MAKER_METADATA_HEADER =
  "| 标题 | 模式 | Existing Timeline Version | 语言 |";
export const TIMELINE_MAKER_REQUIREMENT_HEADER =
  "| Requirement ID | Domain | Requirement | Status | Evidence | Reason |";
export const TIMELINE_MAKER_PHASE_HEADER =
  "| 阶段 | 依据 | 依据说明 |";
export const TIMELINE_MAKER_ASSUMPTION_HEADER =
  "| Assumption ID | Planning Assumption | Affected Task IDs |";
export const TIMELINE_MAKER_WARNING_HEADER = "| Warning |";
export const TIMELINE_MAKER_TASK_HEADER =
  "| Task ID | 阶段 | 任务 | 负责人 | 开始日期 | 结束日期 | 状态 | 依据 | Requirement IDs | Assumption ID | 依据说明 |";

function encodeCell(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\|/gu, "\\|")
    .replace(/\r?\n/gu, " ")
    .trim() || "/";
}

function renderRow(cells: string[]): string {
  return "| " + cells.map(encodeCell).join(" | ") + " |";
}

function separator(columns: number): string {
  return "|" + Array.from({ length: columns }, () => "---").join("|") + "|";
}

function listCell(values: string[]): string {
  return values.length > 0 ? values.join("<br>") : "/";
}

function nullableCell(value: string | null): string {
  return value || "/";
}

export function renderTimelineMakerMarkdown(input: TimelineMakerDraft): string {
  const draft = timelineMakerDraftSchema.parse(input);
  return [
    TIMELINE_MAKER_MARKDOWN_TITLE,
    "",
    TIMELINE_MAKER_METADATA_HEADER,
    separator(4),
    renderRow([
      draft.title,
      draft.mode,
      draft.existingTimelineVersion === null ? "/" : String(draft.existingTimelineVersion),
      draft.language,
    ]),
    "",
    "## Requirement Check",
    "",
    TIMELINE_MAKER_REQUIREMENT_HEADER,
    separator(6),
    ...draft.requirements.map((item) => renderRow([
      item.id,
      item.domain,
      item.label,
      item.status,
      nullableCell(item.evidence),
      item.reason,
    ])),
    "",
    "## Phases",
    "",
    TIMELINE_MAKER_PHASE_HEADER,
    separator(3),
    ...draft.phases.map((phase) => renderRow([
      phase.name,
      phase.basis,
      phase.basisDetail,
    ])),
    "",
    "## Planning Assumptions",
    "",
    TIMELINE_MAKER_ASSUMPTION_HEADER,
    separator(3),
    ...draft.assumptions.map((assumption) => renderRow([
      assumption.id,
      assumption.statement,
      listCell(assumption.affectedTaskIds),
    ])),
    "",
    "## Warnings",
    "",
    TIMELINE_MAKER_WARNING_HEADER,
    separator(1),
    ...draft.warnings.map((warning) => renderRow([warning])),
    "",
    "## Timeline Draft",
    "",
    TIMELINE_MAKER_TASK_HEADER,
    separator(11),
    ...draft.tasks.map((task) => renderRow([
      task.id,
      task.stage || "/",
      task.name,
      listCell(task.owners),
      task.start || "/",
      task.end || "/",
      task.status,
      task.basis,
      listCell(task.requirementIds),
      nullableCell(task.assumptionId),
      task.basisDetail,
    ])),
  ].join("\n") + "\n";
}

function parseRow(line: string, columns: number): string[] {
  const cells: string[] = [];
  let value = "";
  let escaped = false;
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new Error("Timeline Markdown table row is malformed");
  }
  for (const character of trimmed.slice(1, -1)) {
    if (escaped) {
      value += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
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
  if (escaped) value += "\\";
  cells.push(value.trim());
  if (cells.length !== columns) {
    throw new Error(`Timeline Markdown row must contain ${columns} columns`);
  }
  return cells;
}

function parseListCell(value: string): string[] {
  if (!value || value === "/") return [];
  return value
    .split(/<br\s*\/?\s*>/giu)
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyCell(value: string): string {
  return value === "/" ? "" : value;
}

function nullableParsedCell(value: string): string | null {
  return value === "/" ? null : value;
}

function expectLine(lines: string[], index: number, expected: string): void {
  if (lines[index] !== expected) {
    throw new Error(`Timeline Markdown expected “${expected}”`);
  }
}

function parseSection(input: {
  lines: string[];
  start: number;
  heading: string;
  header: string;
  columns: number;
  nextHeading: string | null;
}): { rows: string[][]; next: number } {
  expectLine(input.lines, input.start, input.heading);
  expectLine(input.lines, input.start + 1, input.header);
  expectLine(input.lines, input.start + 2, separator(input.columns));
  const rows: string[][] = [];
  let index = input.start + 3;
  while (index < input.lines.length) {
    if (input.nextHeading && input.lines[index] === input.nextHeading) break;
    rows.push(parseRow(input.lines[index], input.columns));
    index += 1;
  }
  if (input.nextHeading && input.lines[index] !== input.nextHeading) {
    throw new Error(`Timeline Markdown is missing ${input.nextHeading}`);
  }
  return { rows, next: index };
}

export function parseTimelineMakerMarkdown(markdown: string): TimelineMakerDraft {
  if (/```|~~~/u.test(markdown)) {
    throw new Error("Timeline Markdown must not use a code fence");
  }
  const lines = markdown
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  expectLine(lines, 0, TIMELINE_MAKER_MARKDOWN_TITLE);
  expectLine(lines, 1, TIMELINE_MAKER_METADATA_HEADER);
  expectLine(lines, 2, separator(4));
  const metadata = parseRow(lines[3], 4);

  const requirements = parseSection({
    lines,
    start: 4,
    heading: "## Requirement Check",
    header: TIMELINE_MAKER_REQUIREMENT_HEADER,
    columns: 6,
    nextHeading: "## Phases",
  });
  const phases = parseSection({
    lines,
    start: requirements.next,
    heading: "## Phases",
    header: TIMELINE_MAKER_PHASE_HEADER,
    columns: 3,
    nextHeading: "## Planning Assumptions",
  });
  const assumptions = parseSection({
    lines,
    start: phases.next,
    heading: "## Planning Assumptions",
    header: TIMELINE_MAKER_ASSUMPTION_HEADER,
    columns: 3,
    nextHeading: "## Warnings",
  });
  const warnings = parseSection({
    lines,
    start: assumptions.next,
    heading: "## Warnings",
    header: TIMELINE_MAKER_WARNING_HEADER,
    columns: 1,
    nextHeading: "## Timeline Draft",
  });
  const tasks = parseSection({
    lines,
    start: warnings.next,
    heading: "## Timeline Draft",
    header: TIMELINE_MAKER_TASK_HEADER,
    columns: 11,
    nextHeading: null,
  });
  if (tasks.next !== lines.length) {
    throw new Error("Timeline Markdown contains unsupported trailing content");
  }

  const existingVersion = metadata[2] === "/" ? null : Number(metadata[2]);
  if (existingVersion !== null && !Number.isInteger(existingVersion)) {
    throw new Error("Existing Timeline Version must be / or a positive integer");
  }

  return timelineMakerDraftSchema.parse({
    schemaVersion: "projectai-timeline-maker-draft-v1",
    skillId: "project-timeline-maker",
    skillVersion: "0.1.0",
    title: metadata[0],
    mode: metadata[1],
    existingTimelineVersion: existingVersion,
    language: metadata[3],
    requirements: requirements.rows.map((row) => ({
      id: row[0],
      domain: row[1],
      label: row[2],
      status: row[3],
      evidence: nullableParsedCell(row[4]),
      reason: row[5],
    })),
    phases: phases.rows.map((row) => ({
      name: row[0],
      basis: row[1],
      basisDetail: row[2],
    })),
    assumptions: assumptions.rows.map((row) => ({
      id: row[0],
      statement: row[1],
      affectedTaskIds: parseListCell(row[2]),
    })),
    tasks: tasks.rows.map((row) => ({
      id: row[0],
      stage: emptyCell(row[1]),
      name: row[2],
      owners: parseListCell(row[3]),
      start: emptyCell(row[4]),
      end: emptyCell(row[5]),
      status: row[6],
      basis: row[7],
      requirementIds: parseListCell(row[8]),
      assumptionId: nullableParsedCell(row[9]),
      basisDetail: row[10],
    })),
    warnings: warnings.rows.map((row) => row[0]),
  });
}

export function parseTimelineMakerMarkdownToWorkbench(markdown: string) {
  return timelineMakerDraftToWorkbenchData(parseTimelineMakerMarkdown(markdown));
}
