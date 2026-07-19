import { sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../lib/db/client";

async function main(): Promise<void> {
  const db = getDb();
  const summary = await db.execute<{
    run_count: string;
    hybrid_success_count: string;
    fallback_count: string;
    average_latency_ms: string | null;
    p95_latency_ms: string | null;
    lexical_hybrid_top10_overlap_ratio: string | null;
    hybrid_unique_candidate_count: string;
    lexical_top10_lost_count: string;
    average_lexical_final_rank_change: string | null;
    input_token_count: string;
    reserved_token_count: string;
    unknown_call_count: string;
    project_scope_leakage_count: string;
    no_answer_run_count: string;
  }>(sql`
    with recent_runs as (
      select * from ai_retrieval_runs
      where requested_mode = 'shadow'
        and created_at >= current_timestamp - interval '24 hours'
    ), candidate_summary as (
      select
        c.retrieval_run_id,
        count(*) filter (
          where c.final_rank <= 10 and c.lexical_rank is null
        ) as hybrid_unique_count,
        count(*) filter (
          where c.lexical_rank <= 10 and c.final_rank <= 10
        ) as overlap_count,
        greatest(count(*) filter (where c.lexical_rank <= 10), 1) as lexical_top10_count,
        count(*) filter (
          where c.lexical_rank <= 10
            and (c.final_rank is null or c.final_rank > 10)
        ) as lexical_top10_lost_count,
        avg(abs(c.final_rank - c.lexical_rank)) filter (
          where c.lexical_rank is not null and c.final_rank is not null
        ) as lexical_final_rank_change,
        count(*) filter (where c.project_id <> r.project_id) as leakage_count
      from ai_retrieval_candidates c
      join recent_runs r on r.id = c.retrieval_run_id
      group by c.retrieval_run_id
    )
    select
      count(distinct r.id)::text as run_count,
      count(distinct r.id) filter (
        where r.fallback_reason = 'SHADOW_MODE'
          and r.vector_candidate_count > 0
      )::text as hybrid_success_count,
      count(distinct r.id) filter (where r.status = 'fallback_lexical')::text
        as fallback_count,
      avg(r.total_latency_ms)::text as average_latency_ms,
      percentile_cont(0.95) within group (order by r.total_latency_ms)::text
        as p95_latency_ms,
      avg(cs.overlap_count::numeric / cs.lexical_top10_count)::text
        as lexical_hybrid_top10_overlap_ratio,
      coalesce(sum(cs.hybrid_unique_count), 0)::text as hybrid_unique_candidate_count,
      coalesce(sum(cs.lexical_top10_lost_count), 0)::text
        as lexical_top10_lost_count,
      avg(cs.lexical_final_rank_change)::text
        as average_lexical_final_rank_change,
      coalesce(sum(q.input_token_count), 0)::text as input_token_count,
      coalesce(sum(
        case when q.status in ('reserved', 'calling', 'unknown')
          or (q.status = 'succeeded' and q.input_token_count is null)
          then q.reserved_input_tokens else 0 end
      ), 0)::text as reserved_token_count,
      count(q.id) filter (where q.status = 'unknown')::text as unknown_call_count,
      coalesce(sum(cs.leakage_count), 0)::text as project_scope_leakage_count,
      count(distinct r.id) filter (where r.status = 'insufficient_evidence')::text
        as no_answer_run_count
    from recent_runs r
    left join candidate_summary cs on cs.retrieval_run_id = r.id
    left join ai_retrieval_query_embedding_calls q on q.retrieval_run_id = r.id
  `);
  const fallbacks = await db.execute<{ reason: string; count: string }>(sql`
    select coalesce(fallback_reason, 'NONE') as reason, count(*)::text as count
    from ai_retrieval_runs
    where requested_mode = 'shadow'
      and created_at >= current_timestamp - interval '24 hours'
    group by coalesce(fallback_reason, 'NONE')
    order by reason
  `);
  process.stdout.write(`${JSON.stringify({
    window: "past_24_hours",
    summary: summary.rows[0],
    fallbackDistribution: fallbacks.rows,
  })}\n`);
}

main()
  .finally(() => closeDatabasePool())
  .catch((error: unknown) => {
    process.stderr.write(
      `Retrieval shadow report failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
