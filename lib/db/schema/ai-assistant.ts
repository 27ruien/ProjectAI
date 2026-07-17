import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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
import {
  aiExecutionStatusEnum,
  aiMessageRoleEnum,
  aiMessageStatusEnum,
  aiThreadStatusEnum,
} from "./enums";
import { documentChunk } from "./document-ingestion";
import { project } from "./projects";
import { user } from "./users";

export const aiModelProfile = pgTable(
  "ai_model_profiles",
  {
    id: text("id").primaryKey(),
    provider: varchar("provider", { length: 32 }).notNull(),
    purpose: varchar("purpose", { length: 64 }).notNull(),
    primaryModel: varchar("primary_model", { length: 120 }).notNull(),
    fallbackModel: varchar("fallback_model", { length: 120 }).notNull(),
    region: varchar("region", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    gatewayVersion: varchar("gateway_version", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_model_profiles_enabled_purpose_idx").on(
      table.enabled,
      table.purpose,
    ),
    check("ai_model_profiles_values_check", sql`
      length(btrim(${table.id})) > 0
      and length(btrim(${table.provider})) > 0
      and length(btrim(${table.purpose})) > 0
      and length(btrim(${table.primaryModel})) > 0
      and length(btrim(${table.fallbackModel})) > 0
      and length(btrim(${table.region})) > 0
      and length(btrim(${table.gatewayVersion})) > 0
    `),
  ],
);

export const aiThread = pgTable(
  "ai_threads",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    status: aiThreadStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    unique("ai_threads_project_owner_scope_unique").on(
      table.id,
      table.projectId,
      table.createdBy,
    ),
    index("ai_threads_owner_status_updated_idx").on(
      table.projectId,
      table.createdBy,
      table.status,
      table.updatedAt,
    ),
    check(
      "ai_threads_title_check",
      sql`length(btrim(${table.title})) > 0`,
    ),
    check("ai_threads_archive_check", sql`
      (${table.status} = 'archived' and ${table.archivedAt} is not null)
      or (${table.status} = 'active' and ${table.archivedAt} is null)
    `),
  ],
);

export const aiMessage = pgTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    threadId: text("thread_id").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: aiMessageRoleEnum("role").notNull(),
    status: aiMessageStatusEnum("status").notNull(),
    content: text("content").notNull(),
    executionId: text("execution_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_messages_thread_scope_unique").on(
      table.id,
      table.projectId,
      table.threadId,
    ),
    index("ai_messages_thread_created_idx").on(
      table.projectId,
      table.threadId,
      table.createdAt,
    ),
    foreignKey({
      name: "ai_messages_thread_owner_scope_fk",
      columns: [table.threadId, table.projectId, table.createdBy],
      foreignColumns: [aiThread.id, aiThread.projectId, aiThread.createdBy],
    }).onDelete("restrict"),
    check("ai_messages_content_check", sql`
      length(${table.content}) <= 100000
      and (
        length(btrim(${table.content})) > 0
        or (
          ${table.role} = 'assistant'
          and ${table.status} = 'pending'
          and length(${table.content}) = 0
        )
      )
    `),
    check(
      "ai_messages_user_status_check",
      sql`${table.role} <> 'user' or ${table.status} = 'completed'`,
    ),
  ],
);

export const aiExecution = pgTable(
  "ai_executions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    threadId: text("thread_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    modelProfileId: text("model_profile_id")
      .notNull()
      .references(() => aiModelProfile.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    requestedModel: varchar("requested_model", { length: 120 }).notNull(),
    actualModel: varchar("actual_model", { length: 120 }),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    status: aiExecutionStatusEnum("status").notNull().default("reserved"),
    promptVersion: varchar("prompt_version", { length: 32 }).notNull(),
    retrievalVersion: varchar("retrieval_version", { length: 32 }).notNull(),
    gatewayVersion: varchar("gateway_version", { length: 32 }).notNull(),
    evidenceCount: integer("evidence_count").notNull().default(0),
    inputTokenCount: integer("input_token_count"),
    outputTokenCount: integer("output_token_count"),
    totalTokenCount: integer("total_token_count"),
    latencyMs: integer("latency_ms"),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    questionSha256: varchar("question_sha256", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    failureCode: varchar("failure_code", { length: 80 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_executions_idempotency_uidx").on(
      table.projectId,
      table.actorUserId,
      table.threadId,
      table.idempotencyKey,
    ),
    unique("ai_executions_message_scope_unique").on(
      table.id,
      table.projectId,
      table.threadId,
      table.assistantMessageId,
    ),
    unique("ai_executions_thread_scope_unique").on(
      table.id,
      table.projectId,
      table.threadId,
    ),
    index("ai_executions_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("ai_executions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("ai_executions_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    foreignKey({
      name: "ai_executions_thread_owner_scope_fk",
      columns: [table.threadId, table.projectId, table.actorUserId],
      foreignColumns: [aiThread.id, aiThread.projectId, aiThread.createdBy],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_executions_user_message_scope_fk",
      columns: [table.userMessageId, table.projectId, table.threadId],
      foreignColumns: [aiMessage.id, aiMessage.projectId, aiMessage.threadId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_executions_assistant_message_scope_fk",
      columns: [table.assistantMessageId, table.projectId, table.threadId],
      foreignColumns: [aiMessage.id, aiMessage.projectId, aiMessage.threadId],
    }).onDelete("restrict"),
    check(
      "ai_executions_question_hash_check",
      sql`${table.questionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_executions_idempotency_key_check",
      sql`length(btrim(${table.idempotencyKey})) between 8 and 200`,
    ),
    check(
      "ai_executions_evidence_count_check",
      sql`${table.evidenceCount} between 0 and 10`,
    ),
    check("ai_executions_token_usage_check", sql`
      (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.outputTokenCount} is null or ${table.outputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
      and (
        ${table.inputTokenCount} is null
        or ${table.outputTokenCount} is null
        or ${table.totalTokenCount} is null
        or ${table.totalTokenCount} = ${table.inputTokenCount} + ${table.outputTokenCount}
      )
      and (${table.latencyMs} is null or ${table.latencyMs} >= 0)
    `),
    check("ai_executions_succeeded_check", sql`
      ${table.status} <> 'succeeded'
      or (
        ${table.completedAt} is not null
        and ${table.failureCode} is null
        and ${table.actualModel} is not null
        and ${table.evidenceCount} > 0
      )
    `),
    check("ai_executions_failed_check", sql`
      ${table.status} <> 'failed'
      or (
        ${table.completedAt} is not null
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
      )
    `),
    check("ai_executions_insufficient_check", sql`
      ${table.status} <> 'insufficient_evidence'
      or (
        ${table.completedAt} is not null
        and ${table.failureCode} is null
        and ${table.evidenceCount} = 0
        and ${table.inputTokenCount} is null
        and ${table.outputTokenCount} is null
        and ${table.totalTokenCount} is null
      )
    `),
    check("ai_executions_running_check", sql`
      ${table.status} not in ('reserved', 'retrieving', 'calling_provider', 'validating')
      or ${table.completedAt} is null
    `),
  ],
);

export const aiMessageCitation = pgTable(
  "ai_message_citations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    threadId: text("thread_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    citationIndex: integer("citation_index").notNull(),
    evidenceLabel: varchar("evidence_label", { length: 8 }).notNull(),
    chunkId: text("chunk_id").notNull(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    versionNumber: integer("version_number").notNull(),
    mimeType: varchar("mime_type", { length: 200 }).notNull(),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
    sourceLocator: jsonb("source_locator")
      .$type<Record<string, unknown>>()
      .notNull(),
    excerpt: varchar("excerpt", { length: 1000 }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    retrievalScore: doublePrecision("retrieval_score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_message_citations_message_index_uidx").on(
      table.assistantMessageId,
      table.citationIndex,
    ),
    index("ai_message_citations_project_thread_idx").on(
      table.projectId,
      table.threadId,
      table.assistantMessageId,
    ),
    foreignKey({
      name: "ai_message_citations_message_scope_fk",
      columns: [table.assistantMessageId, table.projectId, table.threadId],
      foreignColumns: [aiMessage.id, aiMessage.projectId, aiMessage.threadId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_message_citations_chunk_scope_fk",
      columns: [
        table.chunkId,
        table.projectId,
        table.documentId,
        table.versionId,
      ],
      foreignColumns: [
        documentChunk.id,
        documentChunk.projectId,
        documentChunk.documentId,
        documentChunk.versionId,
      ],
    }).onDelete("restrict"),
    check(
      "ai_message_citations_index_check",
      sql`${table.citationIndex} between 1 and 10`,
    ),
    check(
      "ai_message_citations_label_check",
      sql`${table.evidenceLabel} ~ '^E([1-9]|10)$'`,
    ),
    check(
      "ai_message_citations_version_check",
      sql`${table.versionNumber} > 0`,
    ),
    check("ai_message_citations_source_check", sql`
      jsonb_typeof(${table.sourceLocator}) = 'object'
      and jsonb_typeof(${table.headingPath}) = 'array'
    `),
    check(
      "ai_message_citations_excerpt_check",
      sql`length(btrim(${table.excerpt})) > 0`,
    ),
    check(
      "ai_message_citations_hash_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_message_citations_score_check",
      sql`${table.retrievalScore} >= 0`,
    ),
  ],
);

export type AiModelProfileRecord = typeof aiModelProfile.$inferSelect;
export type AiThreadRecord = typeof aiThread.$inferSelect;
export type AiMessageRecord = typeof aiMessage.$inferSelect;
export type AiExecutionRecord = typeof aiExecution.$inferSelect;
export type AiMessageCitationRecord = typeof aiMessageCitation.$inferSelect;
