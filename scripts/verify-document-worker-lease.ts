import { randomUUID } from "node:crypto";
import nodeAssert from "node:assert/strict";
import { closeDatabasePool, getDb } from "../lib/db/client";
import { documentIngestionJob } from "../lib/db/schema";
import {
  claimIngestionJob,
  completeIngestionJob,
  recordIngestionFailure,
} from "../lib/documents/processing/jobs";
import { DocumentProcessingError } from "../lib/documents/processing/errors";
import type { ProjectDocumentUploadResponse } from "../types/documents";
import { createTextFixture } from "../tests/helpers/file-fixtures";
import { eq, inArray, sql } from "drizzle-orm";
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

const environment = documentVerificationEnvironment();
const runId = randomUUID();
const displayNamePrefix = "B2 虚构 Staging Lease 验收 ";
const userAgent = `projectai-staging-document-lease/0.5/${runId}`;
const managerEmail = requiredEnvironment("SEED_MANAGER_A_EMAIL");
const managerPassword = requiredEnvironment("SEED_MANAGER_A_PASSWORD");

let manager: VerificationSession | null = null;

async function upload(key: string): Promise<ProjectDocumentUploadResponse> {
  assert(manager, "Manager Session is unavailable.");
  const response = await uploadVerificationDocument({
    environment,
    session: manager,
    projectId: environment.projectAId,
    file: createTextFixture(
      `B2-lease-${key}-${runId}.txt`,
      `B2 fictitious lease verification ${key} ${runId}`,
    ),
    displayName: `${displayNamePrefix}${key} ${runId}`,
  });
  assert(response.status === 201, `Lease fixture upload returned ${response.status}.`);
  return responseJson(response, "Lease fixture upload");
}

let verificationError: unknown;
try {
  await cleanupDocumentVerification({
    projectId: environment.projectAId,
    displayNamePrefix,
    userAgents: [userAgent],
    userAgentPrefixes: ["projectai-staging-document-lease/0.5/"],
  });
  const queued = await getDb()
    .select({ id: documentIngestionJob.id })
    .from(documentIngestionJob)
    .where(inArray(documentIngestionJob.status, ["pending", "running"]));
  assert(queued.length === 0, "Worker queue must be idle before Lease verification.");

  manager = await signIn({
    environment,
    email: managerEmail,
    password: managerPassword,
    userAgent,
  });
  const leaseFixture = await upload("recovery");
  const firstLease = await claimIngestionJob(`staging-lease-a-${runId}`);
  assert(firstLease?.versionId === leaseFixture.version.id, "First Worker did not claim the Lease fixture.");
  const unavailable = await claimIngestionJob(`staging-lease-b-${runId}`);
  assert(unavailable === null, "A live Lease was claimed by another Worker.");

  await getDb()
    .update(documentIngestionJob)
    .set({
      startedAt: sql`now() - interval '10 seconds'`,
      leaseExpiresAt: sql`now() - interval '1 second'`,
    })
    .where(eq(documentIngestionJob.id, firstLease.id));
  const recovered = await claimIngestionJob(`staging-lease-b-${runId}`);
  assert(recovered?.id === firstLease.id, "Expired Lease was not recovered.");
  assert(recovered.attemptCount === 2, "Lease recovery did not increment attempt count.");
  await nodeAssert.rejects(
    completeIngestionJob({
      jobId: firstLease.id,
      workerId: `staging-lease-a-${runId}`,
      sections: [],
      chunks: [],
    }),
    (error: unknown) =>
      error instanceof DocumentProcessingError &&
      error.code === "WORKER_LEASE_LOST",
  );
  await recordIngestionFailure({
    jobId: recovered.id,
    workerId: `staging-lease-b-${runId}`,
    error: new DocumentProcessingError(
      "DOCUMENT_PARSE_FAILED",
      "Injected Staging Lease verification failure.",
    ),
  });

  const [parallelA, parallelB] = await Promise.all([
    upload("parallel-a"),
    upload("parallel-b"),
  ]);
  const [claimA, claimB] = await Promise.all([
    claimIngestionJob(`staging-parallel-a-${runId}`),
    claimIngestionJob(`staging-parallel-b-${runId}`),
  ]);
  assert(claimA && claimB, "Parallel Workers did not both claim a Job.");
  assert(claimA.id !== claimB.id, "Parallel Workers claimed the same Job.");
  nodeAssert.deepEqual(
    new Set([claimA.versionId, claimB.versionId]),
    new Set([parallelA.version.id, parallelB.version.id]),
    "SKIP LOCKED claims did not match the two queued versions.",
  );
  await getDb()
    .update(documentIngestionJob)
    .set({
      status: "cancelled",
      completedAt: sql`now()`,
      leasedBy: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      updatedAt: sql`now()`,
    })
    .where(inArray(documentIngestionJob.id, [claimA.id, claimB.id]));

  await signOut(environment, manager);
  manager = null;
  const cleanup = await cleanupDocumentVerification({
    projectId: environment.projectAId,
    displayNamePrefix,
    userAgents: [userAgent],
    userAgentPrefixes: ["projectai-staging-document-lease/0.5/"],
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      exclusiveLease: true,
      leaseRecovery: true,
      staleWorkerRejected: true,
      skipLocked: true,
      cleanup,
    })}\n`,
  );
} catch (error) {
  verificationError = error;
  throw error;
} finally {
  try {
    await signOut(environment, manager);
  } catch (cleanupError) {
    if (!verificationError) throw cleanupError;
  }
  try {
    await cleanupDocumentVerification({
      projectId: environment.projectAId,
      displayNamePrefix,
      userAgents: [userAgent],
      userAgentPrefixes: ["projectai-staging-document-lease/0.5/"],
    });
  } catch (cleanupError) {
    if (!verificationError) throw cleanupError;
  } finally {
    await closeDatabasePool();
  }
}
