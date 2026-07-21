import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  documentChunk,
  documentGrant,
  documentIngestionJob,
  documentSection,
  projectDocument,
  projectDocumentVersion,
  aiExecution,
  aiMessage,
  aiMessageCitation,
  aiRetrievalCandidate,
  aiRetrievalQueryEmbeddingCall,
  aiRetrievalRun,
  aiThread,
  requirement,
  requirementAudit,
  requirementDraft,
  requirementExtractionRun,
  requirementReview,
  requirementSource,
  requirementVersion,
  scopeComparisonRun,
  scopeDiffItem,
  scopeDiffReview,
  scopeVersion,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  compareScope,
  createScopeVersion,
  extractRequirementDrafts,
  reviewRequirementDraft,
} from "../../lib/project-management/requirements";
import {
  askProjectAssistant,
  createProjectAssistantThread,
  getProjectAssistantThread,
  ProjectAssistantError,
} from "../../lib/ai/project-assistant";

const prefix = "phase1-r2-test-";
const projectId = "project-001";
const headers = new Headers({ origin: "http://127.0.0.1:3200", "user-agent": "phase1-round2-integration" });
let manager: UserRecord;
const documentId = `${prefix}document`;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Round 2 integration tests.`);
  return value;
}

function principal(): AuthenticatedPrincipal {
  return { sessionId: `${prefix}session`, user: manager };
}

async function clearFixtures() {
  await getDb().transaction(async (tx) => {
    await tx.delete(aiMessageCitation).where(eq(aiMessageCitation.projectId, projectId));
    await tx.delete(aiRetrievalCandidate).where(eq(aiRetrievalCandidate.projectId, projectId));
    await tx.delete(aiRetrievalQueryEmbeddingCall).where(eq(aiRetrievalQueryEmbeddingCall.projectId, projectId));
    await tx.delete(aiRetrievalRun).where(eq(aiRetrievalRun.projectId, projectId));
    await tx.delete(aiExecution).where(eq(aiExecution.projectId, projectId));
    await tx.delete(aiMessage).where(eq(aiMessage.projectId, projectId));
    await tx.delete(aiThread).where(eq(aiThread.projectId, projectId));
    await tx.delete(scopeDiffReview).where(sql`${scopeDiffReview.projectId} = ${projectId}`);
    await tx.delete(scopeDiffItem).where(sql`${scopeDiffItem.projectId} = ${projectId}`);
    await tx.delete(scopeComparisonRun).where(sql`${scopeComparisonRun.projectId} = ${projectId}`);
    await tx.delete(scopeVersion).where(sql`${scopeVersion.projectId} = ${projectId}`);
    await tx.delete(requirementSource).where(sql`${requirementSource.projectId} = ${projectId}`);
    await tx.delete(requirementVersion).where(sql`${requirementVersion.projectId} = ${projectId}`);
    await tx.delete(requirementReview).where(sql`${requirementReview.projectId} = ${projectId}`);
    await tx.delete(requirementDraft).where(sql`${requirementDraft.projectId} = ${projectId}`);
    await tx.delete(requirementAudit).where(sql`${requirementAudit.projectId} = ${projectId}`);
    await tx.delete(requirement).where(sql`${requirement.projectId} = ${projectId}`);
    await tx.delete(requirementExtractionRun).where(sql`${requirementExtractionRun.projectId} = ${projectId}`);
    await tx.delete(documentGrant).where(sql`${documentGrant.id} like ${`${prefix}%`}`);
    await tx.delete(documentChunk).where(sql`${documentChunk.id} like ${`${prefix}%`}`);
    await tx.delete(documentSection).where(sql`${documentSection.id} like ${`${prefix}%`}`);
    await tx.delete(documentIngestionJob).where(sql`${documentIngestionJob.id} like ${`${prefix}%`}`);
    await tx.delete(projectDocumentVersion).where(sql`${projectDocumentVersion.id} like ${`${prefix}%`}`);
    await tx.delete(projectDocument).where(sql`${projectDocument.id} like ${`${prefix}%`}`);
  });
}

describe("Phase 1 Round 2 requirement and scope lifecycle", () => {
  before(async () => {
    const found = await findUserByEmail(required("SEED_MANAGER_A_EMAIL"));
    assert.ok(found);
    manager = found;
    await clearFixtures();
    const versionId = `${prefix}version`;
    const jobId = `${prefix}job`;
    const sectionId = `${prefix}section`;
    const content = "虚构客户要求 2026 年 11 月前完成组织知识搜索，并由项目经理人工验收。";
    const digest = createHash("sha256").update(content).digest("hex");
    const now = new Date();
    await getDb().transaction(async (tx) => {
      await tx.insert(projectDocument).values({ id: documentId, projectId, displayName: "虚构需求来源.md", status: "active", createdBy: manager.id });
      await tx.insert(projectDocumentVersion).values({ id: versionId, documentId, projectId, versionNumber: 1, isCurrent: true, uploadId: `${prefix}upload`, objectKey: `projects/${projectId}/documents/${documentId}/versions/${versionId}/${randomUUID()}`, originalFilename: "fictional.md", normalizedExtension: "md", declaredMimeType: "text/markdown", detectedMimeType: "text/markdown", sizeBytes: Buffer.byteLength(content), sha256: digest, storageEtag: `${prefix}etag`, storageStatus: "stored", uploadedBy: manager.id, storedAt: now });
      await tx.insert(documentIngestionJob).values({ id: jobId, projectId, documentId, versionId, generation: 1, status: "succeeded", parserVersion: "1", chunkerVersion: "1", attemptCount: 1, maxAttempts: 3, startedAt: now, completedAt: now, createdBy: manager.id });
      await tx.insert(documentSection).values({ id: sectionId, projectId, documentId, versionId, ingestionJobId: jobId, generation: 1, sectionType: "markdown_section", sectionIndex: 0, heading: "需求", headingPath: ["需求"], lineStart: 1, lineEnd: 1, sourceLocator: { type: "markdown_section", headingPath: ["需求"], lineStart: 1, lineEnd: 1 }, content, contentSha256: digest, characterCount: content.length, parserVersion: "1" });
      await tx.insert(documentChunk).values({ id: `${prefix}chunk`, projectId, documentId, versionId, sectionId, ingestionJobId: jobId, generation: 1, chunkIndex: 0, content, contentSha256: digest, searchText: content, characterCount: content.length, estimatedTokenCount: 30, headingPath: ["需求"], sourceLocator: { type: "markdown_section", headingPath: ["需求"], lineStart: 1, lineEnd: 1 }, parserVersion: "1", chunkerVersion: "1", isEffective: true });
    });
  });

  after(async () => {
    await clearFixtures();
    await closeDatabasePool();
  });

  it("atomically replays extraction and keeps AI output in draft state", async () => {
    const idempotencyKey = randomUUID();
    const input = { principal: principal(), projectId, documentIds: [documentId], idempotencyKey, requestHeaders: headers };
    const [first, second] = await Promise.all([extractRequirementDrafts(input), extractRequirementDrafts(input)]);
    assert.equal(new Set([first.run.id, second.run.id]).size, 1);
    const storedRuns = await getDb().select().from(requirementExtractionRun).where(eq(requirementExtractionRun.idempotencyKeyHash, first.run.idempotencyKeyHash));
    const storedDrafts = await getDb().select().from(requirementDraft).where(eq(requirementDraft.extractionRunId, first.run.id));
    const formal = await getDb().select().from(requirement).where(eq(requirement.projectId, projectId));
    assert.equal(storedRuns.length, 1);
    assert.equal(storedDrafts.length, 1);
    assert.equal(formal.length, 0);
  });

  it("creates formal data only after accept and reject creates none", async () => {
    const pending = await getDb().select().from(requirementDraft).where(eq(requirementDraft.projectId, projectId));
    assert.equal(pending.length, 1);
    const accepted = await reviewRequirementDraft({ principal: principal(), projectId, draftId: pending[0]!.id, decision: "edit_accept", fields: { title: "人工确认的组织知识搜索", description: pending[0]!.description, type: pending[0]!.type, priority: pending[0]!.priority, ownerUserId: null, acceptanceCriteria: pending[0]!.acceptanceCriteria, assumptions: pending[0]!.assumptions, openQuestions: pending[0]!.openQuestions }, note: "虚构集成审核", requestHeaders: headers });
    assert.ok(accepted.requirement);
    const second = await extractRequirementDrafts({ principal: principal(), projectId, documentIds: [documentId], idempotencyKey: randomUUID(), requestHeaders: headers });
    assert.ok(second.drafts[0]!.duplicateOfDraftId);
    const rejected = await reviewRequirementDraft({ principal: principal(), projectId, draftId: second.drafts[0]!.id, decision: "reject", note: "重复需求", requestHeaders: headers });
    assert.equal(rejected.requirement, null);
    assert.equal((await getDb().select().from(requirement).where(eq(requirement.projectId, projectId))).length, 1);
  });

  it("rejects unauthorized source narrowing and redacts an old thread after revocation", async () => {
    const thread = await createProjectAssistantThread({ principal: principal(), projectId, requestHeaders: headers });
    const response = await askProjectAssistant({
      principal: principal(),
      projectId,
      threadId: thread.id,
      requestHeaders: headers,
      idempotencyKey: randomUUID(),
      body: { question: "虚构客户要求什么？", modelProfileId: "qwen-project-assistant-cn-v1", sourceDocumentIds: [documentId] },
    });
    assert.equal(response.assistantMessage.status, "completed");
    assert.ok(response.assistantMessage.citations.length > 0);
    await assert.rejects(
      askProjectAssistant({ principal: principal(), projectId, threadId: thread.id, requestHeaders: headers, idempotencyKey: randomUUID(), body: { question: "不存在来源", modelProfileId: "qwen-project-assistant-cn-v1", sourceDocumentIds: [`${prefix}unknown`] } }),
      (error: unknown) => error instanceof ProjectAssistantError && error.code === "AI_SOURCE_NOT_FOUND",
    );
    await getDb().insert(documentGrant).values({ id: `${prefix}manager-view-deny`, organizationId: "org-legacy-default", projectId, documentId, subjectType: "user", subjectId: manager.id, permission: "view", effect: "deny", createdBy: manager.id });
    const revoked = await getProjectAssistantThread({ principal: principal(), projectId, threadId: thread.id, requestHeaders: headers });
    const answer = revoked.messages.find((message) => message.role === "assistant");
    assert.ok(answer);
    assert.match(answer.content, /内容已隐藏/);
    assert.equal(answer.citations.length, 0);
    await getDb().delete(documentGrant).where(eq(documentGrant.id, `${prefix}manager-view-deny`));
  });

  it("distinguishes not mentioned from explicit removal and records reviewable diffs", async () => {
    const [formal] = await getDb().select().from(requirement).where(eq(requirement.projectId, projectId));
    assert.ok(formal);
    const baseline = await createScopeVersion({ principal: principal(), projectId, name: "虚构 Baseline", includedRequirementIds: [formal.id], requestHeaders: headers });
    const omitted = await createScopeVersion({ principal: principal(), projectId, name: "虚构未提及版", includedRequirementIds: [], requestHeaders: headers });
    const notMentioned = await compareScope({ principal: principal(), projectId, baselineVersionId: baseline.id, candidateVersionId: omitted.id, requestHeaders: headers });
    assert.equal(notMentioned.items[0]!.diffType, "not_mentioned");
    const removed = await createScopeVersion({ principal: principal(), projectId, name: "虚构明确删除版", includedRequirementIds: [], removalDeclarations: [formal.id], requestHeaders: headers });
    const removal = await compareScope({ principal: principal(), projectId, baselineVersionId: baseline.id, candidateVersionId: removed.id, requestHeaders: headers });
    assert.equal(removal.items[0]!.diffType, "removed");
    assert.equal(removal.items[0]!.reviewStatus, "pending");
  });
});
