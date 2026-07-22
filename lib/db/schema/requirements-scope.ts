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
  requirementDraftStatusEnum,
  requirementExtractionStatusEnum,
  requirementStatusEnum,
  requirementTypeEnum,
  reviewDecisionEnum,
  scopeComparisonStatusEnum,
  scopeDiffTypeEnum,
  scopeReviewStatusEnum,
  scopeVersionStatusEnum,
  workPriorityEnum,
} from "./enums";
import { documentChunk } from "./document-ingestion";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";

export type RequirementSnapshot = {
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  ownerUserId: string | null;
  acceptanceCriteria: string[];
  assumptions: string[];
  openQuestions: string[];
};

export const requirementExtractionRun = pgTable(
  "requirement_extraction_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    idempotencyKeyHash: varchar("idempotency_key_hash", {
      length: 64,
    }).notNull(),
    sourceSelectionDigest: varchar("source_selection_digest", {
      length: 64,
    }).notNull(),
    skillId: varchar("skill_id", { length: 80 })
      .notNull()
      .default("requirement-extraction"),
    status: requirementExtractionStatusEnum("status")
      .notNull()
      .default("running"),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    provider: varchar("provider", { length: 40 }),
    actualModel: varchar("actual_model", { length: 120 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    costUsdMicros: integer("cost_usd_micros"),
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
    uniqueIndex("requirement_extraction_runs_idempotency_uidx").on(
      table.projectId,
      table.actorUserId,
      table.idempotencyKeyHash,
    ),
    index("requirement_extraction_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    check(
      "requirement_extraction_runs_digest_check",
      sql`${table.sourceSelectionDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const requirementDraft = pgTable(
  "requirement_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    extractionRunId: text("extraction_run_id")
      .notNull()
      .references(() => requirementExtractionRun.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    type: requirementTypeEnum("requirement_type").notNull(),
    priority: workPriorityEnum("priority").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<string[]>()
      .notNull(),
    assumptions: jsonb("assumptions").$type<string[]>().notNull(),
    openQuestions: jsonb("open_questions").$type<string[]>().notNull(),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => projectDocument.id, { onDelete: "restrict" }),
    sourceVersionId: text("source_version_id")
      .notNull()
      .references(() => projectDocumentVersion.id, { onDelete: "restrict" }),
    sourceChunkId: text("source_chunk_id")
      .notNull()
      .references(() => documentChunk.id, { onDelete: "restrict" }),
    sourceTextRange: jsonb("source_text_range")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceLabel: varchar("source_label", { length: 20 }).notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    duplicateOfDraftId: text("duplicate_of_draft_id"),
    status: requirementDraftStatusEnum("status")
      .notNull()
      .default("pending_review"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("requirement_drafts_project_status_idx").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    index("requirement_drafts_source_idx").on(
      table.sourceDocumentId,
      table.sourceVersionId,
      table.sourceChunkId,
    ),
    check(
      "requirement_drafts_confidence_check",
      sql`${table.confidenceBps} between 0 and 10000`,
    ),
    check(
      "requirement_drafts_title_check",
      sql`length(btrim(${table.title})) > 0`,
    ),
  ],
);

export const requirement = pgTable(
  "requirements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 40 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description").notNull(),
    type: requirementTypeEnum("requirement_type").notNull(),
    priority: workPriorityEnum("priority").notNull(),
    status: requirementStatusEnum("status").notNull().default("approved"),
    ownerUserId: text("owner_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<string[]>()
      .notNull(),
    assumptions: jsonb("assumptions").$type<string[]>().notNull(),
    openQuestions: jsonb("open_questions").$type<string[]>().notNull(),
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
    uniqueIndex("requirements_project_code_uidx").on(
      table.projectId,
      table.code,
    ),
    index("requirements_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
  ],
);

export const requirementReview = pgTable(
  "requirement_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    draftId: text("draft_id")
      .notNull()
      .references(() => requirementDraft.id, { onDelete: "restrict" }),
    requirementId: text("requirement_id").references(() => requirement.id, {
      onDelete: "restrict",
    }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: reviewDecisionEnum("decision").notNull(),
    editedFields: jsonb("edited_fields").$type<Record<string, unknown>>(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("requirement_reviews_draft_uidx").on(table.draftId),
    index("requirement_reviews_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const requirementVersion = pgTable(
  "requirement_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirement.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").$type<RequirementSnapshot>().notNull(),
    reviewId: text("review_id").references(() => requirementReview.id, {
      onDelete: "restrict",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("requirement_versions_number_uidx").on(
      table.requirementId,
      table.versionNumber,
    ),
    index("requirement_versions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    check(
      "requirement_versions_positive_check",
      sql`${table.versionNumber} > 0`,
    ),
  ],
);

export const requirementSource = pgTable(
  "requirement_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    requirementId: text("requirement_id")
      .notNull()
      .references(() => requirement.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => projectDocument.id, { onDelete: "restrict" }),
    versionId: text("version_id")
      .notNull()
      .references(() => projectDocumentVersion.id, { onDelete: "restrict" }),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => documentChunk.id, { onDelete: "restrict" }),
    sourceLabel: varchar("source_label", { length: 20 }).notNull(),
    sourceLocator: jsonb("source_locator")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("requirement_sources_requirement_idx").on(table.requirementId),
    index("requirement_sources_document_idx").on(
      table.documentId,
      table.versionId,
    ),
  ],
);

export const requirementAudit = pgTable(
  "requirement_audits",
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
    index("requirement_audits_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const scopeVersion = pgTable(
  "scope_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    versionNumber: integer("version_number").notNull(),
    status: scopeVersionStatusEnum("status").notNull().default("draft"),
    requirementSnapshot: jsonb("requirement_snapshot")
      .$type<
        Array<{
          id: string;
          code: string;
          title: string;
          description: string;
          sourceIds: string[];
        }>
      >()
      .notNull(),
    removalDeclarations: jsonb("removal_declarations")
      .$type<string[]>()
      .notNull()
      .default([]),
    ambiguousRequirementIds: jsonb("ambiguous_requirement_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    outOfScopeRequirementIds: jsonb("out_of_scope_requirement_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("scope_versions_project_number_uidx").on(
      table.projectId,
      table.versionNumber,
    ),
    index("scope_versions_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const scopeComparisonRun = pgTable(
  "scope_comparison_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    baselineVersionId: text("baseline_version_id")
      .notNull()
      .references(() => scopeVersion.id, { onDelete: "restrict" }),
    candidateVersionId: text("candidate_version_id")
      .notNull()
      .references(() => scopeVersion.id, { onDelete: "restrict" }),
    status: scopeComparisonStatusEnum("status").notNull().default("running"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("scope_comparison_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const scopeDiffItem = pgTable(
  "scope_diff_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    comparisonRunId: text("comparison_run_id")
      .notNull()
      .references(() => scopeComparisonRun.id, { onDelete: "cascade" }),
    diffType: scopeDiffTypeEnum("diff_type").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    explanation: text("explanation").notNull(),
    baselineCitation:
      jsonb("baseline_citation").$type<Record<string, unknown>>(),
    candidateCitation:
      jsonb("candidate_citation").$type<Record<string, unknown>>(),
    confidenceBps: integer("confidence_bps").notNull(),
    reviewStatus: scopeReviewStatusEnum("review_status")
      .notNull()
      .default("pending"),
    reviewerNote: text("reviewer_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scope_diff_items_run_type_idx").on(
      table.comparisonRunId,
      table.diffType,
    ),
    check(
      "scope_diff_items_confidence_check",
      sql`${table.confidenceBps} between 0 and 10000`,
    ),
  ],
);

export const scopeDiffReview = pgTable(
  "scope_diff_reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    diffItemId: text("diff_item_id")
      .notNull()
      .references(() => scopeDiffItem.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: scopeReviewStatusEnum("status").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scope_diff_reviews_item_created_idx").on(
      table.diffItemId,
      table.createdAt,
    ),
  ],
);

export type RequirementRecord = typeof requirement.$inferSelect;
export type RequirementDraftRecord = typeof requirementDraft.$inferSelect;
