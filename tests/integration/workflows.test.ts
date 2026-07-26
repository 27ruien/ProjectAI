import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { eq, like, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  documentChunk,
  documentIngestionJob,
  documentSection,
  project,
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
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  createRequirementFrameworkRun,
  regenerateWorkflowArtifact,
  readWorkflowRun,
  recordWorkflowExport,
  renameTranscriptSpeaker,
  reviewWorkflowRun,
  saveArtifactVersion,
} from "../../lib/workflows/service";
import { claimWorkflowRun, processWorkflowRun } from "../../lib/workflows/worker";
import { setObjectStorageForTests, type ObjectStorage, type StoredObjectMetadata } from "../../lib/files/object-storage";

const prefix = "v3-r2-workflow-test-";
const projectId = "project-001";
const headers = new Headers({ origin: "http://127.0.0.1:3200", "user-agent": "v3-round2-workflow-integration" });
const documentId = `${prefix}document`;
let manager: UserRecord;
let temporaryDirectory = "";
let requirementRunId = "";

class InMemoryObjectStorage implements ObjectStorage {
  private readonly entries = new Map<string, { body: Uint8Array; metadata: StoredObjectMetadata }>();
  async putObject(input: Parameters<ObjectStorage["putObject"]>[0]) {
    const metadata = { size: input.body.byteLength, etag: createHash("sha256").update(input.body).digest("hex"), sha256: input.sha256 };
    this.entries.set(input.key, { body: input.body, metadata });
    return metadata;
  }
  async getObject(key: string) {
    const entry = this.entries.get(key);
    if (!entry) throw new Error("OBJECT_NOT_FOUND");
    return { ...entry.metadata, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(entry.body); controller.close(); } }) };
  }
  async headObject(key: string) { return this.entries.get(key)?.metadata ?? null; }
  async deleteObject(key: string) { this.entries.delete(key); }
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
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`delete from workflow_runs where id like ${`${prefix}%`} or id in (select run_id from workflow_run_sources where document_id = ${documentId})`);
    await tx.delete(documentChunk).where(like(documentChunk.id, `${prefix}%`));
    await tx.delete(documentSection).where(like(documentSection.id, `${prefix}%`));
    await tx.delete(documentIngestionJob).where(like(documentIngestionJob.id, `${prefix}%`));
    await tx.delete(projectDocumentVersion).where(like(projectDocumentVersion.id, `${prefix}%`));
    await tx.delete(projectDocument).where(like(projectDocument.id, `${prefix}%`));
  });
}

describe("V3 Round 2 workflow database lifecycle", () => {
  before(async () => {
    setObjectStorageForTests(new InMemoryObjectStorage());
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
    const now = new Date();
    await getDb().transaction(async (tx) => {
      await tx.insert(projectDocument).values({ id: documentId, projectId, displayName: "虚构 V3 工作流来源.md", status: "active", createdBy: manager.id });
      await tx.insert(projectDocumentVersion).values({ id: versionId, documentId, projectId, versionNumber: 1, isCurrent: true, uploadId: `${prefix}upload`, objectKey: `projects/${projectId}/documents/${documentId}/versions/${versionId}/${randomUUID()}`, originalFilename: "fictional-v3.md", normalizedExtension: "md", declaredMimeType: "text/markdown", detectedMimeType: "text/markdown", sizeBytes: Buffer.byteLength(content), sha256: digest, storageEtag: `${prefix}etag`, storageStatus: "stored", uploadedBy: manager.id, storedAt: now });
      await tx.insert(documentIngestionJob).values({ id: jobId, projectId, documentId, versionId, generation: 1, status: "succeeded", parserVersion: "1", chunkerVersion: "1", attemptCount: 1, maxAttempts: 3, startedAt: now, completedAt: now, createdBy: manager.id });
      await tx.insert(documentSection).values({ id: sectionId, projectId, documentId, versionId, ingestionJobId: jobId, generation: 1, sectionType: "markdown_section", sectionIndex: 0, heading: "项目需求", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1, sourceLocator: { type: "markdown_section", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1 }, content, contentSha256: digest, characterCount: content.length, parserVersion: "1" });
      await tx.insert(documentChunk).values({ id: `${prefix}chunk`, projectId, documentId, versionId, sectionId, ingestionJobId: jobId, generation: 1, chunkIndex: 0, content, contentSha256: digest, searchText: content, characterCount: content.length, estimatedTokenCount: 48, headingPath: ["项目需求"], sourceLocator: { type: "markdown_section", headingPath: ["项目需求"], lineStart: 1, lineEnd: 1 }, parserVersion: "1", chunkerVersion: "1", isEffective: true });
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
    const executions = await getDb().select().from(workflowExecution).where(eq(workflowExecution.runId, winners[0]!.id));
    assert.equal(executions.length, 10);
    assert.equal(executions.every((execution) => execution.status === "succeeded"), true);

    await assert.rejects(
      saveArtifactVersion({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 1, content: { forged: true }, requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_ARTIFACT_SCHEMA_INVALID",
    );
    await regenerateWorkflowArtifact({ principal: principal(), projectId, runId: winners[0]!.id, artifactId: detail.artifacts[0]!.id, expectedVersion: 1, requestHeaders: headers });
    const regenerationClaim = await claimWorkflowRun(`${prefix}regeneration-worker`);
    assert.equal(regenerationClaim?.id, winners[0]!.id);
    await processWorkflowRun(regenerationClaim!);
    const regenerated = await readWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, requestHeaders: headers });
    assert.equal(regenerated.run.status, "awaiting_review");
    assert.deepEqual(regenerated.artifacts.map((artifact) => artifact.currentVersion).sort(), [1, 1, 1, 2]);

    await getDb().update(workflowRunSource).set({ status: "expired" }).where(eq(workflowRunSource.runId, winners[0]!.id));
    await assert.rejects(
      reviewWorkflowRun({ principal: principal(), projectId, runId: winners[0]!.id, decision: "publish", note: "撤权验证", requestHeaders: headers }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "WORKFLOW_SOURCE_ACCESS_REVOKED",
    );
    await getDb().update(workflowRunSource).set({ status: "ready" }).where(eq(workflowRunSource.runId, winners[0]!.id));

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

  it("completes Fake ASR meeting flow, preserves generic speaker names, and versions rename edits", async () => {
    const [target] = await getDb().select().from(project).where(eq(project.id, projectId)).limit(1);
    const [definition] = await getDb().select().from(workflowDefinition).where(eq(workflowDefinition.workflowType, "meeting_minutes")).limit(1);
    assert.ok(target?.departmentId && definition);
    const runId = `${prefix}meeting`;
    const sourceId = `${prefix}audio-source`;
    await getDb().transaction(async (tx) => {
      await tx.insert(workflowRun).values({ id: runId, definitionId: definition.id, organizationId: target.organizationId, departmentId: target.departmentId, projectId, workflowType: "meeting_minutes", creatorId: manager.id, displayName: "虚构项目 · 会议纪要 · 2026-07-27", authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: "3".repeat(64), modelProfileId: definition.modelProfileId, status: "queued", currentStep: 1, idempotencyKeyHash: "4".repeat(64) });
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
    const recovered = await claimWorkflowRun(`${prefix}recovery-worker`);
    assert.equal(recovered?.id, runId);
    assert.equal(recovered?.failureCode, null);
    const [oldExecution] = await getDb().select().from(workflowExecution).where(eq(workflowExecution.id, `${prefix}audio-recovery-execution`));
    assert.equal(oldExecution.status, "failed");
    assert.equal(oldExecution.failureCode, "WORKFLOW_LEASE_EXPIRED_RECOVERED");
  });
});
