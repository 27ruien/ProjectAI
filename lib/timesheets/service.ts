import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { createProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";
import {
  requireAiAssistantEnabled,
  type AiRuntimeConfig,
} from "@/lib/ai/project-assistant/config";
import type { AiGatewayResult } from "@/lib/ai/project-assistant/gateway";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { listAuthorizedProjects } from "@/lib/db/repositories/project-repository";
import {
  dailyTimesheetDraft,
  actionItem,
  timesheetAiExecution,
  timesheetSyncBatch,
  timesheetSyncItem,
  timesheetTask,
  workLogRecord,
  type DailyTimesheetDraft,
  type TimesheetSyncBatchRecord,
  type TimesheetTaskRecord,
  type WorkLogRecord,
} from "@/lib/db/schema";
import { requireTimesheetOrganization } from "./authorization";
import {
  generatedTimesheetOutputSchema,
  redactConnectorError,
  TIMESHEET_CATEGORIES,
  TIMESHEET_PROMPT_VERSION,
  TIMESHEET_SKILL_ID,
  TIMESHEET_STATUSES,
  TIMESHEET_SYNC_PROTOCOL_VERSION,
  type EditableTimesheetTask,
  type GeneratedTimesheetOutput,
  type TimesheetSyncPayload,
} from "./contracts";
import {
  requireDailyReportEnabled,
  requireWecomSyncEnabled,
} from "./config";
import { TimesheetError } from "./errors";
import { mockSmartSheetResult } from "./mock-smartsheet-provider";

const ACTIVE_BATCH_STATUSES = [
  "pending",
  "validating",
  "waiting_for_board",
  "waiting_for_login",
  "running",
  "paused",
] as const;

const TERMINAL_BATCH_STATUSES = new Set([
  "partially_synced",
  "synced",
  "failed",
  "cancelled",
]);

const ALLOWED_BATCH_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(["pending", "validating", "waiting_for_board", "waiting_for_login", "running", "paused", "partially_synced", "synced", "failed", "cancelled"]),
  validating: new Set(["validating", "waiting_for_board", "waiting_for_login", "running", "paused", "partially_synced", "synced", "failed", "cancelled"]),
  waiting_for_board: new Set(["waiting_for_board", "validating", "paused", "partially_synced", "synced", "failed", "cancelled"]),
  waiting_for_login: new Set(["waiting_for_login", "validating", "paused", "partially_synced", "synced", "failed", "cancelled"]),
  running: new Set(["running", "waiting_for_login", "paused", "partially_synced", "synced", "failed", "cancelled"]),
  paused: new Set(["paused", "validating", "running", "partially_synced", "synced", "failed", "cancelled"]),
};

const ALLOWED_ITEM_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(["pending", "validating", "waiting_for_login", "running", "saved", "unknown", "failed", "cancelled"]),
  validating: new Set(["validating", "waiting_for_login", "running", "saved", "unknown", "failed", "cancelled"]),
  waiting_for_login: new Set(["waiting_for_login", "pending", "running", "saved", "unknown", "failed", "cancelled"]),
  running: new Set(["running", "waiting_for_login", "saved", "unknown", "failed", "cancelled"]),
  failed: new Set(["failed", "running", "cancelled"]),
};

export function assertSyncBatchTransition(current: string, next: string): void {
  if (TERMINAL_BATCH_STATUSES.has(current) && current !== next) {
    throw new TimesheetError(
      409,
      "SYNC_BATCH_TERMINAL",
      "同步批次已经结束，不能重新打开",
    );
  }
  if (
    !TERMINAL_BATCH_STATUSES.has(current) &&
    !ALLOWED_BATCH_TRANSITIONS[current]?.has(next)
  ) {
    throw new TimesheetError(409, "SYNC_BATCH_TRANSITION_INVALID", "同步批次状态转换无效");
  }
}

export function assertSyncItemTransition(
  current: string,
  next: string,
  reconciliation?: { externalReference?: string | null; errorCode?: string | null },
): void {
  if (current === "saved" && next !== "saved") {
    throw new TimesheetError(409, "SYNC_ITEM_ALREADY_SAVED", "已保存任务不能回退状态");
  }
  const manualUnknownResolution =
    current === "unknown" &&
    ((next === "saved" && reconciliation?.externalReference === "manual-reconciliation") ||
      (next === "failed" && reconciliation?.errorCode === "MANUAL_RECONCILIATION_NOT_SAVED"));
  if (current === "unknown" && next !== "unknown" && !manualUnknownResolution) {
    throw new TimesheetError(
      409,
      "SYNC_ITEM_UNKNOWN_REVIEW_REQUIRED",
      "保存结果未知，必须人工核对后处理",
    );
  }
  if (current === "cancelled" && next !== "cancelled") {
    throw new TimesheetError(409, "SYNC_ITEM_CANCELLED", "已取消任务不能重新执行");
  }
  if (
    current !== "saved" &&
    current !== "unknown" &&
    current !== "cancelled" &&
    !ALLOWED_ITEM_TRANSITIONS[current]?.has(next)
  ) {
    throw new TimesheetError(409, "SYNC_ITEM_TRANSITION_INVALID", "同步任务状态转换无效");
  }
}

export function expectedSyncTerminalStatus(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  if (statuses.every((status) => status === "saved")) return "synced";
  if (statuses.every((status) => status === "failed")) return "failed";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (
    statuses.every((status) =>
      ["saved", "failed", "unknown", "cancelled"].includes(status),
    )
  ) {
    return "partially_synced";
  }
  return null;
}

type WorkLogInput = {
  organizationId: string;
  recordDate: string;
  recordedAt: string;
  rawText: string;
  source: "manual" | "voice" | "import";
  projectId?: string | null;
  projectHint?: string | null;
  hoursHint?: number | null;
  statusHint?: string | null;
};

export type GeneratedContext = {
  organizationId: string;
  reportDate: string;
  records: WorkLogRecord[];
  projects: Array<{
    id: string;
    name: string;
    stage: string;
    aliases: string[];
  }>;
};

function finiteDecimal(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function assertRecordedDate(recordedAt: Date, recordDate: string): void {
  if (shanghaiDate(recordedAt) !== recordDate) {
    throw new TimesheetError(
      422,
      "RECORDED_DATE_MISMATCH",
      "记录时间与日报日期不一致",
    );
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sourceDigest(records: WorkLogRecord[]): string {
  return digest(
    records.map((record) => ({
      id: record.id,
      rawText: record.rawText,
      projectId: record.projectId,
      projectHint: record.projectHint,
      hoursHint: record.hoursHint,
      statusHint: record.statusHint,
      recordedAt: record.recordedAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
  );
}

function errorCode(error: unknown): string {
  const value =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  return typeof value === "string" && /^[A-Z0-9_]{2,80}$/.test(value)
    ? value
    : "TIMESHEET_GENERATION_FAILED";
}

export function combineTimesheetGatewayResults(
  first: AiGatewayResult,
  second: AiGatewayResult,
): AiGatewayResult {
  const add = (left: number | null, right: number | null) =>
    left === null || right === null ? null : left + right;
  return {
    provider: second.provider,
    requestedModel: first.requestedModel,
    actualModel: second.actualModel,
    fallbackUsed: first.fallbackUsed || second.fallbackUsed,
    text: second.text,
    inputTokens: add(first.inputTokens, second.inputTokens),
    outputTokens: add(first.outputTokens, second.outputTokens),
    totalTokens: add(first.totalTokens, second.totalTokens),
    providerRequestId: second.providerRequestId,
    latencyMs: first.latencyMs + second.latencyMs,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new TimesheetError(422, "AI_OUTPUT_INVALID", "AI 工时草稿格式无效");
  }
}

function categoryById(id: string | null) {
  return id ? TIMESHEET_CATEGORIES.find((item) => item.id === id) ?? null : null;
}

function statusById(id: string | null) {
  return id ? TIMESHEET_STATUSES.find((item) => item.id === id) ?? null : null;
}

function escapedNumber(value: number): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function boundedNumber(value: number): string {
  return `(?:^|[^0-9.])${escapedNumber(value)}(?![0-9.])`;
}

function recordSupportsRegularHours(record: WorkLogRecord, hours: number): boolean {
  if (record.hoursHint !== null && Number(record.hoursHint) === hours) return true;
  if (new RegExp(`${boundedNumber(hours)}\\s*(?:小时|h\\b)`, "i").test(record.rawText)) {
    return true;
  }
  const minutes = hours * 60;
  if (
    Number.isInteger(minutes) &&
    new RegExp(`${boundedNumber(minutes)}\\s*(?:分钟|min\\b)`, "i").test(record.rawText)
  ) {
    return true;
  }
  const ranges = record.rawText.matchAll(
    /(\d{1,2})[:：](\d{2})\s*[-—~至到]\s*(\d{1,2})[:：](\d{2})/g,
  );
  for (const match of ranges) {
    const startHour = Number(match[1]);
    const startMinute = Number(match[2]);
    const endHour = Number(match[3]);
    const endMinute = Number(match[4]);
    if (
      startHour > 23 ||
      endHour > 23 ||
      startMinute > 59 ||
      endMinute > 59
    ) {
      continue;
    }
    if (endHour * 60 + endMinute - (startHour * 60 + startMinute) === minutes) {
      return true;
    }
  }
  return false;
}

function recordSupportsOvertime(record: WorkLogRecord, hours: number): boolean {
  const boundedAmount = boundedNumber(hours);
  const overtimeMarker = "(?:加班|晚间额外|夜间额外|周末额外|工作时间之外)";
  return (
    new RegExp(`${overtimeMarker}.{0,20}${boundedAmount}\\s*(?:小时|h\\b)`, "i").test(record.rawText) ||
    new RegExp(`${boundedAmount}\\s*(?:小时|h\\b).{0,20}${overtimeMarker}`, "i").test(record.rawText)
  );
}

function recordExplicitlyConfirmsNoOvertime(record: WorkLogRecord): boolean {
  return /(?:无|没有|未发生)加班|加班\s*(?:为|是|:|：)?\s*0(?:\.0+)?\s*(?:小时|h\b)?/i.test(
    record.rawText,
  );
}

function recordSupportsProgress(record: WorkLogRecord, progress: number): boolean {
  if (new RegExp(`(?:^|[^0-9.])${progress}(?![0-9.])\\s*%`).test(record.rawText)) return true;
  if (progress === 100 && /已完成|完成了|全部完成/.test(record.rawText)) return true;
  return progress === 0 && /未开始|尚未开始/.test(record.rawText);
}

function recordContradictsCompletion(record: WorkLogRecord): boolean {
  const status = record.statusHint?.trim().toLowerCase();
  if (status && ["in_progress", "blocked", "pending", "not_started"].includes(status)) {
    return true;
  }
  return /(?:计划|准备|待)(?:做|进行|开始|处理|完成|验证|联调)|讨论中|对齐中|待确认|尚未|未完成|进行中|阻塞/u.test(
    record.rawText,
  );
}

export function normalizeGeneratedOutput(
  raw: unknown,
  context: GeneratedContext,
  confidenceThreshold: number,
): GeneratedTimesheetOutput {
  const parsed = generatedTimesheetOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TimesheetError(422, "AI_OUTPUT_INVALID", "AI 工时草稿格式无效");
  }
  const projectIds = new Set(context.projects.map((project) => project.id));
  const recordsById = new Map(context.records.map((record) => [record.id, record]));
  const unresolved = new Set(parsed.data.unresolved_record_ids);
  for (const recordId of unresolved) {
    if (!recordsById.has(recordId)) {
      throw new TimesheetError(
        422,
        "AI_SOURCE_RECORD_INVALID",
        "AI 返回了不属于当前日报的来源记录",
      );
    }
  }

  const tasks = parsed.data.tasks.map((task) => {
    if (task.project_id && !projectIds.has(task.project_id)) {
      throw new TimesheetError(
        422,
        "AI_PROJECT_NOT_AUTHORIZED",
        "AI 返回了未授权项目",
      );
    }
    if (task.category_id && !categoryById(task.category_id)) {
      throw new TimesheetError(
        422,
        "AI_CATEGORY_INVALID",
        "AI 返回了不存在的工时分类",
      );
    }
    if (task.status && !statusById(task.status)) {
      throw new TimesheetError(
        422,
        "AI_STATUS_INVALID",
        "AI 返回了不存在的工作状态",
      );
    }
    const sources = task.source_record_ids.map((recordId) => {
      const record = recordsById.get(recordId);
      if (!record) {
        throw new TimesheetError(
          422,
          "AI_SOURCE_RECORD_INVALID",
          "AI 返回了不属于当前日报的来源记录",
        );
      }
      return record;
    });
    const explicitProjects = new Set(
      sources
        .map((record) => record.projectId)
        .filter((value): value is string => Boolean(value)),
    );
    if (explicitProjects.size > 1) {
      throw new TimesheetError(
        422,
        "AI_CROSS_PROJECT_MERGE",
        "AI 不能合并不同项目的记录",
      );
    }
    if (sources.length > 1) {
      throw new TimesheetError(
        422,
        "AI_MULTI_SOURCE_MERGE_REJECTED",
        "AI 草稿必须逐条保留来源；合并只能由用户审核后执行",
      );
    }
    if (
      task.project_id &&
      explicitProjects.size > 0 &&
      !explicitProjects.has(task.project_id)
    ) {
      throw new TimesheetError(
        422,
        "AI_PROJECT_CONTRADICTS_SOURCE",
        "AI 项目与原始记录不一致",
      );
    }
    if (
      task.hours !== null &&
      !sources.some((record) => recordSupportsRegularHours(record, task.hours!))
    ) {
      throw new TimesheetError(
        422,
        "AI_HOURS_WITHOUT_EVIDENCE",
        "AI 返回了没有事实依据的工时",
      );
    }
    const overtimeHours = task.overtime_hours ?? null;
    if (
      overtimeHours !== null &&
      (overtimeHours > 0
        ? !sources.some((record) => recordSupportsOvertime(record, overtimeHours))
        : !sources.some(recordExplicitlyConfirmsNoOvertime))
    ) {
      throw new TimesheetError(
        422,
        "AI_OVERTIME_WITHOUT_EVIDENCE",
        "AI 返回了没有事实依据的加班工时",
      );
    }
    if (task.hours !== null && overtimeHours !== null && task.hours + overtimeHours > 24) {
      throw new TimesheetError(422, "AI_TOTAL_HOURS_INVALID", "正常与加班工时合计超过 24 小时");
    }
    if (task.urgency !== null && task.urgency !== undefined) {
      throw new TimesheetError(
        422,
        "AI_URGENCY_NOT_CONFIGURED",
        "尚未配置受信任的紧急重要度候选项",
      );
    }
    const progress = task.progress ?? null;
    if (progress !== null && !sources.some((record) => recordSupportsProgress(record, progress))) {
      throw new TimesheetError(
        422,
        "AI_PROGRESS_WITHOUT_EVIDENCE",
        "AI 返回了没有事实依据的任务进度",
      );
    }
    if (
      task.status === "completed" &&
      sources.some(recordContradictsCompletion)
    ) {
      throw new TimesheetError(
        422,
        "AI_COMPLETION_CONTRADICTS_SOURCE",
        "AI 将未完成事项错误标记为已完成",
      );
    }
    const reviewFields = new Set(task.review_fields);
    const values = {
      description: task.description,
      project: task.project_id,
      hours: task.hours,
      overtimeHours,
      category: task.category_id,
      status: task.status,
      urgency: task.urgency ?? null,
      progress,
    } as const;
    for (const field of Object.keys(values) as Array<keyof typeof values>) {
      const confidence = task.confidence[field] ?? 0;
      if (values[field] === null || confidence < confidenceThreshold) {
        reviewFields.add(field);
      }
    }
    return {
      ...task,
      overtime_hours: overtimeHours,
      urgency: task.urgency ?? null,
      progress,
      needs_review: true,
      review_fields: [...reviewFields],
    };
  });
  const references = tasks.flatMap((task) => task.source_record_ids);
  const referenced = new Set(references);
  if (referenced.size !== references.length) {
    throw new TimesheetError(
      422,
      "AI_SOURCE_RECORD_DUPLICATED",
      "AI 重复使用了同一条来源记录",
    );
  }
  if ([...unresolved].some((recordId) => referenced.has(recordId))) {
    throw new TimesheetError(
      422,
      "AI_SOURCE_RECORD_CONFLICT",
      "AI 同时使用并标记了未解析来源记录",
    );
  }
  if (context.records.some((record) => !referenced.has(record.id) && !unresolved.has(record.id))) {
    throw new TimesheetError(
      422,
      "AI_SOURCE_RECORD_OMITTED",
      "AI 遗漏了本次日报来源记录",
    );
  }
  return { ...parsed.data, tasks };
}

export function validateGeneratedTimesheetText(
  text: string,
  context: GeneratedContext,
  confidenceThreshold = 0.85,
): GeneratedTimesheetOutput {
  return normalizeGeneratedOutput(parseJson(text), context, confidenceThreshold);
}

export function buildTimesheetPrompts(input: unknown): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: [
      "你是 ProjectAI 的项目经理工时整理器。只输出一个 JSON 对象，不得输出 Markdown。",
      "所有任务都必须引用本次输入中的 source_record_ids，且只能选择输入提供的项目、分类和状态。",
      "不得推测工时，不得为了凑满八小时补齐；没有依据时 hours 必须为 null。",
      "overtime_hours 只有在来源明确提到加班、晚间/周末额外工作及其工时时才能建议；未提到不等于 0，必须为 null。",
      "urgency 只能从输入提供的候选项选择；没有候选或无法判断时必须为 null。",
      "progress 只能来自明确百分比、明确完成=100 或明确未开始=0；不得仅根据状态猜测。",
      "计划、准备、讨论中、对齐中、待确认不得改写为 completed。",
      "描述使用‘动作 + 对象 + 结果或进展’，不同项目、交付物或状态必须分开。",
      "任务描述建议为 18—50 个汉字；不得使用‘跟进一下’或‘处理问题’等空泛描述。",
      "置信度低或字段为空时必须列入 review_fields。AI 输出永远只是待人工审核草稿。",
      `Prompt version: ${TIMESHEET_PROMPT_VERSION}`,
    ].join("\n"),
    userPrompt: `<timesheet_input_json>\n${JSON.stringify(input)}\n</timesheet_input_json>`,
  };
}

export function withTotalHoursWarning(
  output: GeneratedTimesheetOutput,
): GeneratedTimesheetOutput {
  const total = output.tasks.reduce(
    (sum, task) => sum + (task.hours ?? 0) + (task.overtime_hours ?? 0),
    0,
  );
  if (
    total <= 16 ||
    output.warnings.some((warning) => warning.startsWith("TOTAL_HOURS:"))
  ) {
    return output;
  }
  return {
    ...output,
    warnings: [...output.warnings, `TOTAL_HOURS:${total}，请确认是否准确`],
  };
}

function buildRepairPrompts(input: unknown, invalidOutput: string) {
  const base = buildTimesheetPrompts(input);
  return {
    systemPrompt: `${base.systemPrompt}\n上一次输出未通过严格 Schema 或事实校验。只修复格式和受控字段，不得添加新事实。`,
    userPrompt: `${base.userPrompt}\n<invalid_output_json>\n${JSON.stringify(invalidOutput.slice(0, 12_000))}\n</invalid_output_json>`,
  };
}

type WorkLogConsumptionStatus = "unprocessed" | "included" | "submitted";

function serializeRecord(
  record: WorkLogRecord,
  consumptionStatus: WorkLogConsumptionStatus,
) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    recordDate: record.recordDate,
    recordedAt: record.recordedAt.toISOString(),
    rawText: record.rawText,
    source: record.source,
    projectId: record.projectId,
    projectHint: record.projectHint,
    hoursHint: finiteDecimal(record.hoursHint),
    statusHint: record.statusHint,
    consumptionStatus,
    includedInDraft: consumptionStatus === "included",
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function serializeTask(
  task: TimesheetTaskRecord,
  external?: {
    externalReference: string | null;
    externalUrl: string | null;
    savedAt: Date | null;
  },
) {
  return {
    id: task.id,
    description: task.description,
    projectId: task.projectId,
    projectName: task.projectNameSnapshot,
    hours: finiteDecimal(task.hours),
    regularHours: finiteDecimal(task.hours),
    overtimeHours: finiteDecimal(task.overtimeHours),
    categoryId: task.categoryId,
    categoryName: task.categoryNameSnapshot,
    workStatus: task.workStatus,
    workStatusName: task.workStatusNameSnapshot,
    urgency: task.urgencyNameSnapshot,
    progress: task.progress,
    confidence: task.confidence,
    needsReview: task.needsReview,
    reviewFields: task.reviewFields,
    sourceRecordIds: task.sourceRecordIds,
    sortOrder: task.sortOrder,
    submissionStatus: task.submissionStatus,
    submittedAt: task.submittedAt?.toISOString() ?? null,
    confirmedAt: task.confirmedAt?.toISOString() ?? null,
    externalReference: external?.externalReference ?? null,
    externalUrl: external?.externalUrl ?? null,
    savedAt: external?.savedAt?.toISOString() ?? null,
  };
}

async function draftPayload(draft: DailyTimesheetDraft, db: DatabaseExecutor) {
  const tasks = await db
    .select()
    .from(timesheetTask)
    .where(eq(timesheetTask.draftId, draft.id))
    .orderBy(asc(timesheetTask.sortOrder));
  const savedItems = tasks.length
    ? await db
        .select({
          taskId: timesheetSyncItem.taskId,
          externalReference: timesheetSyncItem.externalReference,
          externalUrl: timesheetSyncItem.externalUrl,
          savedAt: timesheetSyncItem.savedAt,
          updatedAt: timesheetSyncItem.updatedAt,
        })
        .from(timesheetSyncItem)
        .where(
          and(
            inArray(timesheetSyncItem.taskId, tasks.map((task) => task.id)),
            eq(timesheetSyncItem.status, "saved"),
          ),
        )
        .orderBy(desc(timesheetSyncItem.updatedAt))
    : [];
  const savedByTask = new Map<
    string,
    (typeof savedItems)[number]
  >();
  for (const item of savedItems) {
    if (!savedByTask.has(item.taskId)) savedByTask.set(item.taskId, item);
  }
  const activeTasks = tasks.filter((task) => task.submissionStatus !== "submitted");
  const submittedTasks = tasks.filter((task) => task.submissionStatus === "submitted");
  const activeHours = activeTasks.reduce(
    (sum, task) =>
      sum + (finiteDecimal(task.hours) ?? 0) + (finiteDecimal(task.overtimeHours) ?? 0),
    0,
  );
  const submittedHours = submittedTasks.reduce(
    (sum, task) =>
      sum + (finiteDecimal(task.hours) ?? 0) + (finiteDecimal(task.overtimeHours) ?? 0),
    0,
  );
  return {
    id: draft.id,
    organizationId: draft.organizationId,
    reportDate: draft.reportDate,
    status: draft.status,
    version: draft.version,
    totalHours: finiteDecimal(draft.totalHours) ?? 0,
    warnings: draft.warnings,
    unresolvedRecordIds: draft.unresolvedRecordIds,
    generatedAt: draft.generatedAt?.toISOString() ?? null,
    confirmedAt: draft.confirmedAt?.toISOString() ?? null,
    aiProvider: draft.aiProvider,
    aiModel: draft.aiModel,
    updatedAt: draft.updatedAt.toISOString(),
    tasks: activeTasks.map((task) => serializeTask(task, savedByTask.get(task.id))),
    submittedTasks: submittedTasks.map((task) =>
      serializeTask(task, savedByTask.get(task.id)),
    ),
    summary: {
      pendingCount: activeTasks.length,
      submittedCount: submittedTasks.length,
      pendingHours: activeHours,
      submittedHours,
      cumulativeHours: activeHours + submittedHours,
    },
  };
}

async function requireOwnedDraft(
  principal: AuthenticatedPrincipal,
  draftId: string,
  organizationId: string,
  db: DatabaseExecutor,
  lockForUpdate = false,
) {
  const query = db
    .select()
    .from(dailyTimesheetDraft)
    .where(
      and(
        eq(dailyTimesheetDraft.id, draftId),
        eq(dailyTimesheetDraft.organizationId, organizationId),
        eq(dailyTimesheetDraft.userId, principal.user.id),
      ),
    )
    .limit(1);
  const [draft] = lockForUpdate
    ? await query.for("update", { of: dailyTimesheetDraft })
    : await query;
  if (!draft) throw new TimesheetError(404, "NOT_FOUND", "工作日报不存在");
  return draft;
}

async function requireProjectInOrganization(
  principal: AuthenticatedPrincipal,
  projectId: string,
  organizationId: string,
  requestHeaders: Headers,
  db?: DatabaseExecutor,
) {
  const project = await requireProjectAccess(principal, projectId, requestHeaders, {
    db,
  });
  if (project.organizationId !== organizationId) {
    throw new TimesheetError(404, "NOT_FOUND", "项目不存在");
  }
  return project;
}

async function invalidateEditableDraft(
  organizationId: string,
  userId: string,
  reportDate: string,
  db: DatabaseExecutor,
) {
  await db
    .update(dailyTimesheetDraft)
    .set({
      status: "needs_review",
      confirmedAt: null,
      version: sql`${dailyTimesheetDraft.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyTimesheetDraft.organizationId, organizationId),
        eq(dailyTimesheetDraft.userId, userId),
        eq(dailyTimesheetDraft.reportDate, reportDate),
        inArray(dailyTimesheetDraft.status, [
          "draft",
          "needs_review",
          "confirmed",
          "synced",
        ]),
      ),
    );
}

async function requireMutableWorkLog(
  organizationId: string,
  userId: string,
  reportDate: string,
  recordId: string,
  db: DatabaseExecutor,
): Promise<void> {
  const linked = await db
    .select({ submissionStatus: timesheetTask.submissionStatus })
    .from(timesheetTask)
    .innerJoin(
      dailyTimesheetDraft,
      eq(dailyTimesheetDraft.id, timesheetTask.draftId),
    )
    .where(
      and(
        eq(dailyTimesheetDraft.organizationId, organizationId),
        eq(dailyTimesheetDraft.userId, userId),
        eq(dailyTimesheetDraft.reportDate, reportDate),
        sql`${timesheetTask.sourceRecordIds} @> ${JSON.stringify([recordId])}::jsonb`,
      ),
    );
  if (linked.some((task) => task.submissionStatus === "submitted")) {
    throw new TimesheetError(
      409,
      "WORK_LOG_ALREADY_SUBMITTED",
      "已提交任务的来源随记不可修改",
    );
  }
  if (
    linked.some((task) =>
      ["syncing", "failed", "unknown"].includes(task.submissionStatus),
    )
  ) {
    throw new TimesheetError(409, "WORK_LOG_SYNC_LOCKED", "该随记正在同步或等待核对");
  }
}

async function requireTaskProjectAccess(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  tasks: Array<{ projectId: string | null }>;
  requestHeaders: Headers;
  db: DatabaseExecutor;
}): Promise<void> {
  const projectIds = [
    ...new Set(
      input.tasks
        .map((task) => task.projectId)
        .filter((projectId): projectId is string => Boolean(projectId)),
    ),
  ];
  for (const projectId of projectIds) {
    await requireProjectInOrganization(
      input.principal,
      projectId,
      input.organizationId,
      input.requestHeaders,
      input.db,
    );
  }
}

export async function listWorkLogs(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const records = await db
    .select()
    .from(workLogRecord)
    .where(
      and(
        eq(workLogRecord.organizationId, input.organizationId),
        eq(workLogRecord.userId, input.principal.user.id),
        eq(workLogRecord.recordDate, input.reportDate),
        eq(workLogRecord.isArchived, false),
      ),
    )
    .orderBy(asc(workLogRecord.recordedAt));
  await requireTaskProjectAccess({
    principal: input.principal,
    organizationId: input.organizationId,
    tasks: records,
    requestHeaders: input.requestHeaders,
    db,
  });
  const [draft] = await db
    .select({ id: dailyTimesheetDraft.id })
    .from(dailyTimesheetDraft)
    .where(
      and(
        eq(dailyTimesheetDraft.organizationId, input.organizationId),
        eq(dailyTimesheetDraft.userId, input.principal.user.id),
        eq(dailyTimesheetDraft.reportDate, input.reportDate),
      ),
    )
    .limit(1);
  const statusesByRecord = new Map<string, string[]>();
  if (draft) {
    const rows = await db
      .select({
        sourceRecordIds: timesheetTask.sourceRecordIds,
        submissionStatus: timesheetTask.submissionStatus,
      })
      .from(timesheetTask)
      .where(eq(timesheetTask.draftId, draft.id));
    for (const row of rows) {
      for (const id of row.sourceRecordIds) {
        statusesByRecord.set(id, [
          ...(statusesByRecord.get(id) ?? []),
          row.submissionStatus,
        ]);
      }
    }
  }
  return {
    records: records.map((record) => {
      const statuses = statusesByRecord.get(record.id) ?? [];
      const consumptionStatus: WorkLogConsumptionStatus =
        statuses.length === 0
          ? "unprocessed"
          : statuses.every((status) => status === "submitted")
            ? "submitted"
            : "included";
      return serializeRecord(record, consumptionStatus);
    }),
  };
}

export async function createWorkLog(input: {
  principal: AuthenticatedPrincipal;
  values: WorkLogInput;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.values.organizationId,
    input.requestHeaders,
  );
  if (input.values.projectId) {
    await requireProjectInOrganization(
      input.principal,
      input.values.projectId,
      input.values.organizationId,
      input.requestHeaders,
    );
  }
  const recordedAt = new Date(input.values.recordedAt);
  assertRecordedDate(recordedAt, input.values.recordDate);
  const db = getDb();
  const record = await db.transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.values.organizationId,
      input.requestHeaders,
      tx,
    );
    if (input.values.projectId) {
      await requireProjectInOrganization(
        input.principal,
        input.values.projectId,
        input.values.organizationId,
        input.requestHeaders,
        tx,
      );
    }
    const [created] = await tx
      .insert(workLogRecord)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.values.organizationId,
        userId: input.principal.user.id,
        recordDate: input.values.recordDate,
        recordedAt,
        rawText: input.values.rawText,
        source: input.values.source,
        projectId: input.values.projectId ?? null,
        projectHint: input.values.projectHint ?? null,
        hoursHint:
          input.values.hoursHint === null || input.values.hoursHint === undefined
            ? null
            : String(input.values.hoursHint),
        statusHint: input.values.statusHint ?? null,
      })
      .returning();
    await invalidateEditableDraft(
      input.values.organizationId,
      input.principal.user.id,
      input.values.recordDate,
      tx,
    );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.values.projectId ?? null,
        eventType: "work_log.created",
        entityType: "work_log_record",
        entityId: created.id,
        result: "succeeded",
        metadata: {
          organizationId: input.values.organizationId,
          reportDate: input.values.recordDate,
          source: input.values.source,
          rawTextLength: input.values.rawText.length,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return created;
  });
  return serializeRecord(record, "unprocessed");
}

export async function updateWorkLog(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  recordId: string;
  values: Partial<Omit<WorkLogInput, "organizationId" | "recordDate">>;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const [current] = await tx
      .select()
      .from(workLogRecord)
      .where(
        and(
          eq(workLogRecord.id, input.recordId),
          eq(workLogRecord.organizationId, input.organizationId),
          eq(workLogRecord.userId, input.principal.user.id),
          eq(workLogRecord.isArchived, false),
        ),
      )
      .limit(1)
      .for("update", { of: workLogRecord });
    if (!current) throw new TimesheetError(404, "NOT_FOUND", "工作随记不存在");
    const effectiveProjectId =
      input.values.projectId === undefined ? current.projectId : input.values.projectId;
    if (effectiveProjectId) {
      await requireProjectInOrganization(
        input.principal,
        effectiveProjectId,
        input.organizationId,
        input.requestHeaders,
        tx,
      );
    }
    await requireMutableWorkLog(
      input.organizationId,
      input.principal.user.id,
      current.recordDate,
      current.id,
      tx,
    );
    const recordedAt = input.values.recordedAt
      ? new Date(input.values.recordedAt)
      : current.recordedAt;
    assertRecordedDate(recordedAt, current.recordDate);
    const [updated] = await tx
      .update(workLogRecord)
      .set({
        ...(input.values.recordedAt ? { recordedAt } : {}),
        ...(input.values.rawText !== undefined
          ? { rawText: input.values.rawText }
          : {}),
        ...(input.values.source !== undefined ? { source: input.values.source } : {}),
        ...(input.values.projectId !== undefined
          ? { projectId: input.values.projectId }
          : {}),
        ...(input.values.projectHint !== undefined
          ? { projectHint: input.values.projectHint }
          : {}),
        ...(input.values.hoursHint !== undefined
          ? {
              hoursHint:
                input.values.hoursHint === null
                  ? null
                  : String(input.values.hoursHint),
            }
          : {}),
        ...(input.values.statusHint !== undefined
          ? { statusHint: input.values.statusHint }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workLogRecord.id, current.id))
      .returning();
    await invalidateEditableDraft(
      input.organizationId,
      input.principal.user.id,
      current.recordDate,
      tx,
    );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: updated.projectId,
        eventType: "work_log.updated",
        entityType: "work_log_record",
        entityId: current.id,
        result: "succeeded",
        metadata: { organizationId: input.organizationId, reportDate: current.recordDate },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return serializeRecord(updated, "unprocessed");
  });
}

export async function deleteWorkLog(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  recordId: string;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const [current] = await tx
      .select()
      .from(workLogRecord)
      .where(
        and(
          eq(workLogRecord.id, input.recordId),
          eq(workLogRecord.organizationId, input.organizationId),
          eq(workLogRecord.userId, input.principal.user.id),
          eq(workLogRecord.isArchived, false),
        ),
      )
      .limit(1)
      .for("update", { of: workLogRecord });
    if (!current) throw new TimesheetError(404, "NOT_FOUND", "工作随记不存在");
    if (current.projectId) {
      await requireProjectInOrganization(
        input.principal,
        current.projectId,
        input.organizationId,
        input.requestHeaders,
        tx,
      );
    }
    await requireMutableWorkLog(
      input.organizationId,
      input.principal.user.id,
      current.recordDate,
      current.id,
      tx,
    );
    await tx
      .update(workLogRecord)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(workLogRecord.id, current.id));
    await invalidateEditableDraft(
      input.organizationId,
      input.principal.user.id,
      current.recordDate,
      tx,
    );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: current.projectId,
        eventType: "work_log.deleted",
        entityType: "work_log_record",
        entityId: current.id,
        result: "succeeded",
        metadata: { organizationId: input.organizationId, reportDate: current.recordDate },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return { deleted: true };
  });
}

async function beginExecution(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  sourceSelectionDigest: string;
  sourceCount: number;
  config: AiRuntimeConfig;
  requestHeaders: Headers;
}) {
  const id = crypto.randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.principal.user.id}:${input.reportDate}:timesheet-ai`}, 0))`,
    );
    const staleBefore = new Date(Date.now() - input.config.executionStaleAfterMs);
    const recovered = await tx
      .update(timesheetAiExecution)
      .set({
        status: "failed",
        failureCode: "AI_EXECUTION_STALE",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(timesheetAiExecution.organizationId, input.organizationId),
          eq(timesheetAiExecution.userId, input.principal.user.id),
          eq(timesheetAiExecution.reportDate, input.reportDate),
          eq(timesheetAiExecution.status, "running"),
          sql`${timesheetAiExecution.createdAt} <= ${staleBefore}`,
        ),
      )
      .returning({ id: timesheetAiExecution.id });
    for (const stale of recovered) {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          eventType: "timesheet.ai_stale_recovered",
          entityType: "timesheet_ai_execution",
          entityId: stale.id,
          result: "failed",
          metadata: {
            organizationId: input.organizationId,
            reportDate: input.reportDate,
            failureCode: "AI_EXECUTION_STALE",
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
    }
    const [running] = await tx
      .select({ id: timesheetAiExecution.id })
      .from(timesheetAiExecution)
      .where(
        and(
          eq(timesheetAiExecution.organizationId, input.organizationId),
          eq(timesheetAiExecution.userId, input.principal.user.id),
          eq(timesheetAiExecution.reportDate, input.reportDate),
          eq(timesheetAiExecution.status, "running"),
        ),
      )
      .limit(1);
    if (running) {
      throw new TimesheetError(
        409,
        "TIMESHEET_GENERATION_IN_PROGRESS",
        "今日工时正在整理，请稍后再试",
      );
    }
    await tx.insert(timesheetAiExecution).values({
      id,
      executionId: id,
      organizationId: input.organizationId,
      userId: input.principal.user.id,
      reportDate: input.reportDate,
      skillId: TIMESHEET_SKILL_ID,
      modelProfileId: input.config.profileId,
      promptVersion: TIMESHEET_PROMPT_VERSION,
      sourceSelectionDigest: input.sourceSelectionDigest,
      sourceCount: input.sourceCount,
    });
  });
  return id;
}

async function failExecution(
  executionId: string,
  error: unknown,
  result?: AiGatewayResult,
) {
  await getDb()
    .update(timesheetAiExecution)
    .set({
      status: "failed",
      provider: result?.provider,
      actualModel: result?.actualModel,
      inputTokens: result?.inputTokens,
      outputTokens: result?.outputTokens,
      totalTokens: result?.totalTokens,
      latencyMs: result?.latencyMs,
      failureCode: errorCode(error),
      completedAt: new Date(),
    })
    .where(eq(timesheetAiExecution.id, executionId));
}

async function generationRecords(
  records: WorkLogRecord[],
  input: {
    organizationId: string;
    userId: string;
    reportDate: string;
    db: DatabaseExecutor;
  },
): Promise<WorkLogRecord[]> {
  const [draft] = await input.db
    .select({ id: dailyTimesheetDraft.id })
    .from(dailyTimesheetDraft)
    .where(
      and(
        eq(dailyTimesheetDraft.organizationId, input.organizationId),
        eq(dailyTimesheetDraft.userId, input.userId),
        eq(dailyTimesheetDraft.reportDate, input.reportDate),
      ),
    )
    .limit(1);
  if (!draft) return records;
  const tasks = await input.db
    .select({
      sourceRecordIds: timesheetTask.sourceRecordIds,
      submissionStatus: timesheetTask.submissionStatus,
    })
    .from(timesheetTask)
    .where(eq(timesheetTask.draftId, draft.id));
  if (
    tasks.some((task) =>
      ["syncing", "failed", "unknown"].includes(task.submissionStatus),
    )
  ) {
    throw new TimesheetError(
      409,
      "TIMESHEET_UNRESOLVED_SYNC_ITEMS",
      "请先完成失败项重试或未知项人工核对，再整理下一批工时",
    );
  }
  const submittedRecordIds = new Set(
    tasks
      .filter((task) => task.submissionStatus === "submitted")
      .flatMap((task) => task.sourceRecordIds),
  );
  return records.filter((record) => !submittedRecordIds.has(record.id));
}

export async function generateDailyTimesheet(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  timezone: "Asia/Shanghai";
  requestHeaders: Headers;
}) {
  const feature = requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const allRecords = await db
    .select()
    .from(workLogRecord)
    .where(
      and(
        eq(workLogRecord.organizationId, input.organizationId),
        eq(workLogRecord.userId, input.principal.user.id),
        eq(workLogRecord.recordDate, input.reportDate),
        eq(workLogRecord.isArchived, false),
      ),
    )
    .orderBy(asc(workLogRecord.recordedAt));
  if (allRecords.length === 0) {
    throw new TimesheetError(
      422,
      "TIMESHEET_RECORDS_REQUIRED",
      "请先添加至少一条今日随记",
    );
  }
  const records = await db.transaction(async (tx) => {
    const selected = await generationRecords(allRecords, {
      organizationId: input.organizationId,
      userId: input.principal.user.id,
      reportDate: input.reportDate,
      db: tx,
    });
    if (selected.length === 0) {
      throw new TimesheetError(
        422,
        "TIMESHEET_NO_UNPROCESSED_RECORDS",
        "今天没有新的未提交随记",
      );
    }
    await requireTaskProjectAccess({
      principal: input.principal,
      organizationId: input.organizationId,
      tasks: selected,
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return selected;
  });
  const config = requireAiAssistantEnabled();
  const authorized = (
    await listAuthorizedProjects(
      input.principal.user.id,
      input.principal.user.systemRole,
    )
  ).filter((project) => project.organizationId === input.organizationId);
  const projects = authorized.map((project) => ({
    id: project.id,
    name: project.name,
    stage: project.stage,
    aliases: [...new Set([project.name, project.clientName])],
  }));
  const context: GeneratedContext = {
    organizationId: input.organizationId,
    reportDate: input.reportDate,
    records,
    projects,
  };
  const currentActionPlans = projects.length === 0
    ? []
    : await db
        .select({
          id: actionItem.id,
          projectId: actionItem.projectId,
          title: actionItem.title,
          description: actionItem.description,
          status: actionItem.status,
          dueDate: actionItem.dueDate,
        })
        .from(actionItem)
        .where(
          and(
            inArray(actionItem.projectId, projects.map((item) => item.id)),
            inArray(actionItem.status, ["todo", "in_progress", "blocked"]),
          ),
        )
        .orderBy(asc(actionItem.dueDate), asc(actionItem.code))
        .limit(100);
  const aiInput = {
    date: input.reportDate,
    user_timezone: input.timezone,
    current_project: null,
    today_records: records.map((record) => ({
      id: record.id,
      recorded_at: record.recordedAt.toISOString(),
      raw_text: record.rawText,
      project_id: record.projectId,
      project_hint: record.projectHint,
      hours_hint: finiteDecimal(record.hoursHint),
      status_hint: record.statusHint,
    })),
    today_meetings: [],
    current_action_plans: currentActionPlans.map((item) => ({
      id: item.id,
      project_id: item.projectId,
      title: item.title,
      description: item.description,
      status: item.status,
      due_date: item.dueDate,
    })),
    available_projects: projects,
    available_categories: TIMESHEET_CATEGORIES,
    available_statuses: TIMESHEET_STATUSES,
  };
  const selectionDigest = sourceDigest(records);
  const executionId = await beginExecution({
    principal: input.principal,
    organizationId: input.organizationId,
    reportDate: input.reportDate,
    sourceSelectionDigest: selectionDigest,
    sourceCount: records.length,
    config,
    requestHeaders: input.requestHeaders,
  });
  const gateway = createProjectAssistantGateway(config);
  let gatewayResult: AiGatewayResult | undefined;
  try {
    const prompts = buildTimesheetPrompts(aiInput);
    gatewayResult = await gateway.generate({
      ...prompts,
      purpose: "timesheet_generation",
    });
    let output: GeneratedTimesheetOutput;
    try {
      output = withTotalHoursWarning(
        normalizeGeneratedOutput(
          parseJson(gatewayResult.text),
          context,
          feature.confidenceThreshold,
        ),
      );
    } catch (firstError) {
      if (!(firstError instanceof TimesheetError)) throw firstError;
      const repair = buildRepairPrompts(aiInput, gatewayResult.text);
      const repaired = await gateway.generate({
        ...repair,
        purpose: "timesheet_repair",
      });
      gatewayResult = combineTimesheetGatewayResults(gatewayResult, repaired);
      output = withTotalHoursWarning(
        normalizeGeneratedOutput(
          parseJson(gatewayResult.text),
          context,
          feature.confidenceThreshold,
        ),
      );
    }

    const saved = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.principal.user.id}:${input.reportDate}:timesheet-save`}, 0))`,
      );
      await requireTimesheetOrganization(
        input.principal,
        input.organizationId,
        input.requestHeaders,
        tx,
      );
      const currentAllRecords = await tx
        .select()
        .from(workLogRecord)
        .where(
          and(
            eq(workLogRecord.organizationId, input.organizationId),
            eq(workLogRecord.userId, input.principal.user.id),
            eq(workLogRecord.recordDate, input.reportDate),
            eq(workLogRecord.isArchived, false),
          ),
        )
        .orderBy(asc(workLogRecord.recordedAt));
      const currentRecords = await generationRecords(currentAllRecords, {
        organizationId: input.organizationId,
        userId: input.principal.user.id,
        reportDate: input.reportDate,
        db: tx,
      });
      if (sourceDigest(currentRecords) !== selectionDigest) {
        throw new TimesheetError(
          409,
          "TIMESHEET_SOURCE_CHANGED",
          "随记在 AI 整理期间发生变化，请重新生成",
        );
      }
      await requireTaskProjectAccess({
        principal: input.principal,
        organizationId: input.organizationId,
        tasks: currentRecords,
        requestHeaders: input.requestHeaders,
        db: tx,
      });
      const [activeBatch] = await tx
        .select({ id: timesheetSyncBatch.id })
        .from(timesheetSyncBatch)
        .innerJoin(
          dailyTimesheetDraft,
          eq(dailyTimesheetDraft.id, timesheetSyncBatch.draftId),
        )
        .where(
          and(
            eq(dailyTimesheetDraft.organizationId, input.organizationId),
            eq(dailyTimesheetDraft.userId, input.principal.user.id),
            eq(dailyTimesheetDraft.reportDate, input.reportDate),
            inArray(timesheetSyncBatch.status, [...ACTIVE_BATCH_STATUSES]),
          ),
        )
        .limit(1);
      if (activeBatch) {
        throw new TimesheetError(
          409,
          "TIMESHEET_SYNC_ACTIVE",
          "当前日报存在活动同步批次",
        );
      }
      const existing = await tx
        .select()
        .from(dailyTimesheetDraft)
        .where(
          and(
            eq(dailyTimesheetDraft.organizationId, input.organizationId),
            eq(dailyTimesheetDraft.userId, input.principal.user.id),
            eq(dailyTimesheetDraft.reportDate, input.reportDate),
          ),
        )
        .limit(1)
        .for("update", { of: dailyTimesheetDraft });
      const draftId = existing[0]?.id ?? crypto.randomUUID();
      const verifiedProjects = new Map<string, { id: string; name: string }>();
      for (const projectId of [
        ...new Set(
          output.tasks
            .map((task) => task.project_id)
            .filter((value): value is string => Boolean(value)),
        ),
      ]) {
        const project = await requireProjectInOrganization(
          input.principal,
          projectId,
          input.organizationId,
          input.requestHeaders,
          tx,
        );
        verifiedProjects.set(project.id, { id: project.id, name: project.name });
      }
      const [{ submittedCount }] = existing[0]
        ? await tx
            .select({ submittedCount: sql<number>`count(*)::int` })
            .from(timesheetTask)
            .where(
              and(
                eq(timesheetTask.draftId, draftId),
                eq(timesheetTask.submissionStatus, "submitted"),
              ),
            )
        : [{ submittedCount: 0 }];
      if (existing[0]) {
        await tx
          .delete(timesheetTask)
          .where(
            and(
              eq(timesheetTask.draftId, draftId),
              inArray(timesheetTask.submissionStatus, [
                "draft",
                "confirmed",
                "cancelled",
              ]),
            ),
          );
        await tx
          .update(dailyTimesheetDraft)
          .set({
            status: "needs_review",
            version: existing[0].version + 1,
            totalHours: String(
              output.tasks.reduce(
                (sum, task) =>
                  sum + (task.hours ?? 0) + (task.overtime_hours ?? 0),
                0,
              ),
            ),
            warnings: output.warnings,
            unresolvedRecordIds: output.unresolved_record_ids,
            aiProvider: gatewayResult!.provider,
            aiModel: gatewayResult!.actualModel,
            promptVersion: TIMESHEET_PROMPT_VERSION,
            generatedAt: new Date(),
            confirmedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(dailyTimesheetDraft.id, draftId));
      } else {
        await tx.insert(dailyTimesheetDraft).values({
          id: draftId,
          organizationId: input.organizationId,
          userId: input.principal.user.id,
          reportDate: input.reportDate,
          status: "needs_review",
          totalHours: String(
            output.tasks.reduce(
              (sum, task) =>
                sum + (task.hours ?? 0) + (task.overtime_hours ?? 0),
              0,
            ),
          ),
          warnings: output.warnings,
          unresolvedRecordIds: output.unresolved_record_ids,
          aiProvider: gatewayResult!.provider,
          aiModel: gatewayResult!.actualModel,
          promptVersion: TIMESHEET_PROMPT_VERSION,
          generatedAt: new Date(),
        });
      }
      await tx.insert(timesheetTask).values(
        output.tasks.map((task, index) => {
          const project = task.project_id
            ? verifiedProjects.get(task.project_id)
            : null;
          const category = categoryById(task.category_id);
          const status = statusById(task.status);
          return {
            id: crypto.randomUUID(),
            draftId,
            description: task.description,
            projectId: task.project_id,
            projectNameSnapshot: project?.name ?? "",
            hours: task.hours === null ? null : String(task.hours),
            overtimeHours:
              task.overtime_hours == null ? null : String(task.overtime_hours),
            categoryId: task.category_id,
            categoryNameSnapshot: category?.name ?? "",
            workStatus: task.status,
            workStatusNameSnapshot: status?.name ?? "",
            urgencyNameSnapshot: task.urgency,
            progress: task.progress,
            confidence: task.confidence,
            needsReview: task.needs_review,
            reviewFields: task.review_fields,
            sourceRecordIds: task.source_record_ids,
            sortOrder: submittedCount + index,
            submissionStatus: "draft",
          };
        }),
      );
      await tx
        .update(timesheetAiExecution)
        .set({
          draftId,
          status: "succeeded",
          provider: gatewayResult!.provider,
          actualModel: gatewayResult!.actualModel,
          outputCount: output.tasks.length,
          inputTokens: gatewayResult!.inputTokens,
          outputTokens: gatewayResult!.outputTokens,
          totalTokens: gatewayResult!.totalTokens,
          latencyMs: gatewayResult!.latencyMs,
          completedAt: new Date(),
        })
        .where(eq(timesheetAiExecution.id, executionId));
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          eventType: "timesheet.generated",
          entityType: "daily_timesheet_draft",
          entityId: draftId,
          result: "succeeded",
          metadata: {
            organizationId: input.organizationId,
            reportDate: input.reportDate,
            sourceCount: records.length,
            taskCount: output.tasks.length,
            executionId,
            promptVersion: TIMESHEET_PROMPT_VERSION,
            provider: gatewayResult!.provider,
            model: gatewayResult!.actualModel,
            mode: gatewayResult!.provider === "fake" ? "mock" : "real",
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      const [draft] = await tx
        .select()
        .from(dailyTimesheetDraft)
        .where(eq(dailyTimesheetDraft.id, draftId));
      return draftPayload(draft, tx);
    });
    return saved;
  } catch (error) {
    await failExecution(executionId, error, gatewayResult);
    throw error;
  }
}

export async function getDailyDraft(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const [draft] = await db
    .select()
    .from(dailyTimesheetDraft)
    .where(
      and(
        eq(dailyTimesheetDraft.organizationId, input.organizationId),
        eq(dailyTimesheetDraft.userId, input.principal.user.id),
        eq(dailyTimesheetDraft.reportDate, input.reportDate),
      ),
    )
    .limit(1);
  if (!draft) return { draft: null };
  const tasks = await db
    .select({ projectId: timesheetTask.projectId })
    .from(timesheetTask)
    .where(eq(timesheetTask.draftId, draft.id));
  await requireTaskProjectAccess({
    principal: input.principal,
    organizationId: input.organizationId,
    tasks,
    requestHeaders: input.requestHeaders,
    db,
  });
  return { draft: await draftPayload(draft, db) };
}

async function validateEditableTasks(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  tasks: EditableTimesheetTask[];
  requestHeaders: Headers;
  db: DatabaseExecutor;
}) {
  const sourceIds = [...new Set(input.tasks.flatMap((task) => task.sourceRecordIds))];
  const records = sourceIds.length
    ? await input.db
        .select({ id: workLogRecord.id, projectId: workLogRecord.projectId })
        .from(workLogRecord)
        .where(
          and(
            inArray(workLogRecord.id, sourceIds),
            eq(workLogRecord.organizationId, input.organizationId),
            eq(workLogRecord.userId, input.principal.user.id),
            eq(workLogRecord.recordDate, input.reportDate),
            eq(workLogRecord.isArchived, false),
          ),
        )
    : [];
  if (records.length !== sourceIds.length) {
    throw new TimesheetError(422, "SOURCE_RECORD_INVALID", "日报来源记录无效");
  }
  const projectIds = [...new Set(input.tasks.map((task) => task.projectId).filter((id): id is string => Boolean(id)))];
  const projects = new Map<string, { id: string; name: string }>();
  for (const projectId of projectIds) {
    const project = await requireProjectInOrganization(
      input.principal,
      projectId,
      input.organizationId,
      input.requestHeaders,
      input.db,
    );
    projects.set(project.id, { id: project.id, name: project.name });
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  return input.tasks.map((task, index) => {
    const category = categoryById(task.categoryId);
    const status = statusById(task.workStatus);
    const regularHours = task.regularHours ?? task.hours ?? null;
    const overtimeHours = task.overtimeHours ?? null;
    if (task.categoryId && !category)
      throw new TimesheetError(422, "CATEGORY_INVALID", "工时分类无效");
    if (task.workStatus && !status)
      throw new TimesheetError(422, "STATUS_INVALID", "工作状态无效");
    if (task.urgency) {
      throw new TimesheetError(
        422,
        "URGENCY_NOT_CONFIGURED",
        "紧急重要度候选项尚未完成受信任配置",
      );
    }
    if (
      regularHours !== null &&
      overtimeHours !== null &&
      regularHours + overtimeHours > 24
    ) {
      throw new TimesheetError(
        422,
        "TOTAL_DAILY_HOURS_INVALID",
        "正常与加班工时合计不能超过 24 小时",
      );
    }
    const sourceProjects = new Set(
      task.sourceRecordIds
        .map((recordId) => recordsById.get(recordId)?.projectId)
        .filter((value): value is string => Boolean(value)),
    );
    if (sourceProjects.size > 1) {
      throw new TimesheetError(
        422,
        "TASK_CROSS_PROJECT_MERGE",
        "不能把不同项目的随记合并为一条任务",
      );
    }
    if (task.projectId && sourceProjects.size === 1 && !sourceProjects.has(task.projectId)) {
      throw new TimesheetError(
        422,
        "TASK_PROJECT_CONTRADICTS_SOURCE",
        "任务项目与来源随记不一致",
      );
    }
    return {
      ...task,
      regularHours,
      overtimeHours,
      urgency: task.urgency ?? null,
      progress: task.progress ?? null,
      sortOrder: index,
      projectName: task.projectId ? projects.get(task.projectId)?.name ?? "" : "",
      categoryName: category?.name ?? "",
      statusName: status?.name ?? "",
    };
  });
}

export async function updateDailyDraft(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  draftId: string;
  expectedVersion: number;
  tasks: EditableTimesheetTask[];
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const draft = await requireOwnedDraft(
      input.principal,
      input.draftId,
      input.organizationId,
      tx,
      true,
    );
    if (draft.version !== input.expectedVersion) {
      throw new TimesheetError(
        409,
        "TIMESHEET_VERSION_CONFLICT",
        "日报已被其他请求修改，请刷新后重试",
      );
    }
    const existingTasks = await tx
      .select()
      .from(timesheetTask)
      .where(
        and(
          eq(timesheetTask.draftId, draft.id),
          sql`${timesheetTask.submissionStatus} <> 'submitted'`,
        ),
      )
      .orderBy(asc(timesheetTask.sortOrder));
    if (
      existingTasks.some((task) =>
        ["syncing", "failed", "unknown"].includes(task.submissionStatus),
      )
    ) {
      throw new TimesheetError(
        409,
        "TIMESHEET_ACTIVE_TASKS_LOCKED",
        "同步中、失败或结果未知的任务不能通过编辑绕过恢复流程",
      );
    }
    const normalized = await validateEditableTasks({
      principal: input.principal,
      organizationId: input.organizationId,
      reportDate: draft.reportDate,
      tasks: input.tasks,
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    const existingIds = new Set(existingTasks.map((task) => task.id));
    const submittedIds = new Set(
      (
        await tx
          .select({ id: timesheetTask.id })
          .from(timesheetTask)
          .where(
            and(
              eq(timesheetTask.draftId, draft.id),
              eq(timesheetTask.submissionStatus, "submitted"),
            ),
          )
      ).map((task) => task.id),
    );
    if (normalized.some((task) => task.id && submittedIds.has(task.id))) {
      throw new TimesheetError(409, "TIMESHEET_SUBMITTED_IMMUTABLE", "已提交任务不可修改");
    }
    const incomingIds = new Set(
      normalized.map((task) => task.id).filter((id): id is string => Boolean(id)),
    );
    const removedIds = existingTasks
      .map((task) => task.id)
      .filter((id) => !incomingIds.has(id));
    if (removedIds.length > 0) {
      const [history] = await tx
        .select({ id: timesheetSyncItem.id })
        .from(timesheetSyncItem)
        .where(inArray(timesheetSyncItem.taskId, removedIds))
        .limit(1);
      if (history) {
        throw new TimesheetError(
          409,
          "TIMESHEET_SYNC_HISTORY_IMMUTABLE",
          "有同步历史的任务不能删除，可保留后重新编辑",
        );
      }
      await tx.delete(timesheetTask).where(inArray(timesheetTask.id, removedIds));
    }
    const submittedCount = submittedIds.size;
    for (const task of normalized) {
      const values = {
        description: task.description,
        projectId: task.projectId,
        projectNameSnapshot: task.projectName,
        hours: task.regularHours === null ? null : String(task.regularHours),
        overtimeHours:
          task.overtimeHours === null ? null : String(task.overtimeHours),
        categoryId: task.categoryId,
        categoryNameSnapshot: task.categoryName,
        workStatus: task.workStatus,
        workStatusNameSnapshot: task.statusName,
        urgencyNameSnapshot: task.urgency,
        progress: task.progress,
        confidence: task.confidence,
        needsReview: task.needsReview,
        reviewFields: task.reviewFields,
        sourceRecordIds: task.sourceRecordIds,
        sortOrder: submittedCount + task.sortOrder,
        submissionStatus: "draft" as const,
        submittedAt: null,
        confirmedAt: null,
        updatedAt: new Date(),
      };
      if (task.id && existingIds.has(task.id)) {
        await tx.update(timesheetTask).set(values).where(eq(timesheetTask.id, task.id));
      } else {
        await tx.insert(timesheetTask).values({
          ...values,
          id: crypto.randomUUID(),
          draftId: draft.id,
        });
      }
    }
    const totalHours = normalized.reduce(
      (sum, task) => sum + (task.regularHours ?? 0) + (task.overtimeHours ?? 0),
      0,
    );
    const warnings = [
      ...draft.warnings.filter(
        (warning) =>
          !warning.startsWith("TOTAL_HOURS:") &&
          !warning.startsWith("STATUS_PROGRESS:"),
      ),
    ];
    if (totalHours > 16) warnings.push(`TOTAL_HOURS:${totalHours}，请确认是否准确`);
    normalized.forEach((task, index) => {
      if (task.workStatus === "completed" && task.progress !== null && task.progress < 100) {
        warnings.push(`STATUS_PROGRESS:任务 ${index + 1} 状态为已完成，但进度低于 100%`);
      } else if (task.workStatus === "pending" && task.progress !== null && task.progress > 0) {
        warnings.push(`STATUS_PROGRESS:任务 ${index + 1} 状态为待确认，但进度大于 0%`);
      } else if (!task.workStatus && task.progress === 100) {
        warnings.push(`STATUS_PROGRESS:任务 ${index + 1} 进度为 100%，但状态为空`);
      }
    });
    const [updated] = await tx
      .update(dailyTimesheetDraft)
      .set({
        status: "needs_review",
        version: draft.version + 1,
        totalHours: String(totalHours),
        warnings,
        confirmedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(dailyTimesheetDraft.id, draft.id))
      .returning();
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "timesheet.updated",
        entityType: "daily_timesheet_draft",
        entityId: draft.id,
        result: "succeeded",
        metadata: {
          organizationId: input.organizationId,
          reportDate: draft.reportDate,
          taskCount: normalized.length,
          version: updated.version,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    if (draft.status === "confirmed") {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          eventType: "timesheet.returned_to_draft",
          entityType: "daily_timesheet_draft",
          entityId: draft.id,
          result: "succeeded",
          metadata: {
            organizationId: input.organizationId,
            reportDate: draft.reportDate,
            previousVersion: draft.version,
            version: updated.version,
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
    }
    return draftPayload(updated, tx);
  });
}

export async function confirmDailyDraft(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  draftId: string;
  expectedVersion: number;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const draft = await requireOwnedDraft(
      input.principal,
      input.draftId,
      input.organizationId,
      tx,
      true,
    );
    if (draft.version !== input.expectedVersion) {
      throw new TimesheetError(
        409,
        "TIMESHEET_VERSION_CONFLICT",
        "日报已被其他请求修改，请刷新后重试",
      );
    }
    const tasks = await tx
      .select()
      .from(timesheetTask)
      .where(
        and(
          eq(timesheetTask.draftId, draft.id),
          sql`${timesheetTask.submissionStatus} <> 'submitted'`,
        ),
      )
      .orderBy(asc(timesheetTask.sortOrder));
    await requireTaskProjectAccess({
      principal: input.principal,
      organizationId: input.organizationId,
      tasks,
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    if (
      draft.status === "confirmed" &&
      tasks.every((task) => task.submissionStatus === "confirmed")
    ) {
      return draftPayload(draft, tx);
    }
    if (tasks.length === 0) {
      throw new TimesheetError(422, "TIMESHEET_TASKS_REQUIRED", "日报没有可确认任务");
    }
    for (const task of tasks) {
      if (
        !task.projectId ||
        task.hours === null ||
        task.overtimeHours === null ||
        !task.categoryId ||
        !task.workStatus
      ) {
        throw new TimesheetError(
          422,
          "TIMESHEET_REVIEW_REQUIRED",
          "请先完成本批次所有必填字段",
        );
      }
      if (["syncing", "failed", "unknown", "submitted"].includes(task.submissionStatus)) {
        throw new TimesheetError(
          409,
          "TIMESHEET_TASK_STATE_INVALID",
          "当前任务状态不能确认",
        );
      }
      await requireProjectInOrganization(
        input.principal,
        task.projectId,
        input.organizationId,
        input.requestHeaders,
        tx,
      );
      if (!categoryById(task.categoryId) || !statusById(task.workStatus)) {
        throw new TimesheetError(422, "TIMESHEET_CATALOG_INVALID", "日报字段已失效");
      }
    }
    const confirmedAt = new Date();
    await tx
      .update(timesheetTask)
      .set({
        submissionStatus: "confirmed",
        confirmedAt,
        updatedAt: confirmedAt,
      })
      .where(
        and(
          eq(timesheetTask.draftId, draft.id),
          inArray(timesheetTask.submissionStatus, ["draft", "confirmed", "cancelled"]),
        ),
      );
    const [confirmed] = await tx
      .update(dailyTimesheetDraft)
      .set({
        status: "confirmed",
        version: draft.version + 1,
        confirmedAt,
        updatedAt: confirmedAt,
      })
      .where(eq(dailyTimesheetDraft.id, draft.id))
      .returning();
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "timesheet.confirmed",
        entityType: "daily_timesheet_draft",
        entityId: draft.id,
        result: "succeeded",
        metadata: {
          organizationId: input.organizationId,
          reportDate: draft.reportDate,
          version: confirmed.version,
          taskCount: tasks.length,
          reviewMode: "batch",
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return draftPayload(confirmed, tx);
  });
}

export async function exportDailyDraft(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  draftId: string;
  requestHeaders: Headers;
}) {
  requireDailyReportEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const draft = await requireOwnedDraft(
    input.principal,
    input.draftId,
    input.organizationId,
    db,
  );
  if (draft.status !== "confirmed" && draft.status !== "synced" && draft.status !== "partially_synced") {
    throw new TimesheetError(422, "TIMESHEET_NOT_CONFIRMED", "未确认日报不能导出");
  }
  const tasks = await db
    .select({ projectId: timesheetTask.projectId })
    .from(timesheetTask)
    .where(eq(timesheetTask.draftId, draft.id));
  await requireTaskProjectAccess({
    principal: input.principal,
    organizationId: input.organizationId,
    tasks,
    requestHeaders: input.requestHeaders,
    db,
  });
  return draftPayload(draft, db);
}

function syncPayload(
  batch: TimesheetSyncBatchRecord,
  draft: DailyTimesheetDraft,
  tasks: TimesheetTaskRecord[],
): TimesheetSyncPayload {
  if (!batch.confirmedAtSnapshot) {
    throw new TimesheetError(422, "TIMESHEET_NOT_CONFIRMED", "日报尚未确认");
  }
  return {
    version: TIMESHEET_SYNC_PROTOCOL_VERSION,
    request_id: batch.requestId,
    sync_batch_id: batch.syncBatchId,
    date: draft.reportDate,
    source: "project-ai",
    confirmed_at: batch.confirmedAtSnapshot.toISOString(),
    draft_version: batch.draftVersion,
    dry_run: batch.dryRun,
    tasks: tasks.map((task) => {
      if (
        !task.projectId ||
        !task.projectNameSnapshot ||
        task.hours === null ||
        task.overtimeHours === null ||
        !task.categoryId ||
        !task.categoryNameSnapshot ||
        !task.workStatus ||
        !task.workStatusNameSnapshot
      ) {
        throw new TimesheetError(422, "TIMESHEET_REVIEW_REQUIRED", "日报字段不完整");
      }
      return {
        id: task.id,
        description: task.description,
        project: { id: task.projectId, name: task.projectNameSnapshot },
        submitter: { id: null, name: null, source: "authenticated-user" as const },
        regularHours: Number(task.hours),
        overtimeHours: Number(task.overtimeHours),
        category: { id: task.categoryId, name: task.categoryNameSnapshot },
        status: { id: null, name: task.workStatusNameSnapshot },
        urgency: task.urgencyNameSnapshot
          ? { id: null, name: task.urgencyNameSnapshot }
          : null,
        progress: task.progress,
      };
    }),
  };
}

async function batchPayload(batch: TimesheetSyncBatchRecord, db: DatabaseExecutor) {
  const items = await db
    .select()
    .from(timesheetSyncItem)
    .where(eq(timesheetSyncItem.batchId, batch.id))
    .orderBy(asc(timesheetSyncItem.createdAt));
  return {
    id: batch.id,
    syncBatchId: batch.syncBatchId,
    requestId: batch.requestId,
    draftId: batch.draftId,
    status: batch.status,
    dryRun: batch.dryRun,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    items: items.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      idempotencyKey: item.idempotencyKey,
      status: item.status,
      attemptCount: item.attemptCount,
      externalReference: item.externalReference,
      externalUrl: item.externalUrl,
      verified: item.verified,
      savedAt: item.savedAt?.toISOString() ?? null,
      errorCode: item.errorCode,
      errorMessage: item.errorMessageRedacted,
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}

async function loadBatchTasks(
  batchId: string,
  db: DatabaseExecutor,
): Promise<TimesheetTaskRecord[]> {
  const rows = await db
    .select({ task: timesheetTask })
    .from(timesheetTask)
    .innerJoin(timesheetSyncItem, eq(timesheetSyncItem.taskId, timesheetTask.id))
    .where(eq(timesheetSyncItem.batchId, batchId))
    .orderBy(asc(timesheetTask.sortOrder));
  return rows.map((row) => row.task);
}

export async function createSyncBatch(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  draftId: string;
  expectedVersion: number;
  requestId: string;
  dryRun: boolean;
  requestHeaders: Headers;
}) {
  const feature = requireWecomSyncEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const draft = await requireOwnedDraft(
      input.principal,
      input.draftId,
      input.organizationId,
      tx,
      true,
    );
    const [sameRequest] = await tx
      .select()
      .from(timesheetSyncBatch)
      .where(
        and(
          eq(timesheetSyncBatch.organizationId, input.organizationId),
          eq(timesheetSyncBatch.userId, input.principal.user.id),
          eq(timesheetSyncBatch.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (sameRequest) {
      if (sameRequest.draftId !== draft.id || sameRequest.dryRun !== input.dryRun) {
        throw new TimesheetError(
          409,
          "TIMESHEET_SYNC_REPLAY_CONFLICT",
          "同步请求 ID 已绑定到不同参数",
        );
      }
      const replayTasks = await loadBatchTasks(sameRequest.id, tx);
      await requireTaskProjectAccess({
        principal: input.principal,
        organizationId: input.organizationId,
        tasks: replayTasks,
        requestHeaders: input.requestHeaders,
        db: tx,
      });
      const payload = syncPayload(sameRequest, draft, replayTasks);
      return { batch: await batchPayload(sameRequest, tx), payload };
    }
    if (draft.version !== input.expectedVersion) {
      throw new TimesheetError(
        409,
        "TIMESHEET_VERSION_CONFLICT",
        "日报已被其他请求修改，请刷新后重试",
      );
    }
    const retryTasks = await tx
      .select()
      .from(timesheetTask)
      .where(
        and(
          eq(timesheetTask.draftId, draft.id),
          eq(timesheetTask.submissionStatus, "failed"),
        ),
      )
      .orderBy(asc(timesheetTask.sortOrder));
    const tasks = retryTasks.length > 0
      ? retryTasks
      : await tx
          .select()
          .from(timesheetTask)
          .where(
            and(
              eq(timesheetTask.draftId, draft.id),
              eq(timesheetTask.submissionStatus, "confirmed"),
            ),
          )
          .orderBy(asc(timesheetTask.sortOrder));
    await requireTaskProjectAccess({
      principal: input.principal,
      organizationId: input.organizationId,
      tasks,
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    const [active] = await tx
      .select({ id: timesheetSyncBatch.id })
      .from(timesheetSyncBatch)
      .where(
        and(
          eq(timesheetSyncBatch.draftId, draft.id),
          inArray(timesheetSyncBatch.status, [...ACTIVE_BATCH_STATUSES]),
        ),
      )
      .limit(1);
    if (active) {
      throw new TimesheetError(
        409,
        "TIMESHEET_SYNC_ACTIVE",
        "当前日报已有活动同步批次",
      );
    }
    if (tasks.length === 0 || !draft.confirmedAt) {
      throw new TimesheetError(422, "TIMESHEET_NOT_CONFIRMED", "未确认日报不能同步");
    }
    for (const task of tasks) {
      if (!task.projectId) {
        throw new TimesheetError(422, "TIMESHEET_REVIEW_REQUIRED", "日报项目不能为空");
      }
    }
    const publicId = crypto.randomUUID();
    const now = new Date();
    const [batch] = await tx
      .insert(timesheetSyncBatch)
      .values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        userId: input.principal.user.id,
        draftId: draft.id,
        syncBatchId: publicId,
        requestId: input.requestId,
        connectorType: feature.syncProvider,
        draftVersion: draft.version,
        confirmedAtSnapshot: draft.confirmedAt,
        status: "pending",
        dryRun: input.dryRun,
        startedAt: now,
      })
      .returning();
    await tx.insert(timesheetSyncItem).values(
      tasks.map((task) => ({
        id: crypto.randomUUID(),
        batchId: batch.id,
        taskId: task.id,
        idempotencyKey: `${publicId}:${task.id}`,
      })),
    );
    if (!input.dryRun) {
      await tx
        .update(timesheetTask)
        .set({ submissionStatus: "syncing", updatedAt: now })
        .where(inArray(timesheetTask.id, tasks.map((task) => task.id)));
    }
    await tx
      .update(dailyTimesheetDraft)
      .set({ status: "syncing", updatedAt: now })
      .where(eq(dailyTimesheetDraft.id, draft.id));
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "timesheet.sync_started",
        entityType: "timesheet_sync_batch",
        entityId: batch.id,
        result: "succeeded",
        metadata: {
          organizationId: input.organizationId,
          draftId: draft.id,
          syncBatchId: publicId,
          taskCount: tasks.length,
          dryRun: input.dryRun,
          connectorType: feature.syncProvider,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    if (retryTasks.length > 0) {
      for (const task of tasks) {
        await writeAuditEvent(
          {
            actorUserId: input.principal.user.id,
            eventType: "timesheet.task_retry_requested",
            entityType: "timesheet_task",
            entityId: task.id,
            result: "succeeded",
            metadata: {
              organizationId: input.organizationId,
              syncBatchId: publicId,
            },
            ...getRequestAuditContext(input.requestHeaders),
          },
          tx,
        );
      }
    }
    return { batch: await batchPayload(batch, tx), payload: syncPayload(batch, draft, tasks) };
  });
}

export async function listSyncBatches(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  requestHeaders: Headers;
}) {
  requireWecomSyncEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const batches = await db
    .select()
    .from(timesheetSyncBatch)
    .where(
      and(
        eq(timesheetSyncBatch.organizationId, input.organizationId),
        eq(timesheetSyncBatch.userId, input.principal.user.id),
      ),
    )
    .orderBy(desc(timesheetSyncBatch.createdAt))
    .limit(30);
  if (batches.length > 0) {
    const tasks = await db
      .select({ projectId: timesheetTask.projectId })
      .from(timesheetTask)
      .where(
        inArray(
          timesheetTask.draftId,
          [...new Set(batches.map((batch) => batch.draftId))],
        ),
      );
    await requireTaskProjectAccess({
      principal: input.principal,
      organizationId: input.organizationId,
      tasks,
      requestHeaders: input.requestHeaders,
      db,
    });
  }
  return { batches: await Promise.all(batches.map((batch) => batchPayload(batch, db))) };
}

export async function executeMockSyncBatch(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  syncBatchId: string;
  requestHeaders: Headers;
}) {
  const feature = requireWecomSyncEnabled();
  if (feature.syncProvider !== "mock_smartsheet") {
    throw new TimesheetError(404, "NOT_FOUND", "Mock SmartSheet Provider 未启用");
  }
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const db = getDb();
  const [batch] = await db
    .select()
    .from(timesheetSyncBatch)
    .where(
      and(
        eq(timesheetSyncBatch.syncBatchId, input.syncBatchId),
        eq(timesheetSyncBatch.organizationId, input.organizationId),
        eq(timesheetSyncBatch.userId, input.principal.user.id),
      ),
    )
    .limit(1);
  if (!batch || batch.connectorType !== "mock_smartsheet") {
    throw new TimesheetError(404, "NOT_FOUND", "同步批次不存在");
  }
  if (TERMINAL_BATCH_STATUSES.has(batch.status)) return batchPayload(batch, db);
  const tasks = await loadBatchTasks(batch.id, db);
  await requireTaskProjectAccess({
    principal: input.principal,
    organizationId: input.organizationId,
    tasks,
    requestHeaders: input.requestHeaders,
    db,
  });
  const items = await db
    .select()
    .from(timesheetSyncItem)
    .where(eq(timesheetSyncItem.batchId, batch.id))
    .orderBy(asc(timesheetSyncItem.createdAt));
  const runningItems = items.map((item) => ({
    taskId: item.taskId,
    status: "running",
    attemptCount: item.attemptCount + 1,
  }));
  await updateSyncBatch({
    ...input,
    status: "running",
    items: runningItems,
  });
  const results = [];
  for (const item of items) {
    const task = tasks.find((candidate) => candidate.id === item.taskId);
    if (!task) throw new TimesheetError(409, "SYNC_ITEM_INVALID", "同步项缺少任务");
    const [previousFailure] = await db
      .select({ id: timesheetSyncItem.id })
      .from(timesheetSyncItem)
      .where(
        and(
          eq(timesheetSyncItem.taskId, item.taskId),
          eq(timesheetSyncItem.status, "failed"),
          sql`${timesheetSyncItem.batchId} <> ${batch.id}`,
        ),
      )
      .limit(1);
    const result = mockSmartSheetResult({
      description: task.description,
      idempotencyKey: item.idempotencyKey,
      dryRun: batch.dryRun,
      hadPreviousFailure: Boolean(previousFailure),
    });
    results.push({
      taskId: item.taskId,
      status: result.status,
      attemptCount: item.attemptCount + 1,
      externalReference: result.externalReference,
      externalUrl: result.externalUrl,
      verified: result.verified,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    });
  }
  const terminalStatus = expectedSyncTerminalStatus(results.map((item) => item.status));
  if (!terminalStatus) {
    throw new TimesheetError(409, "SYNC_TERMINAL_MISMATCH", "Mock 同步结果不完整");
  }
  return updateSyncBatch({
    ...input,
    status: terminalStatus,
    items: results,
  });
}

export async function updateSyncBatch(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  syncBatchId: string;
  status: string;
  items: Array<{
    taskId: string;
    status: string;
    attemptCount: number;
    externalReference?: string | null;
    externalUrl?: string | null;
    verified?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  }>;
  requestHeaders: Headers;
}) {
  requireWecomSyncEnabled();
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireTimesheetOrganization(
      input.principal,
      input.organizationId,
      input.requestHeaders,
      tx,
    );
    const [batch] = await tx
      .select()
      .from(timesheetSyncBatch)
      .where(
        and(
          eq(timesheetSyncBatch.syncBatchId, input.syncBatchId),
          eq(timesheetSyncBatch.organizationId, input.organizationId),
          eq(timesheetSyncBatch.userId, input.principal.user.id),
        ),
      )
      .limit(1)
      .for("update", { of: timesheetSyncBatch });
    if (!batch) throw new TimesheetError(404, "NOT_FOUND", "同步批次不存在");
    const batchTasks = await tx
      .select({ projectId: timesheetTask.projectId })
      .from(timesheetTask)
      .innerJoin(timesheetSyncItem, eq(timesheetSyncItem.taskId, timesheetTask.id))
      .where(eq(timesheetSyncItem.batchId, batch.id));
    await requireTaskProjectAccess({
      principal: input.principal,
      organizationId: input.organizationId,
      tasks: batchTasks,
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    const existingItems = await tx
      .select()
      .from(timesheetSyncItem)
      .where(eq(timesheetSyncItem.batchId, batch.id));
    const existingByTask = new Map(existingItems.map((item) => [item.taskId, item]));
    if (new Set(input.items.map((item) => item.taskId)).size !== input.items.length) {
      throw new TimesheetError(422, "SYNC_ITEM_DUPLICATE", "同步项不能重复");
    }
    if (input.items.length !== existingItems.length) {
      throw new TimesheetError(422, "SYNC_ITEM_SET_MISMATCH", "同步项集合不完整");
    }
    const exactReplay =
      input.status === batch.status &&
      input.items.every((item) => {
        const current = existingByTask.get(item.taskId);
        return (
          current?.status === item.status &&
          current.attemptCount === item.attemptCount &&
          (item.status !== "saved" || current.verified === true)
        );
      });
    const batchWasTerminal = TERMINAL_BATCH_STATUSES.has(batch.status);
    const reconciledTaskIds = new Set<string>();
    if (batchWasTerminal) {
      if (exactReplay) return batchPayload(batch, tx);
      let reconciledUnknown = false;
      const manualReconciliation = input.items.every((item) => {
        const current = existingByTask.get(item.taskId);
        const resolvesUnknown =
          current?.status === "unknown" &&
          ((item.status === "saved" &&
            item.externalReference === "manual-reconciliation" &&
            item.verified === true) ||
            (item.status === "failed" &&
              item.errorCode === "MANUAL_RECONCILIATION_NOT_SAVED"));
        if (resolvesUnknown) {
          reconciledUnknown = true;
          reconciledTaskIds.add(item.taskId);
        }
        return (
          current?.status === item.status ||
          resolvesUnknown
        );
      });
      if (
        !manualReconciliation ||
        !reconciledUnknown ||
        !TERMINAL_BATCH_STATUSES.has(input.status)
      ) {
        throw new TimesheetError(409, "SYNC_BATCH_TERMINAL", "同步批次已经结束，不能修改");
      }
    } else {
      assertSyncBatchTransition(batch.status, input.status);
    }
    for (const update of input.items) {
      const current = existingByTask.get(update.taskId);
      if (!current) {
        throw new TimesheetError(422, "SYNC_ITEM_INVALID", "同步项不属于当前批次");
      }
      if (batchWasTerminal && !reconciledTaskIds.has(update.taskId)) {
        continue;
      }
      assertSyncItemTransition(current.status, update.status, update);
      if (
        update.status === "saved" &&
        (update.verified !== true || !update.externalReference)
      ) {
        throw new TimesheetError(
          422,
          "SYNC_SAVE_NOT_VERIFIED",
          "只有 Provider 已保存并回读验证的任务才能标记为已提交",
        );
      }
      if (update.externalUrl) {
        let parsedExternalUrl: URL;
        try {
          parsedExternalUrl = new URL(update.externalUrl);
        } catch {
          throw new TimesheetError(422, "SYNC_EXTERNAL_URL_INVALID", "外部记录地址无效");
        }
        if (
          parsedExternalUrl.protocol !== "https:" ||
          parsedExternalUrl.username ||
          parsedExternalUrl.password ||
          parsedExternalUrl.search ||
          parsedExternalUrl.hash
        ) {
          throw new TimesheetError(422, "SYNC_EXTERNAL_URL_INVALID", "外部记录地址无效");
        }
      }
      if (update.attemptCount < current.attemptCount) {
        throw new TimesheetError(409, "SYNC_ATTEMPT_ROLLBACK", "同步尝试次数不能回退");
      }
      existingByTask.set(update.taskId, {
        ...current,
        status: update.status as typeof current.status,
        attemptCount: Math.max(current.attemptCount, update.attemptCount),
        verified: update.status === "saved" && update.verified === true,
      });
      const savedAt = update.status === "saved" ? new Date() : null;
      await tx
        .update(timesheetSyncItem)
        .set({
          status: update.status,
          attemptCount: Math.max(current.attemptCount, update.attemptCount),
          externalReference: update.externalReference?.slice(0, 240) ?? null,
          externalUrl: update.externalUrl?.slice(0, 500) ?? null,
          verified: update.status === "saved" && update.verified === true,
          savedAt,
          errorCode: update.errorCode ?? null,
          errorMessageRedacted: redactConnectorError(update.errorMessage),
          updatedAt: new Date(),
        })
        .where(eq(timesheetSyncItem.id, current.id));
    }
    const resultingItems = [...existingByTask.values()];
    const itemStatuses = resultingItems.map((item) => item.status);
    const terminalExpected = expectedSyncTerminalStatus(itemStatuses);
    const terminal = ["synced", "partially_synced", "failed", "cancelled"].includes(
      input.status,
    );
    if (terminal && terminalExpected !== input.status) {
      throw new TimesheetError(
        422,
        "SYNC_TERMINAL_MISMATCH",
        "同步终态与逐项结果不一致",
      );
    }
    const now = new Date();
    if (!batch.dryRun) {
      for (const item of resultingItems) {
        if (batchWasTerminal && !reconciledTaskIds.has(item.taskId)) continue;
        const submissionStatus =
          item.status === "saved"
            ? "submitted"
            : item.status === "failed"
              ? "failed"
              : item.status === "unknown"
                ? "unknown"
                : item.status === "cancelled"
                  ? "cancelled"
                  : "syncing";
        await tx
          .update(timesheetTask)
          .set({
            submissionStatus,
            submittedAt: submissionStatus === "submitted" ? now : null,
            updatedAt: now,
          })
          .where(eq(timesheetTask.id, item.taskId));
        if (
          ["submitted", "failed", "unknown", "cancelled"].includes(
            submissionStatus,
          )
        ) {
          await writeAuditEvent(
            {
              actorUserId: input.principal.user.id,
              eventType: `timesheet.task_${submissionStatus}`,
              entityType: "timesheet_task",
              entityId: item.taskId,
              result: submissionStatus === "submitted" ? "succeeded" : "failed",
              metadata: {
                organizationId: input.organizationId,
                syncBatchId: batch.syncBatchId,
                idempotencyKey: item.idempotencyKey,
                submissionStatus,
              },
              ...getRequestAuditContext(input.requestHeaders),
            },
            tx,
          );
        }
        if (batchWasTerminal && reconciledTaskIds.has(item.taskId)) {
          await writeAuditEvent(
            {
              actorUserId: input.principal.user.id,
              eventType: "timesheet.unknown_resolved",
              entityType: "timesheet_task",
              entityId: item.taskId,
              result: "succeeded",
              metadata: {
                organizationId: input.organizationId,
                syncBatchId: batch.syncBatchId,
                resolution: submissionStatus,
              },
              ...getRequestAuditContext(input.requestHeaders),
            },
            tx,
          );
        }
      }
    }
    const [updated] = await tx
      .update(timesheetSyncBatch)
      .set({
        status: input.status,
        finishedAt: terminal ? now : null,
        updatedAt: now,
      })
      .where(eq(timesheetSyncBatch.id, batch.id))
      .returning();
    const remainingTasks = await tx
      .select({ submissionStatus: timesheetTask.submissionStatus })
      .from(timesheetTask)
      .where(
        and(
          eq(timesheetTask.draftId, batch.draftId),
          sql`${timesheetTask.submissionStatus} <> 'submitted'`,
        ),
      );
    const remainingStatuses = remainingTasks.map((task) => task.submissionStatus);
    const draftStatus =
      batch.dryRun && terminal
        ? "confirmed"
        : remainingStatuses.length === 0
          ? "synced"
          : remainingStatuses.some((status) => status === "syncing")
            ? "syncing"
            : remainingStatuses.some((status) => status === "unknown")
              ? "partially_synced"
              : remainingStatuses.some((status) => status === "failed")
                ? "failed"
                : remainingStatuses.every((status) => status === "confirmed")
                  ? "confirmed"
                  : "needs_review";
    await tx
      .update(dailyTimesheetDraft)
      .set({ status: draftStatus, updatedAt: now })
      .where(eq(dailyTimesheetDraft.id, batch.draftId));
    if (terminal) {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          eventType:
            input.status === "synced" || input.status === "partially_synced"
              ? "timesheet.sync_completed"
              : "timesheet.sync_failed",
          entityType: "timesheet_sync_batch",
          entityId: batch.id,
          result:
            input.status === "synced" || input.status === "partially_synced"
              ? "succeeded"
              : "failed",
          metadata: {
            organizationId: input.organizationId,
            syncBatchId: batch.syncBatchId,
            status: input.status,
            itemCount: input.items.length,
            dryRun: batch.dryRun,
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
    }
    return batchPayload(updated, tx);
  });
}

export const timesheetCatalog = {
  categories: TIMESHEET_CATEGORIES,
  statuses: TIMESHEET_STATUSES,
};
