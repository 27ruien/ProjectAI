import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  HYBRID_RETRIEVAL_PROFILE,
  getHybridRetrievalRuntimeConfig,
} from "../lib/ai/retrieval/config";
import { sql } from "drizzle-orm";

type StatusRow = {
  run_count: string;
  hybrid_success_count: string;
  fallback_count: string;
  insufficient_count: string;
  query_input_tokens: string;
  query_reserved_tokens: string;
  query_unknown_count: string;
  lexical_p50_ms: string | null;
  lexical_p95_ms: string | null;
  query_embedding_p50_ms: string | null;
  query_embedding_p95_ms: string | null;
  vector_sql_p50_ms: string | null;
  vector_sql_p95_ms: string | null;
  fusion_p50_ms: string | null;
  fusion_p95_ms: string | null;
  retrieval_p50_ms: string | null;
  retrieval_p95_ms: string | null;
};

async function main(): Promise<void> {
  const config = getHybridRetrievalRuntimeConfig();
  const db = getDb();
  const profile = await db.execute<{
    id: string;
    enabled: boolean;
    profile_version: number;
  }>(sql`
    select id, enabled, profile_version
    from ai_retrieval_profiles
    where id = ${HYBRID_RETRIEVAL_PROFILE.id}
    limit 1
  `);
  const coverage = await db.execute<{
    eligible_chunks: string;
    embedded_chunks: string;
    coverage_bps: string;
  }>(sql`
    with eligible as (
      select c.id, c.project_id, c.document_id, c.version_id, c.content_sha256
      from document_chunks c
      join document_ingestion_jobs i
        on i.id = c.ingestion_job_id and i.project_id = c.project_id
      join project_document_versions v
        on v.id = c.version_id and v.project_id = c.project_id
      join project_documents d
        on d.id = c.document_id and d.project_id = c.project_id
      where d.document_status = 'active'
        and v.is_current = true
        and v.storage_status = 'stored'
        and i.status = 'succeeded'
        and c.is_effective = true
        and length(btrim(c.content)) > 0
    ), embedded as (
      select distinct e.chunk_id
      from document_chunk_embeddings e
      join eligible on eligible.id = e.chunk_id
        and eligible.project_id = e.project_id
        and eligible.document_id = e.document_id
        and eligible.version_id = e.version_id
        and eligible.content_sha256 = e.content_sha256
      where e.embedding_profile_id = ${HYBRID_RETRIEVAL_PROFILE.embeddingProfileId}
        and e.status = 'current'
    )
    select
      (select count(*)::text from eligible) as eligible_chunks,
      (select count(*)::text from embedded) as embedded_chunks,
      case when (select count(*) from eligible) = 0 then '0'
        else floor(
          (select count(*) from embedded)::numeric * 10000 /
          (select count(*) from eligible)
        )::text
      end as coverage_bps
  `);
  const activity = await db.execute<StatusRow>(sql`
    select
      count(distinct r.id)::text as run_count,
      count(distinct r.id) filter (
        where r.status = 'succeeded' and r.effective_mode = 'hybrid'
      )::text as hybrid_success_count,
      count(distinct r.id) filter (where r.status = 'fallback_lexical')::text
        as fallback_count,
      count(distinct r.id) filter (where r.status = 'insufficient_evidence')::text
        as insufficient_count,
      coalesce(sum(q.input_token_count), 0)::text as query_input_tokens,
      coalesce(sum(
        case when q.status in ('reserved', 'calling', 'unknown')
          or (q.status = 'succeeded' and q.input_token_count is null)
          then q.reserved_input_tokens else 0 end
      ), 0)::text as query_reserved_tokens,
      count(q.id) filter (where q.status = 'unknown')::text as query_unknown_count,
      percentile_cont(0.5) within group (order by r.lexical_latency_ms)::text
        as lexical_p50_ms,
      percentile_cont(0.95) within group (order by r.lexical_latency_ms)::text
        as lexical_p95_ms,
      percentile_cont(0.5) within group (order by r.query_embedding_latency_ms)::text
        as query_embedding_p50_ms,
      percentile_cont(0.95) within group (order by r.query_embedding_latency_ms)::text
        as query_embedding_p95_ms,
      percentile_cont(0.5) within group (order by r.vector_latency_ms)::text
        as vector_sql_p50_ms,
      percentile_cont(0.95) within group (order by r.vector_latency_ms)::text
        as vector_sql_p95_ms,
      percentile_cont(0.5) within group (order by r.fusion_latency_ms)::text
        as fusion_p50_ms,
      percentile_cont(0.95) within group (order by r.fusion_latency_ms)::text
        as fusion_p95_ms,
      percentile_cont(0.5) within group (order by r.total_latency_ms)::text
        as retrieval_p50_ms,
      percentile_cont(0.95) within group (order by r.total_latency_ms)::text
        as retrieval_p95_ms
    from ai_retrieval_runs r
    left join ai_retrieval_query_embedding_calls q on q.retrieval_run_id = r.id
    where r.created_at >= current_timestamp - interval '24 hours'
  `);
  const byFallback = await db.execute<{ reason: string; count: string }>(sql`
    select coalesce(fallback_reason, 'NONE') as reason, count(*)::text as count
    from ai_retrieval_runs
    where created_at >= current_timestamp - interval '24 hours'
    group by coalesce(fallback_reason, 'NONE')
    order by reason
  `);
  process.stdout.write(`${JSON.stringify({
    mode: config.mode,
    profile: profile.rows[0] ?? null,
    coverage: coverage.rows[0] ?? {
      eligible_chunks: "0",
      embedded_chunks: "0",
      coverage_bps: "0",
    },
    past24Hours: activity.rows[0],
    fallbackDistribution: byFallback.rows,
  })}\n`);
}

main()
  .finally(() => closeDatabasePool())
  .catch((error: unknown) => {
    process.stderr.write(
      `Retrieval status failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
