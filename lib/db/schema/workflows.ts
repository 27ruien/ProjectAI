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
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { department, organization } from "./organizations";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { requirementExtractionRun } from "./requirements-scope";
import { user } from "./users";

export type WorkflowType = "requirement_framework" | "meeting_minutes";
export type WorkflowArtifactKind =
  | "project_overview"
  | "requirements_document"
  | "ga4_measurement_plan"
  | "action_plan"
  | "meeting_transcript"
  | "meeting_minutes"
  | "meeting_actions";

export const workflowDefinition = pgTable(
  "workflow_definitions",
  {
    id: text("id").primaryKey(),
    workflowType: varchar("workflow_type", { length: 40 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull(),
    version: integer("version").notNull().default(1),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_definitions_type_version_uidx").on(
      table.workflowType,
      table.version,
    ),
    check(
      "workflow_definitions_type_check",
      sql`${table.workflowType} in ('requirement_framework', 'meeting_minutes')`,
    ),
    check("workflow_definitions_version_check", sql`${table.version} > 0`),
  ],
);

export const workflowRun = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    definitionId: text("definition_id")
      .notNull()
      .references(() => workflowDefinition.id, { onDelete: "restrict" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    departmentId: text("department_id").references(() => department.id, {
      onDelete: "restrict",
    }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    workflowType: varchar("workflow_type", { length: 40 }).notNull(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    authorizedSourceScope: jsonb("authorized_source_scope")
      .$type<{ documentIds: string[]; knowledgeSpaceIds: string[] }>()
      .notNull(),
    sourceScopeDigest: varchar("source_scope_digest", { length: 64 }).notNull(),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    status: varchar("status", { length: 40 }).notNull().default("queued"),
    currentStep: integer("current_step").notNull().default(1),
    version: integer("version").notNull().default(1),
    idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }).notNull(),
    legacyRequirementRunId: text("legacy_requirement_run_id").references(
      () => requirementExtractionRun.id,
      { onDelete: "restrict" },
    ),
    leasedBy: text("leased_by"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true,
      mode: "date",
    }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureStep: integer("failure_step"),
    regenerationArtifactKind: varchar("regeneration_artifact_kind", { length: 48 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("workflow_runs_id_project_uidx").on(table.id, table.projectId),
    foreignKey({
      columns: [table.projectId, table.organizationId],
      foreignColumns: [project.id, project.organizationId],
      name: "workflow_runs_project_organization_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId, table.organizationId, table.departmentId],
      foreignColumns: [project.id, project.organizationId, project.departmentId],
      name: "workflow_runs_project_department_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.departmentId, table.organizationId],
      foreignColumns: [department.id, department.organizationId],
      name: "workflow_runs_department_organization_fk",
    }).onDelete("restrict"),
    uniqueIndex("workflow_runs_idempotency_uidx").on(
      table.projectId,
      table.creatorId,
      table.idempotencyKeyHash,
    ),
    uniqueIndex("workflow_runs_legacy_requirement_uidx").on(
      table.legacyRequirementRunId,
    ),
    index("workflow_runs_project_updated_idx").on(
      table.projectId,
      table.updatedAt,
    ),
    index("workflow_runs_creator_updated_idx").on(
      table.creatorId,
      table.updatedAt,
    ),
    check(
      "workflow_runs_type_check",
      sql`${table.workflowType} in ('requirement_framework', 'meeting_minutes')`,
    ),
    check(
      "workflow_runs_status_check",
      sql`${table.status} in ('legacy_read_only', 'queued', 'validating_sources', 'parsing_sources', 'extracting_facts', 'identifying_gaps', 'generating_overview', 'generating_requirements', 'generating_ga4', 'generating_action_plan', 'checking_consistency', 'uploading', 'uploaded', 'transcribing', 'diarizing', 'normalizing', 'summarizing', 'awaiting_review', 'publishing', 'published', 'failed', 'cancelled')`,
    ),
    check("workflow_runs_step_check", sql`${table.currentStep} between 1 and 11`),
    check("workflow_runs_version_check", sql`${table.version} > 0`),
    check(
      "workflow_runs_digest_check",
      sql`${table.sourceScopeDigest} ~ '^[0-9a-f]{64}$' and ${table.idempotencyKeyHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "workflow_runs_department_check",
      sql`${table.departmentId} is not null or ${table.legacyRequirementRunId} is not null`,
    ),
    check(
      "workflow_runs_regeneration_kind_check",
      sql`${table.regenerationArtifactKind} is null or ${table.regenerationArtifactKind} in ('project_overview', 'requirements_document', 'ga4_measurement_plan', 'action_plan')`,
    ),
    check(
      "workflow_runs_lease_check",
      sql`(${table.leasedBy} is null and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null) or (${table.leasedBy} is not null and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);

export const workflowRunSource = pgTable(
  "workflow_run_sources",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    sourceProjectId: text("source_project_id").notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    documentId: text("document_id").references(() => projectDocument.id, {
      onDelete: "restrict",
    }),
    documentVersionId: text("document_version_id").references(
      () => projectDocumentVersion.id,
      { onDelete: "restrict" },
    ),
    objectKey: text("object_key"),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }),
    sizeBytes: integer("size_bytes"),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_run_sources_id_project_uidx").on(table.id, table.projectId),
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "workflow_run_sources_run_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.documentId, table.sourceProjectId],
      foreignColumns: [projectDocument.id, projectDocument.projectId],
      name: "workflow_run_sources_document_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.documentVersionId, table.documentId, table.sourceProjectId],
      foreignColumns: [
        projectDocumentVersion.id,
        projectDocumentVersion.documentId,
        projectDocumentVersion.projectId,
      ],
      name: "workflow_run_sources_version_document_project_fk",
    }).onDelete("restrict"),
    uniqueIndex("workflow_run_sources_run_digest_uidx").on(
      table.runId,
      table.sourceType,
      table.sha256,
    ),
    index("workflow_run_sources_document_idx").on(table.documentId, table.runId),
    check(
      "workflow_run_sources_type_check",
      sql`${table.sourceType} in ('project_document', 'department_document', 'organization_document', 'temporary_document', 'audio')`,
    ),
    check(
      "workflow_run_sources_status_check",
      sql`${table.status} in ('uploading', 'uploaded', 'ready', 'expired', 'deleted', 'failed')`,
    ),
    check("workflow_run_sources_digest_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "workflow_run_sources_shape_check",
      sql`(${table.sourceType} = 'audio' and ${table.sourceProjectId} = ${table.projectId} and ${table.objectKey} is not null and ${table.documentId} is null) or (${table.sourceType} <> 'audio' and ${table.documentId} is not null and ${table.documentVersionId} is not null and ${table.objectKey} is null)`,
    ),
  ],
);

export const workflowArtifact = pgTable(
  "workflow_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    artifactKind: varchar("artifact_kind", { length: 48 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    contentDigest: varchar("content_digest", { length: 64 }).notNull(),
    publishedDocumentId: text("published_document_id").references(() => projectDocument.id, { onDelete: "restrict" }),
    publishedDocumentVersionId: text("published_document_version_id").references(() => projectDocumentVersion.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_artifacts_id_project_uidx").on(table.id, table.projectId),
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "workflow_artifacts_run_project_fk",
    }).onDelete("cascade"),
    uniqueIndex("workflow_artifacts_run_kind_uidx").on(
      table.runId,
      table.artifactKind,
    ),
    check(
      "workflow_artifacts_kind_check",
      sql`${table.artifactKind} in ('project_overview', 'requirements_document', 'ga4_measurement_plan', 'action_plan', 'meeting_transcript', 'meeting_minutes', 'meeting_actions')`,
    ),
    check(
      "workflow_artifacts_status_check",
      sql`${table.status} in ('draft', 'awaiting_review', 'reviewed', 'published', 'failed')`,
    ),
    check("workflow_artifacts_version_check", sql`${table.currentVersion} > 0`),
    check("workflow_artifacts_digest_check", sql`${table.contentDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const workflowArtifactVersion = pgTable(
  "workflow_artifact_versions",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    version: integer("version").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    markdown: text("markdown").notNull(),
    sourceReferences: jsonb("source_references")
      .$type<Array<{ documentId: string; versionId: string; chunkId?: string; locator?: unknown }>>()
      .notNull(),
    contentDigest: varchar("content_digest", { length: 64 }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactId, table.projectId],
      foreignColumns: [workflowArtifact.id, workflowArtifact.projectId],
      name: "workflow_artifact_versions_artifact_project_fk",
    }).onDelete("cascade"),
    uniqueIndex("workflow_artifact_versions_artifact_version_uidx").on(
      table.artifactId,
      table.version,
    ),
    check("workflow_artifact_versions_version_check", sql`${table.version} > 0`),
    check("workflow_artifact_versions_digest_check", sql`${table.contentDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const workflowReview = pgTable(
  "workflow_reviews",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    decision: varchar("decision", { length: 24 }).notNull(),
    note: text("note"),
    snapshotDigest: varchar("snapshot_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactId, table.projectId],
      foreignColumns: [workflowArtifact.id, workflowArtifact.projectId],
      name: "workflow_reviews_artifact_project_fk",
    }).onDelete("cascade"),
    index("workflow_reviews_artifact_created_idx").on(table.artifactId, table.createdAt),
    check(
      "workflow_reviews_decision_check",
      sql`${table.decision} in ('request_changes', 'approve', 'publish')`,
    ),
    check("workflow_reviews_digest_check", sql`${table.snapshotDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const workflowExecution = pgTable(
  "workflow_executions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    step: integer("step").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: varchar("status", { length: 24 }).notNull().default("running"),
    provider: varchar("provider", { length: 40 }),
    actualModel: varchar("actual_model", { length: 120 }),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    failureCode: varchar("failure_code", { length: 80 }),
    resultDigest: varchar("result_digest", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "workflow_executions_run_project_fk",
    }).onDelete("cascade"),
    uniqueIndex("workflow_executions_run_step_attempt_uidx").on(
      table.runId,
      table.step,
      table.attempt,
    ),
    check("workflow_executions_step_check", sql`${table.step} between 1 and 11`),
    check("workflow_executions_attempt_check", sql`${table.attempt} between 1 and 20`),
    check(
      "workflow_executions_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
);

export const workflowExport = pgTable(
  "workflow_exports",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    artifactVersion: integer("artifact_version").notNull(),
    format: varchar("format", { length: 16 }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactId, table.projectId],
      foreignColumns: [workflowArtifact.id, workflowArtifact.projectId],
      name: "workflow_exports_artifact_project_fk",
    }).onDelete("cascade"),
    index("workflow_exports_artifact_created_idx").on(table.artifactId, table.createdAt),
    check(
      "workflow_exports_format_check",
      sql`${table.format} in ('md', 'docx', 'xlsx', 'txt')`,
    ),
    check("workflow_exports_digest_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check("workflow_exports_size_check", sql`${table.sizeBytes} > 0`),
  ],
);

export const workflowAudioJob = pgTable(
  "workflow_audio_jobs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    sourceId: text("source_id")
      .notNull(),
    transcriptionProvider: varchar("transcription_provider", { length: 48 }).notNull(),
    transcriptionModel: varchar("transcription_model", { length: 120 }).notNull(),
    diarizationProvider: varchar("diarization_provider", { length: 48 }).notNull(),
    diarizationModel: varchar("diarization_model", { length: 120 }).notNull(),
    providerTaskId: text("provider_task_id"),
    providerTaskIdHash: varchar("provider_task_id_hash", { length: 64 }),
    status: varchar("status", { length: 32 }).notNull().default("queued"),
    failureCode: varchar("failure_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "workflow_audio_jobs_run_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceId, table.projectId],
      foreignColumns: [workflowRunSource.id, workflowRunSource.projectId],
      name: "workflow_audio_jobs_source_project_fk",
    }).onDelete("restrict"),
    uniqueIndex("workflow_audio_jobs_run_uidx").on(table.runId),
    check(
      "workflow_audio_jobs_status_check",
      sql`${table.status} in ('queued', 'transcribing', 'diarizing', 'normalizing', 'summarizing', 'awaiting_review', 'published', 'failed', 'cancelled')`,
    ),
  ],
);

export const transcriptSpeaker = pgTable(
  "transcript_speakers",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    speakerKey: varchar("speaker_key", { length: 80 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    confirmedByUser: boolean("confirmed_by_user").notNull().default(false),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("transcript_speakers_id_project_uidx").on(table.id, table.projectId),
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "transcript_speakers_run_project_fk",
    }).onDelete("cascade"),
    uniqueIndex("transcript_speakers_run_key_uidx").on(table.runId, table.speakerKey),
  ],
);

export const transcriptSegment = pgTable(
  "transcript_segments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull(),
    projectId: text("project_id").notNull(),
    sequence: integer("sequence").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    speakerId: text("speaker_id")
      .notNull(),
    text: text("text").notNull(),
    confidenceBps: integer("confidence_bps"),
    language: varchar("language", { length: 24 }).notNull(),
    sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.projectId],
      foreignColumns: [workflowRun.id, workflowRun.projectId],
      name: "transcript_segments_run_project_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.speakerId, table.projectId],
      foreignColumns: [transcriptSpeaker.id, transcriptSpeaker.projectId],
      name: "transcript_segments_speaker_project_fk",
    }).onDelete("restrict"),
    uniqueIndex("transcript_segments_run_sequence_uidx").on(table.runId, table.sequence),
    check(
      "transcript_segments_time_check",
      sql`${table.startMs} >= 0 and ${table.endMs} > ${table.startMs}`,
    ),
    check(
      "transcript_segments_confidence_check",
      sql`${table.confidenceBps} is null or ${table.confidenceBps} between 0 and 10000`,
    ),
    check("transcript_segments_digest_check", sql`${table.sourceDigest} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type WorkflowRunRecord = typeof workflowRun.$inferSelect;
export type WorkflowArtifactRecord = typeof workflowArtifact.$inferSelect;
export type WorkflowArtifactVersionRecord = typeof workflowArtifactVersion.$inferSelect;
