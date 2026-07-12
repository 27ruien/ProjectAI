export type DataRecord = Record<string, unknown>;

export function asRecords(value: unknown): DataRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DataRecord => typeof item === "object" && item !== null,
  );
}

export function textValue(
  record: DataRecord | undefined,
  keys: string | string[],
  fallback = "—",
): string {
  if (!record) return fallback;
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

export function numberValue(
  record: DataRecord | undefined,
  keys: string | string[],
  fallback = 0,
): number {
  if (!record) return fallback;
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return fallback;
}

export function stringList(
  record: DataRecord | undefined,
  keys: string | string[],
): string[] {
  if (!record) return [];
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            return textValue(item as DataRecord, ["name", "displayName", "title"], "");
          }
          return "";
        })
        .filter(Boolean);
    }
  }
  return [];
}

export function dateLabel(value: unknown, fallback = "—"): string {
  if (typeof value !== "string" || !value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function relativeLabel(value: unknown): string {
  if (typeof value !== "string") return "刚刚";
  const delta = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(delta) || delta < 0) return dateLabel(value);
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `${days} 天前` : dateLabel(value);
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "进行中",
    planning: "规划中",
    paused: "已暂停",
    completed: "已完成",
    archived: "已归档",
    healthy: "正常",
    attention: "需关注",
    atRisk: "有风险",
    critical: "严重风险",
    low: "低",
    medium: "中",
    high: "高",
    draft: "草稿",
    pendingReview: "待审核",
    confirmed: "已确认",
    rejected: "已驳回",
    deprecated: "已失效",
    todo: "待开始",
    inProgress: "进行中",
    blocked: "已阻塞",
    overdue: "已逾期",
    parsed: "解析完成",
    processing: "解析中",
    waiting: "等待解析",
    failed: "解析失败",
    approved: "已通过",
    activeVersion: "当前有效",
  };
  return (labels[status] ?? status) || "未知";
}

export function statusClasses(status: string): string {
  if (["healthy", "active", "confirmed", "approved", "completed", "parsed"].includes(status)) {
    return "border-success/20 bg-success/10 text-success";
  }
  if (["attention", "medium", "pendingReview", "processing", "P1"].includes(status)) {
    return "border-warning/20 bg-warning/10 text-warning";
  }
  if (["atRisk", "high", "critical", "failed", "rejected", "overdue", "blocked", "P0"].includes(status)) {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (["P2", "inProgress", "planning"].includes(status)) {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  return "border-border bg-muted/60 text-muted-foreground";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AI";
  return parts.slice(-2).map((part) => part[0]).join("").toUpperCase();
}
