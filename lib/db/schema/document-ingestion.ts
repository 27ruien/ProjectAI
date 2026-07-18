import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
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
import { documentIngestionStatusEnum } from "./enums";
import { projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * Durable PostgreSQL queue item for one immutable document-version generation.
 * Parsing happens outside the claiming transaction; completion is guarded by
 * the worker id and lease deadline before any index rows become effective.
 */
export const documentIngestionJob = pgTable(
  "document_ingestion_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    generation: integer("generation").notNull(),
    jobType: varchar("job_type", { length: 32 }).notNull().default("parse"),
    status: documentIngestionStatusEnum("status").notNull().default("pending"),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    chunkerVersion: varchar("chunker_version", { length: 32 }).notNull(),
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
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    failureCode: varchar("failure_code", { length: 64 }),
    failureMessage: varchar("failure_message", { length: 500 }),
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
    uniqueIndex("document_ingestion_jobs_generation_uidx").on(
      table.versionId,
      table.generation,
      table.parserVersion,
      table.chunkerVersion,
    ),
    unique("document_ingestion_jobs_scope_unique").on(
      table.id,
      table.projectId,
      table.documentId,
      table.versionId,
      table.generation,
    ),
    index("document_ingestion_jobs_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    index("document_ingestion_jobs_version_idx").on(
      table.projectId,
      table.documentId,
      table.versionId,
      table.generation,
    ),
    foreignKey({
      name: "document_ingestion_jobs_version_scope_fk",
      columns: [table.versionId, table.documentId, table.projectId],
      foreignColumns: [
        projectDocumentVersion.id,
        projectDocumentVersion.documentId,
        projectDocumentVersion.projectId,
      ],
    }).onDelete("restrict"),
    check("document_ingestion_jobs_generation_check", sql`${table.generation} > 0`),
    check("document_ingestion_jobs_type_check", sql`${table.jobType} = 'parse'`),
    check("document_ingestion_jobs_attempt_check", sql`
      ${table.attemptCount} >= 0
      and ${table.maxAttempts} > 0
      and ${table.attemptCount} <= ${table.maxAttempts}
    `),
    check("document_ingestion_jobs_version_check", sql`
      length(btrim(${table.parserVersion})) > 0
      and length(btrim(${table.chunkerVersion})) > 0
    `),
    check("document_ingestion_jobs_running_check", sql`
      ${table.status} <> 'running' or (
        ${table.leasedBy} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.startedAt} is not null
        and ${table.leaseExpiresAt} > ${table.startedAt}
      )
    `),
    check("document_ingestion_jobs_succeeded_check", sql`
      ${table.status} <> 'succeeded' or (
        ${table.completedAt} is not null and ${table.failureCode} is null
      )
    `),
    check("document_ingestion_jobs_failed_check", sql`
      ${table.status} <> 'failed' or (
        ${table.completedAt} is not null
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
      )
    `),
    check("document_ingestion_jobs_ocr_check", sql`
      ${table.status} <> 'needs_ocr' or (
        ${table.completedAt} is not null and ${table.failureCode} = 'OCR_REQUIRED'
      )
    `),
    check("document_ingestion_jobs_terminal_lease_check", sql`
      ${table.status} not in ('succeeded', 'failed', 'needs_ocr', 'cancelled') or (
        ${table.leasedBy} is null and ${table.leaseExpiresAt} is null
      )
    `),
  ],
);

/** Natural, citation-safe document structures produced by a single job. */
export const documentSection = pgTable(
  "document_sections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    ingestionJobId: text("ingestion_job_id").notNull(),
    generation: integer("generation").notNull(),
    sectionType: varchar("section_type", { length: 40 }).notNull(),
    sectionIndex: integer("section_index").notNull(),
    heading: varchar("heading", { length: 500 }),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
    pageNumber: integer("page_number"),
    slideNumber: integer("slide_number"),
    sheetName: varchar("sheet_name", { length: 255 }),
    columnStart: integer("column_start"),
    columnEnd: integer("column_end"),
    rowStart: integer("row_start"),
    rowEnd: integer("row_end"),
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    paragraphStart: integer("paragraph_start"),
    paragraphEnd: integer("paragraph_end"),
    sourceLocator: jsonb("source_locator")
      .$type<Record<string, unknown>>()
      .notNull(),
    content: text("content").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    characterCount: integer("character_count").notNull(),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_sections_job_index_uidx").on(
      table.ingestionJobId,
      table.sectionIndex,
    ),
    unique("document_sections_scope_unique").on(
      table.id,
      table.projectId,
      table.documentId,
      table.versionId,
      table.ingestionJobId,
      table.generation,
    ),
    index("document_sections_version_idx").on(
      table.projectId,
      table.documentId,
      table.versionId,
      table.generation,
    ),
    foreignKey({
      name: "document_sections_version_scope_fk",
      columns: [table.versionId, table.documentId, table.projectId],
      foreignColumns: [
        projectDocumentVersion.id,
        projectDocumentVersion.documentId,
        projectDocumentVersion.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "document_sections_job_scope_fk",
      columns: [
        table.ingestionJobId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.generation,
      ],
      foreignColumns: [
        documentIngestionJob.id,
        documentIngestionJob.projectId,
        documentIngestionJob.documentId,
        documentIngestionJob.versionId,
        documentIngestionJob.generation,
      ],
    }).onDelete("restrict"),
    check("document_sections_generation_check", sql`${table.generation} > 0`),
    check("document_sections_index_check", sql`${table.sectionIndex} >= 0`),
    check("document_sections_content_check", sql`
      ${table.characterCount} > 0
      and ${table.characterCount} = length(${table.content})
      and length(btrim(${table.content})) > 0
      and length(${table.content}) <= 1000000
    `),
    check(
      "document_sections_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_sections_locator_check",
      sql`jsonb_typeof(${table.sourceLocator}) = 'object'`,
    ),
    check("document_sections_positions_check", sql`
      (${table.pageNumber} is null or ${table.pageNumber} > 0)
      and (${table.slideNumber} is null or ${table.slideNumber} > 0)
      and (${table.columnStart} is null or ${table.columnStart} > 0)
      and (${table.columnEnd} is null or ${table.columnEnd} >= ${table.columnStart})
      and (${table.rowStart} is null or ${table.rowStart} > 0)
      and (${table.rowEnd} is null or ${table.rowEnd} >= ${table.rowStart})
      and (${table.lineStart} is null or ${table.lineStart} > 0)
      and (${table.lineEnd} is null or ${table.lineEnd} >= ${table.lineStart})
      and (${table.paragraphStart} is null or ${table.paragraphStart} > 0)
      and (${table.paragraphEnd} is null or ${table.paragraphEnd} >= ${table.paragraphStart})
    `),
  ],
);

/** Deterministic lexical retrieval unit. Search vectors never leave the API. */
export const documentChunk = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    sectionId: text("section_id").notNull(),
    ingestionJobId: text("ingestion_job_id").notNull(),
    generation: integer("generation").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    searchText: text("search_text").notNull(),
    searchVector: tsvector("search_vector")
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(search_text, '')), 'A') || to_tsvector('simple', coalesce(search_text, ''))`,
      ),
    characterCount: integer("character_count").notNull(),
    estimatedTokenCount: integer("estimated_token_count").notNull(),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
    sourceLocator: jsonb("source_locator")
      .$type<Record<string, unknown>>()
      .notNull(),
    parserVersion: varchar("parser_version", { length: 32 }).notNull(),
    chunkerVersion: varchar("chunker_version", { length: 32 }).notNull(),
    isEffective: boolean("is_effective").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_chunks_generation_index_uidx").on(
      table.versionId,
      table.generation,
      table.chunkIndex,
    ),
    unique("document_chunks_citation_scope_unique").on(
      table.id,
      table.projectId,
      table.documentId,
      table.versionId,
    ),
    unique("document_chunks_embedding_scope_unique").on(
      table.id,
      table.projectId,
      table.documentId,
      table.versionId,
      table.contentSha256,
    ),
    index("document_chunks_effective_project_idx").on(
      table.projectId,
      table.isEffective,
      table.documentId,
    ),
    index("document_chunks_search_vector_idx").using("gin", table.searchVector),
    index("document_chunks_search_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
    foreignKey({
      name: "document_chunks_section_scope_fk",
      columns: [
        table.sectionId,
        table.projectId,
        table.documentId,
        table.versionId,
        table.ingestionJobId,
        table.generation,
      ],
      foreignColumns: [
        documentSection.id,
        documentSection.projectId,
        documentSection.documentId,
        documentSection.versionId,
        documentSection.ingestionJobId,
        documentSection.generation,
      ],
    }).onDelete("restrict"),
    check("document_chunks_generation_check", sql`${table.generation} > 0`),
    check("document_chunks_index_check", sql`${table.chunkIndex} >= 0`),
    check("document_chunks_content_check", sql`
      ${table.characterCount} > 0
      and ${table.characterCount} = length(${table.content})
      and ${table.estimatedTokenCount} > 0
      and length(btrim(${table.content})) > 0
      and length(${table.content}) <= 1000000
    `),
    check(
      "document_chunks_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "document_chunks_locator_check",
      sql`jsonb_typeof(${table.sourceLocator}) = 'object'`,
    ),
  ],
);

export type DocumentIngestionJobRecord = typeof documentIngestionJob.$inferSelect;
export type NewDocumentIngestionJobRecord = typeof documentIngestionJob.$inferInsert;
export type DocumentSectionRecord = typeof documentSection.$inferSelect;
export type NewDocumentSectionRecord = typeof documentSection.$inferInsert;
export type DocumentChunkRecord = typeof documentChunk.$inferSelect;
export type NewDocumentChunkRecord = typeof documentChunk.$inferInsert;
