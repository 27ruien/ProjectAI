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
  processEmbeddingJob,
  runEmbeddingWorker,
} from "../../lib/ai/embeddings";
import type {
  EmbeddingProvider,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
} from "../../lib/ai/embeddings";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  aiEmbeddingProfile,
  auditEvent,
  documentChunk,
  documentChunkEmbedding,
  documentEmbeddingBatch,
  documentEmbeddingJob,
  documentIngestionJob,
  documentSection,
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
const profileV2 = "qwen-text-embedding-cn-v2-test";

class PartialFailureProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  async embed(request: EmbeddingProviderRequest): Promise<EmbeddingProviderResult> {
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
    };
  }
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
    if (projectIds.length) {
      await getDb().delete(auditEvent).where(inArray(auditEvent.projectId, projectIds));
      await getDb()
        .delete(documentChunkEmbedding)
        .where(inArray(documentChunkEmbedding.projectId, projectIds));
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

  it("commits successful batches atomically and retries only missing chunks after a partial failure", async () => {
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
      gateway: new EmbeddingGateway(config, partialProvider, async () => undefined),
    });
    const [pending] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(pending?.status, "pending");
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
      firstAttemptBatches.filter((batch) => batch.status === "failed").length,
      1,
    );
    await getDb()
      .update(documentEmbeddingJob)
      .set({ availableAt: sql`now()` })
      .where(eq(documentEmbeddingJob.id, job!.id));
    const secondClaim = await claimEmbeddingJob("partial-worker-b");
    assert.equal(secondClaim?.id, job?.id);
    await processEmbeddingJob({
      jobId: job!.id,
      workerId: "partial-worker-b",
      config,
      gateway: new EmbeddingGateway(
        config,
        new FakeEmbeddingProvider(),
        async () => undefined,
      ),
    });
    const [completed] = await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.id, job!.id));
    assert.equal(completed?.status, "succeeded");
    assert.equal(completed?.providerCallCount, 2);
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentChunkEmbedding)
          .where(eq(documentChunkEmbedding.embeddingJobId, job!.id))
      ).length,
      12,
    );
    const finalBatches = await getDb()
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.jobId, job!.id));
    assert.equal(
      finalBatches.filter((batch) => batch.status === "succeeded").length,
      2,
    );
  });

  it("enforces cross-project scope, content hash validity, vector dimensions, and Profile version immutability", async () => {
    const fixtureA = await createFixture({ name: "scope-a", contents: ["Scope A content"] });
    const fixtureB = await createFixture({ name: "scope-b", contents: ["Scope B content"] });
    const jobA = await enqueue(fixtureA);
    await runEmbeddingWorker({ once: true, workerId: "scope-a-worker" });
    assert.ok(jobA);

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
      gateway: new EmbeddingGateway(config, new FakeEmbeddingProvider(), async () => undefined),
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
    const otherProject = await createFixture({ name: "probe-other", contents: ["Exact probe beta"] });

    const candidates = await listEmbeddingBackfillCandidates({
      projectId: eligible.projectId,
      limit: 100,
    });
    assert.deepEqual(candidates.map((candidate) => candidate.versionId), [eligible.versionId]);
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
});
