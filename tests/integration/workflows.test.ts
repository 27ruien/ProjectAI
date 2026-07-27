import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { and, eq, like, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  documentChunk,
  documentIngestionJob,
  documentSection,
  project,
  projectMember,
  projectDocument,
  projectDocumentVersion,
  transcriptSpeaker,
  workflowArtifact,
  workflowArtifactVersion,
  workflowAudioJob,
  workflowDefinition,
  workflowExecution,
  workflowRun,
  workflowRunSource,
  user,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  createMeetingRun,
} from "../../lib/workflows/audio-service";
import {
  createRequirementFrameworkRun,
  cancelWorkflowRun,
  deleteMeetingAudio,
  regenerateWorkflowArtifact,
  readWorkflowRun,
  recordWorkflowExport,
  renameTranscriptSpeaker,
  retryWorkflowRun,
  reviewWorkflowRun,
  saveArtifactVersion,
} from "../../lib/workflows/service";
import { claimWorkflowRun, processWorkflowRun } from "../../lib/workflows/worker";
import { WorkflowError } from "../../lib/workflows/errors";
import { setObjectStorageForTests, type ObjectStorage, type StoredObjectMetadata } from "../../lib/files/object-storage";

const prefix = "v3-r2-workflow-test-";
const projectId = "project-001";
const headers = new Headers({ origin: "http://127.0.0.1:3200", "user-agent": "v3-round2-workflow-integration" });
const documentId = `${prefix}document`;
let manager: UserRecord;
let temporaryDirectory = "";
let requirementRunId = "";
let objectStorage: InMemoryObjectStorage;

class InMemoryObjectStorage implements ObjectStorage {
  private readonly entries = new Map<string, { body: Uint8Array; metadata: StoredObjectMetadata }>();
  private failDelete = false;

  constructor(private readonly corruptPutMetadata = false) {}

  setDeleteFailure(value: boolean) { this.failDelete = value; }

  async putObject(input: Parameters<ObjectStorage["putObject"]>[0]) {
    const metadata = { size: input.body.byteLength, etag: createHash("sha256").update(input.body).digest("hex"), sha256: input.sha256 };
    this.entries.set(input.key, { body: input.body, metadata });
    return this.corruptPutMetadata ? { ...metadata, size: metadata.size + 1 } : metadata;
  }
  async getObject(key: string) {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("OBJECT_NOT_FOUND");
    return { ...entry.metadata, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(entry.body); controller.close(); } }) };
  }
  async headObject(key: string) { return this.entries.get(key)?.metadata ?? null; }
  async deleteObject(key: string) {
    if (this.failDelete) throw new Error("OBJECT_DELETE_FAILED");
    this.entries.delete(key);
  }
  async listObjects(prefix: string) { return [...this.entries.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, entry]) => ({ key, ...entry.metadata })); }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for V3 Round 2 integration tests.`);
  return value;
}

function principal(): AuthenticatedPrincipal {
  return { sessionId: `${prefix}session`, user: manager };
}

async function clearFixtures() {
  const publishedDocuments = await getDb().execute<{ document_id: string }>(sql`
    select distinct wa.published_document_id as document_id
    from workflow_artifacts wa
    join workflow_runs wr on wr.id = wa.run_id
    where (
      wr.id like ${`${prefix}%`}
      or wr.id in (select run_id from workflow_run_sources where document_id = ${documentId})
    ) and wa.published_document_id is not null
  `);
  const publishedDocumentIds = publishedDocuments.rows.map((row) => row.document_id);
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`delete from workflow_runs where id like ${`${prefix}%`} or id in (select run_id from workflow_run_sources where document_id = ${documentId})`);
    if (publishedDocumentIds.length > 0) {
      const ids = sql.join(publishedDocumentIds.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`delete from document_embedding_jobs where document_id in (${ids})`);
      await tx.execute(sql`delete from document_chunks where document_id in (${ids})`);
      await tx.execute(sql`delete from document_sections where document_id in (${ids})`);
      await tx.execute(sql`delete from document_ingestion_jobs where document_id in (${ids})`);
      await tx.execute(sql`delete from project_document_versions where document_id in (${ids})`);
      await tx.execute(sql`delete from project_documents where id in (${ids})`);
    }
    await tx.delete(documentChunk).where(like(documentChunk.id, `${prefix}%`));
    await tx.delete(documentSection).where(like(documentSection.id, `${prefix}%`));
    await tx.delete(documentIngestionJob).where(like(documentIngestionJob.id, `${prefix}%`));
    await tx.delete(projectDocumentVersion).where(like(projectDocumentVersion.id, `${prefix}%`));
    await tx.delete(projectDocument).where(like(projectDocument.id, `${prefix}%`));
  });
}

describe("V3 Round 2 workflow database lifecycle", () => {
  before(async () => {
    objectStorage = new InMemoryObjectStorage();
    setObjectStorageForTests(objectStorage);
    const found = await findUserByEmail(required("SEED_MANAGER_A_EMAIL"));
    assert.ok(found);
    manager = found;
    await clearFixtures();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "projectai-workflow-integration-"));
    const signingKey = path.join(temporaryDirectory, "audio-signing");
    await writeFile(signingKey, Buffer.alloc(48, 9).toString("base64") + "\n", { mode: 0o600 });
    await chmod(signingKey, 0o600);
    process.env.AUDIO_DOWNLOAD_SIGNING_KEY_FILE = signingKey;
    process.env.AUDIO_PROVIDER_PUBLIC_BASE_URL = "https://example.invalid/tool/projectai";

    const versionId = `${prefix}version`;
    const jobId = `${prefix}ingestion`;
    const sectionId = `${prefix}section`;
    const content = "虚构项目需要项目经理在上线前确认验收范围。上线日期和 GA4 Measurement ID 尚未确认。";
    const digest = createHash("sha256").update(content).digest("hex");
    const analyticsContent = "GA4 contract requires the stable event experience_started and parameter event_schema_version.";
    const analyticsDigest = createHash("sha256").update(analyticsContent).digest("hex");
    const now = new Date();
    await getDb().transaction(async (tx) => {
      await tx.insert(projectDocument).values({ id: documentId, projectId, displayName: "虚构 V3 工作流来源.md", status: "active", createdBy: manager.id });
      await tx.insert(projectDocumentVersion).values({ id: versionId, documentId, projectId, versionNumber: 1, isCurrent: true, uploadId: `${prefix}upload`, objectKey: `projects/${projectId}/documents/${documentId}/versions/${versionId}/${randomUUID()}`, originalFilename: "fictional-v3.md", normalizedExtension: "md", declaredMimeType: "text/markdown", detectedMimeType: "text/markdown", sizeBytes: Buffer.byteLength(content), sha256: digest, storageEtag: `${prefix}etag`, storageStatus: "stored", uploadedBy: manager.id, storedAt: now });
      await tx.insert(documentIngestionJob).values({ id: jobId, projectId, documentId, versionId, generation: 1, status: "succeeded", parserVersion: "1", chunkerVersion: "1", attemptCount: 1, maxAttempts: 3, startedAt: now, completedAt: now, createdBy: manager.id });
      await tx.insert(documentSection).values({ id: sectionId, projectId, documentId, versionId, ingestionJobId: jobId, generation: 1, sectionType: "markdown_section", sectionIndex: 0, heading: "项目需求", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1, sourceLocator: { type: "markdown_section", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1 }, content, contentSha256: digest, characterCount: content.length, parserVersion: "1" });
      await tx.insert(documentChunk).values({ id: `${prefix}chunk`, projectId, documentId, versionId, sectionId, ingestionJobId: jobId, generation: 1, chunkIndex: 0, content, contentSha256: digest, searchText: content, characterCount: content.length, estimatedTokenCount: 48, headingPath: ["项目需求"], sourceLocator: { type: "markdown_section", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1 }, parserVersion: "1", chunkerVersion: "1", isEffective: true });
      await tx.insert(documentChunk).values({ id: `${prefix}chunk-2`, projectId, documentId, versionId, sectionId, ingestionJobId: jobId, generation: 1, chunkIndex: 1, content: analyticsContent, contentSha256: analyticsDigest, searchText: analyticsContent, characterCount: analyticsContent.length, estimatedTokenCount: 24, headingPath: ["GA4 contract"], sourceLocator: { type: "markdown_section", headingPath: ["GA4 contract"], lineStart: 2, lineEnd: 2 }, parserVersion: "1", chunkerVersion: "1", isEffective: true });
    });
  });

  after(async () => {
    await clearFixtures();
    delete process.env.AUDIO_DOWNLOAD_SIGNING_KEY_FILE;
    delete process.env.AUDIO_PROVIDER_PUBLIC_BASE_URL;
    await rm(temporaryDirectory, { recursive: true, force: true });
    await closeDatabasePool();
    setObjectStorageForTests(undefined);
  });

  it("deduplicates concurrent creation, grants one lease, and publishes four reviewed versions", async () => {
    const idempotencyKey = randomUUID();
    const input = { principal: principal(), projectId, documentIds: [documentId], idempotencyKey, requestHeaders: headers };
    const created = await Promise.all([createRequirementFrameworkRun(input), createRequirementFrameworkRun(input)]);
    assert.deepEqual(created.map((item) => item.created).sort(), [false, true]);
    assert.equal(new Set(created.map((item) => item.run.id)).size, 1);
    requirementRunId = created[0]!.run.id;

    const claimed = await Promise.all([
      claimWorkflowRun(`${prefix}worker-a`),
      claimWorkflowRun(`${prefix}worker-b`),
    ]);
    const winners = claimed.filter((item): item is NonNullable<typeof item> => item !== null);
    assert.equal(winners.length, 1);
    await processWorkflowRun(winners[0]!);

    const detail = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(detail.run.status, "awaiting_review");
    assert.equal(detail.artifacts.length, 4);
    assert.equal(detail.artifacts.every((item) => item.currentVersion === 1 && item.sourceReferences.length > 0), true);
    assert.equal(detail.artifacts.every((item) => item.sourceReferences.every((reference) => typeof reference.label === "string" && /^E[1-9][0-9]?$/.test(reference.label))), true);
    const executions = await getDb().select().from(workflowExecution).where(eq(workflowExecution.runId, winners[0]!.id));
    assert.equal(executions.length, 10);
    assert.equal(executions.every((execution) => execution.status === "succeeded"), true);

    await assert.rejects(
      saveArtifactVersion({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 1, content: { forged: true }, requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_ARTIFACT_SCHEMA_INVALID",
    );
    const forgedCitation = structuredClone(detail.artifacts[0]!.content) as {
      sections: Array<{ fields: Array<{ citations: string[] }> }>;
    };
    forgedCitation.sections[0]!.fields[0]!.citations = ["E99"];
    await assert.rejects(
      saveArtifactVersion({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 1, content: forgedCitation, requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID",
    );
    const sibling = detail.artifacts.find((artifact) => artifact.id !== detail.artifacts[0]!.id)!;
    const siblingVersion = await getDb().select({ sourceReferences: workflowArtifactVersion.sourceReferences }).from(workflowArtifactVersion).where(eq(workflowArtifactVersion.artifactId, sibling.id)).limit(1);
    const siblingReference = {
      label: "E2",
      documentId,
      versionId: `${prefix}version`,
      chunkId: `${prefix}chunk-2`,
      locator: { type: "markdown_section", headingPath: ["GA4 contract"], lineStart: 2, lineEnd: 2 },
    };
    await getDb().update(workflowArtifactVersion).set({ sourceReferences: [...siblingVersion[0]!.sourceReferences, siblingReference] }).where(and(eq(workflowArtifactVersion.artifactId, sibling.id), eq(workflowArtifactVersion.version, sibling.currentVersion)));
    const reviewerCitation = structuredClone(detail.artifacts[0]!.content) as {
      sections: Array<{ fields: Array<{ citations: string[] }> }>;
    };
    reviewerCitation.sections[0]!.fields[0]!.citations = [siblingReference.label];
    assert.equal(await saveArtifactVersion({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 1, content: reviewerCitation, requestHeaders: headers }), 2);
    const reviewerSaved = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(reviewerSaved.artifacts.find((artifact) => artifact.id === detail.artifacts[0]!.id)!.sourceReferences.some((reference) => reference.label === siblingReference.label), true);

    await regenerateWorkflowArtifact({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 2, requestHeaders: headers });
    const regenerationClaim = await claimWorkflowRun(`${prefix}regeneration-worker`);
    assert.equal(regenerationClaim?.id, winners[0]!.id);
    await processWorkflowRun(regenerationClaim!);
    const regenerated = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(regenerated.run.status, "awaiting_review");
    assert.deepEqual(regenerated.artifacts.map((artifact) => artifact.currentVersion).sort(), [1, 1, 1, 3]);

    await getDb().update(workflowRunSource).set({ status: "expired" }).where(eq(workflowRunSource.runId, winners[0]!.id));
    await assert.rejects(
      reviewWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, decision: "publish", note: "撤权验证", requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_SOURCE_ACCESS_REVOKED",
    );
    await getDb().update(workflowRunSource).set({ status: "ready" }).where(eq(workflowRunSource.runId, winners[0]!.id));

    await getDb().insert(workflowExecution).values(
      [1, 2, 3, 4].flatMap((step) => Array.from({ length: 19 }, (_, index) => ({
        id: `${prefix}setup-${step}-${index + 2}`,
        runId: winners[0]!.id,
        projectId,
        step,
        attempt: index + 2,
        status: "succeeded" as const,
        resultDigest: createHash("sha256").update(`setup:${step}:${index + 2}`).digest("hex"),
        completedAt: new Date(),
      }))),
    );
    await getDb().update(workflowRun).set({
      status: "failed",
      failureCode: "WORKFLOW_AI_OUTPUT_INVALID",
      failureStep: 7,
      completedAt: new Date(),
    }).where(eq(workflowRun.id, winners[0]!.id));
    await retryWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    const boundedRetryClaim = await claimWorkflowRun(`${prefix}bounded-retry-worker`);
    assert.equal(boundedRetryClaim?.id, winners[0]!.id);
    await processWorkflowRun(boundedRetryClaim!);
    const setupExecutionsAfterRetry = await getDb().select({
      step: workflowExecution.step,
      attempt: workflowExecution.attempt,
    }).from(workflowExecution).where(eq(workflowExecution.runId, winners[0]!.id));
    for (const step of [1, 2, 3, 4]) {
      assert.equal(
        Math.max(...setupExecutionsAfterRetry.filter((execution) => execution.step === step).map((execution) => execution.attempt)),
        20,
      );
    }
    const retried = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(retried.run.status, "awaiting_review");

    await reviewWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, decision: "publish", note: "虚构工作流集成审核", requestHeaders: headers });
    const published = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(published.run.status, "published");
    assert.equal(published.artifacts.every((item) => item.status === "published"), true);
    await recordWorkflowExport({ principal: principal(), projectId, artifactId: published.artifacts[0]!.id, format: "md", bytes: new TextEncoder().encode("fictional export"), requestHeaders: headers });
  });

  it("rejects a forged source project at the database boundary", async () => {
    const [run] = await getDb().select().from(workflowRun).where(eq(workflowRun.id, requirementRunId)).limit(1);
    assert.ok(run);
    await assert.rejects(getDb().insert(workflowRunSource).values({
      id: `${prefix}forged-source`, runId: run.id, projectId: run.projectId,
      sourceProjectId: "project-002", sourceType: "department_document",
      documentId, documentVersionId: `${prefix}version`, displayName: "forged",
      sha256: "f".repeat(64), status: "ready",
    }));
  });

  it("deduplicates the same meeting upload and rejects a different file with the same key", async () => {
    const idempotencyKey = randomUUID();
    const wav = (marker: number) => {
      const bytes = new Uint8Array(44);
      bytes.set(new TextEncoder().encode("RIFF"), 0);
      bytes.set(new TextEncoder().encode("WAVE"), 8);
      bytes[43] = marker;
      return new File([bytes], "fictional-meeting.wav", { type: "audio/wav" });
    };
    let runId = "";
    try {
      const first = await createMeetingRun({
        principal: principal(),
        projectId,
        file: wav(1),
        idempotencyKey,
        requestHeaders: headers,
      });
      runId = first.runId;
      assert.equal(first.created, true);

      const replay = await createMeetingRun({
        principal: principal(),
        projectId,
        file: wav(1),
        idempotencyKey,
        requestHeaders: headers,
      });
      assert.deepEqual(replay, { runId, created: false });

      await assert.rejects(
        createMeetingRun({
          principal: principal(),
          projectId,
          file: wav(2),
          idempotencyKey,
          requestHeaders: headers,
        }),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "WORKFLOW_IDEMPOTENCY_CONFLICT",
      );
      const rows = await getDb()
        .select({ id: workflowRun.id })
        .from(workflowRun)
        .where(eq(workflowRun.idempotencyKeyHash, createHash("sha256").update(JSON.stringify(idempotencyKey)).digest("hex")));
      assert.deepEqual(rows, [{ id: runId }]);
      const [job] = await getDb().select().from(workflowAudioJob).where(eq(workflowAudioJob.runId, runId));
      assert.equal(job?.transcriptionProvider, "fake");
      assert.equal(job?.transcriptionModel, "fake-paraformer-v2");
      assert.equal(job?.diarizationProvider, "fake");
      assert.equal(job?.diarizationModel, "fake-paraformer-v2");
    } finally {
      if (runId) await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });

  it("compensates an audio object when upload metadata integrity fails", async () => {
    const storage = new InMemoryObjectStorage(true);
    setObjectStorageForTests(storage);
    const idempotencyKey = `${prefix}corrupt-storage-${randomUUID()}`;
    try {
      await assert.rejects(
        createMeetingRun({
          principal: principal(),
          projectId,
          file: new File([new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
          ])], "fictional-corrupt.wav", { type: "audio/wav" }),
          idempotencyKey,
          requestHeaders: headers,
        }),
        (error: unknown) => error instanceof WorkflowError && error.code === "AUDIO_STORAGE_FAILED",
      );
      assert.deepEqual(await storage.listObjects(`projects/${projectId}/workflow-audio/`), []);
      const [failedRun] = await getDb().select().from(workflowRun).where(eq(
        workflowRun.idempotencyKeyHash,
        createHash("sha256").update(JSON.stringify(idempotencyKey)).digest("hex"),
      ));
      assert.equal(failedRun?.status, "failed");
      assert.equal(failedRun?.failureCode, "AUDIO_STORAGE_FAILED");
      if (failedRun) await getDb().delete(workflowRun).where(eq(workflowRun.id, failedRun.id));
    } finally {
      setObjectStorageForTests(objectStorage);
    }
  });

  it("restores a safe readable state when audio deletion fails and succeeds on retry", async () => {
    const idempotencyKey = `${prefix}delete-retry-${randomUUID()}`;
    const created = await createMeetingRun({
      principal: principal(),
      projectId,
      file: new File([new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
      ])], "fictional-delete.wav", { type: "audio/wav" }),
      idempotencyKey,
      requestHeaders: headers,
    });
    try {
      await getDb().update(workflowAudioJob).set({ status: "failed", failureCode: "TEST_ONLY", completedAt: new Date() }).where(eq(workflowAudioJob.runId, created.runId));
      objectStorage.setDeleteFailure(true);
      await assert.rejects(
        deleteMeetingAudio({ principal: principal(), projectId, runId: created.runId, requestHeaders: headers }),
        (error: unknown) => error instanceof WorkflowError && error.code === "AUDIO_DELETE_FAILED",
      );
      const [restored] = await getDb().select().from(workflowRunSource).where(eq(workflowRunSource.runId, created.runId));
      assert.equal(restored?.status, "ready");
      assert.equal((await objectStorage.listObjects(`projects/${projectId}/workflow-audio/${created.runId}/`)).length, 1);

      objectStorage.setDeleteFailure(false);
      await deleteMeetingAudio({ principal: principal(), projectId, runId: created.runId, requestHeaders: headers });
      const [deleted] = await getDb().select().from(workflowRunSource).where(eq(workflowRunSource.runId, created.runId));
      assert.equal(deleted?.status, "deleted");
      assert.deepEqual(await objectStorage.listObjects(`projects/${projectId}/workflow-audio/${created.runId}/`), []);
    } finally {
      objectStorage.setDeleteFailure(false);
      await getDb().delete(workflowRun).where(eq(workflowRun.id, created.runId));
    }
  });

  it("completes Fake ASR meeting flow, preserves generic speaker names, and versions rename edits", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}meeting`;
    const sourceId = `${prefix}audio-source`;
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构项目 · 会议纪要 · 2026-07-27", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "3".repeat(64), modelProfileId: definition.modelProfileId, status: "queued", currentStep: 1, idempotencyKeyHash: createHash("sha256").update(`${runId}:idempotency`).digest("hex") });
      await tx.insert(workflowRunSource).values({ id: sourceId, runId, projectId, sourceProjectId: projectId, sourceType: "audio", objectKey: `workflow-audio/fictional/${runId}.wav`, displayName: "虚构双人会议.wav", mimeType: "audio/wav", sizeBytes: 256, sha256: "5".repeat(64), status: "ready" });
      await tx.insert(workflowAudioJob).values({ id: `${prefix}audio-job`, runId, projectId, sourceId, transcriptionProvider: "fake", transcriptionModel: "fake-paraformer-v2", diarizationProvider: "fake", diarizationModel: "fake-paraformer-v2", status: "queued" });
    });
    const claimed = await claimWorkflowRun(`${prefix}audio-worker`);
    assert.equal(claimed?.id, runId);
    await processWorkflowRun(claimed!);
    const detail = await readWorkflowRun({ principal: principal(), projectId, runId, requestHeaders: headers });
    assert.equal(detail.run.status, "awaiting_review");
    assert.equal(detail.artifacts.length, 3);
    const speakers = await getDb().select().from(transcriptSpeaker).where(eq(transcriptSpeaker.runId, runId));
    assert.deepEqual(speakers.map((speaker) => speaker.displayName).sort(), ["Speaker 1", "Speaker 2"]);
    assert.equal(speakers.every((speaker) => !speaker.confirmedByUser), true);

    const minutes = detail.artifacts.find((artifact) => artifact.kind === "meeting_minutes");
    assert.ok(minutes);
    const forgedSegment = structuredClone(minutes.content) as {
      keyPoints: Array<{ segmentIds: string[] }>;
    };
    forgedSegment.keyPoints[0]!.segmentIds = ["S999"];
    await assert.rejects(
      saveArtifactVersion({ principal: principal(), projectId, runId, artifactId: minutes.id, expectedVersion: minutes.currentVersion, content: forgedSegment, requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_ARTIFACT_CITATION_SCOPE_INVALID",
    );

    await renameTranscriptSpeaker({ principal: principal(), projectId, runId, speakerId: speakers[0]!.id, displayName: "Client", requestHeaders: headers });
    const renamed = await getDb().select().from(transcriptSpeaker).where(eq(transcriptSpeaker.id, speakers[0]!.id));
    assert.equal(renamed[0]!.displayName, "Client");
    assert.equal(renamed[0]!.confirmedByUser, true);
    const artifacts = await getDb().select().from(workflowArtifact).where(eq(workflowArtifact.runId, runId));
    assert.equal(artifacts.every((artifact) => artifact.currentVersion === 2 && artifact.status === "draft"), true);
    const versions = await getDb().select().from(workflowArtifactVersion).where(eq(workflowArtifactVersion.projectId, projectId));
    assert.ok(versions.filter((version) => artifacts.some((artifact) => artifact.id === version.artifactId)).length >= 6);
  });

  it("recovers a crashed submitted ASR poll without submitting a second task", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}audio-recovery`;
    const sourceId = `${prefix}audio-recovery-source`;
    const expired = new Date(Date.now() - 60_000);
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构会议恢复", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "6".repeat(64), modelProfileId: definition.modelProfileId, status: "transcribing", currentStep: 2, idempotencyKeyHash: "7".repeat(64), leasedBy: `${prefix}crashed`, leaseToken: `${prefix}expired-token`, leaseExpiresAt: expired, heartbeatAt: expired });
      await tx.insert(workflowRunSource).values({ id: sourceId, runId, projectId, sourceProjectId: projectId, sourceType: "audio", objectKey: `workflow-audio/fictional/${runId}.wav`, displayName: "虚构恢复音频.wav", mimeType: "audio/wav", sizeBytes: 256, sha256: "8".repeat(64), status: "ready" });
      await tx.insert(workflowAudioJob).values({ id: `${prefix}audio-recovery-job`, runId, projectId, sourceId, transcriptionProvider: "fake", transcriptionModel: "fake-paraformer-v2", diarizationProvider: "fake", diarizationModel: "fake-paraformer-v2", providerTaskId: "fake-existing-provider-task", providerTaskIdHash: createHash("sha256").update("fake-existing-provider-task").digest("hex"), status: "transcribing" });
      await tx.insert(workflowExecution).values({ id: `${prefix}audio-recovery-execution`, runId, projectId, step: 2, attempt: 1, status: "running" });
    });
    try {
      const recovered = await claimWorkflowRun(`${prefix}recovery-worker`);
      assert.equal(recovered?.id, runId);
      assert.equal(recovered?.failureCode, null);
      const [oldExecution] = await getDb().select().from(workflowExecution).where(eq(workflowExecution.id, `${prefix}audio-recovery-execution`));
      assert.equal(oldExecution.status, "failed");
      assert.equal(oldExecution.failureCode, "WORKFLOW_LEASE_EXPIRED_RECOVERED");
    } finally {
      await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });

  it("revalidates membership, active user, document lifecycle, and current version before any Provider call", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    assert.ok(target);
    const [membership] = await getDb().select().from(projectMember).where(and(
      eq(projectMember.projectId, projectId),
      eq(projectMember.userId, manager.id),
    )).limit(1);
    assert.ok(membership);

    const assertBlocked = async (
      label: string,
      mutate: () => Promise<void>,
      restore: () => Promise<void>,
    ) => {
      const created = await createRequirementFrameworkRun({
        principal: principal(),
        projectId,
        documentIds: [documentId],
        idempotencyKey: `${prefix}reauthorize-${label}-${randomUUID()}`,
        requestHeaders: headers,
      });
      const claimed = await claimWorkflowRun(`${prefix}reauthorize-${label}`);
      assert.equal(claimed?.id, created.run.id);
      await mutate();
      try {
        await assert.rejects(
          processWorkflowRun(claimed!),
          (error: unknown) => error instanceof WorkflowError && error.code === "WORKFLOW_SOURCE_ACCESS_REVOKED",
        );
      } finally {
        await restore();
        await getDb().delete(workflowRun).where(eq(workflowRun.id, created.run.id));
      }
    };

    await getDb().update(project).set({ createdBy: "seed-admin" }).where(eq(project.id, projectId));
    try {
      await assertBlocked(
        "membership",
        async () => { await getDb().delete(projectMember).where(eq(projectMember.id, membership.id)); },
        async () => { await getDb().insert(projectMember).values(membership).onConflictDoNothing(); },
      );
      await assertBlocked(
        "disabled-user",
        async () => { await getDb().update(user).set({ status: "disabled" }).where(eq(user.id, manager.id)); },
        async () => { await getDb().update(user).set({ status: "active" }).where(eq(user.id, manager.id)); },
      );
      await assertBlocked(
        "archived-document",
        async () => { await getDb().update(projectDocument).set({ status: "archived", archivedBy: manager.id, archivedAt: new Date() }).where(eq(projectDocument.id, documentId)); },
        async () => { await getDb().update(projectDocument).set({ status: "active", archivedBy: null, archivedAt: null }).where(eq(projectDocument.id, documentId)); },
      );
      await assertBlocked(
        "old-version",
        async () => { await getDb().update(projectDocumentVersion).set({ isCurrent: false }).where(eq(projectDocumentVersion.documentId, documentId)); },
        async () => { await getDb().update(projectDocumentVersion).set({ isCurrent: true }).where(eq(projectDocumentVersion.id, `${prefix}version`)); },
      );
    } finally {
      await getDb().update(project).set({ createdBy: target.createdBy }).where(eq(project.id, projectId));
    }
  });

  it("keeps more than twenty ASR Pending polls inside one execution attempt", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}long-asr-poll`;
    const sourceId = `${prefix}long-asr-source`;
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构长轮询会议", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "9".repeat(64), modelProfileId: definition.modelProfileId, status: "queued", currentStep: 1, idempotencyKeyHash: createHash("sha256").update(`${runId}:idempotency`).digest("hex") });
      await tx.insert(workflowRunSource).values({ id: sourceId, runId, projectId, sourceProjectId: projectId, sourceType: "audio", objectKey: `projects/${projectId}/workflow-audio/${runId}/fictional.wav`, displayName: "虚构长轮询.wav", mimeType: "audio/wav", sizeBytes: 256, sha256: "b".repeat(64), status: "ready" });
      await tx.insert(workflowAudioJob).values({ id: `${prefix}long-asr-job`, runId, projectId, sourceId, transcriptionProvider: "fake", transcriptionModel: "fake-long-poll", diarizationProvider: "fake", diarizationModel: "fake-long-poll", status: "queued" });
    });
    let polls = 0;
    let submits = 0;
    const provider = {
      provider: "fake" as const,
      model: "fake-long-poll",
      diarizationProvider: "fake" as const,
      diarizationModel: "fake-long-poll",
      providesSpeakerIds: true as const,
      async submit() { submits += 1; return { taskId: "fake-long-running-provider-task" }; },
      async poll() {
        polls += 1;
        if (polls <= 25) return { status: "pending" as const };
        return { status: "succeeded" as const, durationMs: 2_000, segments: [{ startMs: 0, endMs: 2_000, speakerKey: "speaker-1", text: "虚构会议确认继续验收。", confidenceBps: 9000, language: "zh-CN" }] };
      },
    };
    try {
      for (let index = 0; index < 26; index += 1) {
        const claimed = await claimWorkflowRun(`${prefix}long-poll-worker-${index}`);
        assert.equal(claimed?.id, runId);
        await processWorkflowRun(claimed!, { audioProviderFactory: () => provider });
        if (index < 25) {
          await getDb().update(workflowRun).set({ nextAttemptAt: sql`now()` }).where(eq(workflowRun.id, runId));
        }
      }
      const attempts = await getDb().select().from(workflowExecution).where(and(
        eq(workflowExecution.runId, runId),
        eq(workflowExecution.step, 2),
      ));
      assert.equal(submits, 1);
      assert.equal(polls, 26);
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.attempt, 1);
      assert.equal(attempts[0]!.status, "succeeded");
    } finally {
      await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });

  it("cancels a released pending ASR run and closes its running execution", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}cancel-pending-asr`;
    const sourceId = `${prefix}cancel-pending-source`;
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构待取消会议", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "e".repeat(64), modelProfileId: definition.modelProfileId, status: "transcribing", currentStep: 2, idempotencyKeyHash: createHash("sha256").update(`${runId}:idempotency`).digest("hex"), nextAttemptAt: new Date() });
      await tx.insert(workflowRunSource).values({ id: sourceId, runId, projectId, sourceProjectId: projectId, sourceType: "audio", objectKey: `projects/${projectId}/workflow-audio/${runId}/fictional.wav`, displayName: "虚构待取消.wav", mimeType: "audio/wav", sizeBytes: 256, sha256: "1".repeat(64), status: "ready" });
      await tx.insert(workflowAudioJob).values({ id: `${prefix}cancel-pending-job`, runId, projectId, sourceId, transcriptionProvider: "fake", transcriptionModel: "fake-long-poll", diarizationProvider: "fake", diarizationModel: "fake-long-poll", providerTaskId: "fake-pending-provider-task", providerTaskIdHash: "2".repeat(64), status: "transcribing" });
      await tx.insert(workflowExecution).values({ id: `${prefix}cancel-pending-execution`, runId, projectId, step: 2, attempt: 1, status: "running" });
    });
    try {
      await cancelWorkflowRun({ principal: principal(), projectId, runId, requestHeaders: headers });
      const [cancelledRun] = await getDb().select().from(workflowRun).where(eq(workflowRun.id, runId));
      const [cancelledJob] = await getDb().select().from(workflowAudioJob).where(eq(workflowAudioJob.runId, runId));
      const [cancelledExecution] = await getDb().select().from(workflowExecution).where(eq(workflowExecution.runId, runId));
      assert.equal(cancelledRun!.status, "cancelled");
      assert.equal(cancelledJob!.status, "cancelled");
      assert.equal(cancelledExecution!.status, "cancelled");
      assert.equal(cancelledExecution!.failureCode, "WORKFLOW_CANCELLED");
      assert.ok(cancelledExecution!.completedAt);
    } finally {
      await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });

  it("never replays an ASR submission whose external result is unknown", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}unknown-asr-submit`;
    const sourceId = `${prefix}unknown-asr-source`;
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构未知提交会议", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "3".repeat(64), modelProfileId: definition.modelProfileId, status: "queued", currentStep: 1, idempotencyKeyHash: createHash("sha256").update(`${runId}:idempotency`).digest("hex") });
      await tx.insert(workflowRunSource).values({ id: sourceId, runId, projectId, sourceProjectId: projectId, sourceType: "audio", objectKey: `projects/${projectId}/workflow-audio/${runId}/fictional.wav`, displayName: "虚构未知提交.wav", mimeType: "audio/wav", sizeBytes: 256, sha256: "5".repeat(64), status: "ready" });
      await tx.insert(workflowAudioJob).values({ id: `${prefix}unknown-asr-job`, runId, projectId, sourceId, transcriptionProvider: "fake", transcriptionModel: "fake-unknown-submit", diarizationProvider: "fake", diarizationModel: "fake-unknown-submit", status: "queued" });
    });
    let submits = 0;
    const provider = {
      provider: "fake" as const,
      model: "fake-unknown-submit",
      diarizationProvider: "fake" as const,
      diarizationModel: "fake-unknown-submit",
      providesSpeakerIds: true as const,
      async submit() {
        submits += 1;
        throw new Error("connection closed after request body was sent");
      },
      async poll() { throw new Error("poll must not run"); },
    };
    try {
      const claimed = await claimWorkflowRun(`${prefix}unknown-submit-worker`);
      assert.equal(claimed?.id, runId);
      await assert.rejects(
        processWorkflowRun(claimed!, { audioProviderFactory: () => provider }),
        (error: unknown) => error instanceof WorkflowError && error.code === "WORKFLOW_PROVIDER_RESULT_UNKNOWN",
      );
      assert.equal(submits, 1);
      const [failedRun] = await getDb().select().from(workflowRun).where(eq(workflowRun.id, runId));
      const [failedJob] = await getDb().select().from(workflowAudioJob).where(eq(workflowAudioJob.runId, runId));
      const [failedExecution] = await getDb().select().from(workflowExecution).where(eq(workflowExecution.runId, runId));
      assert.equal(failedRun?.status, "failed");
      assert.equal(failedRun?.failureCode, "WORKFLOW_PROVIDER_RESULT_UNKNOWN");
      assert.equal(failedJob?.status, "failed");
      assert.equal(failedJob?.failureCode, "WORKFLOW_PROVIDER_RESULT_UNKNOWN");
      assert.equal(failedExecution?.status, "failed");
      await assert.rejects(
        retryWorkflowRun({ principal: principal(), projectId, runId, requestHeaders: headers }),
        (error: unknown) => error instanceof WorkflowError && error.code === "WORKFLOW_PROVIDER_RESULT_UNKNOWN",
      );
      assert.equal(submits, 1);
    } finally {
      await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });

  it("refuses direct replay when a Provider dispatch result is unknown", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}unknown-provider-result`;
    await getDb().insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构未知 Provider 结果", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "c".repeat(64), modelProfileId: definition.modelProfileId, status: "failed", currentStep: 2, idempotencyKeyHash: "d".repeat(64), failureCode: "WORKFLOW_PROVIDER_RESULT_UNKNOWN", failureStep: 2, completedAt: new Date() });
    try {
      await assert.rejects(
        retryWorkflowRun({ principal: principal(), projectId, runId, requestHeaders: headers }),
        (error: unknown) => error instanceof WorkflowError && error.code === "WORKFLOW_PROVIDER_RESULT_UNKNOWN",
      );
    } finally {
      await getDb().delete(workflowRun).where(eq(workflowRun.id, runId));
    }
  });
});
