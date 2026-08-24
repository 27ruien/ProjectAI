import readXlsxFile, { type CellValue } from "read-excel-file/node";
import {
  DAILY_REPORT_FIELD_ALIASES,
  WEEKLY_REPORT_LIMITS,
  type DailyReportFact,
  type ParsedDailyReport,
} from "./contracts";
import { WeeklyReportError } from "./errors";

type DailyReportField = keyof typeof DAILY_REPORT_FIELD_ALIASES;
type SheetInput = { sheet: string; data: Array<Array<CellValue | null>> };

function normalizedHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-:/（）()]+/gu, "");
}

const normalizedAliases = Object.fromEntries(
  Object.entries(DAILY_REPORT_FIELD_ALIASES).map(([field, aliases]) => [
    field,
    new Set(aliases.map(normalizedHeader)),
  ]),
) as Record<DailyReportField, Set<string>>;

function fieldForHeader(value: unknown): DailyReportField | null {
  const header = normalizedHeader(value);
  if (!header) return null;
  for (const field of Object.keys(normalizedAliases) as DailyReportField[]) {
    if (normalizedAliases[field].has(header)) return field;
  }
  return null;
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).normalize("NFKC").trim();
  if (!text) return null;
  if (text.length > WEEKLY_REPORT_LIMITS.maximumCellCharacters) {
    throw new WeeklyReportError(422, "DAILY_REPORT_CELL_TOO_LONG", "日报单元格内容过长");
  }
  return text;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function parseDateCell(value: unknown, reportingYear: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const text = cellText(value);
  if (!text) return null;
  const normalized = text
    .replace(/[年/.]/gu, "-")
    .replace(/月/gu, "-")
    .replace(/日/gu, "")
    .replace(/\s+/gu, "");
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(normalized);
  const partial = /^(\d{1,2})-(\d{1,2})$/u.exec(normalized);
  const year = full ? Number(full[1]) : reportingYear;
  const month = Number(full?.[2] ?? partial?.[1]);
  const day = Number(full?.[3] ?? partial?.[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  const candidate = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  return isIsoDate(candidate) ? candidate : null;
}

function headerLocation(data: SheetInput["data"]): {
  rowIndex: number;
  columns: Partial<Record<DailyReportField, number>>;
} | null {
  let best: { rowIndex: number; columns: Partial<Record<DailyReportField, number>>; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(data.length, 20); rowIndex += 1) {
    const columns: Partial<Record<DailyReportField, number>> = {};
    data[rowIndex].forEach((value, columnIndex) => {
      const field = fieldForHeader(value);
      if (field && columns[field] === undefined) columns[field] = columnIndex;
    });
    if (columns.task === undefined) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { rowIndex, columns, score };
  }
  return best ? { rowIndex: best.rowIndex, columns: best.columns } : null;
}

function valueAt(
  row: Array<CellValue | null>,
  columns: Partial<Record<DailyReportField, number>>,
  field: DailyReportField,
): CellValue | null {
  const column = columns[field];
  return column === undefined ? null : (row[column] ?? null);
}

export function parseDailyReportSheets(input: {
  filename: string;
  sheets: SheetInput[];
  weekStart: string;
  weekEnd: string;
}): ParsedDailyReport {
  const facts: DailyReportFact[] = [];
  const warnings: string[] = [];
  let skippedOutsideWeek = 0;
  const reportingYear = Number(input.weekStart.slice(0, 4));

  for (const sheet of input.sheets) {
    const header = headerLocation(sheet.data);
    if (!header) {
      warnings.push("工作表“" + sheet.sheet + "”未找到工作内容列，已跳过");
      continue;
    }
    if (header.columns.project === undefined) {
      warnings.push("工作表“" + sheet.sheet + "”未找到项目列，相关行需要人工确认项目");
    }
    let inheritedProject: string | null = null;
    for (let rowIndex = header.rowIndex + 1; rowIndex < sheet.data.length; rowIndex += 1) {
      const row = sheet.data[rowIndex];
      const explicitProject = cellText(valueAt(row, header.columns, "project"));
      if (explicitProject) inheritedProject = explicitProject;
      const task = cellText(valueAt(row, header.columns, "task"));
      if (!task) continue;
      const date = parseDateCell(valueAt(row, header.columns, "date"), reportingYear);
      if (date && (date < input.weekStart || date > input.weekEnd)) {
        skippedOutsideWeek += 1;
        continue;
      }
      facts.push({
        sourceRow: rowIndex + 1,
        sourceSheet: sheet.sheet,
        projectName: explicitProject ?? inheritedProject,
        task,
        date,
        status: cellText(valueAt(row, header.columns, "status")),
        progress: cellText(valueAt(row, header.columns, "progress")),
        owner: cellText(valueAt(row, header.columns, "owner")),
      });
      if (facts.length > WEEKLY_REPORT_LIMITS.maximumRows) {
        throw new WeeklyReportError(413, "DAILY_REPORT_TOO_MANY_ROWS", "日报最多支持 5000 条有效记录");
      }
    }
  }

  if (facts.length === 0) {
    throw new WeeklyReportError(422, "DAILY_REPORT_EMPTY", "日报中没有可用于本周周报的记录");
  }
  return { filename: input.filename, facts, skippedOutsideWeek, warnings };
}

function delimiterScore(text: string, delimiter: string): number {
  let score = 0;
  let quoted = false;
  for (const character of text.slice(0, 8_000)) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === delimiter) score += 1;
  }
  return score;
}

export function parseDelimitedText(text: string): string[][] {
  const delimiter = [",", "\t", ";"].sort(
    (left, right) => delimiterScore(text, right) - delimiterScore(text, left),
  )[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

export async function parseDailyReportFile(input: {
  file: File;
  weekStart: string;
  weekEnd: string;
}): Promise<ParsedDailyReport> {
  if (input.file.size <= 0) {
    throw new WeeklyReportError(422, "DAILY_REPORT_EMPTY_FILE", "日报文件为空");
  }
  if (input.file.size > WEEKLY_REPORT_LIMITS.maximumFileBytes) {
    throw new WeeklyReportError(413, "DAILY_REPORT_FILE_TOO_LARGE", "日报文件不得超过 10 MB");
  }
  const extension = input.file.name.split(".").pop()?.toLocaleLowerCase();
  const bytes = await input.file.arrayBuffer();
  let sheets: SheetInput[];
  try {
    if (extension === "xlsx") {
      sheets = await readXlsxFile(Buffer.from(bytes));
    } else if (extension === "csv") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");
      sheets = [{ sheet: "CSV", data: parseDelimitedText(text) }];
    } else {
      throw new WeeklyReportError(415, "DAILY_REPORT_FILE_TYPE_NOT_ALLOWED", "仅支持 CSV 或 XLSX 日报");
    }
  } catch (error) {
    if (error instanceof WeeklyReportError) throw error;
    throw new WeeklyReportError(422, "DAILY_REPORT_PARSE_FAILED", "日报文件无法解析，请检查格式");
  }
  return parseDailyReportSheets({
    filename: input.file.name,
    sheets,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
  });
}
