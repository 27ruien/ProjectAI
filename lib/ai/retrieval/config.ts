import { EmbeddingPipelineError } from "@/lib/ai/embeddings/errors";

export const HYBRID_RETRIEVAL_PROFILE_ID = "hybrid-rrf-v1" as const;
export const HYBRID_RETRIEVAL_PROFILE_VERSION = 1 as const;
export const HYBRID_RETRIEVAL_VERSION = "hybrid-rrf-1" as const;
export const QUERY_EMBEDDING_BUDGET_RULE_VERSION =
  "text-embedding-v4-query-hard-limit-cn-beijing-v1" as const;
export const QUERY_EMBEDDING_RESERVED_TOKENS = 8_192 as const;

export type RetrievalMode = "lexical" | "shadow" | "hybrid";

export type HybridRetrievalProfile = {
  id: typeof HYBRID_RETRIEVAL_PROFILE_ID;
  version: typeof HYBRID_RETRIEVAL_PROFILE_VERSION;
  lexicalCandidateLimit: number;
  vectorCandidateLimit: number;
  fusedCandidateLimit: number;
  evidenceLimit: number;
  maxEvidenceCharacters: number;
  rrfK: number;
  lexicalWeight: number;
  vectorWeight: number;
  vectorMaxDistance: number;
  minEmbeddingCoverageBps: number;
  embeddingProfileId: "qwen-text-embedding-cn-v1";
  embeddingDimensions: 1024;
  distanceMetric: "cosine";
};

// Profile v1 is immutable. A parameter change requires a new profile id and a
// complete evaluation run instead of an in-place environment override.
export const HYBRID_RETRIEVAL_PROFILE: Readonly<HybridRetrievalProfile> =
  Object.freeze({
    id: HYBRID_RETRIEVAL_PROFILE_ID,
    version: HYBRID_RETRIEVAL_PROFILE_VERSION,
    lexicalCandidateLimit: 30,
    vectorCandidateLimit: 30,
    fusedCandidateLimit: 30,
    evidenceLimit: 10,
    maxEvidenceCharacters: 24_000,
    rrfK: 60,
    lexicalWeight: 1,
    vectorWeight: 1,
    // Calibrated by the checked-in synthetic evaluation distribution. The
    // evaluation command verifies both answerable recall and no-answer FPR.
    vectorMaxDistance: 0.55,
    minEmbeddingCoverageBps: 9_800,
    embeddingProfileId: "qwen-text-embedding-cn-v1",
    embeddingDimensions: 1024,
    distanceMetric: "cosine",
  });

export type HybridRetrievalRuntimeConfig = {
  mode: RetrievalMode;
  profileId: typeof HYBRID_RETRIEVAL_PROFILE_ID;
  queryEmbeddingTimeoutMs: number;
  vectorSqlTimeoutMs: number;
  queryEmbeddingDailyTokenLimit: number;
};

function invalidConfiguration(): never {
  throw new EmbeddingPipelineError(
    "CONFIGURATION_INVALID",
    false,
    "Hybrid retrieval configuration is invalid.",
  );
}

function integerEnvironment(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    return invalidConfiguration();
  }
  return value;
}

export function getHybridRetrievalRuntimeConfig(): HybridRetrievalRuntimeConfig {
  const mode = (process.env.AI_ASSISTANT_RETRIEVAL_MODE?.trim() ||
    "lexical") as RetrievalMode;
  if (!(["lexical", "shadow", "hybrid"] as const).includes(mode)) {
    return invalidConfiguration();
  }
  const profileId =
    process.env.AI_HYBRID_RETRIEVAL_PROFILE_ID?.trim() ||
    HYBRID_RETRIEVAL_PROFILE_ID;
  if (profileId !== HYBRID_RETRIEVAL_PROFILE_ID) {
    return invalidConfiguration();
  }
  return {
    mode,
    profileId,
    queryEmbeddingTimeoutMs: integerEnvironment(
      "AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS",
      5_000,
      1_000,
      15_000,
    ),
    vectorSqlTimeoutMs: integerEnvironment(
      "AI_HYBRID_VECTOR_SQL_TIMEOUT_MS",
      1_500,
      100,
      5_000,
    ),
    queryEmbeddingDailyTokenLimit: integerEnvironment(
      "AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT",
      5_000_000,
      QUERY_EMBEDDING_RESERVED_TOKENS,
      1_000_000_000,
    ),
  };
}
