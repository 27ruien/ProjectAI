import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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
import { aiExecution, aiMessage, aiThread } from "./ai-assistant";
import { aiEmbeddingProfile } from "./document-embeddings";
import { documentChunk } from "./document-ingestion";
import {
  aiRetrievalCandidateSourceEnum,
  aiRetrievalModeEnum,
  aiRetrievalQueryEmbeddingCallStatusEnum,
  aiRetrievalRunStatusEnum,
} from "./enums";
import { aiRetrievalProfile } from "./ai-retrieval-profile";
import { project } from "./projects";
import { user } from "./users";

export const aiRetrievalRun = pgTable(
  "ai_retrieval_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    threadId: text("thread_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    aiExecutionId: text("ai_execution_id").notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    retrievalProfileId: text("retrieval_profile_id")
      .notNull()
      .references(() => aiRetrievalProfile.id, { onDelete: "restrict" }),
    requestedMode: aiRetrievalModeEnum("requested_mode").notNull(),
    effectiveMode: aiRetrievalModeEnum("effective_mode"),
    status: aiRetrievalRunStatusEnum("status").notNull().default("running"),
    querySha256: varchar("query_sha256", { length: 64 }).notNull(),
    lexicalCandidateCount: integer("lexical_candidate_count").notNull().default(0),
    vectorCandidateCount: integer("vector_candidate_count").notNull().default(0),
    fusedCandidateCount: integer("fused_candidate_count").notNull().default(0),
    selectedEvidenceCount: integer("selected_evidence_count").notNull().default(0),
    embeddingCoverageBps: integer("embedding_coverage_bps").notNull().default(0),
    lexicalLatencyMs: integer("lexical_latency_ms").notNull().default(0),
    queryEmbeddingLatencyMs: integer("query_embedding_latency_ms").notNull().default(0),
    vectorLatencyMs: integer("vector_latency_ms").notNull().default(0),
    fusionLatencyMs: integer("fusion_latency_ms").notNull().default(0),
    totalLatencyMs: integer("total_latency_ms").notNull().default(0),
    fallbackReason: varchar("fallback_reason", { length: 80 }),
    retrievalVersion: varchar("retrieval_version", { length: 32 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_retrieval_runs_execution_uidx").on(table.aiExecutionId),
    unique("ai_retrieval_runs_project_scope_unique").on(table.id, table.projectId),
    unique("ai_retrieval_runs_actor_scope_unique").on(
      table.id,
      table.projectId,
      table.actorUserId,
    ),
    index("ai_retrieval_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("ai_retrieval_runs_status_created_idx").on(table.status, table.createdAt),
    foreignKey({
      name: "ai_retrieval_runs_execution_scope_fk",
      columns: [table.aiExecutionId, table.projectId, table.threadId],
      foreignColumns: [aiExecution.id, aiExecution.projectId, aiExecution.threadId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_retrieval_runs_thread_owner_scope_fk",
      columns: [table.threadId, table.projectId, table.actorUserId],
      foreignColumns: [aiThread.id, aiThread.projectId, aiThread.createdBy],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_retrieval_runs_user_message_scope_fk",
      columns: [table.userMessageId, table.projectId, table.threadId],
      foreignColumns: [aiMessage.id, aiMessage.projectId, aiMessage.threadId],
    }).onDelete("restrict"),
    check(
      "ai_retrieval_runs_query_hash_check",
      sql`${table.querySha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("ai_retrieval_runs_counts_check", sql`
      ${table.lexicalCandidateCount} between 0 and 30
      and ${table.vectorCandidateCount} between 0 and 30
      and ${table.fusedCandidateCount} between 0 and 30
      and ${table.selectedEvidenceCount} between 0 and 10
      and ${table.embeddingCoverageBps} between 0 and 10000
      and ${table.lexicalLatencyMs} >= 0
      and ${table.queryEmbeddingLatencyMs} >= 0
      and ${table.vectorLatencyMs} >= 0
      and ${table.fusionLatencyMs} >= 0
      and ${table.totalLatencyMs} >= 0
    `),
    check("ai_retrieval_runs_status_check", sql`
      (
        ${table.status} = 'running'
        and ${table.effectiveMode} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'succeeded'
        and ${table.effectiveMode} is not null
        and ${table.fallbackReason} is null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'insufficient_evidence'
        and ${table.effectiveMode} is not null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} in ('fallback_lexical', 'failed')
        and ${table.effectiveMode} is not null
        and ${table.fallbackReason} is not null
        and length(btrim(${table.fallbackReason})) > 0
        and ${table.completedAt} is not null
      )
    `),
  ],
);

export const aiRetrievalQueryEmbeddingCall = pgTable(
  "ai_retrieval_query_embedding_calls",
  {
    id: text("id").primaryKey(),
    retrievalRunId: text("retrieval_run_id").notNull(),
    projectId: text("project_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    embeddingProfileId: text("embedding_profile_id")
      .notNull()
      .references(() => aiEmbeddingProfile.id, { onDelete: "restrict" }),
    status: aiRetrievalQueryEmbeddingCallStatusEnum("status")
      .notNull()
      .default("reserved"),
    dispatchClassification: varchar("dispatch_classification", { length: 40 }),
    budgetRuleVersion: varchar("budget_rule_version", { length: 80 }).notNull(),
    reservedInputTokens: integer("reserved_input_tokens").notNull(),
    inputTokenCount: integer("input_token_count"),
    totalTokenCount: integer("total_token_count"),
    providerRequestId: varchar("provider_request_id", { length: 240 }),
    latencyMs: integer("latency_ms").notNull().default(0),
    failureCode: varchar("failure_code", { length: 80 }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_retrieval_query_embedding_calls_run_uidx").on(
      table.retrievalRunId,
    ),
    index("ai_retrieval_query_embedding_calls_budget_idx").on(
      table.createdAt,
      table.status,
    ),
    foreignKey({
      name: "ai_retrieval_query_embedding_calls_run_scope_fk",
      columns: [table.retrievalRunId, table.projectId, table.actorUserId],
      foreignColumns: [
        aiRetrievalRun.id,
        aiRetrievalRun.projectId,
        aiRetrievalRun.actorUserId,
      ],
    }).onDelete("restrict"),
    check("ai_retrieval_query_embedding_calls_values_check", sql`
      length(btrim(${table.budgetRuleVersion})) > 0
      and ${table.reservedInputTokens} = 8192
      and (${table.inputTokenCount} is null or ${table.inputTokenCount} >= 0)
      and (${table.totalTokenCount} is null or ${table.totalTokenCount} >= 0)
      and ${table.latencyMs} >= 0
      and (
        ${table.dispatchClassification} is null
        or ${table.dispatchClassification} in (
          'pre_dispatch', 'post_dispatch', 'explicit_http_rejection',
          'successful_response'
        )
      )
    `),
    check("ai_retrieval_query_embedding_calls_status_check", sql`
      (
        ${table.status} = 'reserved'
        and ${table.dispatchClassification} is null
        and ${table.failureCode} is null
        and ${table.dispatchedAt} is null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'calling'
        and ${table.dispatchClassification} = 'post_dispatch'
        and ${table.failureCode} is null
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is null
      ) or (
        ${table.status} = 'succeeded'
        and ${table.dispatchClassification} = 'successful_response'
        and ${table.failureCode} is null
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'failed_confirmed_no_charge'
        and ${table.dispatchClassification} = 'pre_dispatch'
        and ${table.failureCode} is not null
        and length(btrim(${table.failureCode})) > 0
        and ${table.completedAt} is not null
      ) or (
        ${table.status} = 'unknown'
        and ${table.dispatchClassification} in (
          'post_dispatch', 'explicit_http_rejection', 'successful_response'
        )
        and ${table.failureCode} = 'PROVIDER_RESULT_UNKNOWN'
        and ${table.dispatchedAt} is not null
        and ${table.completedAt} is not null
      )
    `),
  ],
);

export const aiRetrievalCandidate = pgTable(
  "ai_retrieval_candidates",
  {
    id: text("id").primaryKey(),
    retrievalRunId: text("retrieval_run_id").notNull(),
    projectId: text("project_id").notNull(),
    chunkId: text("chunk_id").notNull(),
    documentId: text("document_id").notNull(),
    versionId: text("version_id").notNull(),
    candidateSource: aiRetrievalCandidateSourceEnum("candidate_source").notNull(),
    lexicalRank: integer("lexical_rank"),
    lexicalScore: doublePrecision("lexical_score"),
    vectorRank: integer("vector_rank"),
    vectorDistance: doublePrecision("vector_distance"),
    rrfScore: doublePrecision("rrf_score").notNull(),
    finalRank: integer("final_rank"),
    selectedAsEvidence: boolean("selected_as_evidence").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_retrieval_candidates_run_chunk_uidx").on(
      table.retrievalRunId,
      table.chunkId,
    ),
    index("ai_retrieval_candidates_run_rank_idx").on(
      table.retrievalRunId,
      table.finalRank,
    ),
    foreignKey({
      name: "ai_retrieval_candidates_run_scope_fk",
      columns: [table.retrievalRunId, table.projectId],
      foreignColumns: [aiRetrievalRun.id, aiRetrievalRun.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_retrieval_candidates_chunk_scope_fk",
      columns: [table.chunkId, table.projectId, table.documentId, table.versionId],
      foreignColumns: [
        documentChunk.id,
        documentChunk.projectId,
        documentChunk.documentId,
        documentChunk.versionId,
      ],
    }).onDelete("restrict"),
    check("ai_retrieval_candidates_rank_check", sql`
      (${table.lexicalRank} is null or ${table.lexicalRank} between 1 and 30)
      and (${table.vectorRank} is null or ${table.vectorRank} between 1 and 30)
      and (${table.finalRank} is null or ${table.finalRank} between 1 and 30)
      and ${table.rrfScore} >= 0
      and (${table.lexicalScore} is null or ${table.lexicalScore} >= 0)
      and (${table.vectorDistance} is null or ${table.vectorDistance} between 0 and 2)
    `),
    check("ai_retrieval_candidates_source_check", sql`
      (${table.candidateSource} = 'lexical' and ${table.lexicalRank} is not null and ${table.vectorRank} is null)
      or (${table.candidateSource} = 'vector' and ${table.lexicalRank} is null and ${table.vectorRank} is not null)
      or (${table.candidateSource} = 'both' and ${table.lexicalRank} is not null and ${table.vectorRank} is not null)
    `),
  ],
);

export type AiRetrievalRunRecord = typeof aiRetrievalRun.$inferSelect;
export type AiRetrievalQueryEmbeddingCallRecord =
  typeof aiRetrievalQueryEmbeddingCall.$inferSelect;
export type AiRetrievalCandidateRecord = typeof aiRetrievalCandidate.$inferSelect;
