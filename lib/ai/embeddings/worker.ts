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
  assertDailyEmbeddingTokenBudget,
  claimEmbeddingJob,
  commitEmbeddingBatch,
  completeEmbeddingJob,
  embeddingBatchRequestSha256,
  hasSuccessfulEmbeddingBatch,
  prepareEmbeddingJob,
  recordEmbeddingFailure,
  renewEmbeddingLease,
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
}): Promise<void> {
  let activeBatch: EligibleEmbeddingChunk[] | undefined;
  let activeBatchStartedAt: number | null = null;
  let batchIndex = 0;
  try {
    const prepared = await prepareEmbeddingJob({
      jobId: input.jobId,
      workerId: input.workerId,
    });
    if (!prepared) return;
    let offset = 0;
    while (offset < prepared.chunks.length) {
      activeBatch = nextBatch(prepared.chunks, offset, input.config);
      if (!activeBatch.length) {
        throw new EmbeddingPipelineError("INPUT_LIMIT_EXCEEDED", false);
      }
      const requestSha256 = embeddingBatchRequestSha256(
        prepared.job.embeddingProfileId,
        activeBatch,
      );
      if (
        !(await hasSuccessfulEmbeddingBatch({
          jobId: prepared.job.id,
          requestSha256,
        }))
      ) {
        await assertDailyEmbeddingTokenBudget(input.config);
        activeBatchStartedAt = performance.now();
        const result = await input.gateway.embed(
          activeBatch.map((chunk) => chunk.content),
        );
        await commitEmbeddingBatch({
          jobId: prepared.job.id,
          workerId: input.workerId,
          batchIndex,
          chunks: activeBatch,
          result,
        });
        activeBatchStartedAt = null;
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
};

async function waitForPoll(config: EmbeddingRuntimeConfig, signal?: AbortSignal) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, config.pollMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runEmbeddingWorker(
  options: EmbeddingWorkerOptions = {},
): Promise<void> {
  const config = options.config ?? getEmbeddingRuntimeConfig();
  const workerId = options.workerId ?? `embedding-worker-${randomUUID()}`;
  let gateway = options.gateway;
  await touchHeartbeat(config.enabled ? "enabled" : "disabled");
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
    if (!job) {
      if (options.once) break;
      await waitForPoll(config, options.signal);
      continue;
    }
    const heartbeat = setInterval(() => {
      void renewEmbeddingLease(job.id, workerId, config).then((renewed) => {
        if (!renewed) clearInterval(heartbeat);
        return touchHeartbeat("enabled");
      });
    }, Math.max(1_000, Math.floor((config.leaseSeconds * 1_000) / 3)));
    heartbeat.unref();
    try {
      await processEmbeddingJob({
        jobId: job.id,
        workerId,
        config,
        gateway,
      });
    } finally {
      clearInterval(heartbeat);
      await touchHeartbeat("enabled");
    }
  } while (!options.once);
}

export async function countRunningEmbeddingJobs(): Promise<number> {
  const rows = await getDb()
    .select({ id: documentEmbeddingJob.id })
    .from(documentEmbeddingJob)
    .where(eq(documentEmbeddingJob.status, "running"));
  return rows.length;
}
