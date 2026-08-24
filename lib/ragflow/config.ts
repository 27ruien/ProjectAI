import { readFile } from "node:fs/promises";
import { RagflowError } from "./errors";

export type RagflowConfig = {
  baseUrl: string;
  requestTimeoutMs: number;
  retrievalTopK: number;
  retrievalThreshold: number;
  perProjectRetrievalLimit: number;
  globalEvidenceLimit: number;
  maxContextChars: number;
  crossProjectConcurrency: number;
};

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务配置无效",
      false,
    );
  }
  return value;
}

function numberEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务配置无效",
      false,
    );
  }
  return value;
}

export function normalizeRagflowBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务配置无效",
      false,
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务配置无效",
      false,
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  const normalized = parsed.toString().replace(/\/$/u, "");
  return normalized.endsWith("/api/v1")
    ? normalized
    : `${normalized}/api/v1`;
}

export function getRagflowConfig(): RagflowConfig {
  const baseUrl = process.env.RAGFLOW_BASE_URL?.trim();
  if (!baseUrl) {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务尚未配置",
      false,
    );
  }
  return {
    baseUrl: normalizeRagflowBaseUrl(baseUrl),
    requestTimeoutMs: integerEnvironment(
      "RAGFLOW_REQUEST_TIMEOUT_MS",
      30_000,
      1_000,
      120_000,
    ),
    retrievalTopK: integerEnvironment(
      "RAGFLOW_RETRIEVAL_TOP_K",
      64,
      1,
      1_024,
    ),
    retrievalThreshold: numberEnvironment(
      "RAGFLOW_RETRIEVAL_THRESHOLD",
      0.2,
      0,
      1,
    ),
    perProjectRetrievalLimit: integerEnvironment(
      "KNOWLEDGE_PER_PROJECT_EVIDENCE_LIMIT",
      3,
      1,
      10,
    ),
    globalEvidenceLimit: integerEnvironment(
      "KNOWLEDGE_GLOBAL_EVIDENCE_LIMIT",
      12,
      1,
      30,
    ),
    maxContextChars: integerEnvironment(
      "KNOWLEDGE_MAX_CONTEXT_CHARS",
      24_000,
      2_000,
      100_000,
    ),
    crossProjectConcurrency: integerEnvironment(
      "KNOWLEDGE_CROSS_PROJECT_CONCURRENCY",
      3,
      1,
      8,
    ),
  };
}

export async function readRagflowApiKey(): Promise<string> {
  const keyFile = process.env.RAGFLOW_API_KEY_FILE?.trim();
  let key = "";
  if (keyFile) {
    try {
      key = (await readFile(keyFile, "utf8")).trim();
    } catch {
      throw new RagflowError(
        503,
        "RAGFLOW_CONFIGURATION_INVALID",
        "知识服务凭据不可用",
        false,
      );
    }
  } else {
    key = process.env.RAGFLOW_API_KEY?.trim() ?? "";
  }
  if (!key) {
    throw new RagflowError(
      503,
      "RAGFLOW_CONFIGURATION_INVALID",
      "知识服务凭据不可用",
      false,
    );
  }
  return key;
}

export async function isRagflowConfigured(): Promise<boolean> {
  try {
    getRagflowConfig();
  } catch (error) {
    console.error(
      "RAGFlow endpoint configuration check failed",
      error instanceof RagflowError ? error.code : "UNKNOWN_ERROR",
    );
    return false;
  }
  try {
    await readRagflowApiKey();
    return true;
  } catch (error) {
    console.error(
      "RAGFlow credential configuration check failed",
      error instanceof RagflowError ? error.code : "UNKNOWN_ERROR",
    );
    return false;
  }
}
