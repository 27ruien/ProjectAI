import { sql } from "drizzle-orm";
import { readdir, rm } from "node:fs/promises";
import { closeDatabasePool, getDb } from "../lib/db/client";
import { getObjectStorage } from "../lib/files/object-storage";

function assertCiCleanupBoundary(): void {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.CI !== "true" ||
    process.env.PROJECTAI_TEST_CLEANUP !== "1"
  ) {
    throw new Error(
      "CI cleanup requires NODE_ENV=test, CI=true and PROJECTAI_TEST_CLEANUP=1.",
    );
  }
  const databaseUrl = new URL(process.env.DATABASE_URL || "");
  if (
    !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
    databaseUrl.port !== "5432" ||
    databaseUrl.pathname !== "/projectai_ci"
  ) {
    throw new Error("CI cleanup refused a non-local or non-CI database.");
  }
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim() || "";
  if (!/^projectai-ci-[A-Za-z0-9-]+$/.test(bucket)) {
    throw new Error("CI cleanup refused a non-ephemeral object-storage bucket.");
  }
}

assertCiCleanupBoundary();

try {
  const db = getDb();
  const versions = await db.execute<{ object_key: string }>(sql`
    select object_key
    from project_document_versions
    order by object_key
  `);

  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from ai_message_citations`);
    await tx.execute(sql`delete from ai_retrieval_candidates`);
    await tx.execute(sql`delete from ai_retrieval_query_embedding_calls`);
    await tx.execute(sql`delete from ai_retrieval_runs`);
    await tx.execute(sql`delete from ai_executions`);
    await tx.execute(sql`delete from ai_messages`);
    await tx.execute(sql`delete from ai_threads`);
    await tx.execute(sql`delete from document_chunk_embeddings`);
    await tx.execute(sql`delete from document_embedding_provider_calls`);
    await tx.execute(sql`delete from document_embedding_batches`);
    await tx.execute(sql`delete from document_embedding_jobs`);
    await tx.execute(sql`delete from document_chunks`);
    await tx.execute(sql`delete from document_sections`);
    await tx.execute(sql`delete from document_ingestion_jobs`);
    await tx.execute(sql`delete from project_document_versions`);
    await tx.execute(sql`delete from project_documents`);
    await tx.execute(sql`delete from sessions`);
  });

  const storage = getObjectStorage();
  const recordedKeys = new Set(
    versions.rows.map((row) => row.object_key).filter(Boolean),
  );
  const remainingObjects = await storage.listObjects("projects/");
  for (const object of remainingObjects) recordedKeys.add(object.key);
  for (const key of recordedKeys) await storage.deleteObject(key);
  const temporaryEntries = (await readdir("/tmp")).filter((entry) =>
    entry.startsWith("projectai-"),
  );
  for (const entry of temporaryEntries) {
    await rm(`/tmp/${entry}`, { recursive: true, force: true });
  }

  const counts = await db.execute<{
    sessions: number;
    documents: number;
    versions: number;
    jobs: number;
    sections: number;
    chunks: number;
    running_jobs: number;
    embedding_jobs: number;
    embedding_batches: number;
    embedding_provider_calls: number;
    chunk_embeddings: number;
    running_embedding_jobs: number;
    ai_threads: number;
    ai_messages: number;
    ai_executions: number;
    ai_citations: number;
    running_executions: number;
    retrieval_runs: number;
    retrieval_candidates: number;
    query_embedding_calls: number;
    active_retrieval_runs: number;
    active_query_embedding_calls: number;
  }>(sql`
    select
      (select count(*)::int from sessions) as sessions,
      (select count(*)::int from project_documents) as documents,
      (select count(*)::int from project_document_versions) as versions,
      (select count(*)::int from document_ingestion_jobs) as jobs,
      (select count(*)::int from document_sections) as sections,
      (select count(*)::int from document_chunks) as chunks,
      (select count(*)::int from document_embedding_jobs) as embedding_jobs,
      (select count(*)::int from document_embedding_batches) as embedding_batches,
      (select count(*)::int from document_embedding_provider_calls) as embedding_provider_calls,
      (select count(*)::int from document_chunk_embeddings) as chunk_embeddings,
      (select count(*)::int from ai_threads) as ai_threads,
      (select count(*)::int from ai_messages) as ai_messages,
      (select count(*)::int from ai_executions) as ai_executions,
      (select count(*)::int from ai_message_citations) as ai_citations,
      (select count(*)::int from ai_retrieval_runs) as retrieval_runs,
      (select count(*)::int from ai_retrieval_candidates) as retrieval_candidates,
      (select count(*)::int from ai_retrieval_query_embedding_calls) as query_embedding_calls,
      (
        select count(*)::int
        from document_ingestion_jobs
        where status = 'running'
      ) as running_jobs,
      (
        select count(*)::int
        from document_embedding_jobs
        where status = 'running'
      ) as running_embedding_jobs,
      (
        select count(*)::int
        from ai_executions
        where status in ('reserved', 'retrieving', 'calling_provider', 'validating')
      ) as running_executions,
      (
        select count(*)::int from ai_retrieval_runs where status = 'running'
      ) as active_retrieval_runs,
      (
        select count(*)::int from ai_retrieval_query_embedding_calls
        where status in ('reserved', 'calling')
      ) as active_query_embedding_calls
  `);
  const objects = (await storage.listObjects("projects/")).length;
  const temporaryFiles = (await readdir("/tmp")).filter((entry) =>
    entry.startsWith("projectai-"),
  ).length;
  const result = { ...counts.rows[0], objects, temporary_files: temporaryFiles };
  if (Object.values(result).some((value) => Number(value) !== 0)) {
    throw new Error(`CI cleanup left test state: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await closeDatabasePool();
}
