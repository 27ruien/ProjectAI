import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { aiGenerationModel } from "./ai-model-management";
import { aiThread } from "./ai-assistant";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";
import { organization } from "./organizations";

export const PRODUCT_MAP_RUN_STATUSES = [
  "queued",
  "checking_sources",
  "needs_input",
  "uploading",
  "indexing",
  "retrieving",
  "running",
  "reviewing",
  "unknown",
  "failed",
  "cancelled",
  "completed",
  "published",
] as const;
export type ProductMapRunStatus = (typeof PRODUCT_MAP_RUN_STATUSES)[number];

export const productMapRun = pgTable(
  "product_map_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id").notNull().references(() => project.id, { onDelete: "restrict" }),
    creatorId: text("creator_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    threadId: text("thread_id").references(() => aiThread.id, { onDelete: "set null" }),
    skillId: varchar("skill_id", { length: 80 }).notNull(),
    skillVersion: varchar("skill_version", { length: 24 }).notNull(),
    skillFileSha256: varchar("skill_file_sha256", { length: 64 }).notNull(),
    workflowType: varchar("workflow_type", { length: 40 }).notNull().default("skill_execution"),
    scenario: varchar("scenario", { length: 80 }).notNull().default("product_map_generation"),
    generationModelId: text("generation_model_id").notNull().references(() => aiGenerationModel.id, { onDelete: "restrict" }),
    contextReferences: jsonb("context_references").$type<Array<Record<string, unknown>>>().notNull().default(sql`'[]'::jsonb`),
    includeConversationContext: boolean("include_conversation_context").notNull().default(false),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }).notNull(),
    requestDigest: varchar("request_digest", { length: 64 }).notNull(),
    selectedSourceIds: jsonb("selected_source_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    uploadedSourceIds: jsonb("uploaded_source_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    userInput: text("user_input"),
    userInputDigest: varchar("user_input_digest", { length: 64 }),
    retrievalInstruction: varchar("retrieval_instruction", { length: 4_000 }),
    limitedEvidence: boolean("limited_evidence").notNull().default(false),
    sourceCoverage: jsonb("source_coverage").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    sourceConflicts: jsonb("source_conflicts").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    evidenceSnapshot: jsonb("evidence_snapshot").$type<Record<string, unknown> | null>(),
    evidenceSnapshotDigest: varchar("evidence_snapshot_digest", { length: 64 }),
    stepOutputs: jsonb("step_outputs").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    currentStep: integer("current_step").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: varchar("lease_owner", { length: 160 }),
    leaseToken: varchar("lease_token", { length: 160 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, mode: "date" }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true, mode: "date" }),
    failureCode: varchar("failure_code", { length: 96 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    failureReference: varchar("failure_reference", { length: 36 }),
    version: integer("version").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("product_map_runs_id_project_unique").on(table.id, table.projectId),
    uniqueIndex("product_map_runs_idempotency_uidx").on(table.projectId, table.creatorId, table.idempotencyKeyHash),
    index("product_map_runs_queue_idx").on(table.status, table.nextAttemptAt, table.leaseExpiresAt),
    index("product_map_runs_project_idx").on(table.projectId, table.creatorId, table.updatedAt),
    check("product_map_runs_skill_check", sql`${table.skillId} = 'product-map' and ${table.skillVersion} = '1.0.0' and ${table.skillFileSha256} ~ '^[a-f0-9]{64}$'`),
    check("product_map_runs_type_check", sql`${table.workflowType} = 'skill_execution' and ${table.scenario} = 'product_map_generation'`),
    check("product_map_runs_status_check", sql`${table.status} in ('queued','checking_sources','needs_input','uploading','indexing','retrieving','running','reviewing','unknown','failed','cancelled','completed','published')`),
    check("product_map_runs_attempt_check", sql`${table.attempt} >= 0 and ${table.attempt} <= ${table.maxAttempts} and ${table.maxAttempts} between 1 and 5`),
    check("product_map_runs_input_shape_check", sql`jsonb_typeof(${table.selectedSourceIds}) = 'array' and jsonb_typeof(${table.uploadedSourceIds}) = 'array' and jsonb_typeof(${table.contextReferences}) = 'array' and jsonb_typeof(${table.sourceCoverage}) = 'object' and jsonb_typeof(${table.sourceConflicts}) = 'array' and jsonb_typeof(${table.stepOutputs}) = 'object'`),
    check("product_map_runs_snapshot_digest_check", sql`${table.evidenceSnapshotDigest} is null or ${table.evidenceSnapshotDigest} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const productMapSource = pgTable(
  "product_map_sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    projectId: text("project_id").notNull(),
    sourceProjectId: text("source_project_id").notNull(),
    sourceType: varchar("source_type", { length: 32 }).notNull(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    mimeType: varchar("mime_type", { length: 200 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "product_map_sources_run_project_fk", columns: [table.runId, table.projectId], foreignColumns: [productMapRun.id, productMapRun.projectId] }).onDelete("cascade"),
    foreignKey({ name: "product_map_sources_document_project_fk", columns: [table.documentId, table.sourceProjectId], foreignColumns: [projectDocument.id, projectDocument.projectId] }).onDelete("restrict"),
    foreignKey({ name: "product_map_sources_version_scope_fk", columns: [table.versionId, table.documentId, table.sourceProjectId], foreignColumns: [projectDocumentVersion.id, projectDocumentVersion.documentId, projectDocumentVersion.projectId] }).onDelete("restrict"),
    uniqueIndex("product_map_sources_run_version_uidx").on(table.runId, table.projectId, table.versionId),
    index("product_map_sources_scope_idx").on(table.projectId, table.sourceProjectId, table.documentId),
    check("product_map_sources_type_check", sql`${table.sourceType} in ('project','organization','department','upload','user_input')`),
    check("product_map_sources_status_check", sql`${table.status} in ('pending','uploaded','ready','failed','revoked')`),
  ],
);

export const productMapExecution = pgTable(
  "product_map_executions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    projectId: text("project_id").notNull(),
    stepId: varchar("step_id", { length: 64 }).notNull(),
    attempt: integer("attempt").notNull().default(1),
    generationModelId: text("generation_model_id").notNull().references(() => aiGenerationModel.id, { onDelete: "restrict" }),
    skillFileSha256: varchar("skill_file_sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("reserved"),
    inputDigest: varchar("input_digest", { length: 64 }).notNull(),
    outputDigest: varchar("output_digest", { length: 64 }),
    providerRequestId: varchar("provider_request_id", { length: 200 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    reservedTokens: integer("reserved_tokens").notNull(),
    latencyMs: integer("latency_ms"),
    costUsdMicros: integer("cost_usd_micros"),
    costAccountingStatus: varchar("cost_accounting_status", { length: 32 })
      .notNull()
      .default("provider_not_reported"),
    failureCode: varchar("failure_code", { length: 96 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({ name: "product_map_executions_run_project_fk", columns: [table.runId, table.projectId], foreignColumns: [productMapRun.id, productMapRun.projectId] }).onDelete("cascade"),
    uniqueIndex("product_map_executions_step_attempt_uidx").on(table.runId, table.projectId, table.stepId, table.attempt),
    index("product_map_executions_run_idx").on(table.runId, table.projectId, table.startedAt),
    check("product_map_executions_status_check", sql`${table.status} in ('reserved','running','succeeded','failed','unknown','cancelled')`),
    check("product_map_executions_skill_check", sql`${table.skillFileSha256} ~ '^[a-f0-9]{64}$'`),
    check("product_map_executions_usage_check", sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0) and (${table.totalTokens} is null or ${table.totalTokens} >= 0) and (${table.inputTokens} is null or ${table.outputTokens} is null or ${table.totalTokens} is null or ${table.totalTokens} = ${table.inputTokens} + ${table.outputTokens}) and ${table.reservedTokens} > 0 and (${table.latencyMs} is null or ${table.latencyMs} >= 0) and (${table.costUsdMicros} is null or ${table.costUsdMicros} >= 0)`),
    check("product_map_executions_cost_check", sql`(${table.costAccountingStatus} = 'recorded' and ${table.costUsdMicros} is not null) or (${table.costAccountingStatus} = 'provider_not_reported' and ${table.costUsdMicros} is null)`),
  ],
);

export const productMapArtifact = pgTable(
  "product_map_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    projectId: text("project_id").notNull(),
    title: varchar("title", { length: 240 }).notNull().default("产品结构"),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    contentDigest: varchar("content_digest", { length: 64 }).notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    publishedDocumentId: text("published_document_id"),
    publishedDocumentVersionId: text("published_document_version_id"),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "product_map_artifacts_run_project_fk", columns: [table.runId, table.projectId], foreignColumns: [productMapRun.id, productMapRun.projectId] }).onDelete("cascade"),
    foreignKey({ name: "product_map_artifacts_published_document_fk", columns: [table.publishedDocumentId, table.projectId], foreignColumns: [projectDocument.id, projectDocument.projectId] }).onDelete("restrict"),
    foreignKey({ name: "product_map_artifacts_published_version_fk", columns: [table.publishedDocumentVersionId, table.publishedDocumentId, table.projectId], foreignColumns: [projectDocumentVersion.id, projectDocumentVersion.documentId, projectDocumentVersion.projectId] }).onDelete("restrict"),
    unique("product_map_artifacts_id_project_unique").on(table.id, table.projectId),
    unique("product_map_artifacts_run_project_unique").on(table.runId, table.projectId),
    index("product_map_artifacts_project_idx").on(table.projectId, table.status, table.updatedAt),
    check("product_map_artifacts_status_check", sql`${table.status} in ('draft','reviewed','published')`),
    check("product_map_artifacts_version_check", sql`${table.currentVersion} > 0`),
  ],
);

export const productMapArtifactVersion = pgTable(
  "product_map_artifact_versions",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id").notNull(),
    projectId: text("project_id").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    markdown: text("markdown").notNull(),
    mermaid: text("mermaid").notNull().default(""),
    sourceReferences: jsonb("source_references").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    contentDigest: varchar("content_digest", { length: 64 }).notNull(),
    createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: "product_map_artifact_versions_artifact_project_fk", columns: [table.artifactId, table.projectId], foreignColumns: [productMapArtifact.id, productMapArtifact.projectId] }).onDelete("cascade"),
    uniqueIndex("product_map_artifact_versions_number_uidx").on(table.artifactId, table.projectId, table.version),
    index("product_map_artifact_versions_project_idx").on(table.projectId, table.artifactId, table.version),
    check("product_map_artifact_versions_version_check", sql`${table.version} > 0`),
  ],
);

export type ProductMapRunRecord = typeof productMapRun.$inferSelect;
export type ProductMapSourceRecord = typeof productMapSource.$inferSelect;
export type ProductMapExecutionRecord = typeof productMapExecution.$inferSelect;
export type ProductMapArtifactRecord = typeof productMapArtifact.$inferSelect;
export type ProductMapArtifactVersionRecord = typeof productMapArtifactVersion.$inferSelect;
