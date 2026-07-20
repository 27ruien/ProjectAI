#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { inspectSecretMetadata, ProductionRolloutError } from "./production-rollout-contract.mjs";

function failClosed(error) {
  process.stderr.write(`${error?.code ?? "PRODUCTION_CONFIG_INVALID"}: ${error?.message ?? String(error)}\n`);
  process.exit(1);
}
process.on("uncaughtException", failClosed);
process.on("unhandledRejection", failClosed);

const root = process.argv[2] ? path.resolve(process.argv[2]) : "/srv/projectai";
if (root !== "/srv/projectai" && process.env.NODE_ENV !== "test") {
  throw new ProductionRolloutError(
    "PRODUCTION_CONFIG_INVALID",
    "Formal Production configuration must remain under /srv/projectai.",
  );
}

const contracts = [
  [".env.database-production", ["DATABASE_URL"]],
  [".env.auth-production", ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "AUTH_COOKIE_PREFIX", "AUTH_COOKIE_PATH", "AUTH_TRUSTED_ORIGINS"]],
  [".env.storage-production", ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY"]],
  [".env.ai-production", ["AI_PROVIDER", "AI_REGION", "AI_ASSISTANT_ENABLED", "AI_ASSISTANT_RETRIEVAL_MODE", "QWEN_API_KEY_FILE"]],
  [".env.embedding-production", ["AI_EMBEDDING_ENABLED", "AI_EMBEDDING_PROFILE_ID", "AI_EMBEDDING_DIMENSIONS", "QWEN_API_KEY_FILE"]],
  [".env.document-production", ["DOCUMENT_WORKER_POLL_MS", "DOCUMENT_WORKER_LEASE_SECONDS", "DOCUMENT_WORKER_MAX_ATTEMPTS"]],
];

for (const [filename, requiredKeys] of contracts) {
  const target = path.join(root, filename);
  const metadata = await lstat(target).catch(() => null);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ProductionRolloutError("PRODUCTION_CONFIG_INVALID", `${filename} metadata is invalid.`);
  }
  const mode = metadata.mode & 0o777;
  if (![0o600, 0o640].includes(mode)) {
    throw new ProductionRolloutError("PRODUCTION_CONFIG_INVALID", `${filename} permissions are too broad.`);
  }
  const keys = new Set();
  for (const rawLine of (await readFile(target, "utf8")).split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1 || !/^[A-Z][A-Z0-9_]*$/.test(line.slice(0, equals))) {
      throw new ProductionRolloutError("PRODUCTION_CONFIG_INVALID", `${filename} contains an invalid key record.`);
    }
    const key = line.slice(0, equals);
    if (keys.has(key)) {
      throw new ProductionRolloutError("PRODUCTION_CONFIG_INVALID", `${filename} contains a duplicate key.`);
    }
    keys.add(key);
  }
  if (requiredKeys.some((key) => !keys.has(key))) {
    throw new ProductionRolloutError("PRODUCTION_CONFIG_INVALID", `${filename} is missing required keys.`);
  }
}

if (process.argv.includes("--require-qwen")) {
  await inspectSecretMetadata(path.join(root, "secrets/qwen_api_key"));
}

process.stdout.write(`${JSON.stringify({ valid: true, files: contracts.length, qwenRequired: process.argv.includes("--require-qwen") })}\n`);
