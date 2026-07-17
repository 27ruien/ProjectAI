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
    status: documentEmbeddingBatchStatusEnum("status").notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    dimensions: integer("dimensions").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    inputTokenCount: integer("input_token_count"),
    totalTokenCount: integer("total_token_count"),
    costMicroCny: integer("cost_micro_cny"),
    latencyMs: integer("latency_ms").notNull(),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    failureCode: varchar("failure_code", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_embedding_batches_request_uidx").on(
      table.jobId,
      table.requestSha256,
      table.attemptCount,
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
      and ${table.dimensions} = 1024
      and ${table.chunkCount} between 1 and 10
      and (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
      and (${table.costMicroCny} is null or ${table.costMicroCny} >= 0)
      and ${table.latencyMs} >= 0
    `),
    check("document_embedding_batches_status_check", sql`
      (${table.status} = 'succeeded' and ${table.failureCode} is null)
      or (
        ${table.status} = 'failed'
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
      )
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
export type DocumentChunkEmbeddingRecord = typeof documentChunkEmbedding.$inferSelect;
