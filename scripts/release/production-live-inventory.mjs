import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  assertInventory,
  assertReleaseSession,
  booleanOrNotApplicable,
  numberOrNull,
  withDigest,
  digestObject,
} from "./contract.mjs";
import {
  ProductionRolloutError,
  PRODUCTION_LOCK_HEARTBEAT_INTERVAL_MS,
} from "./production-rollout-contract.mjs";

const MAX_INVENTORY_AGE_MS = 5 * 60 * 1000;

function asBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Invalid boolean inventory record.");
}

function setNested(target, dottedKey, value) {
  const numericKeys = new Set([
    "schemaVersion", "app.restartCount", "app.imageSizeBytes", "app.publicHttpStatus",
    "app.localHttpStatus", "capacity.totalBytes", "capacity.usedBytes", "capacity.availableBytes",
    "capacity.filesystemUsagePercent", "capacity.inodeTotal", "capacity.inodeUsed",
    "capacity.inodeAvailable", "capacity.inodeUsagePercent", "database.sizeBytes",
    "objectStorage.objectCount", "objectStorage.totalBytes", "objectStorage.bucketCount",
    "services.documentWorkerRestartCount", "services.embeddingWorkerRestartCount",
    "active.documentJobs", "active.embeddingJobs", "active.embeddingBatches",
    "active.embeddingProviderCalls", "active.retrievalRuns", "active.queryEmbeddingCalls",
    "active.aiExecutions", "backup.latestSizeBytes", "backup.availableBytes",
    "features.hybridQueryEmbeddingTimeoutMs", "features.hybridVectorSqlTimeoutMs",
    "features.hybridDailyQueryTokenLimit",
  ]);
  const booleanKeys = new Set([
    "checks.nginxConfigValid", "checks.composeConfigValid", "features.aiAssistantEnabled",
    "features.aiEmbeddingEnabled", "features.queryEmbeddingConfigured", "features.qwenSecretMount",
    "database.present", "objectStorage.present", "services.documentWorker",
    "services.embeddingWorker", "locks.deployment", "locks.migrationApplicable",
    "locks.migrationFile", "locks.migration", "backup.pgDumpAvailable",
    "backup.pgRestoreAvailable", "backup.directoryExists", "backup.directoryWritable",
  ]);
  const inventoryKnownKeys = new Set(["database.inventoryKnown", "objectStorage.inventoryKnown"]);
  let normalized = value;
  if (value === "null") normalized = null;
  else if (inventoryKnownKeys.has(dottedKey)) normalized = booleanOrNotApplicable(value, dottedKey);
  else if (numericKeys.has(dottedKey)) normalized = numberOrNull(value);
  else if (booleanKeys.has(dottedKey)) normalized = asBoolean(value);
  const parts = dottedKey.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts.at(-1)] = normalized;
}

function parseInventory(stdout) {
  const inventory = {};
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 1) throw new Error("Live Production Inventory emitted an invalid record.");
    setNested(inventory, line.slice(0, tab), line.slice(tab + 1));
  }
  return inventory;
}

export function assertFreshLiveInventory(inventory, { session, now = new Date(), environment }) {
  assertInventory(inventory);
  const captured = Date.parse(inventory.capturedAt);
  if (
    inventory.environment !== environment ||
    inventory.releaseSessionId !== session.releaseSessionId ||
    inventory.sourceMode !== (environment === "production" ? "live-readonly" : "synthetic-test") ||
    !Number.isFinite(captured) ||
    captured > now.getTime() + 60_000 ||
    now.getTime() - captured > MAX_INVENTORY_AGE_MS
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_INVENTORY_STALE",
      "Production Inventory is stale, mismatched, or not live-readonly.",
    );
  }
  return inventory;
}

export function inventoryStateDigest(inventory) {
  return digestObject({
    app: {
      containerId: inventory.app?.containerId ?? null,
      imageDigest: inventory.app?.imageDigest ?? null,
      imageOs: inventory.app?.imageOs ?? null,
      imageArchitecture: inventory.app?.imageArchitecture ?? null,
      imageRevision: inventory.app?.imageRevision ?? null,
      imageEnvironment: inventory.app?.imageEnvironment ?? null,
      startedAt: inventory.app?.startedAt ?? null,
      restartCount: inventory.app?.restartCount ?? null,
      health: inventory.app?.health ?? null,
      publicHttpStatus: inventory.app?.publicHttpStatus ?? null,
    },
    configuration: inventory.configuration ?? null,
    database: {
      present: inventory.database?.present ?? null,
      imageDigest: inventory.database?.imageDigest ?? null,
      health: inventory.database?.health ?? null,
      version: inventory.database?.version ?? null,
      pgvectorVersion: inventory.database?.pgvectorVersion ?? null,
      migrationCount: inventory.database?.migrationCount ?? null,
    },
    objectStorage: {
      present: inventory.objectStorage?.present ?? null,
      imageDigest: inventory.objectStorage?.imageDigest ?? null,
      health: inventory.objectStorage?.health ?? null,
      objectCount: inventory.objectStorage?.objectCount ?? null,
      totalBytes: inventory.objectStorage?.totalBytes ?? null,
    },
    services: inventory.services ?? null,
    features: inventory.features ?? null,
  });
}

export function deploymentStateDigest(inventory) {
  return digestObject({
    app: {
      imageDigest: inventory.app?.imageDigest ?? null,
      imageOs: inventory.app?.imageOs ?? null,
      imageArchitecture: inventory.app?.imageArchitecture ?? null,
      imageRevision: inventory.app?.imageRevision ?? null,
      imageEnvironment: inventory.app?.imageEnvironment ?? null,
      health: inventory.app?.health ?? null,
      publicHttpStatus: inventory.app?.publicHttpStatus ?? null,
    },
    database: {
      present: inventory.database?.present ?? null,
      imageDigest: inventory.database?.imageDigest ?? null,
      health: inventory.database?.health ?? null,
      pgvectorVersion: inventory.database?.pgvectorVersion ?? null,
      migrationCount: inventory.database?.migrationCount ?? null,
    },
    objectStorage: {
      present: inventory.objectStorage?.present ?? null,
      imageDigest: inventory.objectStorage?.imageDigest ?? null,
      health: inventory.objectStorage?.health ?? null,
    },
    services: inventory.services ?? null,
    features: inventory.features ?? null,
  });
}

async function runInventoryProcess({ args, input, onProgress }) {
  await onProgress?.();
  const controller = new AbortController();
  let heartbeatError = null;
  let heartbeatChain = Promise.resolve();
  const heartbeat = () => {
    heartbeatChain = heartbeatChain
      .then(() => onProgress?.())
      .catch((error) => {
        heartbeatError ??= error;
        controller.abort();
      });
  };
  const timer = onProgress
    ? setInterval(heartbeat, PRODUCTION_LOCK_HEARTBEAT_INTERVAL_MS)
    : null;
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn("bash", args, {
        signal: controller.signal,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const maximumBytes = 8 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      let settled = false;
      const capture = (field) => (chunk) => {
        bytes += chunk.length;
        if (bytes > maximumBytes) {
          child.kill("SIGTERM");
          if (!settled) {
            settled = true;
            reject(new Error("Live Inventory output exceeded its bounded capture limit."));
          }
          return;
        }
        if (field === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout.on("data", capture("stdout"));
      child.stderr.on("data", capture("stderr"));
      child.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          resolve({ status: Number.isInteger(code) ? code : 1, stdout, stderr });
        }
      });
      child.stdin.end(input);
    });
  } catch (error) {
    if (heartbeatError) throw heartbeatError;
    throw error;
  } finally {
    if (timer) clearInterval(timer);
    await heartbeatChain;
  }
  if (heartbeatError) throw heartbeatError;
  await onProgress?.();
  return result;
}

export async function collectLiveInventory({ session, environment, onProgress }) {
  assertReleaseSession(session);
  let raw;
  if (environment === "production") {
    const [remoteScript, migrationLockContract] = await Promise.all([
      readFile(new URL("./remote-inventory.sh", import.meta.url), "utf8"),
      readFile(new URL("../../release/migration-lock-contract.json", import.meta.url), "utf8").then(JSON.parse),
    ]);
    const result = await runInventoryProcess({
      args: [
        "-s",
        "--",
        "production",
        migrationLockContract.productionFile,
        String(migrationLockContract.postgresAdvisoryKey),
      ],
      input: remoteScript,
      onProgress,
    });
    if (result.status !== 0) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Live Production Inventory collection failed.",
      );
    }
    raw = parseInventory(result.stdout);
  } else {
    if (process.env.NODE_ENV !== "test" || !process.env.PROJECTAI_ROLLOUT_TEST_INVENTORY) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Rehearsal Inventory adapter is restricted to NODE_ENV=test.",
      );
    }
    raw = JSON.parse(process.env.PROJECTAI_ROLLOUT_TEST_INVENTORY);
    raw.capturedAt = new Date().toISOString();
    raw.environment = environment;
  }
  const finalized = withDigest({
    ...raw,
    reportType: `${environment}-inventory`,
    producer: "projectai-release-tool",
    producerVersion: "b3-c1-v3",
    sourceMode: environment === "production" ? "live-readonly" : "synthetic-test",
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    releaseSessionId: session.releaseSessionId,
  });
  return assertFreshLiveInventory(finalized, { session, environment });
}
