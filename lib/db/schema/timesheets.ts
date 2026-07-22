import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { organization } from "./organizations";
import { project } from "./projects";
import { user } from "./users";

export type TimesheetConfidence = {
  description: number;
  project: number;
  hours: number;
  category: number;
  status: number;
};

export const workLogRecord = pgTable(
  "work_log_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    recordDate: date("record_date", { mode: "string" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull(),
    rawText: text("raw_text").notNull(),
    source: varchar("source", { length: 24 }).notNull().default("manual"),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    projectHint: varchar("project_hint", { length: 200 }),
    hoursHint: numeric("hours_hint", { precision: 5, scale: 2 }),
    statusHint: varchar("status_hint", { length: 80 }),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("work_log_records_owner_date_idx").on(
      table.organizationId,
      table.userId,
      table.recordDate,
      table.recordedAt,
    ),
    index("work_log_records_project_idx").on(table.projectId, table.recordDate),
    check(
      "work_log_records_source_check",
      sql`${table.source} in ('manual', 'voice', 'import')`,
    ),
    check(
      "work_log_records_raw_text_check",
      sql`length(btrim(${table.rawText})) between 1 and 4000`,
    ),
    check(
      "work_log_records_hours_hint_check",
      sql`${table.hoursHint} is null or (${table.hoursHint} > 0 and ${table.hoursHint} <= 24)`,
    ),
  ],
);

export const dailyTimesheetDraft = pgTable(
  "daily_timesheet_drafts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 32 })
      .notNull()
      .default("needs_review"),
    version: integer("version").notNull().default(1),
    totalHours: numeric("total_hours", { precision: 6, scale: 2 })
      .notNull()
      .default("0"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    unresolvedRecordIds: jsonb("unresolved_record_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    aiProvider: varchar("ai_provider", { length: 40 }),
    aiModel: varchar("ai_model", { length: 120 }),
    promptVersion: varchar("prompt_version", { length: 40 }),
    generatedAt: timestamp("generated_at", {
      withTimezone: true,
      mode: "date",
    }),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_timesheet_drafts_owner_date_uidx").on(
      table.organizationId,
      table.userId,
      table.reportDate,
    ),
    index("daily_timesheet_drafts_owner_status_idx").on(
      table.organizationId,
      table.userId,
      table.status,
      table.updatedAt,
    ),
    check(
      "daily_timesheet_drafts_status_check",
      sql`${table.status} in ('draft', 'needs_review', 'confirmed', 'syncing', 'partially_synced', 'synced', 'failed')`,
    ),
    check("daily_timesheet_drafts_version_check", sql`${table.version} > 0`),
    check(
      "daily_timesheet_drafts_total_hours_check",
      sql`${table.totalHours} >= 0 and ${table.totalHours} <= 168`,
    ),
  ],
);

export const timesheetTask = pgTable(
  "timesheet_tasks",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => dailyTimesheetDraft.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 500 }).notNull(),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "restrict",
    }),
    projectNameSnapshot: varchar("project_name_snapshot", { length: 200 })
      .notNull()
      .default(""),
    hours: numeric("hours", { precision: 5, scale: 2 }),
    categoryId: varchar("category_id", { length: 80 }),
    categoryNameSnapshot: varchar("category_name_snapshot", { length: 120 })
      .notNull()
      .default(""),
    workStatus: varchar("work_status", { length: 80 }),
    workStatusNameSnapshot: varchar("work_status_name_snapshot", {
      length: 120,
    })
      .notNull()
      .default(""),
    confidence: jsonb("confidence").$type<TimesheetConfidence>().notNull(),
    needsReview: boolean("needs_review").notNull().default(true),
    reviewFields: jsonb("review_fields").$type<string[]>().notNull().default([]),
    sourceRecordIds: jsonb("source_record_ids")
      .$type<string[]>()
      .notNull(),
    sortOrder: integer("sort_order").notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("timesheet_tasks_draft_order_idx").on(table.draftId, table.sortOrder),
    index("timesheet_tasks_project_idx").on(table.projectId),
    check(
      "timesheet_tasks_description_check",
      sql`length(btrim(${table.description})) between 2 and 500`,
    ),
    check(
      "timesheet_tasks_hours_check",
      sql`${table.hours} is null or (${table.hours} > 0 and ${table.hours} <= 24)`,
    ),
    check("timesheet_tasks_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const timesheetSyncBatch = pgTable(
  "timesheet_sync_batches",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => dailyTimesheetDraft.id, { onDelete: "restrict" }),
    syncBatchId: text("sync_batch_id").notNull(),
    requestId: text("request_id").notNull(),
    connectorType: varchar("connector_type", { length: 40 })
      .notNull()
      .default("wecom_chrome_extension"),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    dryRun: boolean("dry_run").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("timesheet_sync_batches_public_id_uidx").on(table.syncBatchId),
    uniqueIndex("timesheet_sync_batches_request_uidx").on(
      table.organizationId,
      table.userId,
      table.requestId,
    ),
    index("timesheet_sync_batches_owner_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
    check(
      "timesheet_sync_batches_status_check",
      sql`${table.status} in ('pending', 'validating', 'waiting_for_board', 'waiting_for_login', 'running', 'paused', 'partially_synced', 'synced', 'failed', 'cancelled')`,
    ),
  ],
);

export const timesheetSyncItem = pgTable(
  "timesheet_sync_items",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => timesheetSyncBatch.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => timesheetTask.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: varchar("status", { length: 40 }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    externalReference: varchar("external_reference", { length: 240 }),
    errorCode: varchar("error_code", { length: 80 }),
    errorMessageRedacted: varchar("error_message_redacted", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("timesheet_sync_items_idempotency_uidx").on(
      table.idempotencyKey,
    ),
    uniqueIndex("timesheet_sync_items_batch_task_uidx").on(
      table.batchId,
      table.taskId,
    ),
    index("timesheet_sync_items_batch_status_idx").on(
      table.batchId,
      table.status,
    ),
    check(
      "timesheet_sync_items_status_check",
      sql`${table.status} in ('pending', 'validating', 'waiting_for_login', 'running', 'saved', 'unknown', 'failed', 'cancelled')`,
    ),
    check(
      "timesheet_sync_items_attempt_count_check",
      sql`${table.attemptCount} >= 0 and ${table.attemptCount} <= 100`,
    ),
  ],
);

export const timesheetAiExecution = pgTable(
  "timesheet_ai_executions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    draftId: text("draft_id").references(() => dailyTimesheetDraft.id, {
      onDelete: "set null",
    }),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    executionId: text("execution_id").notNull(),
    skillId: varchar("skill_id", { length: 80 }).notNull(),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
    provider: varchar("provider", { length: 40 }),
    actualModel: varchar("actual_model", { length: 120 }),
    status: varchar("status", { length: 24 }).notNull().default("running"),
    sourceSelectionDigest: varchar("source_selection_digest", {
      length: 64,
    }).notNull(),
    sourceCount: integer("source_count").notNull(),
    outputCount: integer("output_count"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    latencyMs: integer("latency_ms"),
    failureCode: varchar("failure_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("timesheet_ai_executions_execution_uidx").on(table.executionId),
    index("timesheet_ai_executions_owner_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
    check(
      "timesheet_ai_executions_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check(
      "timesheet_ai_executions_digest_check",
      sql`${table.sourceSelectionDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "timesheet_ai_executions_counts_check",
      sql`${table.sourceCount} >= 0 and (${table.outputCount} is null or ${table.outputCount} >= 0)`,
    ),
  ],
);

export type WorkLogRecord = typeof workLogRecord.$inferSelect;
export type DailyTimesheetDraft = typeof dailyTimesheetDraft.$inferSelect;
export type TimesheetTaskRecord = typeof timesheetTask.$inferSelect;
export type TimesheetSyncBatchRecord = typeof timesheetSyncBatch.$inferSelect;
export type TimesheetSyncItemRecord = typeof timesheetSyncItem.$inferSelect;
