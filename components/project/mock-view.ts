export function dateLabel(value: unknown, fallback = "—"): string {
  if (typeof value !== "string" || !value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

export function statusLabel(status: string): string {
  return ({
    planning: "规划中",
    active: "进行中",
    completed: "已完成",
    paused: "已暂停",
    cancelled: "已取消",
    archived: "已归档",
    at_risk: "有风险",
  } as Record<string, string>)[status] ?? "未知状态";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "AI";
  return parts.slice(-2).map((part) => part[0]).join("").toUpperCase();
}
