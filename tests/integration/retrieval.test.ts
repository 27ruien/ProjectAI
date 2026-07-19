import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { FakeEmbeddingProvider } from "../../lib/ai/embeddings/fake-provider";
import {
  askProjectAssistant,
  createProjectAssistantThread,
} from "../../lib/ai/project-assistant";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  aiExecution,
  aiMessage,
  aiMessageCitation,
  aiRetrievalCandidate,
  aiRetrievalProfile,
  aiRetrievalQueryEmbeddingCall,
  aiRetrievalRun,
  aiThread,
  auditEvent,
  documentChunk,
  documentChunkEmbedding,
  documentEmbeddingJob,
  documentIngestionJob,
  documentSection,
  projectDocument,
  projectDocumentVersion,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";

const prefix = "b3b2-test-";
const projectA = "project-001";
const projectB = "project-002";
const headers = new Headers({
  origin: "http://127.0.0.1:3000",
  "user-agent": "project-ai-b3b2-integration",
  "x-real-ip": "198.51.100.82",
});

let managerA: UserRecord;
let managerB: UserRecord;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for retrieval integration tests.`);
  return value;
}

function principal(user: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `${prefix}session-${user.id}`, user };
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

function postgresErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const own = "message" in error ? String(error.message) : "";
  const cause = "cause" in error ? postgresErrorMessage(error.cause) : "";
  return `${own} ${cause}`.trim();
}

async function vectorFor(text: string): Promise<number[]> {
  const result = await new FakeEmbeddingProvider().embed({
    model: "text-embedding-v4",
    dimensions: 1024,
    inputs: [text],
    timeoutMs: 5_000,
  });
  return result.vectors[0]!;
}

async function clearState(): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(aiMessageCitation);
    await tx.delete(aiRetrievalCandidate);
    await tx.delete(aiRetrievalQueryEmbeddingCall);
    await tx.delete(aiRetrievalRun);
    await tx.delete(aiExecution);
    await tx.delete(aiMessage);
    await tx.delete(aiThread);
    await tx.delete(documentChunkEmbedding);
    await tx.delete(documentEmbeddingJob);
    // This suite already requires a test/CI database. Clear the document chain
    // as one unit so global Embedding cleanup cannot leave unrelated effective
    // Chunks without vectors and distort the project Coverage gate.
    await tx.delete(documentChunk);
    await tx.delete(documentSection);
    await tx.delete(documentIngestionJob);
    await tx.delete(projectDocumentVersion);
    await tx.delete(projectDocument);
    await tx
      .delete(auditEvent)
      .where(sql`${auditEvent.eventType} like 'ai_%'`);
    await tx
      .update(aiRetrievalProfile)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(aiRetrievalProfile.id, "hybrid-rrf-v1"));
  });
  process.env.AI_ASSISTANT_RETRIEVAL_MODE = "hybrid";
  process.env.AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT = "5000000";
}

async function seedChunk(input: {
  projectId: string;
  actor: UserRecord;
  suffix: string;
  content: string;
  vector?: number[];
  documentStatus?: "active" | "archived";
  current?: boolean;
  effective?: boolean;
}) {
  const documentId = `${prefix}document-${input.suffix}`;
  const versionId = `${prefix}version-${input.suffix}`;
  const ingestionJobId = `${prefix}ingestion-${input.suffix}`;
  const sectionId = `${prefix}section-${input.suffix}`;
  const chunkId = `${prefix}chunk-${input.suffix}`;
  const hash = createHash("sha256").update(input.content).digest("hex");
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.insert(projectDocument).values({
      id: documentId,
      projectId: input.projectId,
      displayName: `虚构混合检索资料 ${input.suffix}`,
      status: input.documentStatus ?? "active",
      createdBy: input.actor.id,
      archivedAt:
        (input.documentStatus ?? "active") === "archived" ? now : null,
      archivedBy:
        (input.documentStatus ?? "active") === "archived"
          ? input.actor.id
          : null,
    });
    await tx.insert(projectDocumentVersion).values({
      id: versionId,
      documentId,
      projectId: input.projectId,
      versionNumber: 1,
      isCurrent: input.current ?? true,
      uploadId: `${prefix}upload-${input.suffix}`,
      objectKey: `projects/${input.projectId}/documents/${documentId}/versions/${versionId}/${randomUUID()}`,
      originalFilename: `fictional-${input.suffix}.txt`,
      normalizedExtension: "txt",
      declaredMimeType: "text/plain",
      detectedMimeType: "text/plain",
      sizeBytes: Buffer.byteLength(input.content),
      sha256: hash,
      storageEtag: `${prefix}etag-${input.suffix}`,
      storageStatus: "stored",
      uploadedBy: input.actor.id,
      storedAt: now,
    });
    await tx.insert(documentIngestionJob).values({
      id: ingestionJobId,
      projectId: input.projectId,
      documentId,
      versionId,
      generation: 1,
      status: "succeeded",
      parserVersion: "1",
      chunkerVersion: "1",
      attemptCount: 1,
      maxAttempts: 3,
      startedAt: now,
      completedAt: now,
      createdBy: input.actor.id,
    });
    await tx.insert(documentSection).values({
      id: sectionId,
      projectId: input.projectId,
      documentId,
      versionId,
      ingestionJobId,
      generation: 1,
      sectionType: "text",
      sectionIndex: 0,
      heading: "虚构检索资料",
      headingPath: ["虚构检索资料"],
      lineStart: 1,
      lineEnd: 1,
      sourceLocator: { type: "text_lines", lineStart: 1, lineEnd: 1 },
      content: input.content,
      contentSha256: hash,
      characterCount: input.content.length,
      parserVersion: "1",
    });
    await tx.insert(documentChunk).values({
      id: chunkId,
      projectId: input.projectId,
      documentId,
      versionId,
      sectionId,
      ingestionJobId,
      generation: 1,
      chunkIndex: 0,
      content: input.content,
      contentSha256: hash,
      searchText: input.content,
      characterCount: input.content.length,
      estimatedTokenCount: Math.max(1, Math.ceil(input.content.length / 3)),
      headingPath: ["虚构检索资料"],
      sourceLocator: { type: "text_lines", lineStart: 1, lineEnd: 1 },
      parserVersion: "1",
      chunkerVersion: "1",
      isEffective: input.effective ?? true,
    });
    if (input.vector) {
      const embeddingJobId = `${prefix}embedding-job-${input.suffix}`;
      await tx.insert(documentEmbeddingJob).values({
        id: embeddingJobId,
        projectId: input.projectId,
        documentId,
        versionId,
        embeddingProfileId: "qwen-text-embedding-cn-v1",
        generation: 1,
        status: "succeeded",
        attemptCount: 1,
        maxAttempts: 3,
        chunkCount: 1,
        completedChunkCount: 1,
        providerCallCount: 0,
        latencyMs: 0,
        createdBy: input.actor.id,
        startedAt: now,
        completedAt: now,
      });
      await tx.insert(documentChunkEmbedding).values({
        id: `${prefix}embedding-${input.suffix}`,
        projectId: input.projectId,
        documentId,
        versionId,
        chunkId,
        embeddingProfileId: "qwen-text-embedding-cn-v1",
        embeddingJobId,
        embedding: input.vector,
        contentSha256: hash,
        status: "current",
      });
    }
  });
  return { documentId, versionId, chunkId };
}

async function createThread(actor = managerA) {
  return createProjectAssistantThread({
    principal: principal(actor),
    projectId: actor.id === managerB.id ? projectB : projectA,
    requestHeaders: headers,
  });
}

async function ask(question: string, key = randomUUID()) {
  const thread = await createThread();
  const result = await askProjectAssistant({
    principal: principal(managerA),
    projectId: projectA,
    threadId: thread.id,
    requestHeaders: headers,
    idempotencyKey: key,
    body: {
      question,
      modelProfileId: "qwen-project-assistant-cn-v1",
    },
  });
  return { thread, result };
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(databaseUrl.pathname, /test|ci/i);
  const users = await Promise.all([
    findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
  ]);
  assert.ok(users[0]);
  assert.ok(users[1]);
  managerA = users[0];
  managerB = users[1];
});

beforeEach(clearState);

after(async () => {
  await clearState();
  await closeDatabasePool();
});

describe("evaluated hybrid retrieval persistence and modes", () => {
  it("keeps lexical mode identical and never creates a query embedding call", async () => {
    const query = "精确发布日期 2031-04-09";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "lexical",
      content: `精确发布日期 2031-04-09，预算 420000 元。`,
      vector: await vectorFor(query),
    });
    process.env.AI_ASSISTANT_RETRIEVAL_MODE = "lexical";
    const { result } = await ask(query);
    assert.equal(result.execution.status, "succeeded");
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.requestedMode, "lexical");
    assert.equal(run?.effectiveMode, "lexical");
    assert.equal(run?.fallbackReason, null);
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 0);
  });

  it("records shadow candidates while keeping lexical evidence", async () => {
    const query = "精确金额 420000 元";
    const fixture = await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "shadow",
      content: "精确金额 420000 元，审批日期 2031-04-09。",
      vector: await vectorFor(query),
    });
    process.env.AI_ASSISTANT_RETRIEVAL_MODE = "shadow";
    const { result } = await ask(query);
    assert.equal(result.execution.status, "succeeded");
    assert.equal(result.assistantMessage.citations[0]?.documentId, fixture.documentId);
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.requestedMode, "shadow");
    assert.equal(run?.effectiveMode, "lexical");
    assert.equal(run?.fallbackReason, "SHADOW_MODE");
    assert.ok((run?.vectorCandidateCount ?? 0) > 0);
    assert.ok((await getDb().select().from(aiRetrievalCandidate)).length > 0);
  });

  it("uses vector evidence for a semantic query with no lexical match", async () => {
    const query = "何时正式投产";
    const fixture = await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "semantic",
      content: "系统启用日期为 2031 年 4 月 9 日。",
      vector: await vectorFor(query),
    });
    const { result } = await ask(query);
    assert.equal(result.execution.status, "succeeded");
    assert.equal(result.assistantMessage.citations[0]?.documentId, fixture.documentId);
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.effectiveMode, "hybrid");
    assert.equal(run?.embeddingCoverageBps, 10_000);
    const [candidate] = await getDb().select().from(aiRetrievalCandidate);
    assert.equal(candidate?.candidateSource, "vector");
    assert.equal(candidate?.selectedAsEvidence, true);
  });

  it("never admits a more similar cross-project, old-version, or archived chunk", async () => {
    const query = "跨项目语义范围验证";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "scope-current",
      content: "当前项目的有效范围说明。",
      vector: await vectorFor(query),
    });
    const cross = await seedChunk({
      projectId: projectB,
      actor: managerB,
      suffix: "scope-cross",
      content: "另一个项目的内容更相似。",
      vector: await vectorFor(query),
    });
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "scope-old",
      content: "旧版本不得出现。",
      vector: await vectorFor(query),
      current: false,
    });
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "scope-archived",
      content: "归档资料不得出现。",
      vector: await vectorFor(query),
      documentStatus: "archived",
    });
    await ask(query);
    const candidates = await getDb().select().from(aiRetrievalCandidate);
    assert.equal(candidates.length, 1);
    assert.equal(candidates.some((item) => item.chunkId === cross.chunkId), false);
    assert.equal(candidates.every((item) => item.projectId === projectA), true);
  });

  it("falls back before dispatch when coverage is below 98 percent", async () => {
    const query = "覆盖率回退";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "coverage-one",
      content: "覆盖率回退的词法证据。",
      vector: await vectorFor(query),
    });
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "coverage-two",
      content: "未生成向量的有效资料。",
    });
    const { result } = await ask(query);
    assert.equal(result.execution.status, "succeeded");
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.effectiveMode, "lexical");
    assert.equal(run?.fallbackReason, "EMBEDDING_COVERAGE_INSUFFICIENT");
    assert.equal(run?.embeddingCoverageBps, 5_000);
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 0);
  });

  it("falls back on post-dispatch unknown without retrying or mutating the terminal call", async () => {
    const question = "QUERY_EMBEDDING_TIMEOUT_TEST";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "timeout",
      content: `${question} 的词法回退证据。`,
      vector: await vectorFor("unrelated-vector"),
    });
    const { result } = await ask(question);
    assert.equal(result.execution.status, "succeeded");
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.fallbackReason, "QUERY_EMBEDDING_UNKNOWN");
    const [call] = await getDb().select().from(aiRetrievalQueryEmbeddingCall);
    assert.equal(call?.status, "unknown");
    assert.equal(call?.failureCode, "PROVIDER_RESULT_UNKNOWN");
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 1);
    await assert.rejects(
      getDb()
        .update(aiRetrievalQueryEmbeddingCall)
        .set({ latencyMs: 999 })
        .where(eq(aiRetrievalQueryEmbeddingCall.id, call!.id)),
      (error: unknown) => postgresErrorCode(error) === "P0001",
    );
  });

  it("releases a confirmed pre-dispatch reservation and preserves usage-null reservations", async () => {
    const preDispatch = "QUERY_EMBEDDING_PRE_DISPATCH_TEST";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "pre-dispatch",
      content: `${preDispatch} 的词法回退证据。`,
      vector: await vectorFor("pre-dispatch-seed"),
    });
    await ask(preDispatch);
    let [call] = await getDb().select().from(aiRetrievalQueryEmbeddingCall);
    assert.equal(call?.status, "failed_confirmed_no_charge");
    await clearState();
    const usageNull = "QUERY_EMBEDDING_USAGE_NULL_TEST";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "usage-null",
      content: `${usageNull} 的有效资料。`,
      vector: await vectorFor(usageNull),
    });
    await ask(usageNull);
    [call] = await getDb().select().from(aiRetrievalQueryEmbeddingCall);
    assert.equal(call?.status, "succeeded");
    assert.equal(call?.inputTokenCount, null);
    assert.equal(call?.reservedInputTokens, 8_192);
  });

  it("enforces the independent daily budget and falls back without a second call", async () => {
    process.env.AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT = "8192";
    const firstQuery = "每日预算第一次调用";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "budget",
      content: `${firstQuery} 与第二次调用的词法证据。`,
      vector: await vectorFor(firstQuery),
    });
    await ask(firstQuery);
    const { result } = await ask("第二次调用");
    assert.equal(result.execution.status, "succeeded");
    const runs = await getDb().select().from(aiRetrievalRun);
    assert.equal(runs.some((run) => run.fallbackReason === "QUERY_EMBEDDING_DAILY_LIMIT"), true);
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 1);
  });

  it("replays one Retrieval Run and one Query Embedding Call for the same key", async () => {
    const query = "幂等检索调用";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "idempotency",
      content: "幂等检索调用的虚构资料。",
      vector: await vectorFor(query),
    });
    const thread = await createThread();
    const key = randomUUID();
    const request = () =>
      askProjectAssistant({
        principal: principal(managerA),
        projectId: projectA,
        threadId: thread.id,
        requestHeaders: headers,
        idempotencyKey: key,
        body: {
          question: query,
          modelProfileId: "qwen-project-assistant-cn-v1",
        },
      });
    const first = await request();
    process.env.AI_ASSISTANT_RETRIEVAL_MODE = "shadow";
    const replay = await request();
    assert.equal(replay.execution.id, first.execution.id);
    assert.equal(replay.execution.replayed, true);
    assert.equal((await getDb().select().from(aiRetrievalRun)).length, 1);
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 1);
  });

  it("falls back when the immutable profile is disabled", async () => {
    const query = "Profile disabled fallback";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "profile-disabled",
      content: `${query} lexical evidence.`,
      vector: await vectorFor(query),
    });
    await assert.rejects(
      getDb()
        .update(aiRetrievalProfile)
        .set({ vectorMaxDistance: 0.6 })
        .where(eq(aiRetrievalProfile.id, "hybrid-rrf-v1")),
      (error: unknown) =>
        postgresErrorMessage(error).includes(
          "retrieval profile definitions are immutable",
        ),
    );
    await assert.rejects(
      getDb()
        .delete(aiRetrievalProfile)
        .where(eq(aiRetrievalProfile.id, "hybrid-rrf-v1")),
      (error: unknown) =>
        postgresErrorMessage(error).includes(
          "retrieval profile definitions are immutable",
        ),
    );
    await getDb()
      .update(aiRetrievalProfile)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(aiRetrievalProfile.id, "hybrid-rrf-v1"));
    await ask(query);
    const [run] = await getDb().select().from(aiRetrievalRun);
    assert.equal(run?.fallbackReason, "RETRIEVAL_PROFILE_DISABLED");
    assert.equal((await getDb().select().from(aiRetrievalQueryEmbeddingCall)).length, 0);
  });

  it("rejects cross-project Candidate ownership at the database boundary", async () => {
    const query = "候选归属约束";
    await seedChunk({
      projectId: projectA,
      actor: managerA,
      suffix: "candidate-a",
      content: "候选归属约束的当前项目资料。",
      vector: await vectorFor(query),
    });
    const cross = await seedChunk({
      projectId: projectB,
      actor: managerB,
      suffix: "candidate-b",
      content: "候选归属约束的其他项目资料。",
      vector: await vectorFor(query),
    });
    await ask(query);
    const [run] = await getDb().select().from(aiRetrievalRun);
    await assert.rejects(
      getDb().insert(aiRetrievalCandidate).values({
        id: randomUUID(),
        retrievalRunId: run!.id,
        projectId: projectA,
        chunkId: cross.chunkId,
        documentId: cross.documentId,
        versionId: cross.versionId,
        candidateSource: "vector",
        vectorRank: 2,
        vectorDistance: 0.1,
        rrfScore: 1 / 62,
        finalRank: 2,
      }),
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });
});
