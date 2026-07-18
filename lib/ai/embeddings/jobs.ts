import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  aiEmbeddingProfile,
  documentChunkEmbedding,
  documentEmbeddingBatch,
  documentEmbeddingJob,
  documentEmbeddingProviderCall,
  embeddingWorkerHeartbeat,
  type DocumentEmbeddingJobRecord,
} from "@/lib/db/schema";
import {
  EMBEDDING_BUDGET_RULE_VERSION,
  EMBEDDING_DISTANCE_METRIC,
  EMBEDDING_MODEL,
  EMBEDDING_PROFILE_VERSION,
  EMBEDDING_PROVIDER,
  EMBEDDING_REGION,
  TEXT_EMBEDDING_V4_MAX_TOKENS_PER_ITEM,
  TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST,
  type EmbeddingRuntimeConfig,
  getEmbeddingRuntimeConfig,
} from "./config";
import {
  EmbeddingPipelineError,
  controlledEmbeddingError,
  type EmbeddingFailureCode,
} from "./errors";
import type { EmbeddingGatewayResult } from "./gateway";

export type EligibleEmbeddingChunk = {
  id: string;
  content: string;
  contentSha256: string;
  chunkIndex: number;
  estimatedTokenCount: number;
};

type EligibilityCountRow = {
  eligible_count: number | string;
  current_count: number | string;
};

function hasValidLease(
  job: DocumentEmbeddingJobRecord | null,
  workerId: string,
): job is DocumentEmbeddingJobRecord {
  return Boolean(
    job &&
      job.status === "running" &&
      job.leasedBy === workerId &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > new Date(),
  );
}

export async function findEmbeddingJob(
  jobId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<DocumentEmbeddingJobRecord | null> {
  const query = db
    .select()
    .from(documentEmbeddingJob)
    .where(eq(documentEmbeddingJob.id, jobId))
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: documentEmbeddingJob })
    : await query;
  return record ?? null;
}

async function assertEmbeddingProfile(
  profileId: string,
  db: DatabaseExecutor,
): Promise<void> {
  const [profile] = await db
    .select()
    .from(aiEmbeddingProfile)
    .where(eq(aiEmbeddingProfile.id, profileId))
    .limit(1);
  if (
    !profile ||
    !profile.enabled ||
    profile.provider !== EMBEDDING_PROVIDER ||
    profile.model !== EMBEDDING_MODEL ||
    profile.region !== EMBEDDING_REGION ||
    profile.dimensions !== 1024 ||
    profile.distanceMetric !== EMBEDDING_DISTANCE_METRIC ||
    profile.profileVersion !== EMBEDDING_PROFILE_VERSION
  ) {
    throw new EmbeddingPipelineError("CONFIGURATION_INVALID", false);
  }
}

async function embeddingEligibilityCounts(
  input: {
    projectId: string;
    documentId: string;
    versionId: string;
    profileId: string;
  },
  db: DatabaseExecutor,
): Promise<{ eligible: number; current: number }> {
  const result = await db.execute<EligibilityCountRow>(sql`
    select
      count(*) as eligible_count,
      count(e.id) filter (
        where e.status = 'current' and e.content_sha256 = c.content_sha256
      ) as current_count
    from document_chunks c
    inner join document_ingestion_jobs i
      on i.id = c.ingestion_job_id
      and i.project_id = c.project_id
      and i.document_id = c.document_id
      and i.version_id = c.version_id
      and i.generation = c.generation
    inner join project_document_versions v
      on v.id = c.version_id
      and v.document_id = c.document_id
      and v.project_id = c.project_id
    inner join project_documents d
      on d.id = c.document_id
      and d.project_id = c.project_id
    inner join projects p on p.id = c.project_id
    left join document_chunk_embeddings e
      on e.chunk_id = c.id
      and e.project_id = c.project_id
      and e.document_id = c.document_id
      and e.version_id = c.version_id
      and e.embedding_profile_id = ${input.profileId}
    where c.project_id = ${input.projectId}
      and c.document_id = ${input.documentId}
      and c.version_id = ${input.versionId}
      and p.status <> 'cancelled'
      and d.document_status = 'active'
      and v.is_current = true
      and v.storage_status = 'stored'
      and i.status = 'succeeded'
      and c.is_effective = true
      and length(btrim(c.content)) > 0
  `);
  const row = result.rows[0];
  return {
    eligible: Number(row?.eligible_count ?? 0),
    current: Number(row?.current_count ?? 0),
  };
}

export async function ensureEmbeddingJob(input: {
  projectId: string;
  documentId: string;
  versionId: string;
  createdBy: string;
  reason: "ingestion_succeeded" | "current_version" | "restored" | "backfill" | "profile_upgrade";
  db?: DatabaseExecutor;
  config?: EmbeddingRuntimeConfig;
}): Promise<DocumentEmbeddingJobRecord | null> {
  const config = input.config ?? getEmbeddingRuntimeConfig();
  if (!config.enabled) return null;
  if (!input.db) {
    return getDb().transaction((tx) =>
      ensureEmbeddingJob({ ...input, db: tx, config }),
    );
  }
  const db = input.db;
  await assertEmbeddingProfile(config.profileId, db);
  const scope = [input.projectId, input.documentId, input.versionId, config.profileId].join(":");
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`embedding:${scope}`}, 0))`,
  );
  const counts = await embeddingEligibilityCounts(
    { ...input, profileId: config.profileId },
    db,
  );
  if (!counts.eligible || counts.current === counts.eligible) return null;

  const [existing] = await db
    .select()
    .from(documentEmbeddingJob)
    .where(
      and(
        eq(documentEmbeddingJob.projectId, input.projectId),
        eq(documentEmbeddingJob.documentId, input.documentId),
        eq(documentEmbeddingJob.versionId, input.versionId),
        eq(documentEmbeddingJob.embeddingProfileId, config.profileId),
        inArray(documentEmbeddingJob.status, ["pending", "running"]),
      ),
    )
    .orderBy(desc(documentEmbeddingJob.generation))
    .limit(1);
  if (existing) return existing;

  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('embedding-daily-job-limit', 0))`,
  );
  const daily = await db.execute<{ job_count: number | string }>(sql`
    select count(*) as job_count
    from document_embedding_jobs
    where created_at >= now() - interval '1 day'
  `);
  if (Number(daily.rows[0]?.job_count ?? 0) >= config.dailyJobLimit) {
    throw new EmbeddingPipelineError("DAILY_JOB_LIMIT_REACHED", false);
  }

  const [generationRow] = await db
    .select({
      generation: sql<number>`coalesce(max(${documentEmbeddingJob.generation}), 0)`,
    })
    .from(documentEmbeddingJob)
    .where(
      and(
        eq(documentEmbeddingJob.versionId, input.versionId),
        eq(documentEmbeddingJob.embeddingProfileId, config.profileId),
      ),
    );
  const generation = Number(generationRow?.generation ?? 0) + 1;
  const [created] = await db
    .insert(documentEmbeddingJob)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: input.versionId,
      embeddingProfileId: config.profileId,
      generation,
      maxAttempts: config.maxAttempts,
      chunkCount: counts.eligible,
      completedChunkCount: counts.current,
      createdBy: input.createdBy,
    })
    .returning();
  await writeAuditEvent(
    {
      actorUserId: input.createdBy,
      projectId: input.projectId,
      eventType: "document_embedding_created",
      entityType: "document_embedding_job",
      entityId: created.id,
      result: "succeeded",
      metadata: {
        documentId: input.documentId,
        versionId: input.versionId,
        embeddingProfileId: config.profileId,
        generation,
        chunkCount: counts.eligible,
        existingEmbeddingCount: counts.current,
        reason: input.reason,
      },
    },
    db,
  );
  return created;
}

export async function failExhaustedEmbeddingJobs(): Promise<number> {
  await reconcileStaleEmbeddingCalls();
  const db = getDb();
  const exhausted = await db.execute<{
    id: string;
    project_id: string;
    document_id: string;
    version_id: string;
    embedding_profile_id: string;
    created_by: string;
    generation: number;
    attempt_count: number;
  }>(sql`
    update document_embedding_jobs
    set
      status = 'failed',
      failure_code = 'WORKER_MAX_ATTEMPTS_REACHED',
      failure_message = 'Maximum attempts reached.',
      completed_at = now(),
      leased_by = null,
      lease_expires_at = null,
      heartbeat_at = null,
      updated_at = now()
    where status = 'running'
      and lease_expires_at <= now()
      and attempt_count >= max_attempts
    returning id, project_id, document_id, version_id, embedding_profile_id,
      created_by, generation, attempt_count
  `);
  for (const row of exhausted.rows) {
    await writeAuditEvent(
      {
        actorUserId: row.created_by,
        projectId: row.project_id,
        eventType: "document_embedding_failed",
        entityType: "document_embedding_job",
        entityId: row.id,
        result: "failed",
        metadata: {
          documentId: row.document_id,
          versionId: row.version_id,
          embeddingProfileId: row.embedding_profile_id,
          generation: row.generation,
          attemptCount: row.attempt_count,
          failureCode: "WORKER_MAX_ATTEMPTS_REACHED",
        },
      },
      db,
    );
  }
  return exhausted.rows.length;
}

export async function claimEmbeddingJob(
  workerId: string,
  config: EmbeddingRuntimeConfig = getEmbeddingRuntimeConfig(),
): Promise<DocumentEmbeddingJobRecord | null> {
  if (!config.enabled) return null;
  await failExhaustedEmbeddingJobs();
  return getDb().transaction(async (tx) => {
    const candidate = await tx.execute<{ id: string }>(sql`
      select id
      from document_embedding_jobs
      where embedding_profile_id = ${config.profileId}
        and (
        (status = 'pending' and available_at <= now())
        or (
          status = 'running'
          and lease_expires_at <= now()
          and attempt_count < max_attempts
        )
        )
      order by available_at asc, created_at asc, id asc
      for update skip locked
      limit 1
    `);
    const jobId = candidate.rows[0]?.id;
    if (!jobId) return null;
    const [job] = await tx
      .update(documentEmbeddingJob)
      .set({
        status: "running",
        attemptCount: sql`${documentEmbeddingJob.attemptCount} + 1`,
        leasedBy: workerId,
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`coalesce(${documentEmbeddingJob.startedAt}, now())`,
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, jobId))
      .returning();
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_embedding_started",
        entityType: "document_embedding_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          embeddingProfileId: job.embeddingProfileId,
          generation: job.generation,
          attemptCount: job.attemptCount,
        },
      },
      tx,
    );
    return job;
  });
}

export async function renewEmbeddingLease(
  jobId: string,
  workerId: string,
  config: EmbeddingRuntimeConfig = getEmbeddingRuntimeConfig(),
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const renewed = await tx
      .update(documentEmbeddingJob)
      .set({
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(documentEmbeddingJob.id, jobId),
          eq(documentEmbeddingJob.status, "running"),
          eq(documentEmbeddingJob.leasedBy, workerId),
          sql`${documentEmbeddingJob.leaseExpiresAt} > now()`,
        ),
      )
      .returning({ id: documentEmbeddingJob.id });
    if (renewed.length !== 1) return false;
    const renewedBatches = await tx
      .update(documentEmbeddingBatch)
      .set({
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(documentEmbeddingBatch.jobId, jobId),
          eq(documentEmbeddingBatch.status, "calling"),
          eq(documentEmbeddingBatch.leasedBy, workerId),
          sql`${documentEmbeddingBatch.leaseExpiresAt} > now()`,
        ),
      )
      .returning({ id: documentEmbeddingBatch.id });
    const [activeBatch] = await tx
      .select({ id: documentEmbeddingBatch.id })
      .from(documentEmbeddingBatch)
      .where(
        and(
          eq(documentEmbeddingBatch.jobId, jobId),
          eq(documentEmbeddingBatch.status, "calling"),
        ),
      )
      .limit(1);
    if (activeBatch && renewedBatches.length !== 1) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const renewedCalls = await tx
      .update(documentEmbeddingProviderCall)
      .set({
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(documentEmbeddingProviderCall.jobId, jobId),
          inArray(documentEmbeddingProviderCall.status, ["reserved", "calling"]),
          eq(documentEmbeddingProviderCall.leasedBy, workerId),
          sql`${documentEmbeddingProviderCall.leaseExpiresAt} > now()`,
        ),
      )
      .returning({ id: documentEmbeddingProviderCall.id });
    if (activeBatch && renewedCalls.length !== 1) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    return true;
  });
}

export async function writeEmbeddingWorkerHeartbeat(input: {
  workerId: string;
  profileId: string;
  workerVersion: string;
  state: "running" | "draining";
}): Promise<void> {
  await getDb()
    .insert(embeddingWorkerHeartbeat)
    .values({
      workerId: input.workerId,
      embeddingProfileId: input.profileId,
      workerVersion: input.workerVersion,
      state: input.state,
    })
    .onConflictDoUpdate({
      target: embeddingWorkerHeartbeat.workerId,
      set: {
        embeddingProfileId: input.profileId,
        workerVersion: input.workerVersion,
        state: input.state,
        heartbeatAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

export async function prepareEmbeddingJob(input: {
  jobId: string;
  workerId: string;
}): Promise<{ job: DocumentEmbeddingJobRecord; chunks: EligibleEmbeddingChunk[] } | null> {
  return getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    await tx.execute(sql`
      update document_chunk_embeddings e
      set status = 'current', embedding_job_id = ${job.id}, updated_at = now()
      from document_chunks c
      inner join document_ingestion_jobs i
        on i.id = c.ingestion_job_id
        and i.project_id = c.project_id
        and i.document_id = c.document_id
        and i.version_id = c.version_id
        and i.generation = c.generation
      inner join project_document_versions v
        on v.id = c.version_id
        and v.document_id = c.document_id
        and v.project_id = c.project_id
      inner join project_documents d
        on d.id = c.document_id
        and d.project_id = c.project_id
      inner join projects p on p.id = c.project_id
      where e.chunk_id = c.id
        and e.project_id = c.project_id
        and e.document_id = c.document_id
        and e.version_id = c.version_id
        and e.content_sha256 = c.content_sha256
        and e.embedding_profile_id = ${job.embeddingProfileId}
        and e.status = 'invalid'
        and c.project_id = ${job.projectId}
        and c.document_id = ${job.documentId}
        and c.version_id = ${job.versionId}
        and p.status <> 'cancelled'
        and d.document_status = 'active'
        and v.is_current = true
        and v.storage_status = 'stored'
        and i.status = 'succeeded'
        and c.is_effective = true
        and length(btrim(c.content)) > 0
    `);
    const counts = await embeddingEligibilityCounts(
      {
        projectId: job.projectId,
        documentId: job.documentId,
        versionId: job.versionId,
        profileId: job.embeddingProfileId,
      },
      tx,
    );
    if (!counts.eligible) {
      await tx
        .update(documentEmbeddingJob)
        .set({
          status: "cancelled",
          chunkCount: 0,
          completedChunkCount: 0,
          completedAt: sql`now()`,
          leasedBy: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          failureCode: null,
          failureMessage: null,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingJob.id, job.id));
      await writeAuditEvent(
        {
          actorUserId: job.createdBy,
          projectId: job.projectId,
          eventType: "document_embedding_cancelled",
          entityType: "document_embedding_job",
          entityId: job.id,
          result: "succeeded",
          metadata: {
            documentId: job.documentId,
            versionId: job.versionId,
            embeddingProfileId: job.embeddingProfileId,
            reason: "no_eligible_chunks",
          },
        },
        tx,
      );
      return null;
    }
    const missing = await tx.execute<{
      id: string;
      content: string;
      content_sha256: string;
      chunk_index: number;
      estimated_token_count: number;
    }>(sql`
      select c.id, c.content, c.content_sha256, c.chunk_index,
        c.estimated_token_count
      from document_chunks c
      inner join document_ingestion_jobs i
        on i.id = c.ingestion_job_id
        and i.status = 'succeeded'
      inner join project_document_versions v
        on v.id = c.version_id
        and v.document_id = c.document_id
        and v.project_id = c.project_id
      inner join project_documents d
        on d.id = c.document_id
        and d.project_id = c.project_id
      inner join projects p on p.id = c.project_id
      left join document_chunk_embeddings e
        on e.chunk_id = c.id
        and e.project_id = c.project_id
        and e.document_id = c.document_id
        and e.version_id = c.version_id
        and e.embedding_profile_id = ${job.embeddingProfileId}
        and e.content_sha256 = c.content_sha256
        and e.status = 'current'
      where c.project_id = ${job.projectId}
        and c.document_id = ${job.documentId}
        and c.version_id = ${job.versionId}
        and p.status <> 'cancelled'
        and d.document_status = 'active'
        and v.is_current = true
        and v.storage_status = 'stored'
        and c.is_effective = true
        and length(btrim(c.content)) > 0
        and e.id is null
      order by c.chunk_index asc, c.id asc
    `);
    await tx
      .update(documentEmbeddingJob)
      .set({
        chunkCount: counts.eligible,
        completedChunkCount: counts.current,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
    return {
      job: { ...job, chunkCount: counts.eligible, completedChunkCount: counts.current },
      chunks: missing.rows.map((row) => ({
        id: row.id,
        content: row.content,
        contentSha256: row.content_sha256,
        chunkIndex: Number(row.chunk_index),
        estimatedTokenCount: Number(row.estimated_token_count),
      })),
    };
  });
}

export async function assertDailyEmbeddingTokenBudget(
  config: EmbeddingRuntimeConfig,
  requestedInputTokens = 1,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    await lockDailyEmbeddingTokenBudget(tx);
    const used = await dailyEmbeddingTokenBudgetUsed(tx);
    if (used + requestedInputTokens > config.dailyTokenLimit) {
      throw new EmbeddingPipelineError("DAILY_TOKEN_LIMIT_REACHED", false);
    }
  });
}

async function lockDailyEmbeddingTokenBudget(db: DatabaseExecutor): Promise<void> {
  await db.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        'embedding-daily-token-budget:' ||
        to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
        0
      )
    )
  `);
}

async function dailyEmbeddingTokenBudgetUsed(
  db: DatabaseExecutor,
): Promise<number> {
  const usage = await db.execute<{ input_tokens: number | string }>(sql`
    select coalesce(sum(
      case
        when status = 'succeeded'
          then coalesce(input_token_count, reserved_input_tokens)
        when status in ('reserved', 'calling', 'unknown')
          then reserved_input_tokens
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
  return Number(usage.rows[0]?.input_tokens ?? 0);
}

export function embeddingBatchReservedInputTokens(
  chunks: EligibleEmbeddingChunk[],
): number {
  return Math.min(
    chunks.length * TEXT_EMBEDDING_V4_MAX_TOKENS_PER_ITEM,
    TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST,
  );
}

export function embeddingBatchRequestSha256(
  profileId: string,
  chunks: EligibleEmbeddingChunk[],
): string {
  const hash = createHash("sha256").update(profileId);
  for (const chunk of chunks) {
    hash.update("\u0000").update(chunk.id).update("\u0000").update(chunk.contentSha256);
  }
  return hash.digest("hex");
}

export async function hasSuccessfulEmbeddingBatch(input: {
  jobId: string;
  requestSha256: string;
}): Promise<boolean> {
  const [batch] = await getDb()
    .select({ id: documentEmbeddingBatch.id })
    .from(documentEmbeddingBatch)
    .where(
      and(
        eq(documentEmbeddingBatch.jobId, input.jobId),
        eq(documentEmbeddingBatch.requestSha256, input.requestSha256),
        eq(documentEmbeddingBatch.status, "succeeded"),
      ),
    )
    .limit(1);
  return Boolean(batch);
}

export type EmbeddingBatchReservation =
  | {
      action: "call";
      batchId: string;
      providerCallId: string;
      requestSha256: string;
      reservedInputTokens: number;
    }
  | {
      action: "skip";
      batchId: string;
      requestSha256: string;
    };

export async function reserveEmbeddingBatch(input: {
  jobId: string;
  workerId: string;
  batchIndex: number;
  chunks: EligibleEmbeddingChunk[];
  config: EmbeddingRuntimeConfig;
}): Promise<EmbeddingBatchReservation> {
  return getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const requestSha256 = embeddingBatchRequestSha256(
      job.embeddingProfileId,
      input.chunks,
    );
    const [existing] = await tx
      .select()
      .from(documentEmbeddingBatch)
      .where(
        and(
          eq(documentEmbeddingBatch.jobId, job.id),
          eq(documentEmbeddingBatch.requestSha256, requestSha256),
        ),
      )
      .limit(1)
      .for("update", { of: documentEmbeddingBatch });
    if (existing?.status === "succeeded") {
      return { action: "skip", batchId: existing.id, requestSha256 };
    }
    if (existing?.status === "calling") {
      throw new EmbeddingPipelineError("PROVIDER_RESULT_UNKNOWN", false);
    }

    const reservedInputTokens = embeddingBatchReservedInputTokens(input.chunks);
    const [authorizedCall] = existing
      ? await tx
          .select()
          .from(documentEmbeddingProviderCall)
          .where(
            and(
              eq(documentEmbeddingProviderCall.batchId, existing.id),
              eq(documentEmbeddingProviderCall.status, "reserved"),
            ),
          )
          .orderBy(desc(documentEmbeddingProviderCall.callSequence))
          .limit(1)
          .for("update", { of: documentEmbeddingProviderCall })
      : [];
    if (existing?.status === "unknown" && !authorizedCall) {
      throw new EmbeddingPipelineError("PROVIDER_RESULT_UNKNOWN", false);
    }

    let batchId = existing?.id;
    if (existing) {
      await tx
        .update(documentEmbeddingBatch)
        .set({
          batchIndex: input.batchIndex,
          attemptCount: job.attemptCount,
          status: "reserved",
          model: input.config.model,
          dimensions: input.config.dimensions,
          chunkCount: input.chunks.length,
          reservedInputTokens,
          inputTokenCount: null,
          totalTokenCount: null,
          costMicroCny: null,
          latencyMs: 0,
          providerRequestId: null,
          failureCode: null,
          leasedBy: input.workerId,
          leaseExpiresAt: job.leaseExpiresAt,
          startedAt: null,
          completedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingBatch.id, existing.id));
    } else {
      batchId = crypto.randomUUID();
      await tx.insert(documentEmbeddingBatch).values({
        id: batchId,
        jobId: job.id,
        projectId: job.projectId,
        documentId: job.documentId,
        versionId: job.versionId,
        embeddingProfileId: job.embeddingProfileId,
        requestSha256,
        batchIndex: input.batchIndex,
        attemptCount: job.attemptCount,
        providerAttemptCount: 0,
        status: "reserved",
        model: input.config.model,
        dimensions: input.config.dimensions,
        chunkCount: input.chunks.length,
        reservedInputTokens,
        inputTokenCount: null,
        totalTokenCount: null,
        costMicroCny: null,
        latencyMs: 0,
        providerRequestId: null,
        failureCode: null,
        leasedBy: input.workerId,
        leaseExpiresAt: job.leaseExpiresAt,
        startedAt: null,
        completedAt: null,
      });
    }

    let providerCallId = authorizedCall?.id;
    if (authorizedCall) {
      if (authorizedCall.reservedInputTokens !== reservedInputTokens) {
        throw new EmbeddingPipelineError("CONFIGURATION_INVALID", false);
      }
      await tx
        .update(documentEmbeddingProviderCall)
        .set({
          leasedBy: input.workerId,
          leaseExpiresAt: job.leaseExpiresAt,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingProviderCall.id, authorizedCall.id));
    } else {
      await lockDailyEmbeddingTokenBudget(tx);
      const used = await dailyEmbeddingTokenBudgetUsed(tx);
      if (used + reservedInputTokens > input.config.dailyTokenLimit) {
        throw new EmbeddingPipelineError("DAILY_TOKEN_LIMIT_REACHED", false);
      }
      const sequence = await tx.execute<{ next_sequence: number | string }>(sql`
        select coalesce(max(call_sequence), 0) + 1 as next_sequence
        from document_embedding_provider_calls
        where batch_id = ${batchId!}
      `);
      providerCallId = crypto.randomUUID();
      await tx.insert(documentEmbeddingProviderCall).values({
        id: providerCallId,
        batchId: batchId!,
        jobId: job.id,
        projectId: job.projectId,
        documentId: job.documentId,
        versionId: job.versionId,
        embeddingProfileId: job.embeddingProfileId,
        callSequence: Number(sequence.rows[0]?.next_sequence ?? 1),
        status: "reserved",
        budgetRuleVersion: EMBEDDING_BUDGET_RULE_VERSION,
        reservedInputTokens,
        leasedBy: input.workerId,
        leaseExpiresAt: job.leaseExpiresAt,
      });
    }
    return {
      action: "call",
      batchId: batchId!,
      providerCallId: providerCallId!,
      requestSha256,
      reservedInputTokens,
    };
  });
}

export async function markEmbeddingProviderCallDispatched(input: {
  jobId: string;
  workerId: string;
  batchId: string;
  providerCallId: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const [providerCall] = await tx
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.id, input.providerCallId))
      .limit(1)
      .for("update", { of: documentEmbeddingProviderCall });
    if (
      !providerCall ||
      providerCall.batchId !== input.batchId ||
      providerCall.jobId !== job.id ||
      providerCall.status !== "reserved" ||
      providerCall.leasedBy !== input.workerId
    ) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    await tx
      .update(documentEmbeddingProviderCall)
      .set({
        status: "calling",
        dispatchClassification: "post_dispatch",
        dispatchedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingProviderCall.id, providerCall.id));
    const updatedBatch = await tx
      .update(documentEmbeddingBatch)
      .set({
        status: "calling",
        providerAttemptCount: sql`${documentEmbeddingBatch.providerAttemptCount} + 1`,
        startedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(documentEmbeddingBatch.id, input.batchId),
          eq(documentEmbeddingBatch.status, "reserved"),
          eq(documentEmbeddingBatch.leasedBy, input.workerId),
        ),
      )
      .returning({ id: documentEmbeddingBatch.id });
    if (updatedBatch.length !== 1) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    await tx
      .update(documentEmbeddingJob)
      .set({
        providerCallCount: sql`${documentEmbeddingJob.providerCallCount} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
  });
}

export async function commitEmbeddingBatch(input: {
  jobId: string;
  workerId: string;
  batchId: string;
  providerCallId: string;
  batchIndex: number;
  chunks: EligibleEmbeddingChunk[];
  result: EmbeddingGatewayResult;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const requestSha256 = embeddingBatchRequestSha256(
      job.embeddingProfileId,
      input.chunks,
    );
    const [batch] = await tx
      .select()
      .from(documentEmbeddingBatch)
      .where(eq(documentEmbeddingBatch.id, input.batchId))
      .limit(1)
      .for("update", { of: documentEmbeddingBatch });
    if (
      !batch ||
      batch.jobId !== job.id ||
      batch.requestSha256 !== requestSha256 ||
      batch.status !== "calling" ||
      batch.leasedBy !== input.workerId ||
      !batch.leaseExpiresAt ||
      batch.leaseExpiresAt <= new Date()
    ) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const [providerCall] = await tx
      .select()
      .from(documentEmbeddingProviderCall)
      .where(eq(documentEmbeddingProviderCall.id, input.providerCallId))
      .limit(1)
      .for("update", { of: documentEmbeddingProviderCall });
    if (
      !providerCall ||
      providerCall.batchId !== batch.id ||
      providerCall.jobId !== job.id ||
      providerCall.status !== "calling" ||
      providerCall.leasedBy !== input.workerId
    ) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    await tx
      .insert(documentChunkEmbedding)
      .values(
        input.chunks.map((chunk, index) => ({
          id: crypto.randomUUID(),
          projectId: job.projectId,
          documentId: job.documentId,
          versionId: job.versionId,
          chunkId: chunk.id,
          embeddingProfileId: job.embeddingProfileId,
          embeddingJobId: job.id,
          embedding: input.result.vectors[index]!,
          contentSha256: chunk.contentSha256,
          status: "current" as const,
          inputTokenCount: null,
          providerRequestId: input.result.providerRequestId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          documentChunkEmbedding.chunkId,
          documentChunkEmbedding.embeddingProfileId,
        ],
        set: {
          embeddingJobId: job.id,
          embedding: sql`excluded.embedding`,
          contentSha256: sql`excluded.content_sha256`,
          status: "current",
          inputTokenCount: null,
          providerRequestId: input.result.providerRequestId,
          generatedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
    await tx
      .update(documentEmbeddingJob)
      .set({
        completedChunkCount: sql`${documentEmbeddingJob.completedChunkCount} + ${input.chunks.length}`,
        latencyMs: sql`${documentEmbeddingJob.latencyMs} + ${input.result.latencyMs}`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
    await tx
      .update(documentEmbeddingBatch)
      .set({
        status: "succeeded",
        model: input.result.actualModel,
        dimensions: input.result.dimensions,
        inputTokenCount: input.result.inputTokens,
        totalTokenCount: input.result.totalTokens,
        costMicroCny: null,
        latencyMs: input.result.latencyMs,
        providerRequestId: input.result.providerRequestId,
        failureCode: null,
        leasedBy: null,
        leaseExpiresAt: null,
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingBatch.id, batch.id));
    await tx
      .update(documentEmbeddingProviderCall)
      .set({
        status: "succeeded",
        dispatchClassification: "successful_response",
        inputTokenCount: input.result.inputTokens,
        totalTokenCount: input.result.totalTokens,
        costMicroCny: null,
        latencyMs: input.result.latencyMs,
        providerRequestId: input.result.providerRequestId,
        failureCode: null,
        leasedBy: null,
        leaseExpiresAt: null,
        completedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingProviderCall.id, providerCall.id));
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_embedding_batch_succeeded",
        entityType: "document_embedding_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          embeddingProfileId: job.embeddingProfileId,
          model: input.result.actualModel,
          dimensions: input.result.dimensions,
          batchIndex: input.batchIndex,
          batchSize: input.chunks.length,
          inputTokenCount: input.result.inputTokens,
          totalTokenCount: input.result.totalTokens,
          latencyMs: input.result.latencyMs,
          providerAttemptCount: input.result.attemptCount,
          budgetRuleVersion: providerCall.budgetRuleVersion,
          reservedInputTokens: providerCall.reservedInputTokens,
        },
      },
      tx,
    );
  });
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempt - 1));
}

export async function recordEmbeddingFailure(input: {
  jobId: string;
  workerId: string;
  error: unknown;
  batchId?: string;
  providerCallId?: string;
  batchIndex?: number;
  chunks?: EligibleEmbeddingChunk[];
  latencyMs?: number;
  config?: EmbeddingRuntimeConfig;
}): Promise<void> {
  const error = controlledEmbeddingError(input.error);
  await getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const confirmedNoCharge = error.dispatchClassification === "pre_dispatch";
    const unknown = Boolean(input.providerCallId) && !confirmedNoCharge;
    if (input.batchId) {
      const [batch] = await tx
        .select()
        .from(documentEmbeddingBatch)
        .where(eq(documentEmbeddingBatch.id, input.batchId))
        .limit(1)
        .for("update", { of: documentEmbeddingBatch });
      if (
        !batch ||
        batch.jobId !== job.id ||
        !["reserved", "calling"].includes(batch.status) ||
        batch.leasedBy !== input.workerId
      ) {
        throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
      }
      await tx
        .update(documentEmbeddingBatch)
        .set({
          status: unknown ? "unknown" : "failed",
          latencyMs: input.latencyMs ?? 0,
          failureCode: unknown ? "PROVIDER_RESULT_UNKNOWN" : error.code,
          leasedBy: null,
          leaseExpiresAt: null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingBatch.id, batch.id));
      if (!input.providerCallId) {
        throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
      }
      const [providerCall] = await tx
        .select()
        .from(documentEmbeddingProviderCall)
        .where(eq(documentEmbeddingProviderCall.id, input.providerCallId))
        .limit(1)
        .for("update", { of: documentEmbeddingProviderCall });
      if (
        !providerCall ||
        providerCall.batchId !== batch.id ||
        providerCall.jobId !== job.id ||
        !["reserved", "calling"].includes(providerCall.status) ||
        providerCall.leasedBy !== input.workerId
      ) {
        throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
      }
      await tx
        .update(documentEmbeddingProviderCall)
        .set({
          status: unknown ? "unknown" : "failed_confirmed_no_charge",
          dispatchClassification: unknown
            ? error.dispatchClassification
            : "pre_dispatch",
          latencyMs: input.latencyMs ?? 0,
          failureCode: unknown ? "PROVIDER_RESULT_UNKNOWN" : error.code,
          leasedBy: null,
          leaseExpiresAt: null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingProviderCall.id, providerCall.id));
    }
    const retry =
      !unknown && error.retryable && job.attemptCount < job.maxAttempts;
    await tx
      .update(documentEmbeddingJob)
      .set({
        status: retry ? "pending" : "failed",
        availableAt: retry
          ? sql`now() + (${retryDelaySeconds(job.attemptCount)} * interval '1 second')`
          : job.availableAt,
        completedAt: retry ? null : sql`now()`,
        leasedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode: unknown ? "PROVIDER_RESULT_UNKNOWN" : error.code,
        failureMessage: "Embedding operation failed.",
        latencyMs: sql`${documentEmbeddingJob.latencyMs} + ${input.latencyMs ?? 0}`,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: retry
          ? "document_embedding_retried"
          : "document_embedding_failed",
        entityType: "document_embedding_job",
        entityId: job.id,
        result: retry ? "succeeded" : "failed",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          embeddingProfileId: job.embeddingProfileId,
          generation: job.generation,
          attemptCount: job.attemptCount,
          failureCode: unknown ? "PROVIDER_RESULT_UNKNOWN" : error.code,
          providerAttemptCount: error.providerAttemptCount,
          dispatchClassification: error.dispatchClassification,
          chargeOutcome: unknown ? "unknown" : "confirmed_no_charge",
          latencyMs: input.latencyMs ?? 0,
          retry,
        },
      },
      tx,
    );
  });
}

export async function reconcileStaleEmbeddingCalls(): Promise<number> {
  return getDb().transaction(async (tx) => {
    const stale = await tx.execute<{
      id: string;
      batch_id: string;
      job_id: string;
      project_id: string;
      document_id: string;
      version_id: string;
      embedding_profile_id: string;
      created_by: string;
      call_status: "reserved" | "calling";
      attempt_count: number;
      max_attempts: number;
    }>(sql`
      select c.id, c.batch_id, c.job_id, c.project_id, c.document_id,
        c.version_id, c.embedding_profile_id, j.created_by,
        c.status as call_status, j.attempt_count, j.max_attempts
      from document_embedding_provider_calls c
      inner join document_embedding_jobs j on j.id = c.job_id
      where c.status in ('reserved', 'calling')
        and c.lease_expires_at <= now()
      order by coalesce(c.dispatched_at, c.created_at) asc, c.id asc
      for update of c, j skip locked
    `);
    for (const row of stale.rows) {
      const dispatched = row.call_status === "calling";
      const retry = !dispatched && row.attempt_count < row.max_attempts;
      await tx
        .update(documentEmbeddingProviderCall)
        .set({
          status: dispatched ? "unknown" : "failed_confirmed_no_charge",
          dispatchClassification: dispatched ? "post_dispatch" : "pre_dispatch",
          failureCode: dispatched
            ? "PROVIDER_RESULT_UNKNOWN"
            : "WORKER_LEASE_LOST",
          leasedBy: null,
          leaseExpiresAt: null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingProviderCall.id, row.id));
      await tx
        .update(documentEmbeddingBatch)
        .set({
          status: dispatched ? "unknown" : "failed",
          failureCode: dispatched
            ? "PROVIDER_RESULT_UNKNOWN"
            : "WORKER_LEASE_LOST",
          leasedBy: null,
          leaseExpiresAt: null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingBatch.id, row.batch_id));
      await tx
        .update(documentEmbeddingJob)
        .set({
          status: retry ? "pending" : "failed",
          availableAt: retry ? sql`now()` : undefined,
          completedAt: retry ? null : sql`now()`,
          leasedBy: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          failureCode: dispatched
            ? "PROVIDER_RESULT_UNKNOWN"
            : retry
              ? "WORKER_LEASE_LOST"
              : "WORKER_MAX_ATTEMPTS_REACHED",
          failureMessage: dispatched
            ? "Embedding provider result is unknown."
            : "Embedding provider dispatch did not start before the lease expired.",
          updatedAt: sql`now()`,
        })
        .where(eq(documentEmbeddingJob.id, row.job_id));
      await writeAuditEvent(
        {
          actorUserId: row.created_by,
          projectId: row.project_id,
          eventType: retry
            ? "document_embedding_retried"
            : "document_embedding_failed",
          entityType: "document_embedding_job",
          entityId: row.job_id,
          result: retry ? "succeeded" : "failed",
          metadata: {
            documentId: row.document_id,
            versionId: row.version_id,
            embeddingProfileId: row.embedding_profile_id,
            failureCode: dispatched
              ? "PROVIDER_RESULT_UNKNOWN"
              : retry
                ? "WORKER_LEASE_LOST"
                : "WORKER_MAX_ATTEMPTS_REACHED",
            dispatchClassification: dispatched
              ? "post_dispatch"
              : "pre_dispatch",
            chargeOutcome: dispatched ? "unknown" : "confirmed_no_charge",
            retry,
          },
        },
        tx,
      );
    }
    return stale.rows.length;
  });
}

export async function retryUnknownEmbeddingJob(input: {
  jobId: string;
  acceptPossibleDuplicateCharge: boolean;
  apply?: boolean;
  config?: EmbeddingRuntimeConfig;
}): Promise<{
  dryRun: boolean;
  unknownCallCount: number;
  oldReservedInputTokens: number;
  newReservedInputTokens: number;
  usedInputTokens: number;
  remainingInputTokens: number;
  canApply: boolean;
  requeued: boolean;
}> {
  if (!input.acceptPossibleDuplicateCharge) {
    throw new EmbeddingPipelineError("PROVIDER_RESULT_UNKNOWN", false);
  }
  return getDb().transaction(async (tx) => {
    const config = input.config ?? getEmbeddingRuntimeConfig();
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!job || job.status !== "failed" || job.failureCode !== "PROVIDER_RESULT_UNKNOWN") {
      throw new EmbeddingPipelineError("CONFIGURATION_INVALID", false);
    }
    const batches = await tx
      .select({
        id: documentEmbeddingBatch.id,
        chunkCount: documentEmbeddingBatch.chunkCount,
      })
      .from(documentEmbeddingBatch)
      .where(
        and(
          eq(documentEmbeddingBatch.jobId, job.id),
          eq(documentEmbeddingBatch.status, "unknown"),
        ),
      )
      .for("update", { of: documentEmbeddingBatch });
    const unknownCalls = await tx
      .select({
        id: documentEmbeddingProviderCall.id,
        reservedInputTokens: documentEmbeddingProviderCall.reservedInputTokens,
      })
      .from(documentEmbeddingProviderCall)
      .where(
        and(
          eq(documentEmbeddingProviderCall.jobId, job.id),
          eq(documentEmbeddingProviderCall.status, "unknown"),
        ),
      )
      .for("update", { of: documentEmbeddingProviderCall });
    const pendingCalls = await tx
      .select({ id: documentEmbeddingProviderCall.id })
      .from(documentEmbeddingProviderCall)
      .where(
        and(
          eq(documentEmbeddingProviderCall.jobId, job.id),
          eq(documentEmbeddingProviderCall.status, "reserved"),
        ),
      )
      .limit(1);
    if (batches.length !== 1 || unknownCalls.length < 1 || pendingCalls.length) {
      throw new EmbeddingPipelineError("CONFIGURATION_INVALID", false);
    }
    await lockDailyEmbeddingTokenBudget(tx);
    const usedInputTokens = await dailyEmbeddingTokenBudgetUsed(tx);
    const oldReservedInputTokens = unknownCalls.reduce(
      (total, call) => total + call.reservedInputTokens,
      0,
    );
    const newReservedInputTokens = Math.min(
      batches.reduce(
        (total, batch) =>
          total + batch.chunkCount * TEXT_EMBEDDING_V4_MAX_TOKENS_PER_ITEM,
        0,
      ),
      TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST,
    );
    const canApply =
      usedInputTokens + newReservedInputTokens <= config.dailyTokenLimit;
    const result = {
      unknownCallCount: unknownCalls.length,
      oldReservedInputTokens,
      newReservedInputTokens,
      usedInputTokens,
      remainingInputTokens: Math.max(
        0,
        config.dailyTokenLimit - usedInputTokens - newReservedInputTokens,
      ),
      canApply,
    };
    if (!input.apply) {
      return { dryRun: true, ...result, requeued: false };
    }
    if (!canApply) {
      throw new EmbeddingPipelineError("DAILY_TOKEN_LIMIT_REACHED", false);
    }
    const sequence = await tx.execute<{ next_sequence: number | string }>(sql`
      select coalesce(max(call_sequence), 0) + 1 as next_sequence
      from document_embedding_provider_calls
      where batch_id = ${batches[0]!.id}
    `);
    await tx.insert(documentEmbeddingProviderCall).values({
      id: crypto.randomUUID(),
      batchId: batches[0]!.id,
      jobId: job.id,
      projectId: job.projectId,
      documentId: job.documentId,
      versionId: job.versionId,
      embeddingProfileId: job.embeddingProfileId,
      callSequence: Number(sequence.rows[0]?.next_sequence ?? 1),
      status: "reserved",
      budgetRuleVersion: EMBEDDING_BUDGET_RULE_VERSION,
      reservedInputTokens: newReservedInputTokens,
    });
    await tx
      .update(documentEmbeddingJob)
      .set({
        status: "pending",
        maxAttempts: sql`greatest(${documentEmbeddingJob.maxAttempts}, ${documentEmbeddingJob.attemptCount} + 1)`,
        availableAt: sql`now()`,
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_embedding_retried",
        entityType: "document_embedding_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          embeddingProfileId: job.embeddingProfileId,
          reason: "manual_unknown_retry_acknowledged",
          possibleDuplicateChargeAccepted: true,
          unknownCallCount: unknownCalls.length,
          oldReservedInputTokens,
          newReservedInputTokens,
          usedInputTokens,
          remainingInputTokens: result.remainingInputTokens,
          budgetRuleVersion: EMBEDDING_BUDGET_RULE_VERSION,
        },
      },
      tx,
    );
    return { dryRun: false, ...result, requeued: true };
  });
}

export async function completeEmbeddingJob(input: {
  jobId: string;
  workerId: string;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const job = await findEmbeddingJob(input.jobId, tx, { lockForUpdate: true });
    if (!hasValidLease(job, input.workerId)) {
      throw new EmbeddingPipelineError("WORKER_LEASE_LOST", false);
    }
    const counts = await embeddingEligibilityCounts(
      {
        projectId: job.projectId,
        documentId: job.documentId,
        versionId: job.versionId,
        profileId: job.embeddingProfileId,
      },
      tx,
    );
    if (!counts.eligible || counts.current !== counts.eligible) {
      throw new EmbeddingPipelineError("SERVER_ERROR", true);
    }
    const usage = await tx.execute<{
      input_complete: boolean;
      total_complete: boolean;
      input_tokens: number | string;
      total_tokens: number | string;
      latency_ms: number | string;
      provider_call_count: number | string;
    }>(sql`
      select
        coalesce(bool_and(input_token_count is not null), true) as input_complete,
        coalesce(bool_and(total_token_count is not null), true) as total_complete,
        coalesce(sum(input_token_count), 0) as input_tokens,
        coalesce(sum(total_token_count), 0) as total_tokens,
        coalesce(sum(latency_ms), 0) as latency_ms,
        (
          select count(*)
          from document_embedding_provider_calls dispatched
          where dispatched.job_id = ${job.id}
            and dispatched.dispatched_at is not null
            and dispatched.status <> 'failed_confirmed_no_charge'
        ) as provider_call_count
      from document_embedding_provider_calls
      where job_id = ${job.id} and status = 'succeeded'
    `);
    const aggregate = usage.rows[0];
    const providerCallCount = Number(aggregate?.provider_call_count ?? 0);
    await tx
      .update(documentEmbeddingJob)
      .set({
        status: "succeeded",
        chunkCount: counts.eligible,
        completedChunkCount: counts.current,
        inputTokenCount:
          aggregate?.input_complete === false
            ? null
            : Number(aggregate?.input_tokens ?? 0),
        totalTokenCount:
          aggregate?.total_complete === false
            ? null
            : Number(aggregate?.total_tokens ?? 0),
        providerCallCount,
        latencyMs: Number(aggregate?.latency_ms ?? 0),
        completedAt: sql`now()`,
        leasedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(documentEmbeddingJob.id, job.id));
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_embedding_succeeded",
        entityType: "document_embedding_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          embeddingProfileId: job.embeddingProfileId,
          generation: job.generation,
          attemptCount: job.attemptCount,
          chunkCount: counts.eligible,
          providerCallCount,
          inputTokenCount:
            aggregate?.input_complete === false
              ? null
              : Number(aggregate?.input_tokens ?? 0),
          totalTokenCount:
            aggregate?.total_complete === false
              ? null
              : Number(aggregate?.total_tokens ?? 0),
          latencyMs: Number(aggregate?.latency_ms ?? 0),
        },
      },
      tx,
    );
  });
}

export function embeddingFailureCode(error: unknown): EmbeddingFailureCode {
  return controlledEmbeddingError(error).code;
}
