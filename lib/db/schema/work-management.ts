import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  actionItemStatusEnum,
  reviewDecisionEnum,
  riskStatusEnum,
  weeklyReportDraftStatusEnum,
  workDraftStatusEnum,
  workPriorityEnum,
} from "./enums";
import { project } from "./projects";
import { user } from "./users";
import { requirement } from "./requirements-scope";
import { scopeDiffItem } from "./requirements-scope";

export type ActionSnapshot = {
  title: string;
  description: string;
  ownerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  progress: number;
  blocker: string;
};

export const actionItemDraft = pgTable(
  "action_item_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    startDate: varchar("start_date", { length: 10 }),
    dueDate: varchar("due_date", { length: 10 }),
    priority: workPriorityEnum("priority").notNull(),
    blocker: text("blocker").notNull().default(""),
    sourceType: varchar("source_type", { length: 24 }).notNull(),
    sourceCitation: jsonb("source_citation")
      .$type<Record<string, unknown>>()
      .notNull(),
    relatedRequirementId: text("related_requirement_id").references(
      () => requirement.id,
      { onDelete: "restrict" },
    ),
    relatedScopeItemId: text("related_scope_item_id").references(
      () => scopeDiffItem.id,
      { onDelete: "restrict" },
    ),
    status: workDraftStatusEnum("status").notNull().default("pending_review"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("action_item_drafts_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    check(
      "action_item_drafts_source_type_check",
      sql`${table.sourceType} in ('document', 'requirement')`,
    ),
  ],
);

export const actionItem = pgTable(
  "action_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    startDate: varchar("start_date", { length: 10 }),
    dueDate: varchar("due_date", { length: 10 }),
    status: actionItemStatusEnum("status").notNull().default("todo"),
    priority: workPriorityEnum("priority").notNull(),
    progress: integer("progress").notNull().default(0),
    blocker: text("blocker").notNull().default(""),
    relatedRequirementId: text("related_requirement_id").references(
      () => requirement.id,
      { onDelete: "restrict" },
    ),
    relatedScopeItemId: text("related_scope_item_id").references(
      () => scopeDiffItem.id,
      { onDelete: "restrict" },
    ),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_items_project_code_uidx").on(
      table.projectId,
      table.code,
    ),
    index("action_items_project_status_due_idx").on(
      table.projectId,
      table.status,
      table.dueDate,
    ),
    index("action_items_owner_status_idx").on(table.ownerUserId, table.status),
    check(
      "action_items_progress_check",
      sql`${table.progress} between 0 and 100`,
    ),
  ],
);

export const actionItemDependency = pgTable(
  "action_item_dependencies",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actionItemId: text("action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),
    dependsOnActionItemId: text("depends_on_action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_item_dependencies_pair_uidx").on(
      table.actionItemId,
      table.dependsOnActionItemId,
    ),
    index("action_item_dependencies_project_idx").on(table.projectId),
    check(
      "action_item_dependencies_no_self_check",
      sql`${table.actionItemId} <> ${table.dependsOnActionItemId}`,
    ),
  ],
);

export const actionItemSource = pgTable(
  "action_item_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actionItemId: text("action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 24 }).notNull(),
    sourceId: text("source_id").notNull(),
    citation: jsonb("citation").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("action_item_sources_item_idx").on(table.actionItemId),
    index("action_item_sources_source_idx").on(
      table.sourceType,
      table.sourceId,
    ),
  ],
);

export const actionItemHistory = pgTable(
  "action_item_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actionItemId: text("action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").$type<ActionSnapshot>().notNull(),
    changeReason: text("change_reason").notNull().default(""),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_item_history_version_uidx").on(
      table.actionItemId,
      table.versionNumber,
    ),
    index("action_item_history_project_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const actionItemReview = pgTable(
  "action_item_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => actionItemDraft.id, { onDelete: "restrict" }),
    actionItemId: text("action_item_id").references(() => actionItem.id, {
      onDelete: "restrict",
    }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: reviewDecisionEnum("decision").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_item_reviews_draft_uidx").on(table.draftId),
    index("action_item_reviews_project_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const riskDraft = pgTable(
  "risk_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    probability: integer("probability").notNull(),
    impact: integer("impact").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    mitigation: text("mitigation").notNull(),
    trigger: text("trigger").notNull(),
    dueDate: varchar("due_date", { length: 10 }),
    sourceType: varchar("source_type", { length: 24 }).notNull(),
    sourceCitation: jsonb("source_citation")
      .$type<Record<string, unknown>>()
      .notNull(),
    relatedRequirementId: text("related_requirement_id").references(
      () => requirement.id,
      { onDelete: "restrict" },
    ),
    relatedActionItemId: text("related_action_item_id").references(
      () => actionItem.id,
      { onDelete: "restrict" },
    ),
    status: workDraftStatusEnum("status").notNull().default("pending_review"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("risk_drafts_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    check(
      "risk_drafts_matrix_check",
      sql`${table.probability} between 1 and 5 and ${table.impact} between 1 and 5`,
    ),
  ],
);

export const risk = pgTable(
  "risks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    probability: integer("probability").notNull(),
    impact: integer("impact").notNull(),
    severity: integer("severity").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    mitigation: text("mitigation").notNull(),
    trigger: text("trigger").notNull(),
    status: riskStatusEnum("status").notNull().default("open"),
    dueDate: varchar("due_date", { length: 10 }),
    relatedRequirementId: text("related_requirement_id").references(
      () => requirement.id,
      { onDelete: "restrict" },
    ),
    relatedActionItemId: text("related_action_item_id").references(
      () => actionItem.id,
      { onDelete: "restrict" },
    ),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("risks_project_code_uidx").on(table.projectId, table.code),
    index("risks_project_status_severity_idx").on(
      table.projectId,
      table.status,
      table.severity,
    ),
    check(
      "risks_matrix_check",
      sql`${table.probability} between 1 and 5 and ${table.impact} between 1 and 5 and ${table.severity} = ${table.probability} * ${table.impact}`,
    ),
  ],
);

export const riskSource = pgTable(
  "risk_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    riskId: text("risk_id")
      .notNull()
      .references(() => risk.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 24 }).notNull(),
    sourceId: text("source_id").notNull(),
    citation: jsonb("citation").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("risk_sources_risk_idx").on(table.riskId),
    index("risk_sources_source_idx").on(table.sourceType, table.sourceId),
  ],
);

export const riskHistory = pgTable(
  "risk_history",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    riskId: text("risk_id")
      .notNull()
      .references(() => risk.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changeReason: text("change_reason").notNull().default(""),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("risk_history_version_uidx").on(
      table.riskId,
      table.versionNumber,
    ),
    index("risk_history_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const riskReview = pgTable(
  "risk_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => riskDraft.id, { onDelete: "restrict" }),
    riskId: text("risk_id").references(() => risk.id, { onDelete: "restrict" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: reviewDecisionEnum("decision").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("risk_reviews_draft_uidx").on(table.draftId),
    index("risk_reviews_project_idx").on(table.projectId, table.createdAt),
  ],
);

export type WeeklyReportSections = {
  completed: string[];
  inProgress: string[];
  nextWeek: string[];
  milestones: string[];
  blockers: string[];
  risks: string[];
  scopeChanges: string[];
  requirementChanges: string[];
  overdueActions: string[];
  decisionsNeeded: string[];
};

export const weeklyReportDraft = pgTable(
  "weekly_report_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    periodStart: varchar("period_start", { length: 10 }).notNull(),
    periodEnd: varchar("period_end", { length: 10 }).notNull(),
    sections: jsonb("sections").$type<WeeklyReportSections>().notNull(),
    sourceManifest: jsonb("source_manifest")
      .$type<Record<string, string[]>>()
      .notNull(),
    status: weeklyReportDraftStatusEnum("status")
      .notNull()
      .default("pending_review"),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("weekly_report_drafts_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    check(
      "weekly_report_drafts_period_check",
      sql`${table.periodStart} <= ${table.periodEnd}`,
    ),
  ],
);

export const weeklyReportVersion = pgTable(
  "weekly_report_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => weeklyReportDraft.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    periodStart: varchar("period_start", { length: 10 }).notNull(),
    periodEnd: varchar("period_end", { length: 10 }).notNull(),
    sections: jsonb("sections").$type<WeeklyReportSections>().notNull(),
    sourceManifest: jsonb("source_manifest")
      .$type<Record<string, string[]>>()
      .notNull(),
    markdown: text("markdown").notNull(),
    publishedBy: text("published_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("weekly_report_versions_project_number_uidx").on(
      table.projectId,
      table.versionNumber,
    ),
    uniqueIndex("weekly_report_versions_draft_uidx").on(table.draftId),
    index("weekly_report_versions_project_period_idx").on(
      table.projectId,
      table.periodEnd,
    ),
  ],
);

export const projectManagementAudit = pgTable(
  "project_management_audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    resourceType: varchar("resource_type", { length: 40 }).notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("project_management_audits_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("project_management_audits_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
  ],
);
