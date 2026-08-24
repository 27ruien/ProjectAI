const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MILLISECONDS_PER_DAY = 86_400_000;

export type ReportingPeriod = {
  weekStart: string;
  weekEnd: string;
};

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function shiftIsoDate(value: string, days: number): string {
  if (!isIsoDate(value)) throw new Error("Timeline date must use YYYY-MM-DD");
  const parsed = new Date(value + "T00:00:00.000Z");
  return new Date(parsed.valueOf() + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function nextReportingPeriod(period: ReportingPeriod): ReportingPeriod {
  return {
    weekStart: shiftIsoDate(period.weekStart, 7),
    weekEnd: shiftIsoDate(period.weekEnd, 7),
  };
}

export function overlapsPeriod(
  task: Pick<{ startDate: string; endDate: string }, "startDate" | "endDate">,
  period: ReportingPeriod,
): boolean {
  return task.startDate <= period.weekEnd && task.endDate >= period.weekStart;
}
