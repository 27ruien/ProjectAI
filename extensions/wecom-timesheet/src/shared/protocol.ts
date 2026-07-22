export const PROTOCOL_VERSION = 1 as const;
export const EXTENSION_SOURCE = "project-ai-extension" as const;
export const PROJECT_AI_SOURCE = "project-ai" as const;

export type SyncTask = {
  id: string;
  description: string;
  project: { id: string; name: string };
  submitter: { id: null; name: null; source: "authenticated-user" };
  regularHours: number;
  overtimeHours: number | null;
  category: { id: string; name: string };
  status: { id: string | null; name: string };
  urgency: { id: string | null; name: string } | null;
  progress: number | null;
};

export type SyncPayload = {
  version: 1;
  request_id: string;
  sync_batch_id: string;
  date: string;
  source: "project-ai";
  confirmed_at: string;
  draft_version: number;
  dry_run: boolean;
  tasks: SyncTask[];
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function catalog(value: unknown, maxName: number): value is { id: string; name: string } {
  return (
    object(value) &&
    exactKeys(value, ["id", "name"]) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= maxName
  );
}

function externalOption(
  value: unknown,
): value is { id: string | null; name: string } {
  return (
    object(value) &&
    exactKeys(value, ["id", "name"]) &&
    (value.id === null ||
      (typeof value.id === "string" && value.id.length > 0 && value.id.length <= 200)) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 120
  );
}

function quarterHours(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 24 &&
    Math.abs(value * 4 - Math.round(value * 4)) < Number.EPSILON
  );
}

function baseTask(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    typeof value.description === "string" &&
    value.description.trim().length >= 2 &&
    value.description.length <= 500 &&
    catalog(value.project, 200) &&
    catalog(value.category, 120) &&
    externalOption(value.status)
  );
}

function normalizeTask(value: unknown): SyncTask | null {
  if (!object(value)) return null;
  const legacyKeys = ["id", "description", "project", "hours", "category", "status"];
  if (exactKeys(value, legacyKeys)) {
    if (!baseTask(value) || !quarterHours(value.hours) || !catalog(value.status, 120)) return null;
    return {
      id: value.id as string,
      description: value.description as string,
      project: value.project as SyncTask["project"],
      submitter: { id: null, name: null, source: "authenticated-user" },
      regularHours: value.hours,
      overtimeHours: null,
      category: value.category as SyncTask["category"],
      status: value.status,
      urgency: null,
      progress: null,
    };
  }
  if (
    !exactKeys(value, [
      "id",
      "description",
      "project",
      "submitter",
      "regularHours",
      "overtimeHours",
      "category",
      "status",
      "urgency",
      "progress",
    ]) ||
    !baseTask(value) ||
    !object(value.submitter) ||
    !exactKeys(value.submitter, ["id", "name", "source"]) ||
    value.submitter.id !== null ||
    value.submitter.name !== null ||
    value.submitter.source !== "authenticated-user" ||
    !quarterHours(value.regularHours) ||
    (value.overtimeHours !== null && !quarterHours(value.overtimeHours)) ||
    (value.overtimeHours !== null && value.regularHours + value.overtimeHours > 24) ||
    (value.urgency !== null && !externalOption(value.urgency)) ||
    (value.progress !== null &&
      (typeof value.progress !== "number" ||
        !Number.isInteger(value.progress) ||
        value.progress < 0 ||
        value.progress > 100))
  ) {
    return null;
  }
  return value as SyncTask;
}

export function validateSyncPayload(value: unknown): ValidationResult<SyncPayload> {
  if (
    !object(value) ||
    !exactKeys(value, [
      "version",
      "request_id",
      "sync_batch_id",
      "date",
      "source",
      "confirmed_at",
      "draft_version",
      "dry_run",
      "tasks",
    ])
  ) {
    return { ok: false, code: "PAYLOAD_SCHEMA_INVALID", message: "同步 Payload 字段无效" };
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.source !== PROJECT_AI_SOURCE ||
    typeof value.request_id !== "string" ||
    !UUID.test(value.request_id) ||
    typeof value.sync_batch_id !== "string" ||
    !UUID.test(value.sync_batch_id) ||
    typeof value.date !== "string" ||
    !validDate(value.date) ||
    typeof value.confirmed_at !== "string" ||
    Number.isNaN(Date.parse(value.confirmed_at)) ||
    typeof value.draft_version !== "number" ||
    !Number.isInteger(value.draft_version) ||
    value.draft_version < 1 ||
    typeof value.dry_run !== "boolean" ||
    !Array.isArray(value.tasks) ||
    value.tasks.length < 1 ||
    value.tasks.length > 50 ||
    !value.tasks.every((item) => normalizeTask(item) !== null)
  ) {
    return { ok: false, code: "PAYLOAD_SCHEMA_INVALID", message: "同步 Payload 内容无效" };
  }
  const tasks = value.tasks.map((item) => normalizeTask(item)!);
  const taskIds = new Set(tasks.map((item) => item.id));
  if (taskIds.size !== value.tasks.length) {
    return { ok: false, code: "DUPLICATE_TASK_ID", message: "同步任务 ID 重复" };
  }
  return { ok: true, value: { ...(value as Omit<SyncPayload, "tasks">), tasks } };
}

export function validateProjectAiWindowMessage(input: {
  data: unknown;
  eventOrigin: string;
  currentOrigin: string;
  isTopFrame: boolean;
  allowedOrigins: readonly string[];
}): ValidationResult<
  | { kind: "ping" }
  | { kind: "open_board" }
  | { kind: "sync"; requestId: string; payload: SyncPayload }
  | { kind: "control"; requestId: string; syncBatchId: string; action: "pause" | "resume" | "cancel" }
> {
  if (!input.isTopFrame) return { ok: false, code: "IFRAME_REJECTED", message: "拒绝 iframe 消息" };
  if (
    input.eventOrigin !== input.currentOrigin ||
    !input.allowedOrigins.includes(input.eventOrigin)
  ) {
    return { ok: false, code: "ORIGIN_REJECTED", message: "拒绝不受信任来源" };
  }
  if (!object(input.data) || input.data.source !== PROJECT_AI_SOURCE || input.data.version !== PROTOCOL_VERSION) {
    return { ok: false, code: "MESSAGE_SCHEMA_INVALID", message: "消息字段无效" };
  }
  if (input.data.type === "PROJECT_AI_EXTENSION_PING") {
    return exactKeys(input.data, ["source", "type", "version"])
      ? { ok: true, value: { kind: "ping" } }
      : { ok: false, code: "MESSAGE_SCHEMA_INVALID", message: "消息字段无效" };
  }
  if (input.data.type === "PROJECT_AI_OPEN_WECOM_BOARD") {
    return exactKeys(input.data, ["source", "type", "version"])
      ? { ok: true, value: { kind: "open_board" } }
      : { ok: false, code: "MESSAGE_SCHEMA_INVALID", message: "消息字段无效" };
  }
  if (input.data.type === "PROJECT_AI_SYNC_TIMESHEET") {
    if (!exactKeys(input.data, ["source", "type", "version", "requestId", "payload"])) {
      return { ok: false, code: "MESSAGE_SCHEMA_INVALID", message: "消息字段无效" };
    }
    const payload = validateSyncPayload(input.data.payload);
    if (!payload.ok) return payload;
    if (input.data.requestId !== payload.value.request_id) {
      return { ok: false, code: "REQUEST_ID_MISMATCH", message: "请求 ID 不一致" };
    }
    return { ok: true, value: { kind: "sync", requestId: payload.value.request_id, payload: payload.value } };
  }
  if (input.data.type === "PROJECT_AI_SYNC_CONTROL") {
    if (
      !exactKeys(input.data, ["source", "type", "version", "requestId", "syncBatchId", "action"]) ||
      typeof input.data.requestId !== "string" ||
      !UUID.test(input.data.requestId) ||
      typeof input.data.syncBatchId !== "string" ||
      !UUID.test(input.data.syncBatchId) ||
      !["pause", "resume", "cancel"].includes(String(input.data.action))
    ) {
      return { ok: false, code: "CONTROL_SCHEMA_INVALID", message: "控制消息无效" };
    }
    return {
      ok: true,
      value: {
        kind: "control",
        requestId: input.data.requestId,
        syncBatchId: input.data.syncBatchId,
        action: input.data.action as "pause" | "resume" | "cancel",
      },
    };
  }
  return { ok: false, code: "MESSAGE_TYPE_INVALID", message: "未知消息类型" };
}

export function idempotencyKey(syncBatchId: string, taskId: string): string {
  if (!UUID.test(syncBatchId) || !taskId || taskId.length > 200) {
    throw new Error("INVALID_IDEMPOTENCY_INPUT");
  }
  return `${syncBatchId}:${taskId}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Exact canonical payload identity used for local replay protection. Keeping
 * the canonical value avoids treating a short, collision-prone checksum as a
 * trust decision. The same payload is already stored in extension-local
 * storage and this fingerprint never leaves the extension.
 */
export function protocolDigest(payload: SyncPayload): string {
  return canonicalJson(payload);
}
