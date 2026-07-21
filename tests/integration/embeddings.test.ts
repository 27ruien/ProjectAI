import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  EmbeddingGateway,
  EmbeddingProviderError,
  FakeEmbeddingProvider,
  assertDailyEmbeddingTokenBudget,
  claimEmbeddingJob,
  completeEmbeddingJob,
  enqueueEmbeddingBackfill,
  ensureEmbeddingJob,
  failExhaustedEmbeddingJobs,
  findNearestEmbeddedChunksForProbe,
  getEmbeddingRuntimeConfig,
  listEmbeddingBackfillCandidates,
  markEmbeddingProviderCallDispatched,
  processEmbeddingJob,
  QwenEmbeddingProvider,
  prepareEmbeddingJob,
  reconcileStaleEmbeddingCalls,
  reserveEmbeddingBatch,
  retryUnknownEmbeddingJob,
  runEmbeddingWorker,
} from "../../lib/ai/embeddings";
import type {
  EmbeddingProvider,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
} from "../../lib/ai/embeddings";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import { activateOrQueueVersionIndex } from "../../lib/documents/processing/jobs";
import {
  aiEmbeddingProfile,
  auditEvent,
  documentChunk,
  documentChunkEmbedding,
  documentEmbeddingBatch,
  documentEmbeddingJob,
  documentEmbeddingProviderCall,
  documentIngestionJob,
  documentSection,
  embeddingWorkerHeartbeat,
  project,
  projectDocument,
  projectDocumentVersion,
  type UserRecord,
} from "../../lib/db/schema";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for embedding integration tests.`);
  return value;
};

type Fixture = {
  projectId: string;
  documentId: string;
  versionId: string;
  ingestionJobId: string;
  chunkIds: string[];
  contentHashes: string[];
};

let manager: UserRecord;
const projectIds: string[] = [];
const workerIds: string[] = [];
const profileV2 = "qwen-text-embedding-cn-v2-test";

class PartialFailureProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  async embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
    await request.onRequestStarted?.();
    this.calls += 1;
    if (this.calls >= 2 && this.calls <= 4) {
      throw new EmbeddingProviderError("SERVER_ERROR", true);
    }
    return {
      vectors: request.inputs.map(() => Array(request.dimensions).fill(0.125)),
      actualModel: request.model,
      inputTokens: request.inputs.length,
      totalTokens: request.inputs.length,
      providerRequestId: `partial-${this.calls}`,
      latencyMs: 1,
      dispatchClassification: "successful_response",
    };
  }
}

class CountingProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  constructor(
    private readonly usage: number | null = 1,
    private readonly waitForAbort = false,
  ) {}

  async embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
    await request.onRequestStarted?.();
    this.calls += 1;
    if (this.waitForAbort) {
      await new Promise<void>((_resolve, reject) => {
        const rejectUnknown = () =>
          reject(new EmbeddingProviderError("PROVIDER_RESULT_UNKNOWN", false));
        if (request.signal?.aborted) rejectUnknown();
        else request.signal?.addEventListener("abort", rejectUnknown, { once: true });
      });
    }
    return {
      vectors: request.inputs.map(() => Array(request.dimensions).fill(0.0625)),
      actualModel: request.model,
      inputTokens: this.usage,
      totalTokens: this.usage,
      providerRequestId: `counting-${this.calls}`,
      latencyMs: 1,
      dispatchClassification: "successful_response",
    };
  }
}

class DelayedSuccessProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  async embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
    await request.onRequestStarted?.();
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      vectors: request.inputs.map(() => Array(request.dimensions).fill(0.046875)),
      actualModel: request.model,
      inputTokens: request.inputs.length,
      totalTokens: request.inputs.length,
      providerRequestId: `delayed-success-${this.calls}`,
      latencyMs: 30,
      dispatchClassification: "successful_response",
    };
  }
}

class FailOnceProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  constructor(private readonly code: "RATE_LIMITED" | "SERVER_ERROR" | "NETWORK") {}

  async embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
    await request.onRequestStarted?.();
    this.calls += 1;
    if (this.calls === 1) throw new EmbeddingProviderError(this.code, true);
    return {
      vectors: request.inputs.map(() => Array(request.dimensions).fill(0.03125)),
      actualModel: request.model,
      inputTokens: 2,
      totalTokens: 2,
      providerRequestId: `retry-${this.code.toLowerCase()}`,
      latencyMs: 1,
      dispatchClassification: "successful_response",
    };
  }
}

class PreDispatchAbortProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  adapterInvocations = 0;
  dispatchedCalls = 0;

  async embed(): Promise<EmbeddingProviderResult> {
    this.adapterInvocations += 1;
    throw new EmbeddingProviderError(
      "SHUTDOWN_ABORTED",
      true,
      "pre_dispatch",
    );
  }
}

async function currentDailyTokenBudget(): Promise<number> {
  const result = await getDb().execute<{ input_tokens: number | string }>(sql`
    select coalesce(sum(
      case
        when status = 'succeeded' then coalesce(input_token_count, reserved_input_tokens)
        when status in ('reserved', 'calling', 'unknown') then reserved_input_tokens
        else 0
      end
    ), 0) as input_tokens
    from document_embedding_provider_calls
    where created_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    )
      and created_at < (
        date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
        + interval '1 day'
      )
  `);
  return Number(result.rows[0]?.input_tokens ?? 0);
}

async function createFixture(input: {
  projectId?: string;
  name: string;
  contents: string[];
  documentStatus?: "active" | "archived";
  current?: boolean;
  stored?: boolean;
  ingestionStatus?: "succeeded" | "needs_ocr" | "pending" | "running" | "failed";
  effective?: boolean;
}): Promise<Fixture> {
  const projectId = input.projectId ?? `embedding-project-${crypto.randomUUID()}`;
  if (!input.projectId) {
    projectIds.push(projectId);
    await getDb().insert(project).values({
      id: projectId,
      name: `${input.name} project`,
      clientName: "Fictional Client",
      description: "Runtime-generated embedding integration fixture",
      status: "active",
      createdBy: manager.id,
    });
  }
  const documentId = `embedding-document-${crypto.randomUUID()}`;
  const versionId = `embedding-version-${crypto.randomUUID()}`;
  const ingestionJobId = `embedding-ingestion-${crypto.randomUUID()}`;
  const sectionId = `embedding-section-${crypto.randomUUID()}`;
  const documentStatus = input.documentStatus ?? "active";
  const current = input.current ?? true;
  const stored = input.stored ?? true;
  const ingestionStatus = input.ingestionStatus ?? "succeeded";
  const effective = input.effective ?? true;
  const now = new Date();
  const chunkIds: string[] = [];
  const contentHashes: string[] = [];
  await getDb().transaction(async (tx) => {
    await tx.insert(projectDocument).values({
      id: documentId,
      projectId,
      displayName: input.name,
      status: documentStatus,
      createdBy: manager.id,
      archivedBy: documentStatus === "archived" ? manager.id : null,
      archivedAt: documentStatus === "archived" ? now : null,
    });
    await tx.insert(projectDocumentVersion).values({
      id: versionId,
      documentId,
      projectId,
      versionNumber: 1,
      isCurrent: current,
      uploadId: crypto.randomUUID(),
      objectKey: `projects/${projectId}/documents/${documentId}/versions/${versionId}/source`,
      originalFilename: `${input.name}.txt`,
      normalizedExtension: "txt",
      declaredMimeType: "text/plain",
      detectedMimeType: "text/plain",
      sizeBytes: Math.max(1, input.contents.join("\n").length),
      sha256: "a".repeat(64),
      storageEtag: stored ? `etag-${crypto.randomUUID()}` : null,
      storageStatus: stored ? "stored" : "pending",
      uploadedBy: manager.id,
      storedAt: stored ? now : null,
    });
    const terminal = ["succeeded", "needs_ocr", "failed"].includes(
      ingestionStatus,
    );
    await tx.insert(documentIngestionJob).values({
      id: ingestionJobId,
      projectId,
      documentId,
      versionId,
      generation: 1,
      status: ingestionStatus,
      parserVersion: "1",
      chunkerVersion: "1",
      createdBy: manager.id,
      completedAt: terminal ? now : null,
      failureCode:
        ingestionStatus === "needs_ocr"
          ? "OCR_REQUIRED"
          : ingestionStatus === "failed"
            ? "DOCUMENT_PARSE_FAILED"
            : null,
      failureMessage:
        ingestionStatus === "failed" ? "Synthetic failure." : null,
      leasedBy: ingestionStatus === "running" ? "fixture-worker" : null,
      leaseExpiresAt:
        ingestionStatus === "running" ? new Date(Date.now() + 60_000) : null,
      startedAt: ingestionStatus === "running" ? now : null,
    });
    await tx.insert(documentSection).values({
      id: sectionId,
      projectId,
      documentId,
      versionId,
      ingestionJobId,
      generation: 1,
      sectionType: "text",
      sectionIndex: 0,
      headingPath: [],
      sourceLocator: { type: "text_lines", lineStart: 1, lineEnd: input.contents.length },
      content: input.contents.join("\n"),
      contentSha256: "b".repeat(64),
      characterCount: input.contents.join("\n").length,
      parserVersion: "1",
    });
    await tx.insert(documentChunk).values(
      input.contents.map((content, chunkIndex) => {
        const id = `embedding-chunk-${crypto.randomUUID()}`;
        const contentSha256 = Buffer.from(content)
          .toString("hex")
          .padEnd(64, "0")
          .slice(0, 64);
        chunkIds.push(id);
        contentHashes.push(contentSha256);
        return {
          id,
          projectId,
          documentId,
          versionId,
          sectionId,
          ingestionJobId,
          generation: 1,
          chunkIndex,
          content,
          contentSha256,
          searchText: content,
          characterCount: content.length,
          estimatedTokenCount: Math.max(1, content.split(/\s+/u).length),
          headingPath: [],
          sourceLocator: { type: "text_lines", lineStart: chunkIndex + 1, lineEnd: chunkIndex + 1 },
          parserVersion: "1",
          chunkerVersion: "1",
          isEffective: effective,
        };
      }),
    );
  });
  return {
    projectId,
    documentId,
    versionId,
    ingestionJobId,
    chunkIds,
    contentHashes,
  };
}

async function enqueue(fixture: Fixture) {
  return ensureEmbeddingJob({
    projectId: fixture.projectId,
    documentId: fixture.documentId,
    versionId: fixture.versionId,
    createdBy: manager.id,
    reason: "backfill",
  });
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(databaseUrl.pathname, /test|ci/i);
  assert.ok(["127.0.0.1", "localhost", "postgres", "db"].includes(databaseUrl.hostname));
  const found = await findUserByEmail(required("SEED_MANAGER_A_EMAIL"));
  assert.ok(found);
  manager = found;
  await getDb().insert(aiEmbeddingProfile).values({
    id: profileV2,
    provider: "qwen",
    model: "text-embedding-v4",
    region: "cn-beijing",
    dimensions: 1024,
    distanceMetric: "cosine",
    profileVersion: 2,
    enabled: true,
  });
});

after(async () => {
  try {
    if (workerIds.length) {
      await getDb()
        .delete(embeddingWorkerHeartbeat)
        .where(inArray(embeddingWorkerHeartbeat.workerId, workerIds));
    }
    if (projectIds.length) {
      await getDb().delete(auditEvent).where(inArray(auditEvent.projectId, projectIds));
      await getDb()
        .delete(documentChunkEmbedding)
        .where(inArray(documentChunkEmbedding.projectId, projectIds));
      await getDb()
        .delete(documentEmbeddingProviderCall)
        .where(inArray(documentEmbeddingProviderCall.projectId, projectIds));
      await getDb()
        .delete(documentEmbeddingBatch)
        .where(inArray(documentEmbeddingBatch.projectId, projectIds));
      await getDb()
        .delete(documentEmbeddingJob)
        .where(inArray(documentEmbeddingJob.projectId, projectIds));
      await getDb().delete(documentChunk).where(inArray(documentChunk.projectId, projectIds));
      await getDb().delete(documentSection).where(inArray(documentSection.projectId, projectIds));
      await getDb()
        .delete(documentIngestionJob)
        .where(inArray(documentIngestionJob.projectId, projectIds));
      await getDb()
        .delete(projectDocumentVersion)
        .where(inArray(projectDocumentVersion.projectId, projectIds));
      await getDb()
        .delete(projectDocument)
        .where(inArray(projectDocument.projectId, projectIds));
      await getDb().delete(project).where(inArray(project.id, projectIds));
    }
    await getDb().delete(aiEmbeddingProfile).where(eq(aiEmbeddingProfile.id, profileV2));
  } finally {
    await closeDatabasePool();
  }
});

describe("pgvector schema and embedding pipeline", () => {
  it("installs the pinned profile, pgvector extension, 1024-dimensional column, and batches at most ten chunks", async () => {
    const metadata = await getDb().execute<{
      vector_version: string;
      postgres_version: string;
      vector_type: string;
    }>(sql`
      select
        (select extversion from pg_extension where extname = 'vector') as vector_version,
        current_setting('server_version') as postgres_version,
        (
          select format_type(a.atttypid, a.atttypmod)
          from pg_attribute a
          where a.attrelid = 'document_chunk_embeddings'::regclass
            and a.attname = 'embedding'
        ) as vector_type
    `);
    assert.match(metadata.rows[0]!.postgres_version, /^17\./);
    assert.equal(metadata.rows[0]!.vector_version, "0.8.1");
    assert.equal(metadata.rows[0]!.vector_type, "vector(1024)");
    const [profile] = await getDb()
      .select()
      .from(aiEmbeddingProfile)
      .where(eq(aiEmbeddingProfile.id, "qwen-text-embedding-cn-v1"));
    assert.equal(profile?.model, "text-embedding-v4");
    assert.equal(profile?.dimensions, 1024);
    assert.equal(profile?.profileVersion, 1);

    const fixture = await createFixture({
      name: "batch-foundation",
      contents: Array.from({ length: 12 }, (_, index) => `Fictional embedding chunk ${index}`),
    });
    const job = await enqueue(fixture);
    assert.equal(job?.status, "pending");
    await runEmbeddingWorker({ once: true, workerId: "embedding-success-worker" });
    const [completed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.chunkCount, 12);
    assert.equal(completed?.completedChunkCount, 12);
    assert.equal(completed?.providerCallCount, 2);
    assert.ok((completed?.inputTokenCount ?? 0) > 0);
    const batches = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, job!.id));
    assert.deepEqual(
      batches.map((batch) => batch.chunkCount).sort((a, b) => a - b),
      [2, 10],
    );
    assert.ok(batches.every((batch) => batch.costMicroCny === null));
    const vectors = await getDb().execute<{ dimensions: number }>(sql`
      select vector_dims(embedding)::int as dimensions
      from document_chunk_embeddings
      where embedding_job_id = ${job!.id}
    `);
    assert.equal(vectors.rows.length, 12);
    assert.ok(vectors.rows.every((row) => row.dimensions === 1024));

    const batchesBeforeReplay = batches.length;
    assert.equal(await enqueue(fixture), null);
    await runEmbeddingWorker({ once: true, workerId: "embedding-replay-worker" });
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentEmbeddingBatch)
          .where(eq(documentEmbeddingBatch.jobId, job!.id))
      ).length,
      batchesBeforeReplay,
    );
  });

  it("commits an earlier batch but freezes a later post-dispatch failure as unknown", async () => {
    const fixture = await createFixture({
      name: "partial-failure",
      contents: Array.from({ length: 12 }, (_, index) => `Partial batch ${index}`),
    });
    const job = await enqueue(fixture);
    const firstClaim = await claimEmbeddingJob("partial-worker-a");
    assert.equal(firstClaim?.id, job?.id);
    const config = getEmbeddingRuntimeConfig();
    const partialProvider = new PartialFailureProvider();
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "partial-worker-a",
      config,
      gateway: new EmbeddingGateway(config, partialProvider),
    });
    const [failed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "PROVIDER_RESULT_UNKNOWN");
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentChunkEmbedding)
          .where(eq(documentChunkEmbedding.embeddingJobId, job!.id))
      ).length,
      10,
    );
    const firstAttemptBatches = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, job!.id));
    assert.equal(
      firstAttemptBatches.filter((batch) => batch.status === "succeeded").length,
      1,
    );
    assert.equal(
      firstAttemptBatches.filter((batch) => batch.status === "unknown").length,
      1,
    );
    assert.equal(partialProvider.calls, 2);
    assert.equal(await claimEmbeddingJob("partial-worker-b"), null);
  });

  it("never automatically retries dispatched 429, 5xx, or network failures", async () => {
    for (const code of ["RATE_LIMITED", "SERVER_ERROR", "NETWORK"] as const) {
      const fixture = await createFixture({
        name: `durable-retry-${code.toLowerCase()}`,
        contents: [`Fictional ${code} retry`],
      });
      const job = await enqueue(fixture);
      const provider = new FailOnceProvider(code);
      const config = getEmbeddingRuntimeConfig();
      const first = await claimEmbeddingJob(`retry-${code}-a`);
      assert.equal(first?.id, job?.id);
      await processEmbeddingJob({
        jobId: job!.id,
        workerId: `retry-${code}-a`,
        config,
        gateway: new EmbeddingGateway(config, provider),
      });
      const [failed] = await getDb()
        .select()
        .from(documentEmbeddingJob)
        .where(eq(documentEmbeddingJob.id, job!.id));
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.failureCode, "PROVIDER_RESULT_UNKNOWN");
      assert.equal(await claimEmbeddingJob(`retry-${code}-b`), null);
      const [batch] = await getDb()
        .select()
        .from(documentEmbeddingBatch)
        .where(eq(documentEmbeddingBatch.jobId, job!.id));
      const calls = await getDb()
        .select()
        .from(documentEmbeddingProviderCall)
        .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
      assert.equal(provider.calls, 1);
      assert.equal(batch?.status, "unknown");
      assert.equal(batch?.providerAttemptCount, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.status, "unknown");
      assert.equal(calls[0]?.dispatchClassification, "post_dispatch");
    }
  });

  it("persists Qwen timeout, network, and invalid-200 outcomes as one unknown call", async () => {
    const originalKey = process.env.QWEN_API_KEY;
    process.env.QWEN_API_KEY = "integration-test-placeholder-only";
    try {
      for (const failure of ["timeout", "network", "invalid-200"] as const) {
        const fixture = await createFixture({
          name: `qwen-${failure}`,
          contents: [`Fictional ${failure} provider outcome`],
        });
        const job = await enqueue(fixture);
        const config = getEmbeddingRuntimeConfig();
        let fetchCalls = 0;
        const provider = new QwenEmbeddingProvider(
          "https://dashscope.aliyuncs.com/compatible-mode/v1",
          async () => {
            fetchCalls += 1;
            if (failure === "timeout") {
              throw Object.assign(new Error("synthetic abort"), {
                name: "AbortError",
              });
            }
            if (failure === "network") throw new Error("synthetic reset");
            return new Response("not-json", { status: 200 });
          },
        );
        const workerId = `qwen-${failure}-worker`;
        const claimed = await claimEmbeddingJob(workerId);
        assert.equal(claimed?.id, job?.id);
        await processEmbeddingJob({
          jobId: job!.id,
          workerId,
          config,
          gateway: new EmbeddingGateway(config, provider),
        });
        const [failed] = await getDb()
          .select()
          .from(documentEmbeddingJob)
          .where(eq(documentEmbeddingJob.id, job!.id));
        const calls = await getDb()
          .select()
          .from(documentEmbeddingProviderCall)
          .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
        assert.equal(fetchCalls, 1);
        assert.equal(failed?.status, "failed");
        assert.equal(failed?.failureCode, "PROVIDER_RESULT_UNKNOWN");
        assert.equal(failed?.providerCallCount, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.status, "unknown");
        assert.equal(calls[0]?.dispatchClassification, "post_dispatch");
        assert.equal(await claimEmbeddingJob(`qwen-${failure}-retry`), null);
      }
    } finally {
      if (originalKey === undefined) delete process.env.QWEN_API_KEY;
      else process.env.QWEN_API_KEY = originalKey;
    }
  });

  it("releases only a confirmed pre-dispatch reservation and safely requeues", async () => {
    const fixture = await createFixture({
      name: "safe-pre-dispatch-abort",
      contents: ["Fictional pre-dispatch shutdown"],
    });
    const job = await enqueue(fixture);
    const config = getEmbeddingRuntimeConfig();
    const provider = new PreDispatchAbortProvider();
    const first = await claimEmbeddingJob("pre-dispatch-worker-a");
    assert.equal(first?.id, job?.id);
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "pre-dispatch-worker-a",
      config,
      gateway: new EmbeddingGateway(config, provider),
    });
    const [pending] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    const [confirmedNoCharge] = await getDb()
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
    assert.equal(provider.adapterInvocations, 1);
    assert.equal(provider.dispatchedCalls, 0);
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.providerCallCount, 0);
    assert.equal(confirmedNoCharge?.status, "failed_confirmed_no_charge");
    assert.equal(confirmedNoCharge?.dispatchClassification, "pre_dispatch");

    await getDb()
      .update(documentEmbeddingJob)
      .set({ availableAt: sql`now()` })
      .where(eq(documentEmbeddingJob.id, job!.id));
    const second = await claimEmbeddingJob("pre-dispatch-worker-b");
    assert.equal(second?.id, job?.id);
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "pre-dispatch-worker-b",
      config,
      gateway: new EmbeddingGateway(config, new FakeEmbeddingProvider()),
    });
    const [completed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    const calls = await getDb()
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.providerCallCount, 1);
    assert.deepEqual(
      calls.map((call) => call.status).sort(),
      ["failed_confirmed_no_charge", "succeeded"],
    );
  });

  it("enforces cross-project scope, content hash validity, vector dimensions, and Profile version immutability", async () => {
    const fixtureA = await createFixture({ name: "scope-a", contents: ["Scope A content"] });
    const fixtureB = await createFixture({ name: "scope-b", contents: ["Scope B content"] });
    const jobA = await enqueue(fixtureA);
    await runEmbeddingWorker({ once: true, workerId: "scope-a-worker" });
    assert.ok(jobA);
    const [batchA] = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, jobA!.id));
    await assert.rejects(
      getDb().insert(documentEmbeddingProviderCall).values({
        id: crypto.randomUUID(),
        batchId: batchA!.id,
        jobId: jobA!.id,
        projectId: fixtureB.projectId,
        documentId: fixtureA.documentId,
        versionId: fixtureA.versionId,
        embeddingProfileId: "qwen-text-embedding-cn-v1",
        callSequence: 99,
        status: "reserved",
        budgetRuleVersion: "text-embedding-v4-hard-limit-cn-beijing-v1",
        reservedInputTokens: 8_192,
      }),
    );

    await assert.rejects(
      getDb().execute(sql`
        update document_chunk_embeddings
        set content_sha256 = ${"f".repeat(64)}
        where chunk_id = ${fixtureA.chunkIds[0]!}
      `),
    );

    const [jobV2] = await getDb()
      .insert(documentEmbeddingJob)
      .values({
        id: crypto.randomUUID(),
        projectId: fixtureB.projectId,
        documentId: fixtureB.documentId,
        versionId: fixtureB.versionId,
        embeddingProfileId: profileV2,
        generation: 1,
        chunkCount: 1,
        createdBy: manager.id,
      })
      .returning();
    await assert.rejects(
      getDb().execute(sql`
        insert into document_chunk_embeddings (
          id, project_id, document_id, version_id, chunk_id,
          embedding_profile_id, embedding_job_id, embedding,
          content_sha256, status
        ) values (
          ${crypto.randomUUID()}, ${fixtureB.projectId}, ${fixtureB.documentId},
          ${fixtureB.versionId}, ${fixtureA.chunkIds[0]!}, ${profileV2},
          ${jobV2.id}, cast(${`[${Array(1024).fill(0.1).join(",")}]`} as vector(1024)),
          ${fixtureA.contentHashes[0]!}, 'current'
        )
      `),
    );
    await assert.rejects(
      getDb().execute(sql`
        insert into document_chunk_embeddings (
          id, project_id, document_id, version_id, chunk_id,
          embedding_profile_id, embedding_job_id, embedding,
          content_sha256, status
        ) values (
          ${crypto.randomUUID()}, ${fixtureB.projectId}, ${fixtureB.documentId},
          ${fixtureB.versionId}, ${fixtureB.chunkIds[0]!}, ${profileV2},
          ${jobV2.id}, cast('[0.1,0.2,0.3]' as vector),
          ${fixtureB.contentHashes[0]!}, 'current'
        )
      `),
    );
    const [v1] = await getDb()
      .select()
      .from(aiEmbeddingProfile)
      .where(eq(aiEmbeddingProfile.id, "qwen-text-embedding-cn-v1"));
    const [v2] = await getDb()
      .select()
      .from(aiEmbeddingProfile)
      .where(eq(aiEmbeddingProfile.id, profileV2));
    assert.equal(v1?.profileVersion, 1);
    assert.equal(v2?.profileVersion, 2);
    assert.notEqual(v1?.id, v2?.id);
    await assert.rejects(
      getDb()
        .update(aiEmbeddingProfile)
        .set({ model: "silent-definition-overwrite" })
        .where(eq(aiEmbeddingProfile.id, "qwen-text-embedding-cn-v1")),
    );
  });

  it("invalidates and safely reuses same-hash vectors without a second Provider charge", async () => {
    const fixture = await createFixture({ name: "reuse", contents: ["Stable fictional content"] });
    const first = await enqueue(fixture);
    await runEmbeddingWorker({ once: true, workerId: "reuse-first-worker" });
    const batchCount = (
      await getDb()
        .select()
        .from(documentEmbeddingBatch)
        .where(eq(documentEmbeddingBatch.jobId, first!.id))
    ).length;
    await getDb()
      .update(documentChunk)
      .set({ isEffective: false })
      .where(eq(documentChunk.id, fixture.chunkIds[0]!));
    const [invalid] = await getDb()
      .select()
      .from(documentChunkEmbedding)
      .where(eq(documentChunkEmbedding.chunkId, fixture.chunkIds[0]!));
    assert.equal(invalid?.status, "invalid");
    await getDb()
      .update(documentChunk)
      .set({ isEffective: true })
      .where(eq(documentChunk.id, fixture.chunkIds[0]!));
    const replay = await enqueue(fixture);
    assert.ok(replay);
    await runEmbeddingWorker({ once: true, workerId: "reuse-second-worker" });
    const [reactivated] = await getDb()
      .select()
      .from(documentChunkEmbedding)
      .where(eq(documentChunkEmbedding.chunkId, fixture.chunkIds[0]!));
    assert.equal(reactivated?.status, "current");
    assert.equal(reactivated?.embeddingJobId, replay!.id);
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentEmbeddingBatch)
          .where(
            inArray(documentEmbeddingBatch.jobId, [first!.id, replay!.id]),
          )
      ).length,
      batchCount,
    );
  });

  it("uses SKIP LOCKED, recovers stale leases, rejects the old Worker, and fails exhausted jobs", async () => {
    const fixture = await createFixture({ name: "lease", contents: ["Lease recovery content"] });
    const job = await enqueue(fixture);
    const first = await claimEmbeddingJob("embedding-lease-worker-a");
    assert.equal(first?.id, job?.id);
    assert.equal(await claimEmbeddingJob("embedding-lease-worker-b"), null);
    await getDb()
      .update(documentEmbeddingJob)
      .set({
        startedAt: sql`now() - interval '10 seconds'`,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(documentEmbeddingJob.id, first!.id));
    const recovered = await claimEmbeddingJob("embedding-lease-worker-b");
    assert.equal(recovered?.id, first?.id);
    await assert.rejects(
      completeEmbeddingJob({
        jobId: first!.id,
        workerId: "embedding-lease-worker-a",
      }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "WORKER_LEASE_LOST",
    );
    const config = getEmbeddingRuntimeConfig();
    await processEmbeddingJob({
      jobId: recovered!.id,
      workerId: "embedding-lease-worker-b",
      config,
      gateway: new EmbeddingGateway(config, new FakeEmbeddingProvider()),
    });
    const [completed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, recovered!.id));
    assert.equal(completed?.status, "succeeded");

    const exhaustedFixture = await createFixture({ name: "exhausted", contents: ["Exhausted lease"] });
    const exhaustedJob = await enqueue(exhaustedFixture);
    await getDb()
      .update(documentEmbeddingJob)
      .set({ maxAttempts: 1 })
      .where(eq(documentEmbeddingJob.id, exhaustedJob!.id));
    const exhaustedClaim = await claimEmbeddingJob("embedding-exhausted-worker");
    await getDb()
      .update(documentEmbeddingJob)
      .set({
        startedAt: sql`now() - interval '10 seconds'`,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(documentEmbeddingJob.id, exhaustedClaim!.id));
    assert.equal(await failExhaustedEmbeddingJobs(), 1);
    const [failed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, exhaustedClaim!.id));
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.failureCode, "WORKER_MAX_ATTEMPTS_REACHED");
  });

  it("backfills only active/current/stored/succeeded/effective chunks and keeps exact-vector probes project scoped", async () => {
    const eligible = await createFixture({ name: "backfill-eligible", contents: ["Exact probe alpha"] });
    await createFixture({ projectId: eligible.projectId, name: "old-version", contents: ["Old"], current: false });
    await createFixture({ projectId: eligible.projectId, name: "archived", contents: ["Archived"], documentStatus: "archived" });
    await createFixture({ projectId: eligible.projectId, name: "needs-ocr", contents: ["OCR"], ingestionStatus: "needs_ocr" });
    await createFixture({ projectId: eligible.projectId, name: "not-effective", contents: ["Inactive"], effective: false });
    const oversized = await createFixture({
      projectId: eligible.projectId,
      name: "over-100-chunks",
      contents: Array.from({ length: 101 }, (_, index) => `Oversized Chunk ${index}`),
    });
    const otherProject = await createFixture({ name: "probe-other", contents: ["Exact probe beta"] });

    const candidates = await listEmbeddingBackfillCandidates({
      projectId: eligible.projectId,
      limit: 100,
    });
    assert.deepEqual(candidates.map((candidate) => candidate.versionId), [eligible.versionId]);
    assert.equal(
      candidates.some((candidate) => candidate.versionId === oversized.versionId),
      false,
    );
    assert.ok(
      candidates.reduce((total, candidate) => total + candidate.missingChunkCount, 0) <= 100,
    );
    const dryRun = await enqueueEmbeddingBackfill({
      projectId: eligible.projectId,
      limit: 100,
      apply: false,
    });
    assert.deepEqual(dryRun, {
      dryRun: true,
      candidateVersions: 1,
      missingChunks: 1,
      enqueuedJobs: 0,
    });
    const applied = await enqueueEmbeddingBackfill({
      projectId: eligible.projectId,
      limit: 1,
      apply: true,
    });
    assert.equal(applied.enqueuedJobs, 1);
    await enqueue(otherProject);
    await runEmbeddingWorker({ once: true, workerId: "backfill-worker-a" });
    await runEmbeddingWorker({ once: true, workerId: "backfill-worker-b" });

    const provider = new FakeEmbeddingProvider();
    const query = await provider.embed({
      model: "text-embedding-v4",
      dimensions: 1024,
      inputs: ["Exact probe alpha"],
      timeoutMs: 1_000,
    });
    const nearest = await findNearestEmbeddedChunksForProbe({
      projectId: eligible.projectId,
      vector: query.vectors[0]!,
      limit: 10,
    });
    assert.deepEqual(nearest.map((row) => row.chunkId), eligible.chunkIds);
    assert.equal(nearest.some((row) => otherProject.chunkIds.includes(row.chunkId)), false);

    const disabledFixture = await createFixture({ name: "disabled", contents: ["Disabled flag"] });
    const disabled = await ensureEmbeddingJob({
      projectId: disabledFixture.projectId,
      documentId: disabledFixture.documentId,
      versionId: disabledFixture.versionId,
      createdBy: manager.id,
      reason: "backfill",
      config: { ...getEmbeddingRuntimeConfig(), enabled: false },
    });
    assert.equal(disabled, null);
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentEmbeddingJob)
          .where(eq(documentEmbeddingJob.versionId, disabledFixture.versionId))
      ).length,
      0,
    );

    await assert.rejects(
      assertDailyEmbeddingTokenBudget({
        ...getEmbeddingRuntimeConfig(),
        dailyTokenLimit: 1,
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "DAILY_TOKEN_LIMIT_REACHED",
    );
    const limitedFixture = await createFixture({
      name: "job-limit",
      contents: ["Job limit fixture"],
    });
    await assert.rejects(
      ensureEmbeddingJob({
        projectId: limitedFixture.projectId,
        documentId: limitedFixture.documentId,
        versionId: limitedFixture.versionId,
        createdBy: manager.id,
        reason: "backfill",
        config: { ...getEmbeddingRuntimeConfig(), dailyJobLimit: 1 },
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "DAILY_JOB_LIMIT_REACHED",
    );
  });

  it("propagates the Phase 4 embedding flag through document activation and rollback", async () => {
    const original = process.env.AI_EMBEDDING_ENABLED;
    try {
      const before = await createFixture({ name: "phase4-before", contents: ["Before Phase 4"] });
      process.env.AI_EMBEDDING_ENABLED = "false";
      await activateOrQueueVersionIndex({
        projectId: before.projectId,
        documentId: before.documentId,
        versionId: before.versionId,
        actorUserId: manager.id,
        reason: "current_version",
        db: getDb(),
      });
      assert.equal(
        (await getDb().select().from(documentEmbeddingJob).where(eq(documentEmbeddingJob.versionId, before.versionId))).length,
        0,
      );

      const enabled = await createFixture({ name: "phase4-enabled", contents: ["During Phase 4"] });
      process.env.AI_EMBEDDING_ENABLED = "true";
      await activateOrQueueVersionIndex({
        projectId: enabled.projectId,
        documentId: enabled.documentId,
        versionId: enabled.versionId,
        actorUserId: manager.id,
        reason: "current_version",
        db: getDb(),
      });
      assert.equal(
        (await getDb().select().from(documentEmbeddingJob).where(eq(documentEmbeddingJob.versionId, enabled.versionId))).length,
        1,
      );
      await runEmbeddingWorker({ once: true, workerId: "phase4-propagation-worker" });
      const vectorsBeforeRollback = (
        await getDb()
          .select()
          .from(documentChunkEmbedding)
          .where(eq(documentChunkEmbedding.versionId, enabled.versionId))
      ).length;
      assert.ok(vectorsBeforeRollback > 0);

      const rolledBack = await createFixture({ name: "phase4-rollback", contents: ["After rollback"] });
      process.env.AI_EMBEDDING_ENABLED = "false";
      await activateOrQueueVersionIndex({
        projectId: rolledBack.projectId,
        documentId: rolledBack.documentId,
        versionId: rolledBack.versionId,
        actorUserId: manager.id,
        reason: "current_version",
        db: getDb(),
      });
      assert.equal(
        (await getDb().select().from(documentEmbeddingJob).where(eq(documentEmbeddingJob.versionId, rolledBack.versionId))).length,
        0,
      );
      assert.equal(
        (
          await getDb()
            .select()
            .from(documentChunkEmbedding)
            .where(eq(documentChunkEmbedding.versionId, enabled.versionId))
        ).length,
        vectorsBeforeRollback,
      );
    } finally {
      if (original === undefined) delete process.env.AI_EMBEDDING_ENABLED;
      else process.env.AI_EMBEDDING_ENABLED = original;
    }
  });

  it("persists calling before the Provider and converts a crash to unknown without an automatic second charge", async () => {
    const fixture = await createFixture({
      name: "durable-provider-crash",
      contents: ["Fictional durable provider call"],
    });
    const job = await enqueue(fixture);
    const workerId = "durable-crash-worker";
    const claimed = await claimEmbeddingJob(workerId);
    assert.equal(claimed?.id, job?.id);
    const prepared = await prepareEmbeddingJob({ jobId: job!.id, workerId });
    assert.ok(prepared);
    const config = getEmbeddingRuntimeConfig();
    const reservation = await reserveEmbeddingBatch({
      jobId: job!.id,
      workerId,
      batchIndex: 0,
      chunks: prepared!.chunks,
      config,
    });
    assert.equal(reservation.action, "call");
    await markEmbeddingProviderCallDispatched({
      jobId: job!.id,
      workerId,
      batchId: reservation.batchId,
      providerCallId: reservation.providerCallId,
    });
    const [calling] = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, job!.id));
    assert.equal(calling?.status, "calling");
    assert.ok((calling?.reservedInputTokens ?? 0) > 0);

    const provider = new CountingProvider(4);
    await new EmbeddingGateway(config, provider).embed(
      prepared!.chunks.map((chunk) => chunk.content),
    );
    assert.equal(provider.calls, 1);
    await getDb()
      .update(documentEmbeddingBatch)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(documentEmbeddingBatch.id, calling!.id));
    await getDb()
      .update(documentEmbeddingProviderCall)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(documentEmbeddingProviderCall.id, reservation.providerCallId));
    await getDb()
      .update(documentEmbeddingJob)
      .set({
        startedAt: sql`now() - interval '10 seconds'`,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(await reconcileStaleEmbeddingCalls(), 1);
    const [unknownJob] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    const [unknownBatch] = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.id, calling!.id));
    assert.equal(unknownJob?.status, "failed");
    assert.equal(unknownJob?.failureCode, "PROVIDER_RESULT_UNKNOWN");
    assert.equal(unknownBatch?.status, "unknown");
    await assert.rejects(
      getDb()
        .update(documentEmbeddingProviderCall)
        .set({ failureCode: "MUTATION_MUST_FAIL" })
        .where(eq(documentEmbeddingProviderCall.id, reservation.providerCallId)),
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentChunkEmbedding)
          .where(eq(documentChunkEmbedding.embeddingJobId, job!.id))
      ).length,
      0,
    );
    assert.equal(await claimEmbeddingJob("normal-worker-must-not-retry"), null);
    assert.equal(provider.calls, 1);

    const budgetHeld = await currentDailyTokenBudget();
    const blockedFixture = await createFixture({
      name: "unknown-budget-hold",
      contents: ["Blocked by unknown reservation"],
    });
    const blockedJob = await enqueue(blockedFixture);
    const blockedClaim = await claimEmbeddingJob("unknown-budget-worker");
    assert.equal(blockedClaim?.id, blockedJob?.id);
    const blockedProvider = new CountingProvider();
    await processEmbeddingJob({
      jobId: blockedJob!.id,
      workerId: "unknown-budget-worker",
      config: { ...config, dailyTokenLimit: budgetHeld },
      gateway: new EmbeddingGateway(config, blockedProvider),
    });
    assert.equal(blockedProvider.calls, 0);

    await assert.rejects(
      retryUnknownEmbeddingJob({
        jobId: job!.id,
        acceptPossibleDuplicateCharge: false,
      }),
      (error: unknown) =>
        error instanceof EmbeddingProviderError ||
        (error instanceof Error && "code" in error),
    );
    const insufficient = await retryUnknownEmbeddingJob({
      jobId: job!.id,
      acceptPossibleDuplicateCharge: true,
      config: { ...config, dailyTokenLimit: budgetHeld },
    });
    assert.equal(insufficient.canApply, false);
    await assert.rejects(
      retryUnknownEmbeddingJob({
        jobId: job!.id,
        acceptPossibleDuplicateCharge: true,
        apply: true,
        config: { ...config, dailyTokenLimit: budgetHeld },
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "DAILY_TOKEN_LIMIT_REACHED",
    );
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentEmbeddingProviderCall)
          .where(eq(documentEmbeddingProviderCall.jobId, job!.id))
      ).length,
      1,
    );
    const dryRun = await retryUnknownEmbeddingJob({
      jobId: job!.id,
      acceptPossibleDuplicateCharge: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.unknownCallCount, 1);
    assert.equal(dryRun.oldReservedInputTokens, 8_192);
    assert.equal(dryRun.newReservedInputTokens, 8_192);
    assert.equal(dryRun.canApply, true);
    const applied = await retryUnknownEmbeddingJob({
      jobId: job!.id,
      acceptPossibleDuplicateCharge: true,
      apply: true,
    });
    assert.equal(applied.dryRun, false);
    assert.equal(applied.requeued, true);
    const callsBeforeRetry = await getDb()
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
    assert.deepEqual(
      callsBeforeRetry.map((call) => call.status).sort(),
      ["reserved", "unknown"],
    );
    assert.equal(await currentDailyTokenBudget(), budgetHeld + 8_192);
    const manualClaim = await claimEmbeddingJob("manual-recovery-worker");
    assert.equal(manualClaim?.id, job?.id);
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "manual-recovery-worker",
      config,
      gateway: new EmbeddingGateway(config, provider),
    });
    assert.equal(provider.calls, 2);
    const callsAfterRetry = await getDb()
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.jobId, job!.id));
    assert.deepEqual(
      callsAfterRetry.map((call) => call.status).sort(),
      ["succeeded", "unknown"],
    );
    const [recoveredJob] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(recoveredJob?.providerCallCount, 2);
    assert.equal(await currentDailyTokenBudget(), budgetHeld + 4);
  });

  it("serializes the last daily Token reservation so only one concurrent Provider call starts", async () => {
    const contents = ["one two three four five six seven eight"];
    const fixtureA = await createFixture({ name: "budget-race-a", contents });
    const fixtureB = await createFixture({ name: "budget-race-b", contents });
    const jobA = await enqueue(fixtureA);
    const jobB = await enqueue(fixtureB);
    const claimA = await claimEmbeddingJob("budget-race-worker-a");
    const claimB = await claimEmbeddingJob("budget-race-worker-b");
    assert.deepEqual(
      new Set([claimA?.id, claimB?.id]),
      new Set([jobA?.id, jobB?.id]),
    );
    const used = await currentDailyTokenBudget();
    const config = {
      ...getEmbeddingRuntimeConfig(),
      dailyTokenLimit: used + 8_192,
    };
    const providerA = new CountingProvider(10);
    const providerB = new CountingProvider(10);
    await Promise.all([
      processEmbeddingJob({
        jobId: claimA!.id,
        workerId: "budget-race-worker-a",
        config,
        gateway: new EmbeddingGateway(config, providerA),
      }),
      processEmbeddingJob({
        jobId: claimB!.id,
        workerId: "budget-race-worker-b",
        config,
        gateway: new EmbeddingGateway(config, providerB),
      }),
    ]);
    assert.equal(providerA.calls + providerB.calls, 1);
    const jobs = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(inArray(documentEmbeddingJob.id, [jobA!.id, jobB!.id]));
    assert.equal(jobs.filter((item) => item.status === "succeeded").length, 1);
    assert.equal(
      jobs.filter((item) => item.failureCode === "DAILY_TOKEN_LIMIT_REACHED")
        .length,
      1,
    );
  });

  it("keeps a successful null-Usage reservation in the UTC daily budget", async () => {
    const used = await currentDailyTokenBudget();
    const config = {
      ...getEmbeddingRuntimeConfig(),
      dailyTokenLimit: used + 8_192,
    };
    const fixture = await createFixture({
      name: "null-usage-budget",
      contents: ["one two three four five six seven eight"],
    });
    const job = await enqueue(fixture);
    const claim = await claimEmbeddingJob("null-usage-worker");
    assert.equal(claim?.id, job?.id);
    const nullUsageProvider = new CountingProvider(null);
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "null-usage-worker",
      config,
      gateway: new EmbeddingGateway(config, nullUsageProvider),
    });
    const [batch] = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, job!.id));
    assert.equal(batch?.status, "succeeded");
    assert.equal(batch?.inputTokenCount, null);
    assert.equal(batch?.reservedInputTokens, 8_192);

    const blockedFixture = await createFixture({
      name: "null-usage-budget-blocked",
      contents: ["one"],
    });
    const blockedJob = await enqueue(blockedFixture);
    const blockedClaim = await claimEmbeddingJob("null-usage-blocked-worker");
    assert.equal(blockedClaim?.id, blockedJob?.id);
    const blockedProvider = new CountingProvider();
    await processEmbeddingJob({
      jobId: blockedJob!.id,
      workerId: "null-usage-blocked-worker",
      config,
      gateway: new EmbeddingGateway(config, blockedProvider),
    });
    assert.equal(blockedProvider.calls, 0);
  });

  it("drains an active Provider request on shutdown and controls lease-renewal failures", async () => {
    const first = await createFixture({
      name: "shutdown-active",
      contents: ["Fictional shutdown active request"],
    });
    const second = await createFixture({
      name: "shutdown-not-claimed",
      contents: ["Fictional shutdown pending request"],
    });
    const firstJob = await enqueue(first);
    const secondJob = await enqueue(second);
    const controller = new AbortController();
    const shutdownProvider = new CountingProvider(1, true);
    const workerId = "shutdown-drain-worker";
    workerIds.push(workerId);
    const config = {
      ...getEmbeddingRuntimeConfig(),
      shutdownDrainMs: 100,
    };
    const running = runEmbeddingWorker({
      workerId,
      config,
      gateway: new EmbeddingGateway(config, shutdownProvider),
      signal: controller.signal,
    });
    for (let index = 0; index < 100 && shutdownProvider.calls === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(shutdownProvider.calls, 1);
    controller.abort(new Error("SIGTERM"));
    await running;
    const shutdownJobs = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(inArray(documentEmbeddingJob.id, [firstJob!.id, secondJob!.id]));
    assert.equal(
      shutdownJobs.filter(
        (item) =>
          item.status === "failed" &&
          item.failureCode === "PROVIDER_RESULT_UNKNOWN",
      ).length,
      1,
    );
    assert.equal(shutdownJobs.filter((item) => item.status === "pending").length, 1);
    await getDb()
      .update(documentEmbeddingJob)
      .set({ status: "cancelled", completedAt: sql`now()` })
      .where(eq(documentEmbeddingJob.status, "pending"));

    const leaseFixture = await createFixture({
      name: "lease-renewal-error",
      contents: ["Fictional lease renewal failure"],
    });
    const leaseJob = await enqueue(leaseFixture);
    const leaseProvider = new CountingProvider(1, true);
    const leaseWorkerId = "lease-renewal-error-worker";
    workerIds.push(leaseWorkerId);
    await runEmbeddingWorker({
      once: true,
      workerId: leaseWorkerId,
      config: { ...config, leaseSeconds: 5 },
      gateway: new EmbeddingGateway(config, leaseProvider),
      renewLease: async () => {
        throw new Error("synthetic database renewal failure");
      },
    });
    assert.equal(leaseProvider.calls, 1);
    const [leaseFailed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, leaseJob!.id));
    assert.equal(leaseFailed?.status, "failed");
    assert.equal(leaseFailed?.failureCode, "PROVIDER_RESULT_UNKNOWN");
  });

  it("finishes only the active Batch after shutdown and never starts a later Batch", async () => {
    const fixture = await createFixture({
      name: "shutdown-active-batch-only",
      contents: ["Fictional active batch", "Fictional batch that must not start"],
    });
    const job = await enqueue(fixture);
    const controller = new AbortController();
    const provider = new DelayedSuccessProvider();
    const workerId = "shutdown-active-batch-only-worker";
    workerIds.push(workerId);
    const config = {
      ...getEmbeddingRuntimeConfig(),
      batchSize: 1,
      shutdownDrainMs: 200,
    };
    const running = runEmbeddingWorker({
      workerId,
      config,
      gateway: new EmbeddingGateway(config, provider),
      signal: controller.signal,
    });
    for (let index = 0; index < 100 && provider.calls === 0; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(provider.calls, 1);
    controller.abort(new Error("SIGTERM"));
    await running;
    assert.equal(provider.calls, 1);
    const [stoppedJob] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(stoppedJob?.status, "pending");
    assert.equal(stoppedJob?.failureCode, "SHUTDOWN_ABORTED");
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentChunkEmbedding)
          .where(eq(documentChunkEmbedding.embeddingJobId, job!.id))
      ).length,
      1,
    );
  });
});
