import { validateQwenBaseUrl } from "@/lib/ai/project-assistant/config";
import { EMBEDDING_VECTOR_DIMENSIONS } from "@/lib/db/schema/document-embeddings";
import { EmbeddingPipelineError } from "./errors";

export const EMBEDDING_GATEWAY_VERSION = "1";
export const EMBEDDING_WORKER_VERSION = "1";
export const EMBEDDING_PROFILE_ID = "qwen-text-embedding-cn-v1";
export const EMBEDDING_PROVIDER = "qwen";
export const EMBEDDING_MODEL = "text-embedding-v4";
export const EMBEDDING_REGION = "cn-beijing";
export const EMBEDDING_DISTANCE_METRIC = "cosine";
export const EMBEDDING_PROFILE_VERSION = 1;

export type EmbeddingProviderKind = "qwen" | "fake";

export type EmbeddingRuntimeConfig = {
  enabled: boolean;
  provider: EmbeddingProviderKind;
  profileId: typeof EMBEDDING_PROFILE_ID;
  model: typeof EMBEDDING_MODEL;
  region: typeof EMBEDDING_REGION;
  dimensions: typeof EMBEDDING_VECTOR_DIMENSIONS;
  qwenBaseUrl: string | null;
  timeoutMs: number;
  pollMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  batchSize: number;
  batchMaxCharacters: number;
  dailyJobLimit: number;
  dailyTokenLimit: number;
};

function invalidConfiguration(): never {
  throw new EmbeddingPipelineError(
    "CONFIGURATION_INVALID",
    false,
    "Embedding configuration is invalid.",
  );
}

function booleanEnvironment(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return invalidConfiguration();
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

export function getEmbeddingRuntimeConfig(): EmbeddingRuntimeConfig {
  const providerValue =
    process.env.AI_EMBEDDING_PROVIDER?.trim() ||
    process.env.AI_PROVIDER?.trim() ||
    EMBEDDING_PROVIDER;
  if (providerValue !== "qwen" && providerValue !== "fake") {
    return invalidConfiguration();
  }
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
  const nodeEnvironment = process.env.NODE_ENV?.trim() || "";
  if (
    providerValue === "fake" &&
    (nodeEnvironment !== "test" || environment !== "test")
  ) {
    return invalidConfiguration();
  }
  const profileId =
    process.env.AI_EMBEDDING_PROFILE_ID?.trim() || EMBEDDING_PROFILE_ID;
  const dimensions = integerEnvironment(
    "AI_EMBEDDING_DIMENSIONS",
    EMBEDDING_VECTOR_DIMENSIONS,
    EMBEDDING_VECTOR_DIMENSIONS,
    EMBEDDING_VECTOR_DIMENSIONS,
  );
  if (profileId !== EMBEDDING_PROFILE_ID || dimensions !== 1024) {
    return invalidConfiguration();
  }
  const configuredBaseUrl = process.env.QWEN_BASE_URL?.trim() || "";
  return {
    enabled: booleanEnvironment("AI_EMBEDDING_ENABLED"),
    provider: providerValue,
    profileId,
    model: EMBEDDING_MODEL,
    region: EMBEDDING_REGION,
    dimensions,
    qwenBaseUrl:
      providerValue === "qwen" && configuredBaseUrl
        ? validateQwenBaseUrl(configuredBaseUrl)
        : null,
    timeoutMs: integerEnvironment(
      "AI_EMBEDDING_PROVIDER_TIMEOUT_MS",
      60_000,
      1_000,
      120_000,
    ),
    pollMs: integerEnvironment(
      "AI_EMBEDDING_WORKER_POLL_MS",
      2_000,
      250,
      60_000,
    ),
    leaseSeconds: integerEnvironment(
      "AI_EMBEDDING_WORKER_LEASE_SECONDS",
      120,
      30,
      3_600,
    ),
    maxAttempts: integerEnvironment(
      "AI_EMBEDDING_WORKER_MAX_ATTEMPTS",
      3,
      1,
      10,
    ),
    batchSize: integerEnvironment("AI_EMBEDDING_BATCH_SIZE", 10, 1, 10),
    batchMaxCharacters: integerEnvironment(
      "AI_EMBEDDING_BATCH_MAX_CHARACTERS",
      30_000,
      1_000,
      200_000,
    ),
    dailyJobLimit: integerEnvironment(
      "AI_EMBEDDING_DAILY_JOB_LIMIT",
      500,
      1,
      100_000,
    ),
    dailyTokenLimit: integerEnvironment(
      "AI_EMBEDDING_DAILY_TOKEN_LIMIT",
      5_000_000,
      1,
      1_000_000_000,
    ),
  };
}
