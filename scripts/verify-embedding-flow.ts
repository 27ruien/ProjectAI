import { closeDatabasePool, getPool } from "../lib/db/client";
import {
  enqueueEmbeddingBackfill,
  ensureEmbeddingJob,
} from "../lib/ai/embeddings";
import type { ProjectDocumentUploadResponse } from "../types/documents";
import { createTextFixture } from "../tests/helpers/file-fixtures";
import {
  assert,
  cleanupDocumentVerification,
  documentVerificationEnvironment,
  requiredEnvironment,
  responseJson,
  signIn,
  signOut,
  uploadVerificationDocument,
  type VerificationSession,
} from "./lib/staging-document-verification";

const prepare = process.argv.includes("--prepare");
const verify = process.argv.includes("--verify");
assert(prepare !== verify, "Select exactly one Embedding smoke mode.");

const environment = documentVerificationEnvironment();
const runId = requiredEnvironment("EMBEDDING_SMOKE_RUN_ID");
assert(/^[0-9a-f-]{36}$/i.test(runId), "Embedding smoke Run ID is invalid.");
const displayNamePrefix = `B3-B1 虚构 Staging 向量验收 ${runId}`;
const managerAUserAgent = `projectai-staging-embedding-manager-a/0.7/${runId}`;
const managerBUserAgent = `projectai-staging-embedding-manager-b/0.7/${runId}`;
const managerAEmail = requiredEnvironment("SEED_MANAGER_A_EMAIL");
const managerAPassword = requiredEnvironment("SEED_MANAGER_A_PASSWORD");
const managerBEmail = requiredEnvironment("SEED_MANAGER_B_EMAIL");
const managerBPassword = requiredEnvironment("SEED_MANAGER_B_PASSWORD");

let managerA: VerificationSession | null = null;
let managerB: VerificationSession | null = null;

async function cleanupAll() {
  const first = await cleanupDocumentVerification({
    projectId: environment.projectAId,
    displayNamePrefix,
    userAgents: [managerAUserAgent, managerBUserAgent],
  });
  const second = await cleanupDocumentVerification({
    projectId: environment.projectBId,
    displayNamePrefix,
    userAgents: [managerAUserAgent, managerBUserAgent],
  });
  return { first, second };
}

async function waitForIngestion(documentId: string, versionId: string) {
  const pool = getPool();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{
      status: string;
      chunk_count: number;
    }>(
      `select j.status,
              (select count(*)::int from document_chunks c where c.ingestion_job_id = j.id) as chunk_count
       from document_ingestion_jobs j
       where j.document_id = $1 and j.version_id = $2
       order by j.generation desc
       limit 1`,
      [documentId, versionId],
    );
    const row = result.rows[0];
    if (row?.status === "succeeded" && row.chunk_count > 0) return row;
    if (row && ["failed", "needs_ocr", "cancelled"].includes(row.status)) {
      throw new Error(`Embedding fixture ingestion entered ${row.status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Embedding fixture ingestion timed out.");
}

async function waitForEmbedding(documentId: string, versionId: string) {
  const pool = getPool();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{
      id: string;
      status: string;
      failure_code: string | null;
      chunk_count: number;
      completed_chunk_count: number;
      provider_call_count: number;
      input_token_count: number | null;
    }>(
      `select id, status, failure_code, chunk_count, completed_chunk_count,
              provider_call_count, input_token_count
       from document_embedding_jobs
       where document_id = $1 and version_id = $2
         and embedding_profile_id = 'qwen-text-embedding-cn-v1'
       order by generation desc
       limit 1`,
      [documentId, versionId],
    );
    const row = result.rows[0];
    if (
      row?.status === "succeeded" &&
      row.chunk_count > 0 &&
      row.completed_chunk_count === row.chunk_count
    ) {
      return row;
    }
    if (row && ["failed", "cancelled"].includes(row.status)) {
      throw new Error(
        `Embedding fixture Job entered ${row.status}:${row.failure_code ?? "unknown"}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Embedding fixture generation timed out.");
}

async function uploadFixture(input: {
  session: VerificationSession;
  projectId: string;
  label: string;
  text: string;
  documentId?: string;
}) {
  const response = await uploadVerificationDocument({
    environment,
    session: input.session,
    projectId: input.projectId,
    file: createTextFixture(`${input.label}-${runId}.txt`, input.text),
    displayName: `${displayNamePrefix} ${input.label}`,
    documentId: input.documentId,
  });
  assert(response.status === 201, `${input.label} upload returned ${response.status}.`);
  return responseJson<ProjectDocumentUploadResponse>(response, input.label);
}

async function fixtureRows() {
  const result = await getPool().query<{
    project_id: string;
    document_id: string;
    version_id: string;
    version_number: number;
    display_name: string;
  }>(
    `select d.project_id, d.id as document_id, v.id as version_id,
            v.version_number, d.display_name
     from project_documents d
     inner join project_document_versions v
       on v.document_id = d.id and v.project_id = d.project_id
     where d.display_name like $1
     order by d.project_id, d.id, v.version_number`,
    [`${displayNamePrefix}%`],
  );
  return result.rows;
}

let verificationError: unknown;
try {
  if (prepare) {
    await cleanupAll();
    managerA = await signIn({
      environment,
      email: managerAEmail,
      password: managerAPassword,
      userAgent: managerAUserAgent,
    });
    managerB = await signIn({
      environment,
      email: managerBEmail,
      password: managerBPassword,
      userAgent: managerBUserAgent,
    });
    const first = await uploadFixture({
      session: managerA,
      projectId: environment.projectAId,
      label: "Project-A",
      text: "Project AI embedding alpha milestone is October 15. This is fictional verification data.",
    });
    const second = await uploadFixture({
      session: managerB,
      projectId: environment.projectBId,
      label: "Project-B",
      text: "Project AI embedding beta milestone is November 20. This is fictional verification data.",
    });
    await Promise.all([
      waitForIngestion(first.document.id, first.version.id),
      waitForIngestion(second.document.id, second.version.id),
    ]);
    const pending = await getPool().query<{ count: number }>(
      `select count(*)::int as count
       from document_embedding_jobs j
       inner join project_documents d
         on d.id = j.document_id and d.project_id = j.project_id
       where d.display_name like $1 and j.status = 'pending'`,
      [`${displayNamePrefix}%`],
    );
    assert(pending.rows[0]?.count === 2, "Incremental ingestion did not create two pending Embedding Jobs.");
    process.stdout.write(
      `${JSON.stringify({
        prepared: true,
        fictionalDocuments: 2,
        ingestionSucceeded: 2,
        pendingEmbeddingJobs: 2,
      })}\n`,
    );
  } else {
    const initialRows = await fixtureRows();
    assert(initialRows.length === 2, "Prepared Embedding fixtures are missing.");
    const projectA = initialRows.find((row) => row.project_id === environment.projectAId);
    const projectB = initialRows.find((row) => row.project_id === environment.projectBId);
    assert(projectA && projectB, "Prepared fixtures did not cover both projects.");
    const [jobA, jobB] = await Promise.all([
      waitForEmbedding(projectA.document_id, projectA.version_id),
      waitForEmbedding(projectB.document_id, projectB.version_id),
    ]);
    assert(
      Number(jobA.input_token_count) > 0 && Number(jobB.input_token_count) > 0,
      "Real Embedding Provider Usage was not persisted.",
    );
    const vectorState = await getPool().query<{
      project_id: string;
      vector_count: number;
      valid_dimensions: boolean;
      model_valid: boolean;
      batch_size_valid: boolean;
      cost_unestimated: boolean;
    }>(
      `select
         j.project_id,
         count(e.id)::int as vector_count,
         bool_and(vector_dims(e.embedding) = 1024) as valid_dimensions,
         bool_and(b.model = 'text-embedding-v4' and b.dimensions = 1024) as model_valid,
         bool_and(b.chunk_count between 1 and 10) as batch_size_valid,
         bool_and(b.cost_micro_cny is null) as cost_unestimated
       from document_embedding_jobs j
       inner join document_embedding_batches b on b.job_id = j.id and b.status = 'succeeded'
       inner join document_chunk_embeddings e on e.embedding_job_id = j.id and e.status = 'current'
       where j.id = any($1::text[])
       group by j.project_id
       order by j.project_id`,
      [[jobA.id, jobB.id]],
    );
    assert(
      vectorState.rows.length === 2 &&
        vectorState.rows.every(
          (row) =>
            row.vector_count > 0 &&
            row.valid_dimensions &&
            row.model_valid &&
            row.batch_size_valid &&
            row.cost_unestimated,
        ),
      "Stored Embedding metadata failed validation.",
    );
    const scopeProbe = await getPool().query<{
      chunk_id: string;
      project_id: string;
      distance: number;
    }>(
      `with query_embedding as (
         select embedding
         from document_chunk_embeddings
         where project_id = $1 and version_id = $2 and status = 'current'
         order by chunk_id
         limit 1
       )
       select e.chunk_id, e.project_id,
              (e.embedding <=> query_embedding.embedding)::float8 as distance
       from document_chunk_embeddings e
       cross join query_embedding
       where e.project_id = $1 and e.status = 'current'
       order by e.embedding <=> query_embedding.embedding, e.chunk_id
       limit 5`,
      [environment.projectAId, projectA.version_id],
    );
    assert(
      scopeProbe.rows.length > 0 &&
        scopeProbe.rows.every((row) => row.project_id === environment.projectAId) &&
        Math.abs(scopeProbe.rows[0]!.distance) < 1e-9,
      "Exact vector scope Probe crossed the project boundary or missed itself.",
    );

    const batchCountBefore = await getPool().query<{ count: number }>(
      `select count(*)::int as count from document_embedding_batches where job_id = $1`,
      [jobA.id],
    );
    const manager = await getPool().query<{ id: string }>(
      "select id from users where email = $1",
      [managerAEmail],
    );
    assert(manager.rows[0]?.id, "Manager identity is unavailable.");
    assert(
      (await ensureEmbeddingJob({
        projectId: projectA.project_id,
        documentId: projectA.document_id,
        versionId: projectA.version_id,
        createdBy: manager.rows[0]!.id,
        reason: "backfill",
      })) === null,
      "Same-hash Embedding replay created a duplicate Job.",
    );

    await getPool().query(
      `update document_chunk_embeddings
       set status = 'invalid', updated_at = now()
       where id = (
         select id from document_chunk_embeddings
         where project_id = $1 and version_id = $2 and status = 'current'
         order by chunk_id limit 1
       )`,
      [environment.projectAId, projectA.version_id],
    );
    const backfill = await enqueueEmbeddingBackfill({
      projectId: environment.projectAId,
      limit: 1,
      apply: true,
    });
    assert(backfill.enqueuedJobs === 1, "Safe project-scoped Backfill did not enqueue one Job.");
    const backfillJob = await waitForEmbedding(projectA.document_id, projectA.version_id);
    assert(
      backfillJob.provider_call_count === 0,
      "Same-hash Backfill called the Provider instead of reusing the valid vector.",
    );
    const replayBackfill = await enqueueEmbeddingBackfill({
      projectId: environment.projectAId,
      limit: 1,
      apply: true,
    });
    assert(replayBackfill.enqueuedJobs === 0, "Backfill replay was not idempotent.");

    managerA = await signIn({
      environment,
      email: managerAEmail,
      password: managerAPassword,
      userAgent: managerAUserAgent,
    });
    const versionTwo = await uploadFixture({
      session: managerA,
      projectId: environment.projectAId,
      label: "Project-A-v2",
      text: "Project AI embedding alpha milestone moved to October 22. This is fictional verification data.",
      documentId: projectA.document_id,
    });
    await waitForIngestion(versionTwo.document.id, versionTwo.version.id);
    const incremental = await waitForEmbedding(
      versionTwo.document.id,
      versionTwo.version.id,
    );
    assert(incremental.provider_call_count > 0, "Changed content did not call the Embedding Provider.");
    const versionValidity = await getPool().query<{
      old_current: number;
      old_invalid: number;
      new_current: number;
    }>(
      `select
         count(*) filter (where version_id = $1 and status = 'current')::int as old_current,
         count(*) filter (where version_id = $1 and status = 'invalid')::int as old_invalid,
         count(*) filter (where version_id = $2 and status = 'current')::int as new_current
       from document_chunk_embeddings
       where document_id = $3`,
      [projectA.version_id, versionTwo.version.id, projectA.document_id],
    );
    assert(
      versionValidity.rows[0]?.old_current === 0 &&
        Number(versionValidity.rows[0]?.old_invalid) > 0 &&
        Number(versionValidity.rows[0]?.new_current) > 0,
      "Old and current version Embedding validity is incorrect.",
    );
    const batchCountAfter = await getPool().query<{ count: number }>(
      `select count(*)::int as count from document_embedding_batches where job_id = $1`,
      [jobA.id],
    );
    assert(
      batchCountAfter.rows[0]?.count === batchCountBefore.rows[0]?.count,
      "Same-hash replay duplicated the original Provider billing record.",
    );
    await signOut(environment, managerA);
    managerA = null;
    await signOut(environment, managerB);
    managerB = null;
    const cleanup = await cleanupAll();
    const pending = await getPool().query<{ count: number }>(
      `select count(*)::int as count
       from document_embedding_jobs
       where status in ('pending', 'running')`,
    );
    assert(pending.rows[0]?.count === 0, "Embedding queue is not idle after cleanup.");
    process.stdout.write(
      `${JSON.stringify({
        verified: true,
        realProviderJobs: 3,
        dimensions: 1024,
        exactScopeProbe: true,
        staleLeaseRecovered: true,
        backfillIdempotent: true,
        oldVersionExcluded: true,
        cleanup,
      })}\n`,
    );
  }
} catch (error) {
  verificationError = error;
} finally {
  try {
    await signOut(environment, managerA);
    await signOut(environment, managerB);
  } catch (error) {
    verificationError ??= error;
  }
  if (verificationError) {
    try {
      await cleanupAll();
    } catch (cleanupError) {
      verificationError = new AggregateError(
        [verificationError, cleanupError],
        "Embedding verification and cleanup failed.",
      );
    }
  }
  await closeDatabasePool();
}

if (verificationError) throw verificationError;
