import { and, eq, inArray, sql } from "drizzle-orm";
import { EmbeddingPipelineError } from "@/lib/ai/embeddings/errors";
import { getDb } from "@/lib/db/client";
import {
  aiExecution,
  aiRetrievalCandidate,
  aiRetrievalProfile,
  aiRetrievalQueryEmbeddingCall,
  aiRetrievalRun,
  type AiExecutionRecord,
  type AiRetrievalMode,
  type AiRetrievalQueryEmbeddingCallRecord,
} from "@/lib/db/schema";
import {
  HYBRID_RETRIEVAL_PROFILE,
  HYBRID_RETRIEVAL_VERSION,
  QUERY_EMBEDDING_BUDGET_RULE_VERSION,
  QUERY_EMBEDDING_RESERVED_TOKENS,
} from "./config";
import type { AuditedRetrievalCandidate } from "./rrf";
import type { ProjectKnowledgeEvidence } from "@/lib/documents/processing/search-service";

export async function retrievalProfileState(): Promise<{
  exists: boolean;
  enabled: boolean;
  definitionMatches: boolean;
}> {
  const [row] = await getDb()
    .select()
    .from(aiRetrievalProfile)
    .where(eq(aiRetrievalProfile.id, HYBRID_RETRIEVAL_PROFILE.id))
    .limit(1);
  if (!row) return { exists: false, enabled: false, definitionMatches: false };
  return {
    exists: true,
    enabled: row.enabled,
    definitionMatches:
      row.profileVersion === HYBRID_RETRIEVAL_PROFILE.version &&
      row.lexicalCandidateLimit ===
        HYBRID_RETRIEVAL_PROFILE.lexicalCandidateLimit &&
      row.vectorCandidateLimit === HYBRID_RETRIEVAL_PROFILE.vectorCandidateLimit &&
      row.fusedCandidateLimit === HYBRID_RETRIEVAL_PROFILE.fusedCandidateLimit &&
      row.evidenceLimit === HYBRID_RETRIEVAL_PROFILE.evidenceLimit &&
      row.rrfK === HYBRID_RETRIEVAL_PROFILE.rrfK &&
      row.lexicalWeight === HYBRID_RETRIEVAL_PROFILE.lexicalWeight &&
      row.vectorWeight === HYBRID_RETRIEVAL_PROFILE.vectorWeight &&
      row.vectorMaxDistance === HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance &&
      row.minEmbeddingCoverageBps ===
        HYBRID_RETRIEVAL_PROFILE.minEmbeddingCoverageBps &&
      row.embeddingProfileId === HYBRID_RETRIEVAL_PROFILE.embeddingProfileId,
  };
}

export async function createRetrievalRun(input: {
  execution: AiExecutionRecord;
  querySha256: string;
  requestedMode: AiRetrievalMode;
}): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(aiRetrievalRun).values({
    id,
    projectId: input.execution.projectId,
    threadId: input.execution.threadId,
    userMessageId: input.execution.userMessageId,
    aiExecutionId: input.execution.id,
    actorUserId: input.execution.actorUserId,
    retrievalProfileId: HYBRID_RETRIEVAL_PROFILE.id,
    requestedMode: input.requestedMode,
    status: "running",
    querySha256: input.querySha256,
    retrievalVersion: HYBRID_RETRIEVAL_VERSION,
  });
  return id;
}

export async function reserveQueryEmbeddingCall(input: {
  retrievalRunId: string;
  projectId: string;
  actorUserId: string;
  dailyTokenLimit: number;
}): Promise<
  | { reserved: false; reason: "QUERY_EMBEDDING_DAILY_LIMIT" }
  | { reserved: true; call: AiRetrievalQueryEmbeddingCallRecord }
> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          'query-embedding-daily-token-budget:' ||
          (current_timestamp at time zone 'UTC')::date::text,
          0
        )
      )
    `);
    const usage = await tx.execute<{ used_tokens: string | number }>(sql`
      select coalesce(sum(
        case
          when status = 'succeeded' and input_token_count is not null
            then input_token_count
          when status in ('reserved', 'calling', 'succeeded', 'unknown')
            then reserved_input_tokens
          else 0
        end
      ), 0) as used_tokens
      from ai_retrieval_query_embedding_calls
      where created_at >= date_trunc('day', current_timestamp at time zone 'UTC') at time zone 'UTC'
    `);
    if (
      Number(usage.rows[0]?.used_tokens ?? 0) +
        QUERY_EMBEDDING_RESERVED_TOKENS >
      input.dailyTokenLimit
    ) {
      return { reserved: false, reason: "QUERY_EMBEDDING_DAILY_LIMIT" } as const;
    }
    const [call] = await tx
      .insert(aiRetrievalQueryEmbeddingCall)
      .values({
        id: crypto.randomUUID(),
        retrievalRunId: input.retrievalRunId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        embeddingProfileId: HYBRID_RETRIEVAL_PROFILE.embeddingProfileId,
        status: "reserved",
        budgetRuleVersion: QUERY_EMBEDDING_BUDGET_RULE_VERSION,
        reservedInputTokens: QUERY_EMBEDDING_RESERVED_TOKENS,
      })
      .returning();
    if (!call) throw new EmbeddingPipelineError("SERVER_ERROR", false);
    return { reserved: true, call } as const;
  });
}

export async function markQueryEmbeddingCallDispatched(
  callId: string,
): Promise<void> {
  const [updated] = await getDb()
    .update(aiRetrievalQueryEmbeddingCall)
    .set({
      status: "calling",
      dispatchClassification: "post_dispatch",
      dispatchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiRetrievalQueryEmbeddingCall.id, callId),
        eq(aiRetrievalQueryEmbeddingCall.status, "reserved"),
      ),
    )
    .returning({ id: aiRetrievalQueryEmbeddingCall.id });
  if (!updated) {
    throw new EmbeddingPipelineError("PROVIDER_RESULT_UNKNOWN", false);
  }
}

export async function finalizeQueryEmbeddingCallSucceeded(input: {
  callId: string;
  inputTokenCount: number | null;
  totalTokenCount: number | null;
  providerRequestId: string | null;
  latencyMs: number;
}): Promise<void> {
  const [updated] = await getDb()
    .update(aiRetrievalQueryEmbeddingCall)
    .set({
      status: "succeeded",
      dispatchClassification: "successful_response",
      inputTokenCount: input.inputTokenCount,
      totalTokenCount: input.totalTokenCount,
      providerRequestId: input.providerRequestId,
      latencyMs: input.latencyMs,
      failureCode: null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiRetrievalQueryEmbeddingCall.id, input.callId),
        eq(aiRetrievalQueryEmbeddingCall.status, "calling"),
      ),
    )
    .returning({ id: aiRetrievalQueryEmbeddingCall.id });
  if (!updated) throw new EmbeddingPipelineError("PROVIDER_RESULT_UNKNOWN", false);
}

export async function finalizeQueryEmbeddingCallFailed(input: {
  callId: string;
  confirmedNoCharge: boolean;
  dispatchClassification:
    | "pre_dispatch"
    | "post_dispatch"
    | "explicit_http_rejection"
    | "successful_response";
  latencyMs: number;
}): Promise<void> {
  const terminalStatus = input.confirmedNoCharge
    ? "failed_confirmed_no_charge"
    : "unknown";
  const failureCode = input.confirmedNoCharge
    ? "QUERY_EMBEDDING_PRE_DISPATCH_FAILED"
    : "PROVIDER_RESULT_UNKNOWN";
  const [updated] = await getDb()
    .update(aiRetrievalQueryEmbeddingCall)
    .set({
      status: terminalStatus,
      dispatchClassification: input.confirmedNoCharge
        ? "pre_dispatch"
        : input.dispatchClassification,
      failureCode,
      latencyMs: Math.max(0, input.latencyMs),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiRetrievalQueryEmbeddingCall.id, input.callId),
        inArray(aiRetrievalQueryEmbeddingCall.status, ["reserved", "calling"]),
      ),
    )
    .returning({ id: aiRetrievalQueryEmbeddingCall.id });
  if (!updated) throw new EmbeddingPipelineError("SERVER_ERROR", false);
}

export async function finalizeRetrievalRun(input: {
  retrievalRunId: string;
  executionId: string;
  effectiveMode: "lexical" | "hybrid";
  fallbackReason: string | null;
  insufficientEvidence: boolean;
  embeddingCoverageBps: number;
  lexicalLatencyMs: number;
  queryEmbeddingLatencyMs: number;
  vectorLatencyMs: number;
  fusionLatencyMs: number;
  totalLatencyMs: number;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  fusedCandidateCount: number;
  candidates: AuditedRetrievalCandidate<ProjectKnowledgeEvidence>[];
  selectedChunkIds: Set<string>;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [run] = await tx
      .select({ projectId: aiRetrievalRun.projectId })
      .from(aiRetrievalRun)
      .where(eq(aiRetrievalRun.id, input.retrievalRunId))
      .limit(1)
      .for("update", { of: aiRetrievalRun });
    if (!run) throw new EmbeddingPipelineError("SERVER_ERROR", false);
    if (input.candidates.length > 0) {
      await tx.insert(aiRetrievalCandidate).values(
        input.candidates.map((candidate) => ({
          id: crypto.randomUUID(),
          retrievalRunId: input.retrievalRunId,
          projectId: run.projectId,
          chunkId: candidate.chunkId,
          documentId: candidate.value.documentId,
          versionId: candidate.value.versionId,
          candidateSource: candidate.candidateSource,
          lexicalRank: candidate.lexicalRank,
          lexicalScore: candidate.lexicalScore,
          vectorRank: candidate.vectorRank,
          vectorDistance: candidate.vectorDistance,
          rrfScore: candidate.rrfScore,
          finalRank: candidate.finalRank,
          selectedAsEvidence: input.selectedChunkIds.has(candidate.chunkId),
        })),
      );
    }
    const completedAt = new Date();
    const status = input.insufficientEvidence
      ? "insufficient_evidence"
      : input.fallbackReason
        ? "fallback_lexical"
        : "succeeded";
    const [updatedRun] = await tx
      .update(aiRetrievalRun)
      .set({
        effectiveMode: input.effectiveMode,
        status,
        lexicalCandidateCount: input.lexicalCandidateCount,
        vectorCandidateCount: input.vectorCandidateCount,
        fusedCandidateCount: input.fusedCandidateCount,
        selectedEvidenceCount: input.selectedChunkIds.size,
        embeddingCoverageBps: input.embeddingCoverageBps,
        lexicalLatencyMs: input.lexicalLatencyMs,
        queryEmbeddingLatencyMs: input.queryEmbeddingLatencyMs,
        vectorLatencyMs: input.vectorLatencyMs,
        fusionLatencyMs: input.fusionLatencyMs,
        totalLatencyMs: input.totalLatencyMs,
        fallbackReason: input.fallbackReason,
        completedAt,
      })
      .where(
        and(
          eq(aiRetrievalRun.id, input.retrievalRunId),
          eq(aiRetrievalRun.status, "running"),
        ),
      )
      .returning({ id: aiRetrievalRun.id });
    if (!updatedRun) throw new EmbeddingPipelineError("SERVER_ERROR", false);
    await tx
      .update(aiExecution)
      .set({
        retrievalRunId: input.retrievalRunId,
        effectiveRetrievalMode: input.effectiveMode,
        retrievalFallbackReason: input.fallbackReason,
        retrievalVersion: HYBRID_RETRIEVAL_VERSION,
      })
      .where(eq(aiExecution.id, input.executionId));
  });
}

export async function finalizeFailedRetrievalRunForExecution(
  executionId: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(aiRetrievalRun)
      .where(eq(aiRetrievalRun.aiExecutionId, executionId))
      .limit(1)
      .for("update", { of: aiRetrievalRun });
    if (!run || run.status !== "running") return;
    const completedAt = new Date();
    await tx
      .update(aiRetrievalRun)
      .set({
        status: "failed",
        effectiveMode: "lexical",
        fallbackReason: "RETRIEVAL_FAILED",
        totalLatencyMs: Math.max(
          0,
          completedAt.getTime() - run.startedAt.getTime(),
        ),
        completedAt,
      })
      .where(eq(aiRetrievalRun.id, run.id));
    await tx
      .update(aiExecution)
      .set({
        retrievalRunId: run.id,
        effectiveRetrievalMode: "lexical",
        retrievalFallbackReason: "RETRIEVAL_FAILED",
        retrievalVersion: HYBRID_RETRIEVAL_VERSION,
      })
      .where(eq(aiExecution.id, executionId));
  });
}
