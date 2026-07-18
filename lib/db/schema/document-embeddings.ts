import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  documentEmbeddingBatchStatusEnum,
  documentEmbeddingJobStatusEnum,
  documentEmbeddingProviderCallStatusEnum,
  documentEmbeddingStatusEnum,
} from "./enums";
import { documentChunk } from "./document-ingestion";
import { projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";

export const EMBEDDING_VECTOR_DIMENSIONS = 1024;

export const vector1024 = customType<{
  data: number[];
  driverData: string;
}>({
  dataType: () => `vector(${EMBEDDING_VECTOR_DIMENSIONS})`,
  toDriver(value) {
    if (
      value.length !== EMBEDDING_VECTOR_DIMENSIONS ||
      value.some((item) => !Number.isFinite(item))
    ) {
      throw new Error("Embedding vector must contain exactly 1024 finite values.");
    }
    return `[${value.join(",")}]`;
  },
});

export const aiEmbeddingProfile = pgTable(
  "ai_embedding_profiles",
  {
    id: text("id").primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    region: varchar("region", { length: 64 }).notNull(),
    dimensions: integer("dimensions").notNull(),
    distanceMetric: varchar("distance_metric", { length: 24 }).notNull(),
    profileVersion: integer("profile_version").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_embedding_profiles_definition_unique").on(
      table.provider,
      table.model,
      table.region,
      table.dimensions,
      table.distanceMetric,
      table.profileVersion,
    ),
    index("ai_embedding_profiles_enabled_idx").on(table.enabled),
    check("ai_embedding_profiles_values_check", sql`
      length(btrim(${table.id})) > 0
      and length(btrim(${table.provider})) > 0
      and length(btrim(${table.model})) > 0
      and length(btrim(${table.region})) > 0
      and ${table.dimensions} = 1024
      and ${table.distanceMetric} = 'cosine'
      and ${table.profileVersion} > 0
    `),
  ],
);

export const documentEmbeddingJob = pgTable(
  "document_embedding_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    embeddingProfileId: text("embedding_profile_id")
      .notNull()
      .references(() => aiEmbeddingProfile.id, { onDelete: "restrict" }),
    generation: integer("generation").notNull(),
    status: documentEmbeddingJobStatusEnum("status")
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    leasedBy: varchar("leased_by", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    chunkCount: integer("chunk_count").notNull().default(0),
    completedChunkCount: integer("completed_chunk_count").notNull().default(0),
    inputTokenCount: integer("input_token_count"),
    totalTokenCount: integer("total_token_count"),
    providerCallCount: integer("provider_call_count").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_embedding_jobs_generation_uidx").on(
      table.versionId,
      table.embeddingProfileId,
      table.generation,
    ),
    unique("document_embedding_jobs_scope_unique").on(
      table.id,
      table.projectId,
      table.documentId,
      table.versionId,
      table.embeddingProfileId,
    ),
    index("document_embedding_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    index("document_embedding_jobs_scope_idx").on(
      table.projectId,
      table.documentId,
      table.versionId,
      table.embeddingProfileId,
    ),
    foreignKey({
      name: "document_embedding_jobs_version_scope_fk",
      columns: [table.versionId, table.documentId, table.projectId],
      foreignColumns: [
        projectDocumentVersion.id,
        projectDocumentVersion.documentId,
        projectDocumentVersion.projectId,
      ],
    }).onDelete("restrict"),
    check("document_embedding_jobs_generation_check", sql`${table.generation} > 0`),
    check("document_embedding_jobs_attempt_check", sql`
      ${table.attemptCount} >= 0
      and ${table.maxAttempts} > 0
      and ${table.attemptCount} <= ${table.maxAttempts}
    `),
    check("document_embedding_jobs_counts_check", sql`
      ${table.chunkCount} >= 0
      and ${table.completedChunkCount} >= 0
      and ${table.completedChunkCount} <= ${table.chunkCount}
      and ${table.providerCallCount} >= 0
      and ${table.latencyMs} >= 0
      and (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
    `),
    check("document_embedding_jobs_running_check", sql`
      ${table.status} <> 'running' or (
        ${table.leasedBy} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.startedAt} is not null
        and ${table.leaseExpiresAt} > ${table.startedAt}
      )
    `),
    check("document_embedding_jobs_terminal_check", sql`
      ${table.status} not in ('succeeded', 'failed', 'cancelled') or (
        ${table.completedAt} is not null
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
      )
    `),
    check("document_embedding_jobs_succeeded_check", sql`
      ${table.status} <> 'succeeded' or (
        ${table.failureCode} is null
        and ${table.completedChunkCount} = ${table.chunkCount}
      )
    `),
    check("document_embedding_jobs_failed_check", sql`
      ${table.status} <> 'failed' or (
        ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
      )
    `),
  ],
);

export const documentEmbeddingBatch = pgTable(
  "document_embedding_batches",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    embeddingProfileId: text("embedding_profile_id").notNull(),
    requestSha256: varchar("request_sha256", { length: 64 }).notNull(),
    batchIndex: integer("batch_index").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    providerAttemptCount: integer("provider_attempt_count").notNull().default(0),
    status: documentEmbeddingBatchStatusEnum("status").notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    dimensions: integer("dimensions").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    reservedInputTokens: integer("reserved_input_tokens").notNull().default(0),
    inputTokenCount: integer("input_token_count"),
    totalTokenCount: integer("total_token_count"),
    costMicroCny: integer("cost_micro_cny"),
    latencyMs: integer("latency_ms").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    failureCode: varchar("failure_code", { length: 80 }),
    leasedBy: varchar("leased_by", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_embedding_batches_request_uidx").on(
      table.jobId,
      table.requestSha256,
    ),
    unique("document_embedding_batches_call_scope_unique").on(
      table.id,
      table.jobId,
      table.projectId,
      table.documentId,
      table.versionId,
      table.embeddingProfileId,
    ),
    index("document_embedding_batches_created_idx").on(table.createdAt),
    foreignKey({
      name: "document_embedding_batches_job_scope_fk",
      columns: [
        table.jobId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.embeddingProfileId,
      ],
      foreignColumns: [
        documentEmbeddingJob.id,
        documentEmbeddingJob.projectId,
        documentEmbeddingJob.documentId,
        documentEmbeddingJob.versionId,
        documentEmbeddingJob.embeddingProfileId,
      ],
    }).onDelete("restrict"),
    check("document_embedding_batches_values_check", sql`
      ${table.requestSha256} ~ '^[0-9a-f]{64}$'
      and ${table.batchIndex} >= 0
      and ${table.attemptCount} > 0
      and ${table.providerAttemptCount} >= 0
      and ${table.dimensions} = 1024
      and ${table.chunkCount} between 1 and 10
      and ${table.reservedInputTokens} >= 0
      and (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
      and (${table.costMicroCny} is null or ${table.costMicroCny} >= 0)
      and ${table.latencyMs} >= 0
    `),
    check("document_embedding_batches_status_check", sql`
      (
        ${table.status} = 'reserved'
        and ${table.failureCode} is null
        and ${table.leasedBy} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.startedAt} is null
        and ${table.completedAt} is null
      )
      or (
        ${table.status} = 'calling'
        and ${table.failureCode} is null
        and ${table.leasedBy} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.startedAt} is not null
        and ${table.completedAt} is null
      )
      or (
        ${table.status} = 'succeeded'
        and ${table.failureCode} is null
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.startedAt} is not null
        and ${table.completedAt} is not null
      )
      or (
        ${table.status} = 'failed'
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.completedAt} is not null
      )
      or (
        ${table.status} = 'unknown'
        and ${table.failureCode} = 'PROVIDER_RESULT_UNKNOWN'
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.startedAt} is not null
        and ${table.completedAt} is not null
      )
    `),
  ],
);

export const documentEmbeddingProviderCall = pgTable(
  "document_embedding_provider_calls",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    jobId: text("job_id").notNull(),
    projectId: text("project_id").notNull(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    embeddingProfileId: text("embedding_profile_id").notNull(),
    callSequence: integer("call_sequence").notNull(),
    status: documentEmbeddingProviderCallStatusEnum("status")
      .notNull()
      .default("reserved"),
    dispatchClassification: varchar("dispatch_classification", { length: 40 }),
    budgetRuleVersion: varchar("budget_rule_version", { length: 80 }).notNull(),
    reservedInputTokens: integer("reserved_input_tokens").notNull(),
    inputTokenCount: integer("input_token_count"),
    totalTokenCount: integer("total_token_count"),
    costMicroCny: integer("cost_micro_cny"),
    latencyMs: integer("latency_ms").notNull().default(0),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    failureCode: varchar("failure_code", { length: 80 }),
    leasedBy: varchar("leased_by", { length: 128 }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    dispatchedAt: timestamp("dispatched_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
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
    uniqueIndex("document_embedding_provider_calls_sequence_uidx").on(
      table.batchId,
      table.callSequence,
    ),
    index("document_embedding_provider_calls_budget_idx").on(
      table.createdAt,
      table.status,
    ),
    index("document_embedding_provider_calls_active_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    foreignKey({
      name: "document_embedding_provider_calls_batch_scope_fk",
      columns: [
        table.batchId,
        table.jobId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.embeddingProfileId,
      ],
      foreignColumns: [
        documentEmbeddingBatch.id,
        documentEmbeddingBatch.jobId,
        documentEmbeddingBatch.projectId,
        documentEmbeddingBatch.documentId,
        documentEmbeddingBatch.versionId,
        documentEmbeddingBatch.embeddingProfileId,
      ],
    }).onDelete("restrict"),
    check("document_embedding_provider_calls_values_check", sql`
      ${table.callSequence} > 0
      and length(btrim(${table.budgetRuleVersion})) > 0
      and ${table.reservedInputTokens} between 1 and 33000
      and (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
      and (${table.costMicroCny} is null or ${table.costMicroCny} >= 0)
      and ${table.latencyMs} >= 0
      and (
        ${table.dispatchClassification} is null
        or ${table.dispatchClassification} in (
          'pre_dispatch', 'post_dispatch', 'explicit_http_rejection',
          'successful_response'
        )
      )
    `),
    check("document_embedding_provider_calls_status_check", sql`
      (
        ${table.status} = 'reserved'
        and ${table.dispatchClassification} is null
        and ${table.failureCode} is null
        and ${table.dispatchedAt} is null
        and ${table.completedAt} is null
      )
      or (
        ${table.status} = 'calling'
        and ${table.dispatchClassification} = 'post_dispatch'
        and ${table.failureCode} is null
        and ${table.leasedBy} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is null
      )
      or (
        ${table.status} = 'succeeded'
        and ${table.dispatchClassification} = 'successful_response'
        and ${table.failureCode} is null
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is not null
      )
      or (
        ${table.status} = 'failed_confirmed_no_charge'
        and ${table.dispatchClassification} = 'pre_dispatch'
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.completedAt} is not null
      )
      or (
        ${table.status} = 'unknown'
        and ${table.dispatchClassification} in (
          'post_dispatch', 'explicit_http_rejection', 'successful_response'
        )
        and ${table.failureCode} = 'PROVIDER_RESULT_UNKNOWN'
        and ${table.leasedBy} is null
        and ${table.leaseExpiresAt} is null
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is not null
      )
    `),
  ],
);

export const embeddingWorkerHeartbeat = pgTable(
  "embedding_worker_heartbeats",
  {
    workerId: varchar("worker_id", { length: 128 }).primaryKey(),
    embeddingProfileId: text("embedding_profile_id")
      .notNull()
      .references(() => aiEmbeddingProfile.id, { onDelete: "cascade" }),
    workerVersion: varchar("worker_version", { length: 32 }).notNull(),
    state: varchar("state", { length: 24 }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("embedding_worker_heartbeats_health_idx").on(
      table.embeddingProfileId,
      table.state,
      table.heartbeatAt,
    ),
    check("embedding_worker_heartbeats_state_check", sql`
      ${table.state} in ('running', 'draining')
      and length(btrim(${table.workerVersion})) > 0
    `),
  ],
);

export const documentChunkEmbedding = pgTable(
  "document_chunk_embeddings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    chunkId: text("chunk_id").notNull(),
    embeddingProfileId: text("embedding_profile_id")
      .notNull()
      .references(() => aiEmbeddingProfile.id, { onDelete: "restrict" }),
    embeddingJobId: text("embedding_job_id").notNull(),
    embedding: vector1024("embedding").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    status: documentEmbeddingStatusEnum("status").notNull().default("current"),
    inputTokenCount: integer("input_token_count"),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_chunk_embeddings_chunk_profile_uidx").on(
      table.chunkId,
      table.embeddingProfileId,
    ),
    index("document_chunk_embeddings_effective_idx").on(
      table.projectId,
      table.embeddingProfileId,
      table.status,
    ),
    foreignKey({
      name: "document_chunk_embeddings_chunk_scope_fk",
      columns: [
        table.chunkId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.contentSha256,
      ],
      foreignColumns: [
        documentChunk.id,
        documentChunk.projectId,
        documentChunk.documentId,
        documentChunk.versionId,
        documentChunk.contentSha256,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "document_chunk_embeddings_job_scope_fk",
      columns: [
        table.embeddingJobId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.embeddingProfileId,
      ],
      foreignColumns: [
        documentEmbeddingJob.id,
        documentEmbeddingJob.projectId,
        documentEmbeddingJob.documentId,
        documentEmbeddingJob.versionId,
        documentEmbeddingJob.embeddingProfileId,
      ],
    }).onDelete("restrict"),
    check(
      "document_chunk_embeddings_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_chunk_embeddings_token_check",
      sql`${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0`,
    ),
  ],
);

export type AiEmbeddingProfileRecord = typeof aiEmbeddingProfile.$inferSelect;
export type DocumentEmbeddingJobRecord = typeof documentEmbeddingJob.$inferSelect;
export type DocumentEmbeddingBatchRecord = typeof documentEmbeddingBatch.$inferSelect;
export type DocumentEmbeddingProviderCallRecord =
  typeof documentEmbeddingProviderCall.$inferSelect;
export type DocumentChunkEmbeddingRecord = typeof documentChunkEmbedding.$inferSelect;
export type EmbeddingWorkerHeartbeatRecord = typeof embeddingWorkerHeartbeat.$inferSelect;
