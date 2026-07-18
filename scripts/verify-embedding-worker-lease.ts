import { sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  EmbeddingPipelineError,
  claimEmbeddingJob,
  completeEmbeddingJob,
  recordEmbeddingFailure,
} from "../lib/ai/embeddings";
import { requiredEnvironment } from "./lib/staging-document-verification";

const runId = requiredEnvironment("EMBEDDING_SMOKE_RUN_ID");
const prefix = `B3-B1 虚构 Staging 向量验收 ${runId}`;
const workerA = `embedding-lease-a-${crypto.randomUUID()}`;
const workerB = `embedding-lease-b-${crypto.randomUUID()}`;

try {
  const candidates = await getDb().execute<{
    id: string;
    project_id: string;
    document_id: string;
  }>(sql`
    select j.id, j.project_id, j.document_id
    from document_embedding_jobs j
    inner join project_documents d
      on d.id = j.document_id and d.project_id = j.project_id
    where d.display_name like ${`${prefix}%`}
      and j.status = 'pending'
    order by j.created_at asc, j.id asc
  `);
  if (candidates.rows.length < 2) {
    throw new Error("Embedding Lease verification requires two pending fictional Jobs.");
  }
  const target = candidates.rows[0]!;
  await getDb().execute(sql`
    update document_embedding_jobs
    set available_at = case when id = ${target.id} then now() else now() + interval '1 hour' end,
        updated_at = now()
    where id in (${sql.join(
      candidates.rows.map((row) => sql`${row.id}`),
      sql`, `,
    )})
  `);
  const first = await claimEmbeddingJob(workerA);
  if (first?.id !== target.id) {
    throw new Error("Embedding Lease verification claimed an unexpected Job.");
  }
  await getDb().execute(sql`
    update document_embedding_jobs
    set started_at = now() - interval '10 seconds',
        lease_expires_at = now() - interval '1 second',
        updated_at = now()
    where id = ${first.id}
  `);
  const recovered = await claimEmbeddingJob(workerB);
  if (recovered?.id !== first.id || recovered.attemptCount !== first.attemptCount + 1) {
    throw new Error("Embedding stale Lease was not recovered by the next Worker.");
  }
  let staleRejected = false;
  try {
    await completeEmbeddingJob({ jobId: first.id, workerId: workerA });
  } catch (error) {
    staleRejected =
      error instanceof EmbeddingPipelineError &&
      error.code === "WORKER_LEASE_LOST";
  }
  if (!staleRejected) {
    throw new Error("The stale Embedding Worker was not rejected.");
  }
  await recordEmbeddingFailure({
    jobId: recovered.id,
    workerId: workerB,
    error: new EmbeddingPipelineError("SERVER_ERROR", true),
  });
  await getDb().execute(sql`
    update document_embedding_jobs
    set available_at = now(), updated_at = now()
    where id in (${sql.join(
      candidates.rows.map((row) => sql`${row.id}`),
      sql`, `,
    )}) and status = 'pending'
  `);
  process.stdout.write(
    `${JSON.stringify({
      recoveredJob: true,
      staleWorkerRejected: true,
      attemptCount: recovered.attemptCount,
      pendingJobsReleased: candidates.rows.length,
    })}\n`,
  );
} finally {
  await closeDatabasePool();
}
