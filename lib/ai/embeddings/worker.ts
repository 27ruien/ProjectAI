import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { getDb } from "@/lib/db/client";
import { documentEmbeddingJob } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  EMBEDDING_WORKER_VERSION,
  getEmbeddingRuntimeConfig,
  type EmbeddingRuntimeConfig,
} from "./config";
import { EmbeddingPipelineError } from "./errors";
import {
  createEmbeddingGateway,
  type EmbeddingGateway,
} from "./gateway";
import {
  claimEmbeddingJob,
  commitEmbeddingBatch,
  completeEmbeddingJob,
  markEmbeddingProviderCallDispatched,
  prepareEmbeddingJob,
  recordEmbeddingFailure,
  reserveEmbeddingBatch,
  renewEmbeddingLease,
  writeEmbeddingWorkerHeartbeat,
  type EligibleEmbeddingChunk,
} from "./jobs";

const DEFAULT_HEARTBEAT_FILE = "/tmp/projectai-embedding-worker-heartbeat";

async function touchHeartbeat(mode: "enabled" | "disabled"): Promise<void> {
  const path =
    process.env.AI_EMBEDDING_WORKER_HEARTBEAT_FILE?.trim() ||
    DEFAULT_HEARTBEAT_FILE;
  await writeFile(path, `${Date.now()} ${EMBEDDING_WORKER_VERSION} ${mode}\n`, {
    mode: 0o600,
  });
}

function nextBatch(
  chunks: EligibleEmbeddingChunk[],
  offset: number,
  config: EmbeddingRuntimeConfig,
): EligibleEmbeddingChunk[] {
  const batch: EligibleEmbeddingChunk[] = [];
  let characters = 0;
  for (let index = offset; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.content.length > config.batchMaxCharacters) {
      throw new EmbeddingPipelineError("INPUT_LIMIT_EXCEEDED", false);
    }
    if (
      batch.length >= config.batchSize ||
      characters + chunk.content.length > config.batchMaxCharacters
    ) {
      break;
    }
    batch.push(chunk);
    characters += chunk.content.length;
  }
  return batch;
}

export async function processEmbeddingJob(input: {
  jobId: string;
  workerId: string;
  config: EmbeddingRuntimeConfig;
  gateway: EmbeddingGateway;
  signal?: AbortSignal;
  stopStartingBatchesSignal?: AbortSignal;
}): Promise<void> {
  let activeBatch: EligibleEmbeddingChunk[] | undefined;
  let activeBatchStartedAt: number | null = null;
  let batchIndex = 0;
  let activeBatchId: string | undefined;
  let activeProviderCallId: string | undefined;
  try {
    const prepared = await prepareEmbeddingJob({
      jobId: input.jobId,
      workerId: input.workerId,
    });
    if (!prepared) return;
    let offset = 0;
    while (offset < prepared.chunks.length) {
      if (input.stopStartingBatchesSignal?.aborted) {
        throw new EmbeddingPipelineError("SHUTDOWN_ABORTED", true);
      }
      if (input.signal?.aborted) {
        throw new EmbeddingPipelineError("SHUTDOWN_ABORTED", true);
      }
      activeBatch = nextBatch(prepared.chunks, offset, input.config);
      if (!activeBatch.length) {
        throw new EmbeddingPipelineError("INPUT_LIMIT_EXCEEDED", false);
      }
      const reservation = await reserveEmbeddingBatch({
        jobId: prepared.job.id,
        workerId: input.workerId,
        batchIndex,
        chunks: activeBatch,
        config: input.config,
      });
      if (reservation.action === "call") {
        activeBatchId = reservation.batchId;
        activeProviderCallId = reservation.providerCallId;
        activeBatchStartedAt = performance.now();
        const result = await input.gateway.embed(
          activeBatch.map((chunk) => chunk.content),
          {
            signal: input.signal,
            onProviderRequestStarted: () =>
              markEmbeddingProviderCallDispatched({
                jobId: prepared.job.id,
                workerId: input.workerId,
                batchId: reservation.batchId,
                providerCallId: reservation.providerCallId,
              }),
          },
        );
        try {
          await commitEmbeddingBatch({
            jobId: prepared.job.id,
            workerId: input.workerId,
            batchId: reservation.batchId,
            providerCallId: reservation.providerCallId,
            batchIndex,
            chunks: activeBatch,
            result,
          });
        } catch {
          throw new EmbeddingPipelineError(
            "PROVIDER_RESULT_UNKNOWN",
            false,
            "Embedding provider result could not be committed.",
            "successful_response",
          );
        }
        activeBatchStartedAt = null;
        activeBatchId = undefined;
        activeProviderCallId = undefined;
      }
      offset += activeBatch.length;
      batchIndex += 1;
      activeBatch = undefined;
    }
    await completeEmbeddingJob({
      jobId: prepared.job.id,
      workerId: input.workerId,
    });
  } catch (error) {
    try {
      await recordEmbeddingFailure({
        jobId: input.jobId,
        workerId: input.workerId,
        error,
        batchId: activeBatchId,
        providerCallId: activeProviderCallId,
        batchIndex,
        chunks: activeBatch,
        latencyMs:
          activeBatchStartedAt === null
            ? 0
            : Math.max(0, Math.round(performance.now() - activeBatchStartedAt)),
        config: input.config,
      });
    } catch (recordError) {
      if (
        recordError instanceof EmbeddingPipelineError &&
        recordError.code === "WORKER_LEASE_LOST"
      ) {
        return;
      }
      throw recordError;
    }
  }
}

export type EmbeddingWorkerOptions = {
  once?: boolean;
  workerId?: string;
  config?: EmbeddingRuntimeConfig;
  gateway?: EmbeddingGateway;
  signal?: AbortSignal;
  renewLease?: typeof renewEmbeddingLease;
};

async function waitForPoll(config: EmbeddingRuntimeConfig, signal?: AbortSignal) {
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, config.pollMs);
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function drainingAbortController(
  signal: AbortSignal | undefined,
  drainMs: number,
): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  let drainTimer: NodeJS.Timeout | undefined;
  const beginDrain = () => {
    if (drainTimer || controller.signal.aborted) return;
    drainTimer = setTimeout(() => controller.abort(signal?.reason), drainMs);
  };
  if (signal?.aborted) beginDrain();
  else signal?.addEventListener("abort", beginDrain, { once: true });
  return {
    controller,
    detach: () => {
      signal?.removeEventListener("abort", beginDrain);
      if (drainTimer) clearTimeout(drainTimer);
    },
  };
}

async function maintainActiveLease(input: {
  jobId: string;
  workerId: string;
  config: EmbeddingRuntimeConfig;
  controller: AbortController;
  renewLease: typeof renewEmbeddingLease;
}): Promise<void> {
  const intervalMs = Math.max(
    1_000,
    Math.floor((input.config.leaseSeconds * 1_000) / 3),
  );
  while (!input.controller.signal.aborted) {
    await waitForPoll({ ...input.config, pollMs: intervalMs }, input.controller.signal);
    if (input.controller.signal.aborted) return;
    try {
      const renewed = await input.renewLease(
        input.jobId,
        input.workerId,
        input.config,
      );
      if (!renewed) {
        input.controller.abort(
          new EmbeddingPipelineError("WORKER_LEASE_LOST", false),
        );
        return;
      }
      await touchHeartbeat("enabled");
      await writeEmbeddingWorkerHeartbeat({
        workerId: input.workerId,
        profileId: input.config.profileId,
        workerVersion: EMBEDDING_WORKER_VERSION,
        state: "running",
      });
    } catch (error) {
      input.controller.abort(controlledLeaseFailure(error));
      return;
    }
  }
}

function controlledLeaseFailure(error: unknown): EmbeddingPipelineError {
  return error instanceof EmbeddingPipelineError
    ? error
    : new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
}

export async function runEmbeddingWorker(
  options: EmbeddingWorkerOptions = {},
): Promise<void> {
  const config = options.config ?? getEmbeddingRuntimeConfig();
  const workerId = options.workerId ?? `embedding-worker-${randomUUID()}`;
  let gateway = options.gateway;
  await touchHeartbeat(config.enabled ? "enabled" : "disabled");
  if (config.enabled) {
    await writeEmbeddingWorkerHeartbeat({
      workerId,
      profileId: config.profileId,
      workerVersion: EMBEDDING_WORKER_VERSION,
      state: "running",
    });
  }
  do {
    if (options.signal?.aborted) break;
    if (!config.enabled) {
      await touchHeartbeat("disabled");
      if (options.once) break;
      await waitForPoll(config, options.signal);
      continue;
    }
    gateway ??= createEmbeddingGateway(config);
    const job = await claimEmbeddingJob(workerId, config);
    await touchHeartbeat("enabled");
    await writeEmbeddingWorkerHeartbeat({
      workerId,
      profileId: config.profileId,
      workerVersion: EMBEDDING_WORKER_VERSION,
      state: "running",
    });
    if (!job) {
      if (options.once) break;
      await waitForPoll(config, options.signal);
      continue;
    }
    const linked = drainingAbortController(
      options.signal,
      config.shutdownDrainMs,
    );
    const heartbeat = maintainActiveLease({
      jobId: job.id,
      workerId,
      config,
      controller: linked.controller,
      renewLease: options.renewLease ?? renewEmbeddingLease,
    });
    try {
      await processEmbeddingJob({
        jobId: job.id,
        workerId,
        config,
        gateway,
        signal: linked.controller.signal,
        stopStartingBatchesSignal: options.signal,
      });
    } finally {
      linked.controller.abort();
      await heartbeat;
      linked.detach();
      await touchHeartbeat("enabled");
    }
  } while (!options.once);
  if (config.enabled && options.signal?.aborted) {
    try {
      await writeEmbeddingWorkerHeartbeat({
        workerId,
        profileId: config.profileId,
        workerVersion: EMBEDDING_WORKER_VERSION,
        state: "draining",
      });
    } catch {
      // The durable calling state still lets the next worker reconcile safely.
    }
  }
}

export async function countRunningEmbeddingJobs(): Promise<number> {
  const rows = await getDb()
    .select({ id: documentEmbeddingJob.id })
    .from(documentEmbeddingJob)
    .where(eq(documentEmbeddingJob.status, "running"));
  return rows.length;
}
