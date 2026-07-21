import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import {
  createEmbeddingGateway,
  getEmbeddingRuntimeConfig,
} from "@/lib/ai/embeddings";
import { controlledEmbeddingError } from "@/lib/ai/embeddings/errors";
import { isAiProviderConfigured } from "@/lib/ai/project-assistant/config";
import { getDb } from "@/lib/db/client";
import type { AiExecutionRecord } from "@/lib/db/schema";
import {
  type ProjectKnowledgeEvidence,
  type RankedProjectKnowledgeEvidence,
  retrieveLexicalProjectCandidates,
  selectBoundedProjectEvidence,
} from "@/lib/documents/processing/search-service";
import { validateSourceLocator } from "@/lib/documents/processing/source-locator";
import {
  getHybridRetrievalRuntimeConfig,
  HYBRID_RETRIEVAL_PROFILE,
  type RetrievalMode,
} from "./config";
import {
  createRetrievalRun,
  finalizeQueryEmbeddingCallFailed,
  finalizeQueryEmbeddingCallSucceeded,
  finalizeRetrievalRun,
  markQueryEmbeddingCallDispatched,
  reserveQueryEmbeddingCall,
  retrievalProfileState,
} from "./repository";
import {
  reciprocalRankFusion,
  reciprocalRankFusionAudit,
  type AuditedRetrievalCandidate,
  type FusedRetrievalCandidate,
  type RankedRetrievalCandidate,
} from "./rrf";

export type RetrievalFallbackReason =
  | "RETRIEVAL_PROFILE_DISABLED"
  | "RETRIEVAL_PROFILE_MISMATCH"
  | "EMBEDDING_COVERAGE_INSUFFICIENT"
  | "QUERY_EMBEDDING_CONFIGURATION"
  | "QUERY_EMBEDDING_DAILY_LIMIT"
  | "QUERY_EMBEDDING_UNKNOWN"
  | "VECTOR_RETRIEVAL_TIMEOUT"
  | "VECTOR_RETRIEVAL_FAILED"
  | "VECTOR_CANDIDATES_EMPTY"
  | "HYBRID_CONFIDENCE_INSUFFICIENT"
  | "SHADOW_MODE";

export type RetrievalEvidenceResult = {
  requestedMode: RetrievalMode;
  effectiveMode: "lexical" | "hybrid";
  fallbackReason: RetrievalFallbackReason | null;
  evidence: ProjectKnowledgeEvidence[];
  retrievalRunId: string;
  metrics: {
    lexicalCandidateCount: number;
    vectorCandidateCount: number;
    fusedCandidateCount: number;
    selectedEvidenceCount: number;
    embeddingCoverageBps: number;
    lexicalLatencyMs: number;
    queryEmbeddingLatencyMs: number;
    vectorLatencyMs: number;
    fusionLatencyMs: number;
    totalLatencyMs: number;
  };
};

type VectorRow = {
  chunk_id: string;
  document_id: string;
  version_id: string;
  display_name: string;
  version_number: number;
  mime_type: string;
  content: string;
  content_sha256: string;
  heading_path: unknown;
  source_locator: unknown;
  vector_distance: number | string;
  knowledge_space_id: string;
  source_scope: "organization" | "department" | "project" | "restricted";
};

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function lexicalRanked(
  candidates: RankedProjectKnowledgeEvidence[],
): RankedRetrievalCandidate<ProjectKnowledgeEvidence>[] {
  return candidates.map((candidate) => ({
    chunkId: candidate.evidence.chunkId,
    rank: candidate.rank,
    score: candidate.evidence.score,
    value: candidate.evidence,
  }));
}

function fusedLexicalCandidates(
  lexical: RankedProjectKnowledgeEvidence[],
): FusedRetrievalCandidate<ProjectKnowledgeEvidence>[] {
  return reciprocalRankFusion({
    lexical: lexicalRanked(lexical),
    vector: [],
    rrfK: HYBRID_RETRIEVAL_PROFILE.rrfK,
    lexicalWeight: HYBRID_RETRIEVAL_PROFILE.lexicalWeight,
    vectorWeight: HYBRID_RETRIEVAL_PROFILE.vectorWeight,
    limit: HYBRID_RETRIEVAL_PROFILE.fusedCandidateLimit,
  });
}

function auditedLexicalCandidates(
  lexical: RankedProjectKnowledgeEvidence[],
): AuditedRetrievalCandidate<ProjectKnowledgeEvidence>[] {
  return reciprocalRankFusionAudit({
    lexical: lexicalRanked(lexical),
    vector: [],
    rrfK: HYBRID_RETRIEVAL_PROFILE.rrfK,
    lexicalWeight: HYBRID_RETRIEVAL_PROFILE.lexicalWeight,
    vectorWeight: HYBRID_RETRIEVAL_PROFILE.vectorWeight,
    limit: HYBRID_RETRIEVAL_PROFILE.fusedCandidateLimit,
  });
}

function selectLexicalEvidence(
  lexical: RankedProjectKnowledgeEvidence[],
): ProjectKnowledgeEvidence[] {
  return selectBoundedProjectEvidence({
    candidates: lexical,
    evidenceLimit: HYBRID_RETRIEVAL_PROFILE.evidenceLimit,
    maxChars: HYBRID_RETRIEVAL_PROFILE.maxEvidenceCharacters,
    minimumScore: 0.12,
  });
}

function selectHybridEvidence(
  fused: FusedRetrievalCandidate<ProjectKnowledgeEvidence>[],
): ProjectKnowledgeEvidence[] {
  return selectBoundedProjectEvidence({
    candidates: fused.map((candidate) => ({
      evidence: { ...candidate.value, score: candidate.rrfScore },
    })),
    evidenceLimit: HYBRID_RETRIEVAL_PROFILE.evidenceLimit,
    maxChars: HYBRID_RETRIEVAL_PROFILE.maxEvidenceCharacters,
  });
}

async function embeddingCoverage(input: {
  actorUserId: string;
  projectId: string;
  sourceDocumentIds: string[];
}): Promise<{
  basisPoints: number;
  chunkCount: number;
}> {
  const documentFilter = input.sourceDocumentIds.length
    ? sql`and c.document_id in (${sql.join(input.sourceDocumentIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const result = await getDb().execute<{
    chunk_count: string | number;
    embedding_count: string | number;
  }>(sql`
    select
      count(*)::int as chunk_count,
      count(e.id)::int as embedding_count
    from document_chunks c
    inner join document_ingestion_jobs j
      on j.id = c.ingestion_job_id
      and j.project_id = c.project_id
      and j.document_id = c.document_id
      and j.version_id = c.version_id
      and j.generation = c.generation
    inner join project_document_versions v
      on v.id = c.version_id
      and v.document_id = c.document_id
      and v.project_id = c.project_id
    inner join project_documents d
      on d.id = c.document_id
      and d.project_id = c.project_id
    inner join projectai_authorized_documents(
      ${input.actorUserId},
      ${input.projectId},
      'view'::knowledge_permission
    ) authorized
      on authorized.document_id = c.document_id
      and authorized.source_project_id = c.project_id
    left join document_chunk_embeddings e
      on e.chunk_id = c.id
      and e.project_id = c.project_id
      and e.document_id = c.document_id
      and e.version_id = c.version_id
      and e.content_sha256 = c.content_sha256
      and e.embedding_profile_id = ${HYBRID_RETRIEVAL_PROFILE.embeddingProfileId}
      and e.status = 'current'
    where c.is_effective = true
      and d.document_status = 'active'
      and v.storage_status = 'stored'
      and v.is_current = true
      and j.status = 'succeeded'
      ${documentFilter}
  `);
  const row = result.rows[0];
  const chunks = Number(row?.chunk_count ?? 0);
  const embeddings = Number(row?.embedding_count ?? 0);
  return {
    basisPoints: chunks === 0 ? 0 : Math.floor((embeddings * 10_000) / chunks),
    chunkCount: chunks,
  };
}

async function embedQuery(input: {
  retrievalRunId: string;
  projectId: string;
  actorUserId: string;
  query: string;
}): Promise<
  | { vector: number[]; latencyMs: number }
  | { fallbackReason: RetrievalFallbackReason; latencyMs: number }
> {
  const runtime = getHybridRetrievalRuntimeConfig();
  if (!(await isAiProviderConfigured())) {
    return { fallbackReason: "QUERY_EMBEDDING_CONFIGURATION", latencyMs: 0 };
  }
  const reservation = await reserveQueryEmbeddingCall({
    retrievalRunId: input.retrievalRunId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    dailyTokenLimit: runtime.queryEmbeddingDailyTokenLimit,
  });
  if (!reservation.reserved) {
    return { fallbackReason: reservation.reason, latencyMs: 0 };
  }
  const started = performance.now();
  try {
    const embeddingConfig = getEmbeddingRuntimeConfig();
    const gateway = createEmbeddingGateway({
      ...embeddingConfig,
      enabled: true,
      timeoutMs: runtime.queryEmbeddingTimeoutMs,
      batchSize: 1,
      batchMaxCharacters: 2_000,
    });
    const result = await gateway.embed([input.query], {
      onProviderRequestStarted: () =>
        markQueryEmbeddingCallDispatched(reservation.call.id),
    });
    await finalizeQueryEmbeddingCallSucceeded({
      callId: reservation.call.id,
      inputTokenCount: result.inputTokens,
      totalTokenCount: result.totalTokens,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    });
    return { vector: result.vectors[0]!, latencyMs: result.latencyMs };
  } catch (error) {
    const controlled = controlledEmbeddingError(error);
    const confirmedNoCharge = controlled.dispatchClassification === "pre_dispatch";
    await finalizeQueryEmbeddingCallFailed({
      callId: reservation.call.id,
      confirmedNoCharge,
      dispatchClassification: controlled.dispatchClassification,
      latencyMs: elapsed(started),
    });
    return {
      fallbackReason: confirmedNoCharge
        ? "QUERY_EMBEDDING_CONFIGURATION"
        : "QUERY_EMBEDDING_UNKNOWN",
      latencyMs: elapsed(started),
    };
  }
}

async function exactVectorCandidates(input: {
  actorUserId: string;
  projectId: string;
  vector: number[];
  sourceDocumentIds: string[];
}): Promise<RankedRetrievalCandidate<ProjectKnowledgeEvidence>[]> {
  const runtime = getHybridRetrievalRuntimeConfig();
  const vectorLiteral = `[${input.vector.join(",")}]`;
  const documentFilter = input.sourceDocumentIds.length
    ? sql`and c.document_id in (${sql.join(input.sourceDocumentIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``;
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('statement_timeout', ${String(runtime.vectorSqlTimeoutMs)}, true)`,
    );
    return tx.execute<VectorRow>(sql`
      select
        c.id as chunk_id,
        c.document_id,
        c.version_id,
        d.display_name,
        v.version_number,
        v.detected_mime_type as mime_type,
        c.content,
        c.content_sha256,
        c.heading_path,
        c.source_locator,
        authorized.knowledge_space_id,
        authorized.source_scope,
        (e.embedding <=> ${vectorLiteral}::vector) as vector_distance
      from document_chunk_embeddings e
      inner join document_chunks c
        on c.id = e.chunk_id
        and c.project_id = e.project_id
        and c.document_id = e.document_id
        and c.version_id = e.version_id
        and c.content_sha256 = e.content_sha256
      inner join document_ingestion_jobs j
        on j.id = c.ingestion_job_id
        and j.project_id = c.project_id
        and j.document_id = c.document_id
        and j.version_id = c.version_id
        and j.generation = c.generation
      inner join project_document_versions v
        on v.id = c.version_id
        and v.document_id = c.document_id
        and v.project_id = c.project_id
      inner join project_documents d
        on d.id = c.document_id
        and d.project_id = c.project_id
      inner join projectai_authorized_documents(
        ${input.actorUserId},
        ${input.projectId},
        'view'::knowledge_permission
      ) authorized
        on authorized.document_id = c.document_id
        and authorized.source_project_id = c.project_id
      where e.embedding_profile_id = ${HYBRID_RETRIEVAL_PROFILE.embeddingProfileId}
        and e.status = 'current'
        and c.is_effective = true
        and d.document_status = 'active'
        and v.storage_status = 'stored'
        and v.is_current = true
        and j.status = 'succeeded'
        ${documentFilter}
        and (e.embedding <=> ${vectorLiteral}::vector) <= ${HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance}
      order by (e.embedding <=> ${vectorLiteral}::vector) asc, c.id asc
      limit ${HYBRID_RETRIEVAL_PROFILE.vectorCandidateLimit}
    `);
  });
  return result.rows.map((row, index) => ({
    chunkId: row.chunk_id,
    rank: index + 1,
    score: Number(row.vector_distance),
    value: {
      label: "",
      chunkId: row.chunk_id,
      documentId: row.document_id,
      versionId: row.version_id,
      displayName: row.display_name,
      versionNumber: row.version_number,
      mimeType: row.mime_type,
      content: row.content.trim(),
      contentSha256: row.content_sha256,
      headingPath: Array.isArray(row.heading_path)
        ? row.heading_path.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      source: validateSourceLocator(row.source_locator),
      score: Math.max(0, 1 - Number(row.vector_distance)),
      knowledgeSpaceId: row.knowledge_space_id,
      sourceScope: row.source_scope,
    },
  }));
}

function vectorFailureReason(error: unknown): RetrievalFallbackReason {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  return code === "57014" ? "VECTOR_RETRIEVAL_TIMEOUT" : "VECTOR_RETRIEVAL_FAILED";
}

export async function retrieveProjectEvidence(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
  query: string;
  mode: RetrievalMode;
  retrievalProfileId: string;
  execution: AiExecutionRecord;
  sourceDocumentIds: string[];
}): Promise<RetrievalEvidenceResult> {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const runtime = getHybridRetrievalRuntimeConfig();
  if (input.mode !== runtime.mode || input.retrievalProfileId !== runtime.profileId) {
    throw new Error("Server retrieval configuration mismatch.");
  }
  const query = input.query.trim().slice(0, 2_000);
  const totalStarted = performance.now();
  const retrievalRunId = await createRetrievalRun({
    execution: input.execution,
    querySha256: createHash("sha256").update(query).digest("hex"),
    requestedMode: input.mode,
  });

  const lexicalStarted = performance.now();
  const lexical = await retrieveLexicalProjectCandidates({
    actorUserId: input.principal.user.id,
    projectId: input.projectId,
    query,
    limit: HYBRID_RETRIEVAL_PROFILE.lexicalCandidateLimit,
    documentIds: input.sourceDocumentIds,
  });
  const lexicalLatencyMs = elapsed(lexicalStarted);
  const lexicalEvidence = selectLexicalEvidence(lexical);
  let coverageBps = 0;
  let queryEmbeddingLatencyMs = 0;
  let vectorLatencyMs = 0;
  let fusionLatencyMs = 0;
  let vector: RankedRetrievalCandidate<ProjectKnowledgeEvidence>[] = [];
  let fused = fusedLexicalCandidates(lexical);
  let auditCandidates = auditedLexicalCandidates(lexical);
  let evidence = lexicalEvidence;
  let effectiveMode: "lexical" | "hybrid" = "lexical";
  let fallbackReason: RetrievalFallbackReason | null = null;

  if (input.mode !== "lexical") {
    const profile = await retrievalProfileState();
    if (!profile.exists || !profile.enabled) {
      fallbackReason = "RETRIEVAL_PROFILE_DISABLED";
    } else if (!profile.definitionMatches) {
      fallbackReason = "RETRIEVAL_PROFILE_MISMATCH";
    } else {
      const coverage = await embeddingCoverage({
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        sourceDocumentIds: input.sourceDocumentIds,
      });
      coverageBps = coverage.basisPoints;
      if (coverage.chunkCount === 0) {
        // Preserve B3-A insufficient-evidence behavior without paying for a
        // query embedding when the project has no eligible knowledge.
      } else if (
        coverageBps < HYBRID_RETRIEVAL_PROFILE.minEmbeddingCoverageBps
      ) {
        fallbackReason = "EMBEDDING_COVERAGE_INSUFFICIENT";
      } else {
        const embedded = await embedQuery({
          retrievalRunId,
          projectId: input.projectId,
          actorUserId: input.principal.user.id,
          query,
        });
        queryEmbeddingLatencyMs = embedded.latencyMs;
        if ("fallbackReason" in embedded) {
          fallbackReason = embedded.fallbackReason;
        } else {
          const vectorStarted = performance.now();
          try {
            vector = await exactVectorCandidates({
              actorUserId: input.principal.user.id,
              projectId: input.projectId,
              vector: embedded.vector,
              sourceDocumentIds: input.sourceDocumentIds,
            });
            vectorLatencyMs = elapsed(vectorStarted);
          } catch (error) {
            vectorLatencyMs = elapsed(vectorStarted);
            fallbackReason = vectorFailureReason(error);
          }
          if (!fallbackReason && vector.length === 0) {
            fallbackReason = "VECTOR_CANDIDATES_EMPTY";
          }
          if (!fallbackReason) {
            const fusionStarted = performance.now();
            auditCandidates = reciprocalRankFusionAudit({
              lexical: lexicalRanked(lexical),
              vector,
              rrfK: HYBRID_RETRIEVAL_PROFILE.rrfK,
              lexicalWeight: HYBRID_RETRIEVAL_PROFILE.lexicalWeight,
              vectorWeight: HYBRID_RETRIEVAL_PROFILE.vectorWeight,
              limit: HYBRID_RETRIEVAL_PROFILE.fusedCandidateLimit,
            });
            fused = auditCandidates.filter(
              (candidate): candidate is FusedRetrievalCandidate<ProjectKnowledgeEvidence> =>
                candidate.finalRank !== null,
            );
            fusionLatencyMs = elapsed(fusionStarted);
            const hybridEvidence = selectHybridEvidence(fused);
            if (hybridEvidence.length === 0) {
              fallbackReason = "HYBRID_CONFIDENCE_INSUFFICIENT";
            } else if (input.mode === "shadow") {
              fallbackReason = "SHADOW_MODE";
            } else {
              evidence = hybridEvidence;
              effectiveMode = "hybrid";
            }
          }
        }
      }
    }
  }

  const selectedChunkIds = new Set(evidence.map((item) => item.chunkId));
  const totalLatencyMs = elapsed(totalStarted);
  await finalizeRetrievalRun({
    retrievalRunId,
    executionId: input.execution.id,
    effectiveMode,
    fallbackReason,
    insufficientEvidence: evidence.length === 0,
    embeddingCoverageBps: coverageBps,
    lexicalLatencyMs,
    queryEmbeddingLatencyMs,
    vectorLatencyMs,
    fusionLatencyMs,
    totalLatencyMs,
    lexicalCandidateCount: lexical.length,
    vectorCandidateCount: vector.length,
    fusedCandidateCount: fused.length,
    candidates: auditCandidates,
    selectedChunkIds,
  });
  return {
    requestedMode: input.mode,
    effectiveMode,
    fallbackReason,
    evidence,
    retrievalRunId,
    metrics: {
      lexicalCandidateCount: lexical.length,
      vectorCandidateCount: vector.length,
      fusedCandidateCount: fused.length,
      selectedEvidenceCount: evidence.length,
      embeddingCoverageBps: coverageBps,
      lexicalLatencyMs,
      queryEmbeddingLatencyMs,
      vectorLatencyMs,
      fusionLatencyMs,
      totalLatencyMs,
    },
  };
}
