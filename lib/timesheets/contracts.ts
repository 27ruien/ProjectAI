import { z } from "zod";

export const TIMESHEET_SYNC_PROTOCOL_VERSION = 1 as const;
export const TIMESHEET_PROMPT_VERSION = "pm-daily-report-v1";
export const TIMESHEET_SKILL_ID = "pm-daily-timesheet-generation";

export const TIMESHEET_CATEGORIES = [
  { id: "communication", name: "项目沟通" },
  { id: "planning", name: "方案规划" },
  { id: "execution", name: "项目执行" },
  { id: "review", name: "评审验收" },
  { id: "documentation", name: "文档整理" },
] as const;

export const TIMESHEET_STATUSES = [
  { id: "completed", name: "已完成" },
  { id: "in_progress", name: "进行中" },
  { id: "blocked", name: "阻塞" },
  { id: "pending", name: "待确认" },
] as const;

export const timesheetDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, {
    message: "日期无效",
  });

export const workLogInputSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    recordDate: timesheetDateSchema,
    recordedAt: z.string().datetime({ offset: true }),
    rawText: z.string().trim().min(1).max(4000),
    source: z.enum(["manual", "voice", "import"]).default("manual"),
    projectId: z.string().min(1).max(200).nullable().optional(),
    projectHint: z.string().trim().max(200).nullable().optional(),
    hoursHint: z.number().positive().max(24).nullable().optional(),
    statusHint: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

export const workLogUpdateSchema = workLogInputSchema
  .omit({ organizationId: true, recordDate: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "没有可更新字段");

export const generateTimesheetSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    reportDate: timesheetDateSchema,
    timezone: z.literal("Asia/Shanghai").default("Asia/Shanghai"),
  })
  .strict();

const confidenceSchema = z
  .object({
    description: z.number().min(0).max(1),
    project: z.number().min(0).max(1),
    hours: z.number().min(0).max(1),
    overtimeHours: z.number().min(0).max(1).optional(),
    category: z.number().min(0).max(1),
    status: z.number().min(0).max(1),
    urgency: z.number().min(0).max(1).optional(),
    progress: z.number().min(0).max(1).optional(),
  })
  .strict();

const reviewFieldSchema = z.enum([
  "description",
  "project",
  "hours",
  "overtimeHours",
  "category",
  "status",
  "urgency",
  "progress",
]);

const nonNegativeHoursSchema = z.number().min(0).max(24).multipleOf(0.25);

export const generatedTimesheetTaskSchema = z
  .object({
    description: z.string().trim().min(2).max(500),
    project_id: z.string().min(1).max(200).nullable(),
    hours: nonNegativeHoursSchema.nullable(),
    overtime_hours: nonNegativeHoursSchema.nullable().optional(),
    category_id: z.string().min(1).max(80).nullable(),
    status: z.string().min(1).max(80).nullable(),
    urgency: z.string().trim().min(1).max(120).nullable().optional(),
    progress: z.number().int().min(0).max(100).nullable().optional(),
    source_record_ids: z.array(z.string().min(1).max(200)).min(1).max(100),
    confidence: confidenceSchema,
    needs_review: z.boolean(),
    review_fields: z
      .array(reviewFieldSchema)
      .max(8),
  })
  .strict();

export const generatedTimesheetOutputSchema = z
  .object({
    tasks: z.array(generatedTimesheetTaskSchema).min(1).max(50),
    warnings: z.array(z.string().trim().min(1).max(300)).max(20),
    unresolved_record_ids: z.array(z.string().min(1).max(200)).max(100),
  })
  .strict();

export const editableTimesheetTaskSchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    description: z.string().trim().min(2).max(500),
    projectId: z.string().min(1).max(200).nullable(),
    hours: nonNegativeHoursSchema.nullable().optional(),
    regularHours: nonNegativeHoursSchema.nullable().optional(),
    overtimeHours: nonNegativeHoursSchema.nullable().optional(),
    categoryId: z.string().min(1).max(80).nullable(),
    workStatus: z.string().min(1).max(80).nullable(),
    urgency: z.string().trim().min(1).max(120).nullable().optional(),
    progress: z.number().int().min(0).max(100).nullable().optional(),
    confidence: confidenceSchema,
    needsReview: z.boolean(),
    reviewFields: z
      .array(reviewFieldSchema)
      .max(8),
    sourceRecordIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hours === undefined && value.regularHours === undefined) {
      context.addIssue({ code: "custom", message: "正常工时字段缺失" });
    }
    if (
      value.hours !== undefined &&
      value.regularHours !== undefined &&
      value.hours !== value.regularHours
    ) {
      context.addIssue({ code: "custom", message: "hours 与 regularHours 不一致" });
    }
    const regular = value.regularHours ?? value.hours;
    if (
      regular !== null &&
      regular !== undefined &&
      value.overtimeHours !== null &&
      value.overtimeHours !== undefined &&
      regular + value.overtimeHours > 24
    ) {
      context.addIssue({ code: "custom", message: "正常与加班工时合计不能超过 24" });
    }
  });

export const updateTimesheetDraftSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    tasks: z.array(editableTimesheetTaskSchema).min(1).max(50),
  })
  .strict();

export const confirmTimesheetDraftSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

const syncProjectSchema = z
  .object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200) })
  .strict();
const syncCatalogSchema = z
  .object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120) })
  .strict();
const syncExternalOptionSchema = z
  .object({ id: z.string().min(1).max(80).nullable(), name: z.string().min(1).max(120) })
  .strict();
const syncSubmitterSchema = z
  .object({
    id: z.null(),
    name: z.null(),
    source: z.literal("authenticated-user"),
  })
  .strict();

const legacyTimesheetSyncTaskSchema = z
  .object({
    id: z.string().min(1).max(200),
    description: z.string().trim().min(2).max(500),
    project: syncProjectSchema,
    hours: z.number().positive().max(24).multipleOf(0.25),
    category: syncCatalogSchema,
    status: syncCatalogSchema,
  })
  .strict();

const currentTimesheetSyncTaskSchema = z
  .object({
    id: z.string().min(1).max(200),
    description: z.string().trim().min(2).max(500),
    project: syncProjectSchema,
    submitter: syncSubmitterSchema,
    regularHours: nonNegativeHoursSchema,
    overtimeHours: nonNegativeHoursSchema,
    category: syncCatalogSchema,
    status: syncExternalOptionSchema,
    urgency: syncExternalOptionSchema.nullable(),
    progress: z.number().int().min(0).max(100).nullable(),
  })
  .strict()
  .refine((value) => value.regularHours + value.overtimeHours <= 24, {
    message: "正常与加班工时合计不能超过 24",
  });

export const timesheetSyncTaskSchema = z.union([
  legacyTimesheetSyncTaskSchema,
  currentTimesheetSyncTaskSchema,
]);

export const timesheetSyncPayloadSchema = z
  .object({
    version: z.literal(TIMESHEET_SYNC_PROTOCOL_VERSION),
    request_id: z.string().uuid(),
    sync_batch_id: z.string().uuid(),
    date: timesheetDateSchema,
    source: z.literal("project-ai"),
    confirmed_at: z.string().datetime({ offset: true }),
    draft_version: z.number().int().positive(),
    dry_run: z.boolean(),
    tasks: z.array(timesheetSyncTaskSchema).min(1).max(50),
  })
  .strict();

export const createSyncBatchSchema = z
  .object({
    organizationId: z.string().min(1).max(200),
    draftId: z.string().min(1).max(200),
    expectedVersion: z.number().int().positive(),
    requestId: z.string().uuid(),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const syncItemStatusSchema = z.enum([
  "pending",
  "validating",
  "waiting_for_login",
  "running",
  "saved",
  "unknown",
  "failed",
  "cancelled",
]);

export const updateSyncBatchSchema = z
  .object({
    status: z.enum([
      "validating",
      "waiting_for_board",
      "waiting_for_login",
      "running",
      "paused",
      "partially_synced",
      "synced",
      "failed",
      "cancelled",
    ]),
    items: z
      .array(
        z
          .object({
            taskId: z.string().min(1).max(200),
            status: syncItemStatusSchema,
            attemptCount: z.number().int().min(0).max(100),
            externalReference: z.string().trim().max(240).nullable().optional(),
            errorCode: z
              .string()
              .regex(/^[A-Z0-9_]{2,80}$/)
              .nullable()
              .optional(),
            errorMessage: z.string().max(2000).nullable().optional(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type GeneratedTimesheetOutput = z.infer<
  typeof generatedTimesheetOutputSchema
>;
export type EditableTimesheetTask = z.infer<
  typeof editableTimesheetTaskSchema
>;
export type TimesheetSyncPayload = z.infer<typeof timesheetSyncPayloadSchema>;

export function redactConnectorError(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/(bearer|token|cookie|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[url-redacted]")
    .slice(0, 500);
}
