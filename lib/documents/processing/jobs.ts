import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  deleteJobResults,
  findIngestionJob,
  latestSuccessfulIngestionJobForVersion,
} from "@/lib/db/repositories/ingestion-repository";
import {
  getDb,
  type DatabaseExecutor,
} from "@/lib/db/client";
import {
  documentChunk,
  documentIngestionJob,
  documentSection,
  projectDocument,
  projectDocumentVersion,
  type DocumentIngestionJobRecord,
  type NewDocumentChunkRecord,
  type NewDocumentSectionRecord,
} from "@/lib/db/schema";
import type { DeterministicChunk, ParsedSection } from "./types";
import {
  getDocumentProcessingConfig,
  type DocumentProcessingConfig,
} from "./config";
import {
  DocumentProcessingError,
  publicProcessingFailureMessage,
} from "./errors";
import { ensureEmbeddingJob } from "@/lib/ai/embeddings/jobs";

export type CreateIngestionReason =
  | "stored"
  | "current_version"
  | "restored"
  | "reindex"
  | "version_upgrade";

export async function ensureIngestionJob(input: {
  projectId: string;
  documentId: string;
  versionId: string;
  createdBy: string;
  reason: CreateIngestionReason;
  forceNewGeneration?: boolean;
  db?: DatabaseExecutor;
  config?: DocumentProcessingConfig;
}): Promise<DocumentIngestionJobRecord> {
  if (!input.db) {
    return getDb().transaction((tx) =>
      ensureIngestionJob({
        ...input,
        db: tx,
      }),
    );
  }
  const db = input.db;
  const config = input.config ?? getDocumentProcessingConfig();
  const creationScope = [
    input.projectId,
    input.documentId,
    input.versionId,
    config.parserVersion,
    config.chunkerVersion,
  ].join(":");
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${creationScope}, 0))`,
  );
  const existing = await db
    .select()
    .from(documentIngestionJob)
    .where(
      and(
        eq(documentIngestionJob.projectId, input.projectId),
        eq(documentIngestionJob.documentId, input.documentId),
        eq(documentIngestionJob.versionId, input.versionId),
        eq(documentIngestionJob.parserVersion, config.parserVersion),
        eq(documentIngestionJob.chunkerVersion, config.chunkerVersion),
        inArray(documentIngestionJob.status, [
          "pending",
          "running",
          "succeeded",
          "needs_ocr",
        ]),
      ),
    )
    .orderBy(desc(documentIngestionJob.generation))
    .limit(1);
  if (
    existing[0] &&
    (!input.forceNewGeneration ||
      existing[0].status === "pending" ||
      existing[0].status === "running")
  ) {
    return existing[0];
  }

  const [generationRow] = await db
    .select({ generation: sql<number>`coalesce(max(${documentIngestionJob.generation}), 0)` })
    .from(documentIngestionJob)
    .where(eq(documentIngestionJob.versionId, input.versionId));
  const generation = Number(generationRow?.generation ?? 0) + 1;
  const [created] = await db
    .insert(documentIngestionJob)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: input.versionId,
      generation,
      parserVersion: config.parserVersion,
      chunkerVersion: config.chunkerVersion,
      maxAttempts: config.maxAttempts,
      createdBy: input.createdBy,
    })
    .onConflictDoNothing({
      target: [
        documentIngestionJob.versionId,
        documentIngestionJob.generation,
        documentIngestionJob.parserVersion,
        documentIngestionJob.chunkerVersion,
      ],
    })
    .returning();
  if (!created) {
    const [concurrent] = await db
      .select()
      .from(documentIngestionJob)
      .where(
        and(
          eq(documentIngestionJob.versionId, input.versionId),
          eq(documentIngestionJob.generation, generation),
          eq(documentIngestionJob.parserVersion, config.parserVersion),
          eq(documentIngestionJob.chunkerVersion, config.chunkerVersion),
        ),
      )
      .limit(1);
    if (!concurrent) {
      throw new Error("Concurrent ingestion Job creation could not be resolved.");
    }
    return concurrent;
  }
  await writeAuditEvent(
    {
      actorUserId: input.createdBy,
      projectId: input.projectId,
      eventType: "document_ingestion_created",
      entityType: "document_ingestion_job",
      entityId: created.id,
      result: "succeeded",
      metadata: {
        documentId: input.documentId,
        versionId: input.versionId,
        jobId: created.id,
        generation,
        parserVersion: config.parserVersion,
        chunkerVersion: config.chunkerVersion,
        reason: input.reason,
      },
    },
    db,
  );
  return created;
}

export async function deactivateDocumentIndex(
  projectId: string,
  documentId: string,
  actorUserId: string,
  reason: string,
  db: DatabaseExecutor,
): Promise<void> {
  const changed = await db
    .update(documentChunk)
    .set({ isEffective: false })
    .where(
      and(
        eq(documentChunk.projectId, projectId),
        eq(documentChunk.documentId, documentId),
        eq(documentChunk.isEffective, true),
      ),
    )
    .returning({ id: documentChunk.id });
  if (changed.length) {
    await writeAuditEvent(
      {
        actorUserId,
        projectId,
        eventType: "document_index_deactivated",
        entityType: "project_document",
        entityId: documentId,
        result: "succeeded",
        metadata: { documentId, chunkCount: changed.length, reason },
      },
      db,
    );
  }
}

export async function activateOrQueueVersionIndex(input: {
  projectId: string;
  documentId: string;
  versionId: string;
  actorUserId: string;
  reason: CreateIngestionReason;
  db: DatabaseExecutor;
}): Promise<void> {
  await deactivateDocumentIndex(
    input.projectId,
    input.documentId,
    input.actorUserId,
    input.reason,
    input.db,
  );
  const successful = await latestSuccessfulIngestionJobForVersion(
    input.projectId,
    input.documentId,
    input.versionId,
    input.db,
  );
  if (successful) {
    const activated = await input.db
      .update(documentChunk)
      .set({ isEffective: true })
      .where(eq(documentChunk.ingestionJobId, successful.id))
      .returning({ id: documentChunk.id });
    await writeAuditEvent(
      {
        actorUserId: input.actorUserId,
        projectId: input.projectId,
        eventType: "document_index_activated",
        entityType: "document_ingestion_job",
        entityId: successful.id,
        result: "succeeded",
        metadata: {
          documentId: input.documentId,
          versionId: input.versionId,
          generation: successful.generation,
          chunkCount: activated.length,
          reason: input.reason,
        },
      },
      input.db,
    );
    await ensureEmbeddingJob({
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: input.versionId,
      createdBy: input.actorUserId,
      reason: input.reason === "restored" ? "restored" : "current_version",
      db: input.db,
    });
    return;
  }
  await ensureIngestionJob({
    ...input,
    createdBy: input.actorUserId,
  });
}

export async function failExhaustedJobs(
  db: DatabaseExecutor = getDb(),
): Promise<number> {
  const exhausted = await db.execute<{
    id: string;
    project_id: string;
    document_id: string;
    version_id: string;
    created_by: string;
    generation: number;
    attempt_count: number;
  }>(sql`
    update document_ingestion_jobs
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
    returning id, project_id, document_id, version_id, created_by, generation, attempt_count
  `);
  for (const row of exhausted.rows) {
    await writeAuditEvent(
      {
        actorUserId: row.created_by,
        projectId: row.project_id,
        eventType: "document_ingestion_failed",
        entityType: "document_ingestion_job",
        entityId: row.id,
        result: "failed",
        metadata: {
          documentId: row.document_id,
          versionId: row.version_id,
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

export async function claimIngestionJob(
  workerId: string,
  config: DocumentProcessingConfig = getDocumentProcessingConfig(),
): Promise<DocumentIngestionJobRecord | null> {
  await failExhaustedJobs();
  return getDb().transaction(async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      select id
      from document_ingestion_jobs
      where (
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
    const jobId = result.rows[0]?.id;
    if (!jobId) return null;
    const [job] = await tx
      .update(documentIngestionJob)
      .set({
        status: "running",
        attemptCount: sql`${documentIngestionJob.attemptCount} + 1`,
        leasedBy: workerId,
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`now()`,
        completedAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(documentIngestionJob.id, jobId))
      .returning();
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_ingestion_started",
        entityType: "document_ingestion_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          generation: job.generation,
          attemptCount: job.attemptCount,
          parserVersion: job.parserVersion,
          chunkerVersion: job.chunkerVersion,
        },
      },
      tx,
    );
    return job;
  });
}

export async function renewIngestionLease(
  jobId: string,
  workerId: string,
  config: DocumentProcessingConfig = getDocumentProcessingConfig(),
): Promise<boolean> {
  const renewed = await getDb()
    .update(documentIngestionJob)
    .set({
      leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
      heartbeatAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(documentIngestionJob.id, jobId),
        eq(documentIngestionJob.status, "running"),
        eq(documentIngestionJob.leasedBy, workerId),
        sql`${documentIngestionJob.leaseExpiresAt} > now()`,
      ),
    )
    .returning({ id: documentIngestionJob.id });
  return renewed.length === 1;
}

function sectionRows(
  job: DocumentIngestionJobRecord,
  sections: ParsedSection[],
): NewDocumentSectionRecord[] {
  return sections.map((section, sectionIndex) => ({
    id: crypto.randomUUID(),
    projectId: job.projectId,
    documentId: job.documentId,
    versionId: job.versionId,
    ingestionJobId: job.id,
    generation: job.generation,
    sectionType: section.sectionType,
    sectionIndex,
    heading: section.heading ?? null,
    headingPath: section.headingPath,
    pageNumber: section.pageNumber ?? null,
    slideNumber: section.slideNumber ?? null,
    sheetName: section.sheetName ?? null,
    columnStart: section.columnStart ?? null,
    columnEnd: section.columnEnd ?? null,
    rowStart: section.rowStart ?? null,
    rowEnd: section.rowEnd ?? null,
    lineStart: section.lineStart ?? null,
    lineEnd: section.lineEnd ?? null,
    paragraphStart: section.paragraphStart ?? null,
    paragraphEnd: section.paragraphEnd ?? null,
    sourceLocator: section.sourceLocator,
    content: section.content,
    contentSha256: createHash("sha256").update(section.content).digest("hex"),
    characterCount: section.content.length,
    parserVersion: job.parserVersion,
  }));
}

export async function completeIngestionJob(input: {
  jobId: string;
  workerId: string;
  sections: ParsedSection[];
  chunks: DeterministicChunk[];
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const job = await findIngestionJob(input.jobId, tx, { lockForUpdate: true });
    if (
      !job ||
      job.status !== "running" ||
      job.leasedBy !== input.workerId ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= new Date()
    ) {
      throw new DocumentProcessingError(
        "WORKER_LEASE_LOST",
        "Worker lease was lost before completion.",
      );
    }
    const [version] = await tx
      .select()
      .from(projectDocumentVersion)
      .where(
        and(
          eq(projectDocumentVersion.id, job.versionId),
          eq(projectDocumentVersion.documentId, job.documentId),
          eq(projectDocumentVersion.projectId, job.projectId),
        ),
      )
      .for("update", { of: projectDocumentVersion })
      .limit(1);
    const [document] = await tx
      .select()
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.id, job.documentId),
          eq(projectDocument.projectId, job.projectId),
        ),
      )
      .for("update", { of: projectDocument })
      .limit(1);
    if (!version || !document || version.storageStatus !== "stored") {
      throw new DocumentProcessingError(
        "INVALID_DOCUMENT_STRUCTURE",
        "Document version is no longer available.",
      );
    }

    await deleteJobResults(job.id, tx);
    const sectionsToInsert = sectionRows(job, input.sections);
    await tx.insert(documentSection).values(sectionsToInsert);
    const sectionIds = new Map(
      sectionsToInsert.map((section) => [section.sectionIndex, section.id]),
    );
    const chunksToInsert: NewDocumentChunkRecord[] = input.chunks.map((chunk) => ({
      id: crypto.randomUUID(),
      projectId: job.projectId,
      documentId: job.documentId,
      versionId: job.versionId,
      sectionId: sectionIds.get(chunk.sectionIndex)!,
      ingestionJobId: job.id,
      generation: job.generation,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      contentSha256: chunk.contentSha256,
      searchText: chunk.searchText,
      characterCount: chunk.characterCount,
      estimatedTokenCount: chunk.estimatedTokenCount,
      headingPath: chunk.headingPath,
      sourceLocator: chunk.sourceLocator,
      parserVersion: job.parserVersion,
      chunkerVersion: job.chunkerVersion,
      isEffective: false,
    }));
    await tx.insert(documentChunk).values(chunksToInsert);
    const effective = document.status === "active" && version.isCurrent;
    if (effective) {
      await tx
        .update(documentChunk)
        .set({ isEffective: false })
        .where(
          and(
            eq(documentChunk.projectId, job.projectId),
            eq(documentChunk.documentId, job.documentId),
            eq(documentChunk.isEffective, true),
          ),
        );
      await tx
        .update(documentChunk)
        .set({ isEffective: true })
        .where(eq(documentChunk.ingestionJobId, job.id));
    }
    await tx
      .update(documentIngestionJob)
      .set({
        status: "succeeded",
        completedAt: sql`now()`,
        leasedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode: null,
        failureMessage: null,
        updatedAt: sql`now()`,
      })
      .where(eq(documentIngestionJob.id, job.id));
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType: "document_ingestion_succeeded",
        entityType: "document_ingestion_job",
        entityId: job.id,
        result: "succeeded",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          generation: job.generation,
          parserVersion: job.parserVersion,
          chunkerVersion: job.chunkerVersion,
          sectionCount: input.sections.length,
          chunkCount: input.chunks.length,
          attemptCount: job.attemptCount,
        },
      },
      tx,
    );
    if (effective) {
      await writeAuditEvent(
        {
          actorUserId: job.createdBy,
          projectId: job.projectId,
          eventType: "document_index_activated",
          entityType: "document_ingestion_job",
          entityId: job.id,
          result: "succeeded",
          metadata: {
            documentId: job.documentId,
            versionId: job.versionId,
            generation: job.generation,
            chunkCount: input.chunks.length,
          },
        },
        tx,
      );
      await ensureEmbeddingJob({
        projectId: job.projectId,
        documentId: job.documentId,
        versionId: job.versionId,
        createdBy: job.createdBy,
        reason: "ingestion_succeeded",
        db: tx,
      });
    }
  });
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempt - 1));
}

export async function recordIngestionFailure(input: {
  jobId: string;
  workerId: string;
  error: DocumentProcessingError;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const job = await findIngestionJob(input.jobId, tx, { lockForUpdate: true });
    if (!job || job.status !== "running" || job.leasedBy !== input.workerId) {
      return;
    }
    await deleteJobResults(job.id, tx);
    const needsOcr = input.error.code === "OCR_REQUIRED";
    const retry =
      !needsOcr && input.error.retryable && job.attemptCount < job.maxAttempts;
    const status = needsOcr ? "needs_ocr" : retry ? "pending" : "failed";
    await tx
      .update(documentIngestionJob)
      .set({
        status,
        availableAt: retry
          ? sql`now() + (${retryDelaySeconds(job.attemptCount)} * interval '1 second')`
          : job.availableAt,
        completedAt: retry ? null : sql`now()`,
        leasedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        failureCode: input.error.code,
        failureMessage: publicProcessingFailureMessage(input.error.code),
        updatedAt: sql`now()`,
      })
      .where(eq(documentIngestionJob.id, job.id));
    const eventType = needsOcr
      ? "document_ingestion_needs_ocr"
      : retry
        ? "document_ingestion_retried"
        : "document_ingestion_failed";
    await writeAuditEvent(
      {
        actorUserId: job.createdBy,
        projectId: job.projectId,
        eventType,
        entityType: "document_ingestion_job",
        entityId: job.id,
        result: retry ? "succeeded" : "failed",
        metadata: {
          documentId: job.documentId,
          versionId: job.versionId,
          generation: job.generation,
          attemptCount: job.attemptCount,
          failureCode: input.error.code,
        },
      },
      tx,
    );
  });
}
import { createHash } from "node:crypto";
