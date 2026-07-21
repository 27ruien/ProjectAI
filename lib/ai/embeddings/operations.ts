import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  EMBEDDING_PROFILE_ID,
  getEmbeddingRuntimeConfig,
  type EmbeddingRuntimeConfig,
} from "./config";
import { ensureEmbeddingJob } from "./jobs";

export type EmbeddingBackfillCandidate = {
  projectId: string;
  documentId: string;
  versionId: string;
  createdBy: string;
  missingChunkCount: number;
};

export function selectEmbeddingBackfillCandidatesWithinChunkLimit(
  candidates: EmbeddingBackfillCandidate[],
  chunkLimit: number,
): EmbeddingBackfillCandidate[] {
  if (!Number.isSafeInteger(chunkLimit) || chunkLimit < 1 || chunkLimit > 10_000) {
    throw new Error("Embedding Backfill Chunk limit is invalid.");
  }
  let selectedChunks = 0;
  return candidates.filter((candidate) => {
    if (
      !Number.isSafeInteger(candidate.missingChunkCount) ||
      candidate.missingChunkCount < 1 ||
      selectedChunks + candidate.missingChunkCount > chunkLimit
    ) {
      return false;
    }
    selectedChunks += candidate.missingChunkCount;
    return true;
  });
}

export async function listEmbeddingBackfillCandidates(input: {
  projectId?: string;
  limit: number;
  profileId?: string;
}): Promise<EmbeddingBackfillCandidate[]> {
  const profileId = input.profileId ?? EMBEDDING_PROFILE_ID;
  const projectFilter = input.projectId
    ? sql`and c.project_id = ${input.projectId}`
    : sql``;
  const result = await getDb().execute<{
    project_id: string;
    document_id: string;
    version_id: string;
    created_by: string;
    missing_chunk_count: number | string;
  }>(sql`
    select
      c.project_id,
      c.document_id,
      c.version_id,
      v.uploaded_by as created_by,
      count(*) as missing_chunk_count
    from document_chunks c
    inner join document_ingestion_jobs i
      on i.id = c.ingestion_job_id
      and i.status = 'succeeded'
    inner join project_document_versions v
      on v.id = c.version_id
      and v.document_id = c.document_id
      and v.project_id = c.project_id
    inner join project_documents d
      on d.id = c.document_id
      and d.project_id = c.project_id
    inner join projects p on p.id = c.project_id
    left join document_chunk_embeddings e
      on e.chunk_id = c.id
      and e.project_id = c.project_id
      and e.document_id = c.document_id
      and e.version_id = c.version_id
      and e.embedding_profile_id = ${profileId}
      and e.content_sha256 = c.content_sha256
      and e.status = 'current'
    where p.status <> 'cancelled'
      and d.document_status = 'active'
      and v.is_current = true
      and v.storage_status = 'stored'
      and c.is_effective = true
      and length(btrim(c.content)) > 0
      and e.id is null
      ${projectFilter}
    group by c.project_id, c.document_id, c.version_id, v.uploaded_by
    order by c.project_id asc, c.document_id asc, c.version_id asc
    limit 10000
  `);
  const candidates = result.rows.map((row) => ({
    projectId: row.project_id,
    documentId: row.document_id,
    versionId: row.version_id,
    createdBy: row.created_by,
    missingChunkCount: Number(row.missing_chunk_count),
  }));
  return selectEmbeddingBackfillCandidatesWithinChunkLimit(candidates, input.limit);
}

export async function enqueueEmbeddingBackfill(input: {
  projectId?: string;
  limit: number;
  apply: boolean;
  config?: EmbeddingRuntimeConfig;
}): Promise<{
  dryRun: boolean;
  candidateVersions: number;
  missingChunks: number;
  enqueuedJobs: number;
}> {
  const config = input.config ?? getEmbeddingRuntimeConfig();
  const candidates = await listEmbeddingBackfillCandidates({
    projectId: input.projectId,
    limit: input.limit,
    profileId: config.profileId,
  });
  let enqueuedJobs = 0;
  if (input.apply) {
    for (const candidate of candidates) {
      const job = await ensureEmbeddingJob({
        ...candidate,
        reason: "backfill",
        config,
      });
      if (job) enqueuedJobs += 1;
    }
  }
  return {
    dryRun: !input.apply,
    candidateVersions: candidates.length,
    missingChunks: candidates.reduce(
      (total, candidate) => total + candidate.missingChunkCount,
      0,
    ),
    enqueuedJobs,
  };
}

export async function getEmbeddingStatus(): Promise<{
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  missingEmbeddings: number;
  staleLeases: number;
  inputTokenUsage: number;
  unknownProviderCalls: number;
}> {
  const result = await getDb().execute<{
    pending: number | string;
    running: number | string;
    succeeded: number | string;
    failed: number | string;
    missing_embeddings: number | string;
    stale_leases: number | string;
    input_token_usage: number | string;
    unknown_provider_calls: number | string;
  }>(sql`
    select
      (select count(*) from document_embedding_jobs where status = 'pending') as pending,
      (select count(*) from document_embedding_jobs where status = 'running') as running,
      (select count(*) from document_embedding_jobs where status = 'succeeded') as succeeded,
      (select count(*) from document_embedding_jobs where status = 'failed') as failed,
      (
        select count(*)
        from document_chunks c
        inner join document_ingestion_jobs i
          on i.id = c.ingestion_job_id and i.status = 'succeeded'
        inner join project_document_versions v
          on v.id = c.version_id
          and v.document_id = c.document_id
          and v.project_id = c.project_id
        inner join project_documents d
          on d.id = c.document_id and d.project_id = c.project_id
        inner join projects p on p.id = c.project_id
        left join document_chunk_embeddings e
          on e.chunk_id = c.id
          and e.embedding_profile_id = ${EMBEDDING_PROFILE_ID}
          and e.content_sha256 = c.content_sha256
          and e.status = 'current'
        where p.status <> 'cancelled'
          and d.document_status = 'active'
          and v.is_current = true
          and v.storage_status = 'stored'
          and c.is_effective = true
          and length(btrim(c.content)) > 0
          and e.id is null
      ) as missing_embeddings,
      (
        select count(*) from document_embedding_jobs
        where status = 'running' and lease_expires_at <= now()
      ) as stale_leases,
      (
        select coalesce(sum(input_token_count), 0)
        from document_embedding_provider_calls
        where status = 'succeeded'
          and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
          and created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day'
      ) as input_token_usage,
      (
        select count(*)
        from document_embedding_provider_calls
        where status = 'unknown'
      ) as unknown_provider_calls
  `);
  const row = result.rows[0];
  return {
    pending: Number(row?.pending ?? 0),
    running: Number(row?.running ?? 0),
    succeeded: Number(row?.succeeded ?? 0),
    failed: Number(row?.failed ?? 0),
    missingEmbeddings: Number(row?.missing_embeddings ?? 0),
    staleLeases: Number(row?.stale_leases ?? 0),
    inputTokenUsage: Number(row?.input_token_usage ?? 0),
    unknownProviderCalls: Number(row?.unknown_provider_calls ?? 0),
  };
}

function vectorLiteral(vector: number[]): string {
  if (vector.length !== 1024 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Probe vector must contain exactly 1024 finite values.");
  }
  return `[${vector.join(",")}]`;
}

export async function findNearestEmbeddedChunksForProbe(input: {
  projectId: string;
  vector: number[];
  limit?: number;
  profileId?: string;
}): Promise<Array<{ chunkId: string; distance: number }>> {
  const profileId = input.profileId ?? EMBEDDING_PROFILE_ID;
  const result = await getDb().execute<{
    chunk_id: string;
    distance: number | string;
  }>(sql`
    select
      c.id as chunk_id,
      e.embedding <=> cast(${vectorLiteral(input.vector)} as vector(1024)) as distance
    from document_chunk_embeddings e
    inner join document_chunks c
      on c.id = e.chunk_id
      and c.project_id = e.project_id
      and c.document_id = e.document_id
      and c.version_id = e.version_id
      and c.content_sha256 = e.content_sha256
    inner join document_ingestion_jobs i
      on i.id = c.ingestion_job_id and i.status = 'succeeded'
    inner join project_document_versions v
      on v.id = c.version_id
      and v.document_id = c.document_id
      and v.project_id = c.project_id
    inner join project_documents d
      on d.id = c.document_id and d.project_id = c.project_id
    inner join projects p on p.id = c.project_id
    where e.project_id = ${input.projectId}
      and e.embedding_profile_id = ${profileId}
      and e.status = 'current'
      and p.status <> 'cancelled'
      and d.document_status = 'active'
      and v.is_current = true
      and v.storage_status = 'stored'
      and c.is_effective = true
    order by e.embedding <=> cast(${vectorLiteral(input.vector)} as vector(1024)), c.id
    limit ${Math.min(Math.max(input.limit ?? 5, 1), 20)}
  `);
  return result.rows.map((row) => ({
    chunkId: row.chunk_id,
    distance: Number(row.distance),
  }));
}
