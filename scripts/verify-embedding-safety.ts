import { inArray, sql } from "drizzle-orm";
import {
  claimEmbeddingJob,
  commitEmbeddingBatch,
  completeEmbeddingJob,
  createEmbeddingGateway,
  EMBEDDING_BUDGET_RULE_VERSION,
  EmbeddingGateway,
  embeddingBatchReservedInputTokens,
  EmbeddingPipelineError,
  EmbeddingProviderError,
  ensureEmbeddingJob,
  getEmbeddingRuntimeConfig,
  prepareEmbeddingJob,
  reconcileStaleEmbeddingCalls,
  markEmbeddingProviderCallDispatched,
  recordEmbeddingFailure,
  reserveEmbeddingBatch,
  retryUnknownEmbeddingJob,
  type EmbeddingProvider,
  type EmbeddingProviderRequest,
  type EmbeddingProviderResult,
} from "../lib/ai/embeddings";
import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  auditEvent,
  documentChunk,
  documentChunkEmbedding,
  documentEmbeddingBatch,
  documentEmbeddingJob,
  documentEmbeddingProviderCall,
  documentIngestionJob,
  documentSection,
  projectDocument,
  projectDocumentVersion,
} from "../lib/db/schema";

const runId = process.env.EMBEDDING_SMOKE_RUN_ID?.trim() || "";
if (!/^[0-9a-f-]{36}$/i.test(runId)) {
  throw new Error("Embedding safety Run ID is invalid.");
}
const modes = [
  "--crash-window",
  "--shutdown",
  "--budget",
  "--cost-consistency",
].filter((mode) => process.argv.includes(mode));
if (modes.length !== 1) throw new Error("Select one Embedding safety mode.");
const mode = modes[0]!;
const displayPrefix = `B3-B1 虚构 Embedding 安全验收 ${runId}`;

type Fixture = {
  projectId: string;
  documentId: string;
  versionId: string;
  chunks: Array<{
    id: string;
    content: string;
    contentSha256: string;
    chunkIndex: number;
    estimatedTokenCount: number;
  }>;
  jobId: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createFixture(label: string, contents: string[]): Promise<Fixture> {
  const scope = await getDb().execute<{ project_id: string; user_id: string }>(sql`
    select p.id as project_id, pm.user_id
    from projects p
    inner join project_members pm
      on pm.project_id = p.id and pm.role = 'project_manager'
    where p.status <> 'cancelled'
    order by p.id, pm.created_at, pm.user_id
    limit 1
  `);
  const owner = scope.rows[0];
  assert(owner, "A controlled Staging project manager is required.");
  const documentId = `embedding-safety-document-${crypto.randomUUID()}`;
  const versionId = `embedding-safety-version-${crypto.randomUUID()}`;
  const ingestionJobId = `embedding-safety-ingestion-${crypto.randomUUID()}`;
  const sectionId = `embedding-safety-section-${crypto.randomUUID()}`;
  const now = new Date();
  const chunks: Fixture["chunks"] = [];
  await getDb().transaction(async (tx) => {
    await tx.insert(projectDocument).values({
      id: documentId,
      projectId: owner.project_id,
      displayName: `${displayPrefix} ${label}`,
      status: "active",
      createdBy: owner.user_id,
    });
    await tx.insert(projectDocumentVersion).values({
      id: versionId,
      documentId,
      projectId: owner.project_id,
      versionNumber: 1,
      isCurrent: true,
      uploadId: crypto.randomUUID(),
      objectKey: `projects/${owner.project_id}/documents/${documentId}/versions/${versionId}/source`,
      originalFilename: `${label}.txt`,
      normalizedExtension: "txt",
      declaredMimeType: "text/plain",
      detectedMimeType: "text/plain",
      sizeBytes: Math.max(1, contents.join("\n").length),
      sha256: "a".repeat(64),
      storageEtag: `safety-${crypto.randomUUID()}`,
      storageStatus: "stored",
      uploadedBy: owner.user_id,
      storedAt: now,
    });
    await tx.insert(documentIngestionJob).values({
      id: ingestionJobId,
      projectId: owner.project_id,
      documentId,
      versionId,
      generation: 1,
      status: "succeeded",
      parserVersion: "1",
      chunkerVersion: "1",
      createdBy: owner.user_id,
      completedAt: now,
    });
    await tx.insert(documentSection).values({
      id: sectionId,
      projectId: owner.project_id,
      documentId,
      versionId,
      ingestionJobId,
      generation: 1,
      sectionType: "text",
      sectionIndex: 0,
      headingPath: [],
      sourceLocator: { type: "text_lines", lineStart: 1, lineEnd: contents.length },
      content: contents.join("\n"),
      contentSha256: "b".repeat(64),
      characterCount: contents.join("\n").length,
      parserVersion: "1",
    });
    await tx.insert(documentChunk).values(
      contents.map((content, chunkIndex) => {
        const contentSha256 = Buffer.from(`${label}:${chunkIndex}:${content}`)
          .toString("hex")
          .padEnd(64, "0")
          .slice(0, 64);
        const chunk = {
          id: `embedding-safety-chunk-${crypto.randomUUID()}`,
          content,
          contentSha256,
          chunkIndex,
          estimatedTokenCount: Math.max(1, content.trim().split(/\s+/u).length),
        };
        chunks.push(chunk);
        return {
          ...chunk,
          projectId: owner.project_id,
          documentId,
          versionId,
          sectionId,
          ingestionJobId,
          generation: 1,
          searchText: content,
          characterCount: content.length,
          headingPath: [],
          sourceLocator: {
            type: "text_lines",
            lineStart: chunkIndex + 1,
            lineEnd: chunkIndex + 1,
          },
          parserVersion: "1",
          chunkerVersion: "1",
          isEffective: true,
        };
      }),
    );
  });
  const job = await ensureEmbeddingJob({
    projectId: owner.project_id,
    documentId,
    versionId,
    createdBy: owner.user_id,
    reason: "backfill",
  });
  assert(job, "Embedding safety fixture did not create a Job.");
  return {
    projectId: owner.project_id,
    documentId,
    versionId,
    chunks,
    jobId: job.id,
  };
}

async function cleanup(): Promise<void> {
  const documents = await getDb()
    .select({ id: projectDocument.id })
    .from(projectDocument)
    .where(sql`${projectDocument.displayName} like ${`${displayPrefix}%`}`);
  const documentIds = documents.map((item) => item.id);
  if (!documentIds.length) return;
  const jobs = await getDb()
    .select({ id: documentEmbeddingJob.id })
    .from(documentEmbeddingJob)
    .where(inArray(documentEmbeddingJob.documentId, documentIds));
  const entityIds = [...documentIds, ...jobs.map((item) => item.id)];
  await getDb().transaction(async (tx) => {
    await tx.delete(auditEvent).where(inArray(auditEvent.entityId, entityIds));
    await tx
      .delete(documentChunkEmbedding)
      .where(inArray(documentChunkEmbedding.documentId, documentIds));
    await tx
      .delete(documentEmbeddingProviderCall)
      .where(inArray(documentEmbeddingProviderCall.documentId, documentIds));
    await tx
      .delete(documentEmbeddingBatch)
      .where(inArray(documentEmbeddingBatch.documentId, documentIds));
    await tx
      .delete(documentEmbeddingJob)
      .where(inArray(documentEmbeddingJob.documentId, documentIds));
    await tx.delete(documentChunk).where(inArray(documentChunk.documentId, documentIds));
    await tx
      .delete(documentSection)
      .where(inArray(documentSection.documentId, documentIds));
    await tx
      .delete(documentIngestionJob)
      .where(inArray(documentIngestionJob.documentId, documentIds));
    await tx
      .delete(projectDocumentVersion)
      .where(inArray(projectDocumentVersion.documentId, documentIds));
    await tx.delete(projectDocument).where(inArray(projectDocument.id, documentIds));
  });
}

async function claimedFixture(fixture: Fixture, workerId: string) {
  const claimed = await claimEmbeddingJob(workerId);
  assert(claimed?.id === fixture.jobId, "Embedding safety claimed an unexpected Job.");
  const prepared = await prepareEmbeddingJob({ jobId: fixture.jobId, workerId });
  assert(prepared?.chunks.length, "Embedding safety fixture has no eligible Chunk.");
  return prepared;
}

async function currentDailyTokenBudget(): Promise<number> {
  const usage = await getDb().execute<{ used: number | string }>(sql`
    select coalesce(sum(case
      when status = 'succeeded' then coalesce(input_token_count, reserved_input_tokens)
      when status in ('reserved', 'calling', 'unknown') then reserved_input_tokens
      else 0 end), 0) as used
    from document_embedding_provider_calls
    where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
      and created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day'
  `);
  return Number(usage.rows[0]?.used ?? 0);
}

type InjectedProviderOutcome = "timeout" | "network" | "invalid_response" | "success";

class InjectedEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  constructor(
    private readonly outcome: InjectedProviderOutcome,
    private readonly actualInputTokens = 17,
  ) {}

  async embed(
    request: EmbeddingProviderRequest,
  ): Promise<EmbeddingProviderResult> {
    await request.onRequestStarted?.();
    this.calls += 1;
    if (this.outcome === "timeout") {
      throw new EmbeddingProviderError("TIMEOUT", true, "post_dispatch");
    }
    if (this.outcome === "network") {
      throw new EmbeddingProviderError("NETWORK", true, "post_dispatch");
    }
    const vectorLength =
      this.outcome === "invalid_response"
        ? request.dimensions - 1
        : request.dimensions;
    return {
      vectors: request.inputs.map(() => Array(vectorLength).fill(0.01)),
      actualModel: request.model,
      inputTokens: this.actualInputTokens,
      totalTokens: this.actualInputTokens,
      providerRequestId: null,
      latencyMs: 0,
      dispatchClassification: "successful_response",
    };
  }
}

async function injectUnknownProviderResult(
  label: string,
  outcome: Exclude<InjectedProviderOutcome, "success">,
): Promise<{
  fixture: Fixture;
  provider: InjectedEmbeddingProvider;
  reservedInputTokens: number;
}> {
  const fixture = await createFixture(label, [
    `Project AI fictional ${label} cost consistency verification.`,
  ]);
  const workerId = `embedding-${outcome}-${crypto.randomUUID()}`;
  const config = getEmbeddingRuntimeConfig();
  const prepared = await claimedFixture(fixture, workerId);
  const reservation = await reserveEmbeddingBatch({
    jobId: fixture.jobId,
    workerId,
    batchIndex: 0,
    chunks: prepared.chunks,
    config,
  });
  assert(reservation.action === "call", `${label} Batch was not callable.`);
  const provider = new InjectedEmbeddingProvider(outcome);
  let thrown: unknown;
  try {
    await new EmbeddingGateway(config, provider).embed(
      prepared.chunks.map((chunk) => chunk.content),
      {
        onProviderRequestStarted: () =>
          markEmbeddingProviderCallDispatched({
            jobId: fixture.jobId,
            workerId,
            batchId: reservation.batchId,
            providerCallId: reservation.providerCallId,
          }),
      },
    );
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown instanceof EmbeddingPipelineError &&
      thrown.code === "PROVIDER_RESULT_UNKNOWN" &&
      !thrown.retryable,
    `${label} did not fail as a non-retryable unknown result.`,
  );
  await recordEmbeddingFailure({
    jobId: fixture.jobId,
    workerId,
    batchId: reservation.batchId,
    providerCallId: reservation.providerCallId,
    chunks: prepared.chunks,
    error: thrown,
    latencyMs: 0,
  });
  const terminal = await getDb().execute<{
    job_status: string;
    job_failure: string | null;
    batch_status: string;
    call_status: string;
    call_failure: string | null;
    reserved_input_tokens: number;
  }>(sql`
    select j.status as job_status, j.failure_code as job_failure,
      b.status as batch_status, c.status as call_status,
      c.failure_code as call_failure,
      c.reserved_input_tokens
    from document_embedding_jobs j
    inner join document_embedding_batches b on b.job_id = j.id
    inner join document_embedding_provider_calls c on c.batch_id = b.id
    where j.id = ${fixture.jobId}
  `);
  const row = terminal.rows[0];
  assert(
    row?.job_status === "failed" &&
      row.job_failure === "PROVIDER_RESULT_UNKNOWN" &&
      row.batch_status === "unknown" &&
      row.call_status === "unknown" &&
      row.call_failure === "PROVIDER_RESULT_UNKNOWN" &&
      row.reserved_input_tokens === reservation.reservedInputTokens &&
      provider.calls === 1,
    `${label} did not preserve one immutable unknown Call and its Reservation.`,
  );
  return {
    fixture,
    provider,
    reservedInputTokens: reservation.reservedInputTokens,
  };
}

async function crashWindow(): Promise<Record<string, unknown>> {
  const fixture = await createFixture("Crash-Window", [
    "Project AI fictional crash window verification for a durable embedding call.",
  ]);
  const workerId = `embedding-crash-${crypto.randomUUID()}`;
  const config = getEmbeddingRuntimeConfig();
  const prepared = await claimedFixture(fixture, workerId);
  const reservation = await reserveEmbeddingBatch({
    jobId: fixture.jobId,
    workerId,
    batchIndex: 0,
    chunks: prepared.chunks,
    config,
  });
  assert(reservation.action === "call", "Crash window Batch was not callable.");
  await createEmbeddingGateway(config).embed(
    prepared.chunks.map((chunk) => chunk.content),
    {
      onProviderRequestStarted: () =>
        markEmbeddingProviderCallDispatched({
          jobId: fixture.jobId,
          workerId,
          batchId: reservation.batchId,
          providerCallId: reservation.providerCallId,
        }),
    },
  );
  await getDb().execute(sql`
    update document_embedding_batches
    set lease_expires_at = now() - interval '1 second', updated_at = now()
    where id = ${reservation.batchId}
  `);
  await getDb().execute(sql`
    update document_embedding_provider_calls
    set lease_expires_at = now() - interval '1 second', updated_at = now()
    where id = ${reservation.providerCallId}
  `);
  await getDb().execute(sql`
    update document_embedding_jobs
    set started_at = now() - interval '10 seconds',
        lease_expires_at = now() - interval '1 second', updated_at = now()
    where id = ${fixture.jobId}
  `);
  assert((await reconcileStaleEmbeddingCalls()) === 1, "Crash window was not reconciled.");
  const state = await getDb().execute<{
    job_status: string;
    job_failure: string | null;
    batch_status: string;
    provider_calls: number;
    vectors: number;
  }>(sql`
    select j.status as job_status, j.failure_code as job_failure,
      b.status as batch_status, j.provider_call_count as provider_calls,
      (select count(*)::int from document_chunk_embeddings e
        where e.embedding_job_id = j.id) as vectors
    from document_embedding_jobs j
    inner join document_embedding_batches b on b.job_id = j.id
    where j.id = ${fixture.jobId}
  `);
  const row = state.rows[0];
  assert(
    row?.job_status === "failed" &&
      row.job_failure === "PROVIDER_RESULT_UNKNOWN" &&
      row.batch_status === "unknown" &&
      row.provider_calls === 1 &&
      row.vectors === 0,
    "Crash window did not fail closed without a duplicate vector.",
  );
  const dryRun = await retryUnknownEmbeddingJob({
    jobId: fixture.jobId,
    acceptPossibleDuplicateCharge: true,
  });
  assert(dryRun.dryRun && !dryRun.requeued, "Unknown recovery was not dry-run safe.");
  return {
    crashWindowUnknown: true,
    providerCallCount: row.provider_calls,
    vectorsWritten: row.vectors,
    ordinaryRetryBlocked: true,
  };
}

async function shutdown(): Promise<Record<string, unknown>> {
  const fixture = await createFixture("Shutdown", [
    "Project AI fictional SIGTERM drain verification for an active embedding request.",
  ]);
  const workerId = `embedding-shutdown-${crypto.randomUUID()}`;
  const config = getEmbeddingRuntimeConfig();
  const prepared = await claimedFixture(fixture, workerId);
  const reservation = await reserveEmbeddingBatch({
    jobId: fixture.jobId,
    workerId,
    batchIndex: 0,
    chunks: prepared.chunks,
    config,
  });
  assert(reservation.action === "call", "Shutdown Batch was not callable.");
  const controller = new AbortController();
  let signalReceived = false;
  const receiveSignal = () => {
    signalReceived = true;
    controller.abort(new Error("SIGTERM"));
  };
  process.once("SIGTERM", receiveSignal);
  const started = performance.now();
  try {
    try {
      const result = await createEmbeddingGateway(config).embed(
        prepared.chunks.map((chunk) => chunk.content),
        {
          signal: controller.signal,
          onProviderRequestStarted: async () => {
            await markEmbeddingProviderCallDispatched({
              jobId: fixture.jobId,
              workerId,
              batchId: reservation.batchId,
              providerCallId: reservation.providerCallId,
            });
            setImmediate(() => process.kill(process.pid, "SIGTERM"));
          },
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      await commitEmbeddingBatch({
        jobId: fixture.jobId,
        workerId,
        batchId: reservation.batchId,
        providerCallId: reservation.providerCallId,
        batchIndex: 0,
        chunks: prepared.chunks,
        result,
      });
      await completeEmbeddingJob({ jobId: fixture.jobId, workerId });
    } catch (error) {
      await recordEmbeddingFailure({
        jobId: fixture.jobId,
        workerId,
        batchId: reservation.batchId,
        providerCallId: reservation.providerCallId,
        chunks: prepared.chunks,
        error,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
      });
    }
  } finally {
    process.removeListener("SIGTERM", receiveSignal);
  }
  const terminal = await getDb().execute<{
    status: string;
    failure_code: string | null;
    batch_status: string;
  }>(sql`
    select j.status, j.failure_code, b.status as batch_status
    from document_embedding_jobs j
    inner join document_embedding_batches b on b.job_id = j.id
    where j.id = ${fixture.jobId}
  `);
  const row = terminal.rows[0];
  assert(signalReceived, "The SIGTERM fault injection was not delivered.");
  assert(
    (row?.status === "succeeded" && row.batch_status === "succeeded") ||
      (row?.status === "failed" &&
        row.failure_code === "PROVIDER_RESULT_UNKNOWN" &&
        row.batch_status === "unknown"),
    "SIGTERM did not produce a safe terminal Embedding state.",
  );
  const elapsedMs = Math.round(performance.now() - started);
  assert(elapsedMs < config.shutdownDrainMs, "SIGTERM exceeded the configured drain.");
  return {
    sigtermDelivered: true,
    terminalState: row.status,
    elapsedWithinDrain: true,
  };
}

async function budget(): Promise<Record<string, unknown>> {
  const text = "one two three four five six seven eight";
  const first = await createFixture("Budget-A", [text]);
  const second = await createFixture("Budget-B", [text]);
  const config = getEmbeddingRuntimeConfig();
  const preparedA = await claimedFixture(first, `budget-a-${crypto.randomUUID()}`);
  const workerA = (await getDb()
    .select({ leasedBy: documentEmbeddingJob.leasedBy })
    .from(documentEmbeddingJob)
    .where(sql`${documentEmbeddingJob.id} = ${first.jobId}`))[0]!.leasedBy!;
  const preparedB = await claimedFixture(second, `budget-b-${crypto.randomUUID()}`);
  const workerB = (await getDb()
    .select({ leasedBy: documentEmbeddingJob.leasedBy })
    .from(documentEmbeddingJob)
    .where(sql`${documentEmbeddingJob.id} = ${second.jobId}`))[0]!.leasedBy!;
  const reservationTokens = embeddingBatchReservedInputTokens(preparedA.chunks);
  const usage = await getDb().execute<{ used: number }>(sql`
    select coalesce(sum(case
      when status = 'succeeded' then coalesce(input_token_count, reserved_input_tokens)
      when status in ('reserved', 'calling', 'unknown') then reserved_input_tokens
      else 0 end), 0)::int as used
    from document_embedding_provider_calls
    where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
      and created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day'
  `);
  const limited = {
    ...config,
    dailyTokenLimit: Number(usage.rows[0]?.used ?? 0) + reservationTokens,
  };
  const concurrent = await Promise.allSettled([
    reserveEmbeddingBatch({
      jobId: first.jobId,
      workerId: workerA,
      batchIndex: 0,
      chunks: preparedA.chunks,
      config: limited,
    }),
    reserveEmbeddingBatch({
      jobId: second.jobId,
      workerId: workerB,
      batchIndex: 0,
      chunks: preparedB.chunks,
      config: limited,
    }),
  ]);
  const accepted = concurrent.filter((item) => item.status === "fulfilled").length;
  const rejected = concurrent.filter(
    (item) =>
      item.status === "rejected" &&
      item.reason instanceof EmbeddingPipelineError &&
      item.reason.code === "DAILY_TOKEN_LIMIT_REACHED",
  ).length;
  assert(accepted === 1 && rejected === 1, "Concurrent Token budget was penetrated.");

  await cleanup();
  const usageFixture = await createFixture("Usage-Null", [text]);
  const blockedFixture = await createFixture("Usage-Null-Blocked", ["one"]);
  const usageWorker = `usage-null-${crypto.randomUUID()}`;
  const usagePrepared = await claimedFixture(usageFixture, usageWorker);
  const baseline = await getDb().execute<{ used: number }>(sql`
    select coalesce(sum(case
      when status = 'succeeded' then coalesce(input_token_count, reserved_input_tokens)
      when status in ('reserved', 'calling', 'unknown') then reserved_input_tokens
      else 0 end), 0)::int as used
    from document_embedding_provider_calls
    where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
      and created_at < date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 day'
  `);
  const nullReservation = embeddingBatchReservedInputTokens(usagePrepared.chunks);
  const nullLimit = {
    ...config,
    dailyTokenLimit: Number(baseline.rows[0]?.used ?? 0) + nullReservation,
  };
  const reservation = await reserveEmbeddingBatch({
    jobId: usageFixture.jobId,
    workerId: usageWorker,
    batchIndex: 0,
    chunks: usagePrepared.chunks,
    config: nullLimit,
  });
  assert(reservation.action === "call", "Usage-null Batch was not reserved.");
  await markEmbeddingProviderCallDispatched({
    jobId: usageFixture.jobId,
    workerId: usageWorker,
    batchId: reservation.batchId,
    providerCallId: reservation.providerCallId,
  });
  await commitEmbeddingBatch({
    jobId: usageFixture.jobId,
    workerId: usageWorker,
    batchId: reservation.batchId,
    providerCallId: reservation.providerCallId,
    batchIndex: 0,
    chunks: usagePrepared.chunks,
    result: {
      provider: "fake",
      requestedModel: config.model,
      actualModel: config.model,
      dimensions: 1024,
      vectors: usagePrepared.chunks.map(() => Array(1024).fill(0.01)),
      inputTokens: null,
      totalTokens: null,
      providerRequestId: null,
      latencyMs: 0,
      attemptCount: 1,
    },
  });
  await completeEmbeddingJob({ jobId: usageFixture.jobId, workerId: usageWorker });
  const blockedWorker = `usage-null-blocked-${crypto.randomUUID()}`;
  const blockedPrepared = await claimedFixture(blockedFixture, blockedWorker);
  await assertRejectsDailyLimit(
    reserveEmbeddingBatch({
      jobId: blockedFixture.jobId,
      workerId: blockedWorker,
      batchIndex: 0,
      chunks: blockedPrepared.chunks,
      config: nullLimit,
    }),
  );
  const [nullBatch] = await getDb()
    .select()
    .from(documentEmbeddingBatch)
    .where(sql`${documentEmbeddingBatch.jobId} = ${usageFixture.jobId}`);
  assert(
    nullBatch?.inputTokenCount === null &&
      nullBatch.reservedInputTokens === nullReservation,
    "Usage-null Reservation was released or copied into real Usage.",
  );
  return {
    concurrentReservationsAccepted: accepted,
    concurrentReservationsRejected: rejected,
    usageNullPreserved: true,
    usageNullReservationHeld: true,
    externalProviderCalls: 0,
  };
}

async function costConsistency(): Promise<Record<string, unknown>> {
  const config = getEmbeddingRuntimeConfig();
  const initialBudget = await currentDailyTokenBudget();
  const timeout = await injectUnknownProviderResult("Timeout", "timeout");
  const budgetAfterUnknown = await currentDailyTokenBudget();
  assert(
    budgetAfterUnknown === initialBudget + timeout.reservedInputTokens,
    "Timeout unknown did not hold its full conservative Reservation.",
  );

  const insufficientConfig = {
    ...config,
    dailyTokenLimit: budgetAfterUnknown,
  };
  const insufficientDryRun = await retryUnknownEmbeddingJob({
    jobId: timeout.fixture.jobId,
    acceptPossibleDuplicateCharge: true,
    config: insufficientConfig,
  });
  assert(
    !insufficientDryRun.canApply &&
      insufficientDryRun.unknownCallCount === 1 &&
      insufficientDryRun.oldReservedInputTokens === timeout.reservedInputTokens &&
      insufficientDryRun.newReservedInputTokens === timeout.reservedInputTokens,
    "Insufficient manual Retry dry-run did not include both Reservations.",
  );
  await assertRejectsDailyLimit(
    retryUnknownEmbeddingJob({
      jobId: timeout.fixture.jobId,
      acceptPossibleDuplicateCharge: true,
      apply: true,
      config: insufficientConfig,
    }),
  );
  const callsAfterRejectedRetry = await getDb().execute<{ count: number }>(sql`
    select count(*)::int as count
    from document_embedding_provider_calls
    where job_id = ${timeout.fixture.jobId}
  `);
  assert(
    callsAfterRejectedRetry.rows[0]?.count === 1 && timeout.provider.calls === 1,
    "Insufficient manual Retry created or dispatched a second Call.",
  );

  const applied = await retryUnknownEmbeddingJob({
    jobId: timeout.fixture.jobId,
    acceptPossibleDuplicateCharge: true,
    apply: true,
    config,
  });
  assert(
    applied.requeued &&
      applied.oldReservedInputTokens === timeout.reservedInputTokens &&
      applied.newReservedInputTokens === timeout.reservedInputTokens,
    "Manual Retry did not preserve the old unknown and reserve a new Call.",
  );
  const budgetAfterApply = await currentDailyTokenBudget();
  assert(
    budgetAfterApply === budgetAfterUnknown + timeout.reservedInputTokens,
    "Manual Retry did not account for old and new Reservations together.",
  );
  const manualWorkerId = `embedding-manual-${crypto.randomUUID()}`;
  const manualPrepared = await claimedFixture(timeout.fixture, manualWorkerId);
  const manualReservation = await reserveEmbeddingBatch({
    jobId: timeout.fixture.jobId,
    workerId: manualWorkerId,
    batchIndex: 0,
    chunks: manualPrepared.chunks,
    config,
  });
  assert(manualReservation.action === "call", "Manual Retry Batch was not callable.");
  const successfulProvider = new InjectedEmbeddingProvider("success");
  const result = await new EmbeddingGateway(config, successfulProvider).embed(
    manualPrepared.chunks.map((chunk) => chunk.content),
    {
      onProviderRequestStarted: () =>
        markEmbeddingProviderCallDispatched({
          jobId: timeout.fixture.jobId,
          workerId: manualWorkerId,
          batchId: manualReservation.batchId,
          providerCallId: manualReservation.providerCallId,
        }),
    },
  );
  await commitEmbeddingBatch({
    jobId: timeout.fixture.jobId,
    workerId: manualWorkerId,
    batchId: manualReservation.batchId,
    providerCallId: manualReservation.providerCallId,
    batchIndex: 0,
    chunks: manualPrepared.chunks,
    result,
  });
  await completeEmbeddingJob({
    jobId: timeout.fixture.jobId,
    workerId: manualWorkerId,
  });
  const recovered = await getDb().execute<{
    provider_call_count: number;
    statuses: string[];
    budget_rules: string[];
  }>(sql`
    select j.provider_call_count,
      array_agg(c.status::text order by c.call_sequence) as statuses,
      array_agg(c.budget_rule_version order by c.call_sequence) as budget_rules
    from document_embedding_jobs j
    inner join document_embedding_provider_calls c on c.job_id = j.id
    where j.id = ${timeout.fixture.jobId}
    group by j.provider_call_count
  `);
  const recoveredRow = recovered.rows[0];
  assert(
    recoveredRow?.provider_call_count === 2 &&
      recoveredRow.statuses.join(",") === "unknown,succeeded" &&
      recoveredRow.budget_rules.every(
        (rule) => rule === EMBEDDING_BUDGET_RULE_VERSION,
      ) &&
      timeout.provider.calls + successfulProvider.calls === 2,
    "Manual Retry overwrote the old unknown or miscounted Provider Calls.",
  );
  const budgetAfterSuccess = await currentDailyTokenBudget();
  assert(
    budgetAfterSuccess === budgetAfterUnknown + 17,
    "Successful manual Retry did not reconcile only the new Call to actual Usage.",
  );

  const network = await injectUnknownProviderResult("Network", "network");
  const invalidResponse = await injectUnknownProviderResult(
    "Invalid-200",
    "invalid_response",
  );
  assert(
    network.provider.calls === 1 && invalidResponse.provider.calls === 1,
    "Post-dispatch fault injection performed an automatic second Call.",
  );

  return {
    timeoutUnknown: true,
    networkUnknown: true,
    invalidSuccessfulResponseUnknown: true,
    postDispatchAutomaticRetries: 0,
    immutableCallHistory: ["unknown", "succeeded"],
    manualRetryProviderCalls: 2,
    manualRetryOldReservation: timeout.reservedInputTokens,
    manualRetryNewReservation: timeout.reservedInputTokens,
    manualRetryActualUsage: 17,
    insufficientRetryRejectedBeforeDispatch: true,
    budgetRuleVersion: EMBEDDING_BUDGET_RULE_VERSION,
  };
}

async function assertRejectsDailyLimit(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (
      error instanceof EmbeddingPipelineError &&
      error.code === "DAILY_TOKEN_LIMIT_REACHED"
    ) {
      return;
    }
    throw error;
  }
  throw new Error("Expected DAILY_TOKEN_LIMIT_REACHED.");
}

let failure: unknown;
try {
  await cleanup();
  const result =
    mode === "--crash-window"
      ? await crashWindow()
      : mode === "--shutdown"
        ? await shutdown()
        : mode === "--budget"
          ? await budget()
          : await costConsistency();
  process.stdout.write(`${JSON.stringify({ verified: true, mode, ...result })}\n`);
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  await closeDatabasePool();
}

if (failure) throw failure;
