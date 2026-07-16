import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { AuthorizationError } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { ingestionSummariesForVersions } from "../../lib/db/repositories/ingestion-repository";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  auditEvent,
  documentChunk,
  documentIngestionJob,
  documentSection,
  project,
  projectDocument,
  projectDocumentVersion,
  projectMember,
  type UserRecord,
} from "../../lib/db/schema";
import { uploadDocument, setDocumentArchived } from "../../lib/files/document-service";
import { getObjectStorage } from "../../lib/files/object-storage";
import {
  claimIngestionJob,
  completeIngestionJob,
  ensureIngestionJob,
  failExhaustedJobs,
  recordIngestionFailure,
} from "../../lib/documents/processing/jobs";
import { DocumentProcessingError } from "../../lib/documents/processing/errors";
import { reindexDocumentVersion } from "../../lib/documents/processing/reindex-service";
import { searchProjectKnowledge } from "../../lib/documents/processing/search-service";
import { runDocumentWorker } from "../../lib/documents/processing/worker";
import {
  createMarkdownFixture,
  createScannedPdfFixture,
  createSearchableDocxFixture,
  createSearchablePdfFixture,
  createSearchablePptxFixture,
  createSearchableXlsxFixture,
  createTextFixture,
} from "../helpers/file-fixtures";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for document processing tests.`);
  return value;
};

function principal(user: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `document-processing-${user.id}`, user };
}

function headers(): Headers {
  return new Headers({
    "x-real-ip": "198.51.100.210",
    "user-agent": "project-ai-document-processing-integration-test",
  });
}

let adminUser: UserRecord;
let managerUser: UserRecord;
let managerBUser: UserRecord;
let memberUser: UserRecord;
let viewerUser: UserRecord;
let projectAId = "";
let projectBId = "";

async function upload(file: File, documentId?: string) {
  return uploadDocument({
    principal: principal(managerUser),
    projectId: projectAId,
    documentId,
    requestHeaders: headers(),
    idempotencyKey: crypto.randomUUID(),
    file,
    displayName: null,
  });
}

async function processOne(): Promise<void> {
  await runDocumentWorker({
    once: true,
    workerId: `integration-worker-${crypto.randomUUID()}`,
  });
}

async function search(
  user: UserRecord,
  query: string,
  documentIds: string[] = [],
) {
  return searchProjectKnowledge({
    principal: principal(user),
    projectId: projectAId,
    requestHeaders: headers(),
    body: { query, documentIds, limit: 20 },
  });
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(databaseUrl.pathname, /test|ci/i);
  assert.ok(
    ["127.0.0.1", "localhost", "postgres", "db"].includes(databaseUrl.hostname),
  );
  const storageEndpoint = new URL(required("OBJECT_STORAGE_ENDPOINT"));
  assert.equal(storageEndpoint.protocol, "http:");
  assert.match(required("OBJECT_STORAGE_BUCKET"), /test|ci/i);

  const users = await Promise.all([
    findUserByEmail(required("SEED_ADMIN_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
    findUserByEmail(required("SEED_MEMBER_A_EMAIL")),
    findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
  ]);
  users.forEach((user) => assert.ok(user));
  [adminUser, managerUser, managerBUser, memberUser, viewerUser] =
    users as UserRecord[];

  projectAId = `document-processing-${crypto.randomUUID()}`;
  projectBId = `document-processing-cross-${crypto.randomUUID()}`;
  await getDb().transaction(async (tx) => {
    await tx.insert(project).values([
      {
        id: projectAId,
        name: "Project Aurora 文档处理测试",
        clientName: "Example Client",
        description: "仅包含运行时生成的虚构测试资料",
        createdBy: adminUser.id,
      },
      {
        id: projectBId,
        name: "Project Borealis 隔离测试",
        clientName: "Example Client B",
        description: "仅用于跨项目隔离",
        createdBy: adminUser.id,
      },
    ]);
    await tx.insert(projectMember).values([
      {
        id: crypto.randomUUID(),
        projectId: projectAId,
        userId: managerUser.id,
        role: "project_manager",
        createdBy: adminUser.id,
      },
      {
        id: crypto.randomUUID(),
        projectId: projectAId,
        userId: memberUser.id,
        role: "project_member",
        createdBy: adminUser.id,
      },
      {
        id: crypto.randomUUID(),
        projectId: projectAId,
        userId: viewerUser.id,
        role: "viewer",
        createdBy: adminUser.id,
      },
      {
        id: crypto.randomUUID(),
        projectId: projectBId,
        userId: managerBUser.id,
        role: "project_manager",
        createdBy: adminUser.id,
      },
    ]);
  });
});

after(async () => {
  try {
    const storage = getObjectStorage();
    for (const projectId of [projectAId, projectBId]) {
      const objects = await storage.listObjects(`projects/${projectId}/`);
      await Promise.all(objects.map((object) => storage.deleteObject(object.key)));
    }
    const projectIds = [projectAId, projectBId];
    await getDb().delete(auditEvent).where(inArray(auditEvent.projectId, projectIds));
    await getDb()
      .delete(documentChunk)
      .where(inArray(documentChunk.projectId, projectIds));
    await getDb()
      .delete(documentSection)
      .where(inArray(documentSection.projectId, projectIds));
    await getDb()
      .delete(documentIngestionJob)
      .where(inArray(documentIngestionJob.projectId, projectIds));
    await getDb()
      .delete(projectDocumentVersion)
      .where(inArray(projectDocumentVersion.projectId, projectIds));
    await getDb()
      .delete(projectDocument)
      .where(inArray(projectDocument.projectId, projectIds));
    await getDb()
      .delete(projectMember)
      .where(inArray(projectMember.projectId, projectIds));
    await getDb().delete(project).where(inArray(project.id, projectIds));
  } finally {
    await closeDatabasePool();
  }
});

describe("document processing queue, parsers, and lexical search", () => {
  it("creates durable jobs and indexes every supported format with source locations", async () => {
    let fuzzyDocumentId = "";
    const cases = [
      {
        file: createSearchablePdfFixture(),
        query: "launch date",
        source: "pdf_page",
      },
      {
        file: createSearchableDocxFixture(),
        query: "Timeline",
        source: "docx_section",
      },
      {
        file: createSearchableXlsxFixture(),
        query: "budget",
        source: "xlsx_range",
      },
      {
        file: createSearchablePptxFixture(),
        query: "milestone",
        source: "pptx_slide",
      },
      {
        file: createTextFixture(
          "Project Aurora 中文计划.txt",
          "客户确认上线日期为十月十五日，负责人是 Example Manager。",
        ),
        query: "上线日期",
        source: "text_lines",
      },
      {
        file: createMarkdownFixture(
          "Project Aurora Requirements.md",
          "requirement: Project Aurora approval October 15 123e4567-e89b-12d3-a456-426614174000 aabbccddeeff00112233445566778899 fedcba98765432100123456789abcdef zyxwvutsrqponmlkjihgfedcba",
        ),
        query: "requirement",
        source: "markdown_section",
      },
    ] as const;

    for (const testCase of cases) {
      const stored = await upload(testCase.file);
      if (testCase.source === "markdown_section") {
        fuzzyDocumentId = stored.document.id;
      }
      const [pending] = await getDb()
        .select()
        .from(documentIngestionJob)
        .where(eq(documentIngestionJob.versionId, stored.version.id));
      assert.equal(pending?.status, "pending");
      const replay = await ensureIngestionJob({
        projectId: projectAId,
        documentId: stored.document.id,
        versionId: stored.version.id,
        createdBy: managerUser.id,
        reason: "stored",
      });
      assert.equal(replay.id, pending?.id);

      await processOne();
      const [completed] = await getDb()
        .select()
        .from(documentIngestionJob)
        .where(eq(documentIngestionJob.versionId, stored.version.id));
      assert.equal(completed?.status, "succeeded");
      const summary = (
        await ingestionSummariesForVersions([stored.version.id])
      ).get(stored.version.id);
      assert.ok(summary?.lastIndexedAt instanceof Date);
      const result = await search(viewerUser, testCase.query);
      const match = result.results.find(
        (item) => item.documentId === stored.document.id,
      );
      assert.ok(match, `${testCase.file.name} should be searchable`);
      assert.equal(match.source.type, testCase.source);
      assert.equal(JSON.stringify(match).includes("objectKey"), false);
    }

    assert.ok((await search(memberUser, "October 15")).results.length > 0);
    assert.ok((await search(managerUser, "launc date")).results.length > 0);
    assert.ok(fuzzyDocumentId);
    assert.ok(
      (await search(managerUser, "Octobr", [fuzzyDocumentId])).results.length >
        0,
    );
    assert.ok((await search(viewerUser, "上线日期")).results.length > 0);

    const concurrent = await upload(
      createTextFixture(
        "Project Aurora Concurrent Queue.txt",
        "concurrent ingestion creation marker",
      ),
    );
    await getDb()
      .delete(documentIngestionJob)
      .where(eq(documentIngestionJob.versionId, concurrent.version.id));
    const [jobA, jobB] = await Promise.all([
      ensureIngestionJob({
        projectId: projectAId,
        documentId: concurrent.document.id,
        versionId: concurrent.version.id,
        createdBy: managerUser.id,
        reason: "stored",
      }),
      ensureIngestionJob({
        projectId: projectAId,
        documentId: concurrent.document.id,
        versionId: concurrent.version.id,
        createdBy: managerUser.id,
        reason: "stored",
      }),
    ]);
    assert.equal(jobA.id, jobB.id);
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentIngestionJob)
          .where(eq(documentIngestionJob.versionId, concurrent.version.id))
      ).length,
      1,
    );
    await processOne();
  });

  it("marks scanned PDFs needs_ocr and preserves current-version, archive, and generation rules", async () => {
    const scanned = await upload(createScannedPdfFixture());
    await processOne();
    const [ocrJob] = await getDb()
      .select()
      .from(documentIngestionJob)
      .where(eq(documentIngestionJob.versionId, scanned.version.id));
    assert.equal(ocrJob?.status, "needs_ocr");
    assert.equal(ocrJob?.failureCode, "OCR_REQUIRED");
    assert.equal(
      (
        await getDb()
          .select()
          .from(documentChunk)
          .where(eq(documentChunk.versionId, scanned.version.id))
      ).length,
      0,
    );

    const v1 = await upload(
      createTextFixture("Project Aurora Versioned.txt", "Release marker ALPHA October 15"),
    );
    await processOne();
    assert.ok((await search(viewerUser, "ALPHA")).results.length > 0);

    const v2 = await upload(
      createTextFixture("Project Aurora Versioned.txt", "Release marker BETA November 20"),
      v1.document.id,
    );
    assert.equal((await search(viewerUser, "ALPHA")).results.length, 0);
    await processOne();
    const beta = await search(viewerUser, "BETA");
    assert.equal(beta.results.length, 1);
    assert.equal(beta.results[0]?.versionId, v2.version.id);

    const reindex = await reindexDocumentVersion({
      principal: principal(managerUser),
      projectId: projectAId,
      documentId: v2.document.id,
      versionId: v2.version.id,
      requestHeaders: headers(),
    });
    const claimed = await claimIngestionJob("generation-failure-worker");
    assert.equal(claimed?.id, reindex.id);
    await recordIngestionFailure({
      jobId: reindex.id,
      workerId: "generation-failure-worker",
      error: new DocumentProcessingError(
        "DOCUMENT_PARSE_FAILED",
        "Injected generation failure.",
      ),
    });
    assert.equal((await search(viewerUser, "BETA")).results.length, 1);

    await setDocumentArchived({
      principal: principal(managerUser),
      projectId: projectAId,
      documentId: v2.document.id,
      archived: true,
      requestHeaders: headers(),
    });
    assert.equal((await search(viewerUser, "BETA")).results.length, 0);
    await setDocumentArchived({
      principal: principal(managerUser),
      projectId: projectAId,
      documentId: v2.document.id,
      archived: false,
      requestHeaders: headers(),
    });
    assert.equal((await search(viewerUser, "BETA")).results.length, 1);
  });

  it("uses SKIP LOCKED, recovers expired leases, blocks stale workers, and enforces search permissions", async () => {
    const first = await upload(
      createTextFixture("queue-one.txt", "queue worker one"),
    );
    const second = await upload(
      createTextFixture("queue-two.txt", "queue worker two"),
    );
    const [claimA, claimB] = await Promise.all([
      claimIngestionJob("parallel-worker-a"),
      claimIngestionJob("parallel-worker-b"),
    ]);
    assert.ok(claimA && claimB);
    assert.notEqual(claimA.id, claimB.id);
    assert.deepEqual(
      new Set([claimA.versionId, claimB.versionId]),
      new Set([first.version.id, second.version.id]),
    );
    await getDb()
      .update(documentIngestionJob)
      .set({
        status: "cancelled",
        leasedBy: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: new Date(),
      })
      .where(inArray(documentIngestionJob.id, [claimA.id, claimB.id]));

    const leaseDocument = await upload(
      createTextFixture("lease-recovery.txt", "lease recovery content"),
    );
    const firstLease = await claimIngestionJob("lease-worker-a");
    assert.equal(firstLease?.versionId, leaseDocument.version.id);
    assert.equal(await claimIngestionJob("lease-worker-b"), null);
    await getDb()
      .update(documentIngestionJob)
      .set({
        startedAt: sql`now() - interval '10 seconds'`,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(documentIngestionJob.id, firstLease!.id));
    const recovered = await claimIngestionJob("lease-worker-b");
    assert.equal(recovered?.id, firstLease?.id);
    await assert.rejects(
      completeIngestionJob({
        jobId: firstLease!.id,
        workerId: "lease-worker-a",
        sections: [],
        chunks: [],
      }),
      (error: unknown) =>
        error instanceof DocumentProcessingError &&
        error.code === "WORKER_LEASE_LOST",
    );
    await recordIngestionFailure({
      jobId: recovered!.id,
      workerId: "lease-worker-b",
      error: new DocumentProcessingError(
        "DOCUMENT_PARSE_FAILED",
        "Injected terminal failure.",
      ),
    });

    const exhaustedDocument = await upload(
      createTextFixture("max-attempts.txt", "max attempt content"),
    );
    await getDb()
      .update(documentIngestionJob)
      .set({ maxAttempts: 1 })
      .where(eq(documentIngestionJob.versionId, exhaustedDocument.version.id));
    const exhaustedClaim = await claimIngestionJob("max-attempt-worker");
    await getDb()
      .update(documentIngestionJob)
      .set({
        startedAt: sql`now() - interval '10 seconds'`,
        leaseExpiresAt: sql`now() - interval '1 second'`,
      })
      .where(eq(documentIngestionJob.id, exhaustedClaim!.id));
    assert.equal(await failExhaustedJobs(), 1);
    const [exhausted] = await getDb()
      .select()
      .from(documentIngestionJob)
      .where(eq(documentIngestionJob.id, exhaustedClaim!.id));
    assert.equal(exhausted?.status, "failed");
    assert.equal(exhausted?.failureCode, "WORKER_MAX_ATTEMPTS_REACHED");

    await assert.rejects(
      searchProjectKnowledge({
        principal: principal(managerBUser),
        projectId: projectAId,
        requestHeaders: headers(),
        body: { query: "launch date" },
      }),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 404,
    );
    const knownDocument = await getDb()
      .select({ id: projectDocument.id })
      .from(projectDocument)
      .where(eq(projectDocument.projectId, projectAId))
      .limit(1);
    await assert.rejects(
      search(viewerUser, "launch date", [
        knownDocument[0]!.id,
        `cross-project-${crypto.randomUUID()}`,
      ]),
      /资料不存在/,
    );
    await assert.rejects(
      reindexDocumentVersion({
        principal: principal(viewerUser),
        projectId: projectAId,
        documentId: knownDocument[0]!.id,
        versionId: (
          await getDb()
            .select({ id: projectDocumentVersion.id })
            .from(projectDocumentVersion)
            .where(eq(projectDocumentVersion.documentId, knownDocument[0]!.id))
            .limit(1)
        )[0]!.id,
        requestHeaders: headers(),
      }),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 403,
    );

    const searchEvents = await getDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.projectId, projectAId),
          eq(auditEvent.eventType, "knowledge_search_executed"),
        ),
      );
    assert.ok(searchEvents.length > 0);
    for (const event of searchEvents) {
      assert.equal("query" in event.metadata, false);
      assert.match(String(event.metadata.queryHash), /^[0-9a-f]{64}$/);
    }
  });
});
