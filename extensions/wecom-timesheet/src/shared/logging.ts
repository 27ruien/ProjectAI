const SENSITIVE = /(authorization|bearer|cookie|password|passphrase|secret|token|api.?key|qr.?code)/i;

export type SafeLogEntry = {
  timestamp: string;
  level: "info" | "warning" | "error";
  code: string;
  batchId: string | null;
  taskId: string | null;
  details: Record<string, unknown>;
};

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value
      .replace(/https?:\/\/[^\s]+/gi, "[url-redacted]")
      .replace(/(bearer|token|cookie|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
      .slice(0, 240);
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE.test(key))
        .slice(0, 20)
        .map(([key, item]) => [key, safeValue(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 240);
}

export function createLogEntry(input: Omit<SafeLogEntry, "timestamp" | "details"> & { details?: Record<string, unknown> }): SafeLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: input.level,
    code: input.code.replace(/[^A-Z0-9_]/gi, "_").slice(0, 80),
    batchId: input.batchId,
    taskId: input.taskId,
    details: safeValue(input.details ?? {}) as Record<string, unknown>,
  };
}

export function sanitizeLogs(entries: SafeLogEntry[]): SafeLogEntry[] {
  return entries.slice(-500).map((entry) => createLogEntry({ ...entry, details: entry.details }));
}
