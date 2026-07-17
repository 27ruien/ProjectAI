import { sql } from "drizzle-orm";
import { jsonResponse } from "@/lib/auth/http";
import { getDb } from "@/lib/db/client";
import {
  DOCUMENT_WORKER_VERSION,
  getDocumentProcessingConfig,
} from "@/lib/documents/processing/config";
import {
  AI_GATEWAY_VERSION,
  getAiRuntimeConfig,
  isAiProviderConfigured,
} from "@/lib/ai/project-assistant";
import {
  EMBEDDING_GATEWAY_VERSION,
  EMBEDDING_MODEL,
  getEmbeddingRuntimeConfig,
} from "@/lib/ai/embeddings";

export async function GET(): Promise<Response> {
  try {
    // This verifies more than a TCP socket: PostgreSQL authentication must
    // succeed and the committed identity/project schema must be available.
    const databaseHealth = await getDb().execute(sql`
      select
        (select count(*) from users limit 1) as users_count,
        (select count(*) from sessions limit 1) as sessions_count,
        (select count(*) from projects limit 1) as projects_count,
        (select count(*) from project_members limit 1) as memberships_count,
        (select count(*) from document_ingestion_jobs limit 1) as ingestion_jobs_count,
        (select count(*) from document_sections limit 1) as sections_count,
        (select count(*) from document_chunks limit 1) as chunks_count,
        (select count(*) from ai_model_profiles limit 1) as ai_profiles_count,
        (select count(*) from ai_threads limit 1) as ai_threads_count,
        (select count(*) from ai_executions limit 1) as ai_executions_count,
        (select count(*) from ai_embedding_profiles limit 1) as embedding_profiles_count,
        (select count(*) from document_embedding_jobs limit 1) as embedding_jobs_count,
        (select count(*) from document_chunk_embeddings limit 1) as chunk_embeddings_count,
        exists(select 1 from pg_extension where extname = 'pg_trgm') as pg_trgm_enabled,
        exists(select 1 from pg_extension where extname = 'vector') as pgvector_enabled,
        (select extversion from pg_extension where extname = 'vector') as pgvector_version
    `);
    const row = databaseHealth.rows[0] as
      | {
          pg_trgm_enabled?: boolean;
          pgvector_enabled?: boolean;
          pgvector_version?: string;
        }
      | undefined;
    if (row?.pg_trgm_enabled !== true) {
      throw new Error("Required pg_trgm extension is unavailable.");
    }
    if (row.pgvector_enabled !== true) {
      throw new Error("Required pgvector extension is unavailable.");
    }

    const headers = new Headers({ "cache-control": "no-store" });
    const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
    if (commitSha && /^[0-9a-f]{40}$/i.test(commitSha)) {
      // A revision identifier is non-secret deployment provenance. Keep it in
      // a header so the established minimal health body remains stable.
      headers.set("x-projectai-commit-sha", commitSha.toLowerCase());
    }
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
    if (appVersion) headers.set("x-projectai-app-version", appVersion);
    const processingConfig = getDocumentProcessingConfig();
    headers.set("x-projectai-worker-version", DOCUMENT_WORKER_VERSION);
    headers.set("x-projectai-parser-version", processingConfig.parserVersion);
    headers.set("x-projectai-chunker-version", processingConfig.chunkerVersion);
    const aiConfig = getAiRuntimeConfig();
    const aiProviderConfigured = await isAiProviderConfigured();
    if (aiConfig.enabled && !aiProviderConfigured) {
      throw new Error("Enabled AI provider is not configured.");
    }
    const embeddingConfig = getEmbeddingRuntimeConfig();
    if (embeddingConfig.enabled && !aiProviderConfigured) {
      throw new Error("Enabled Embedding provider is not configured.");
    }
    headers.set("x-projectai-pgvector-version", row.pgvector_version || "unknown");
    headers.set("x-projectai-embedding-model", EMBEDDING_MODEL);
    headers.set(
      "x-projectai-embedding-dimensions",
      String(embeddingConfig.dimensions),
    );
    return jsonResponse(
      {
        status: "ok",
        aiAssistantEnabled: aiConfig.enabled,
        aiProviderConfigured,
        aiGatewayVersion: AI_GATEWAY_VERSION,
        aiEmbeddingEnabled: embeddingConfig.enabled,
        embeddingGatewayVersion: EMBEDDING_GATEWAY_VERSION,
        pgvectorEnabled: true,
      },
      { headers },
    );
  } catch {
    return jsonResponse(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
