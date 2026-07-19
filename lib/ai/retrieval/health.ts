import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { HYBRID_RETRIEVAL_PROFILE } from "./config";
import type { HybridRetrievalRuntimeConfig } from "./config";
import { retrievalProfileState } from "./repository";

export async function hybridRetrievalReadiness(
  config: HybridRetrievalRuntimeConfig,
  queryEmbeddingConfigured: boolean,
): Promise<boolean> {
  if (config.mode === "lexical") return false;
  if (!queryEmbeddingConfigured) return false;
  const profile = await retrievalProfileState();
  if (!profile.exists || !profile.enabled || !profile.definitionMatches) {
    return false;
  }
  const result = await getDb().execute<{
    vector_enabled: boolean;
    embedding_profile_ready: boolean;
  }>(sql`
    select
      exists(select 1 from pg_extension where extname = 'vector') as vector_enabled,
      exists(
        select 1
        from ai_embedding_profiles
        where id = ${HYBRID_RETRIEVAL_PROFILE.embeddingProfileId}
          and dimensions = ${HYBRID_RETRIEVAL_PROFILE.embeddingDimensions}
          and distance_metric = ${HYBRID_RETRIEVAL_PROFILE.distanceMetric}
          and enabled = true
      ) as embedding_profile_ready
  `);
  const row = result.rows[0];
  return row?.vector_enabled === true && row.embedding_profile_ready === true;
}
