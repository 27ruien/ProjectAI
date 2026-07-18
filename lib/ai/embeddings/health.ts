import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { EmbeddingRuntimeConfig } from "./config";

export type EmbeddingDependencyHealth = {
  pgvectorEnabled: boolean;
  profileReady: boolean;
  jobsSchemaReady: boolean;
  batchesSchemaReady: boolean;
  vectorsSchemaReady: boolean;
  workerReady: boolean;
};

export async function inspectEmbeddingDependencies(): Promise<EmbeddingDependencyHealth> {
  const result = await getDb().execute(sql`
    select
      exists(select 1 from pg_extension where extname = 'vector') as pgvector_enabled,
      exists(
        select 1
        from ai_embedding_profiles
        where id = 'qwen-text-embedding-cn-v1'
          and provider = 'qwen'
          and model = 'text-embedding-v4'
          and region = 'cn-beijing'
          and dimensions = 1024
          and distance_metric = 'cosine'
          and profile_version = 1
          and enabled = true
      ) as profile_ready,
      (select count(*) >= 0 from document_embedding_jobs) as jobs_schema_ready,
      (select count(*) >= 0 from document_embedding_batches) as batches_schema_ready,
      (select count(*) >= 0 from document_chunk_embeddings) as vectors_schema_ready,
      exists(
        select 1
        from embedding_worker_heartbeats
        where embedding_profile_id = 'qwen-text-embedding-cn-v1'
          and state = 'running'
          and heartbeat_at > now() - interval '60 seconds'
      ) as worker_ready
  `);
  const row = result.rows[0] as
    | {
        pgvector_enabled?: boolean;
        profile_ready?: boolean;
        jobs_schema_ready?: boolean;
        batches_schema_ready?: boolean;
        vectors_schema_ready?: boolean;
        worker_ready?: boolean;
      }
    | undefined;
  return {
    pgvectorEnabled: row?.pgvector_enabled === true,
    profileReady: row?.profile_ready === true,
    jobsSchemaReady: row?.jobs_schema_ready === true,
    batchesSchemaReady: row?.batches_schema_ready === true,
    vectorsSchemaReady: row?.vectors_schema_ready === true,
    workerReady: row?.worker_ready === true,
  };
}

export async function embeddingReadiness(
  config: EmbeddingRuntimeConfig,
  providerConfigured: boolean,
  inspect: () => Promise<EmbeddingDependencyHealth> = inspectEmbeddingDependencies,
): Promise<boolean> {
  if (!config.enabled) return false;
  if (!providerConfigured || !config.qwenBaseUrl) {
    throw new Error("Enabled Embedding provider is not configured.");
  }
  const health = await inspect();
  const ready = Object.values(health).every((value) => value === true);
  if (!ready) throw new Error("Enabled Embedding dependencies are unavailable.");
  return true;
}
