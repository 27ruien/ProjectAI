import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import {
  documentChunk,
  documentIngestionJob,
  documentSection,
  type DocumentIngestionJobRecord,
  type DocumentIngestionStatus,
} from "../schema";

export async function findIngestionJob(
  jobId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<DocumentIngestionJobRecord | null> {
  const query = db
    .select()
    .from(documentIngestionJob)
    .where(eq(documentIngestionJob.id, jobId))
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: documentIngestionJob })
    : await query;
  return record ?? null;
}

export async function latestIngestionJobForVersion(
  projectId: string,
  documentId: string,
  versionId: string,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentIngestionJobRecord | null> {
  const [record] = await db
    .select()
    .from(documentIngestionJob)
    .where(
      and(
        eq(documentIngestionJob.projectId, projectId),
        eq(documentIngestionJob.documentId, documentId),
        eq(documentIngestionJob.versionId, versionId),
      ),
    )
    .orderBy(desc(documentIngestionJob.generation))
    .limit(1);
  return record ?? null;
}

export async function latestSuccessfulIngestionJobForVersion(
  projectId: string,
  documentId: string,
  versionId: string,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentIngestionJobRecord | null> {
  const [record] = await db
    .select()
    .from(documentIngestionJob)
    .where(
      and(
        eq(documentIngestionJob.projectId, projectId),
        eq(documentIngestionJob.documentId, documentId),
        eq(documentIngestionJob.versionId, versionId),
        eq(documentIngestionJob.status, "succeeded"),
      ),
    )
    .orderBy(desc(documentIngestionJob.generation))
    .limit(1);
  return record ?? null;
}

export type IngestionSummary = {
  status:
    | "not_started"
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "needs_ocr";
  indexedVersion: number | null;
  parserVersion: string | null;
  chunkerVersion: string | null;
  sectionCount: number;
  chunkCount: number;
  lastIndexedAt: Date | null;
  failureCode: string | null;
  generation: number | null;
};

function publicStatus(
  status: DocumentIngestionStatus | null,
): IngestionSummary["status"] {
  if (!status || status === "cancelled") return "not_started";
  return status;
}

function databaseTimestamp(value: Date | string | null): Date | null {
  if (value === null || value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Document ingestion query returned an invalid timestamp.");
  }
  return parsed;
}

export async function ingestionSummariesForVersions(
  versionIds: string[],
  db: DatabaseExecutor = getDb(),
): Promise<Map<string, IngestionSummary>> {
  if (!versionIds.length) return new Map();
  const rows = await db.execute<{
    version_id: string;
    status: DocumentIngestionStatus;
    generation: number;
    parser_version: string;
    chunker_version: string;
    failure_code: string | null;
    completed_at: Date | string | null;
    section_count: number | string;
    chunk_count: number | string;
  }>(sql`
    select distinct on (j.version_id)
      j.version_id,
      j.status,
      j.generation,
      j.parser_version,
      j.chunker_version,
      j.failure_code,
      j.completed_at,
      (select count(*) from document_sections s where s.ingestion_job_id = j.id) as section_count,
      (select count(*) from document_chunks c where c.ingestion_job_id = j.id) as chunk_count
    from document_ingestion_jobs j
    where j.version_id in (${sql.join(
      versionIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by j.version_id, j.generation desc
  `);
  return new Map(
    rows.rows.map((row) => [
      row.version_id,
      {
        status: publicStatus(row.status),
        indexedVersion: row.status === "succeeded" ? row.generation : null,
        parserVersion: row.parser_version,
        chunkerVersion: row.chunker_version,
        sectionCount: Number(row.section_count),
        chunkCount: Number(row.chunk_count),
        lastIndexedAt:
          row.status === "succeeded"
            ? databaseTimestamp(row.completed_at)
            : null,
        failureCode: row.failure_code,
        generation: row.generation,
      },
    ]),
  );
}

export async function deleteJobResults(
  jobId: string,
  db: DatabaseExecutor,
): Promise<void> {
  await db.delete(documentChunk).where(eq(documentChunk.ingestionJobId, jobId));
  await db.delete(documentSection).where(eq(documentSection.ingestionJobId, jobId));
}
