import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
} from "../../lib/auth/session";
import { ProjectAssistantError } from "../../lib/ai/project-assistant/errors";
import { closeDatabasePool, getDb, getPool } from "../../lib/db/client";
import {
  aiMessage,
  aiThread,
  auditEvent,
  documentChunk,
  documentChunkEmbedding,
  documentGrant,
  documentEmbeddingBatch,
  documentEmbeddingJob,
  documentEmbeddingProviderCall,
  documentIngestionJob,
  documentSection,
  embeddingWorkerHeartbeat,
  productMapArtifact,
  productMapArtifactVersion,
  productMapExecution,
  productMapRun,
  productMapSource,
  project,
  projectDocument,
  projectDocumentVersion,
  projectMember,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import { uploadDocument } from "../../lib/files/document-service";
import { getObjectStorage } from "../../lib/files/object-storage";
import { runDocumentWorker } from "../../lib/documents/processing/worker";
import { runEmbeddingWorker } from "../../lib/ai/embeddings";
import { productMapArtifactSchema } from "../../lib/product-map/contracts";
import {
  ProductMapError,
  attachProductMapSource,
  cancelProductMapRun,
  claimProductMapRun,
  continueLimitedEvidence,
  createAndProcessProductMapRunForTest,
  createProductMapRun,
  editProductMapArtifact,
  getProductMapRun,
  processProductMapRun,
  publishProductMapArtifact,
  reviewProductMapArtifact,
  retryProductMapRun,
} from "../../lib/product-map/service";
import { createTextFixture } from "../helpers/file-fixtures";

const prefix = `product-map-integration-${process.pid}-${crypto.randomUUID()}`;
const projectAId = `${prefix}-a`;
const projectBId = `${prefix}-b`;
const headers = new Headers({
  origin: "http://127.0.0.1:3200",
  "x-real-ip": "198.51.100.230",
  "user-agent": "project-ai-product-map-integration-test",
});

let admin: UserRecord;
let manager: UserRecord;
let outsider: UserRecord;
let member: UserRecord;
let viewer: UserRecord;
let setupCompleted = false;
const embeddingWorkerIds: string[] = [];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for Product Map integration tests.`);
  return value;
}

function principal(user: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `${prefix}-${user.id}`, user };
}

function assertProductMapError(
  error: unknown,
  status: number,
  code?: string,
): boolean {
  if (error instanceof ProductMapError) {
    return error.status === status && (!code || error.code === code);
  }
  if (error instanceof ProjectAssistantError) {
    return error.status === status && (!code || error.code === code);
  }
  return (
    error instanceof AuthorizationError &&
    error.status === status &&
    (!code || error.code === code)
  );
}

async function uploadAndIndex(
  projectId: string,
  actor: UserRecord,
  marker: string,
) {
  const stored = await uploadDocument({
    principal: principal(actor),
    projectId,
    requestHeaders: headers,
    idempotencyKey: crypto.randomUUID(),
    file: createTextFixture(
      `${marker}.txt`,
      [
        "这是仅供自动化测试使用的虚构产品资料。",
        "项目背景：项目经理需要更快编写文档并查找分散信息。",
        "业务目标：减少需求遗漏、重复和理解错误。",
        "目标用户：项目经理。平台：Web。",
        "核心需求：按项目隔离资料、生成草稿并由人工审核发布。",
        "业务规则：草稿不能直接覆盖正式数据，所有结论需要来源。",
      ].join("\n"),
    ),
    displayName: null,
  });
  let job = (
    await getDb()
      .select()
      .from(documentIngestionJob)
      .where(eq(documentIngestionJob.versionId, stored.version.id))
  )[0];
  for (
    let attempt = 0;
    attempt < 5 && job?.status !== "succeeded";
    attempt += 1
  ) {
    await runDocumentWorker({
      once: true,
      workerId: `${prefix}-document-worker-${crypto.randomUUID()}`,
    });
    job = (
      await getDb()
        .select()
        .from(documentIngestionJob)
        .where(eq(documentIngestionJob.versionId, stored.version.id))
    )[0];
    if (job?.status !== "succeeded")
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(job?.status, "succeeded");
  const embeddingWorkerId = `${prefix}-embedding-worker-${crypto.randomUUID()}`;
  embeddingWorkerIds.push(embeddingWorkerId);
  let embedding = (
    await getDb()
      .select()
      .from(documentEmbeddingJob)
      .where(eq(documentEmbeddingJob.versionId, stored.version.id))
  )[0];
  for (
    let attempt = 0;
    attempt < 5 && embedding?.status !== "succeeded";
    attempt += 1
  ) {
    await runEmbeddingWorker({ once: true, workerId: embeddingWorkerId });
    embedding = (
      await getDb()
        .select()
        .from(documentEmbeddingJob)
        .where(eq(documentEmbeddingJob.versionId, stored.version.id))
    )[0];
    if (embedding?.status !== "succeeded")
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(embedding?.status, "succeeded");
  return stored;
}

async function cleanup(): Promise<void> {
  const projectIds = [projectAId, projectBId];
  const db = getDb();
  const storage = getObjectStorage();
  for (const projectId of projectIds) {
    const objects = await storage.listObjects(`projects/${projectId}/`);
    await Promise.all(
      objects.map((object) => storage.deleteObject(object.key)),
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(productMapArtifactVersion)
      .where(inArray(productMapArtifactVersion.projectId, projectIds));
    await tx
      .delete(productMapArtifact)
      .where(inArray(productMapArtifact.projectId, projectIds));
    await tx
      .delete(productMapExecution)
      .where(inArray(productMapExecution.projectId, projectIds));
    await tx
      .delete(productMapSource)
      .where(inArray(productMapSource.projectId, projectIds));
    await tx
      .delete(productMapRun)
      .where(inArray(productMapRun.projectId, projectIds));
    await tx.delete(aiMessage).where(inArray(aiMessage.projectId, projectIds));
    await tx.delete(aiThread).where(inArray(aiThread.projectId, projectIds));
    await tx
      .delete(auditEvent)
      .where(inArray(auditEvent.projectId, projectIds));
    await tx
      .delete(documentChunkEmbedding)
      .where(inArray(documentChunkEmbedding.projectId, projectIds));
    await tx
      .delete(documentEmbeddingProviderCall)
      .where(inArray(documentEmbeddingProviderCall.projectId, projectIds));
    await tx
      .delete(documentEmbeddingBatch)
      .where(inArray(documentEmbeddingBatch.projectId, projectIds));
    await tx
      .delete(documentEmbeddingJob)
      .where(inArray(documentEmbeddingJob.projectId, projectIds));
    await tx
      .delete(documentChunk)
      .where(inArray(documentChunk.projectId, projectIds));
    await tx
      .delete(documentSection)
      .where(inArray(documentSection.projectId, projectIds));
    await tx
      .delete(documentIngestionJob)
      .where(inArray(documentIngestionJob.projectId, projectIds));
    await tx
      .delete(projectDocumentVersion)
      .where(inArray(projectDocumentVersion.projectId, projectIds));
    await tx
      .delete(projectDocument)
      .where(inArray(projectDocument.projectId, projectIds));
    await tx
      .delete(projectMember)
      .where(inArray(projectMember.projectId, projectIds));
    await tx.delete(project).where(inArray(project.id, projectIds));
    if (embeddingWorkerIds.length)
      await tx
        .delete(embeddingWorkerHeartbeat)
        .where(inArray(embeddingWorkerHeartbeat.workerId, embeddingWorkerIds));
  });
}

async function clearProductMapState(): Promise<void> {
  const projectIds = [projectAId, projectBId];
  await getDb().transaction(async (tx) => {
    await tx
      .delete(productMapArtifactVersion)
      .where(inArray(productMapArtifactVersion.projectId, projectIds));
    await tx
      .delete(productMapArtifact)
      .where(inArray(productMapArtifact.projectId, projectIds));
    await tx
      .delete(productMapExecution)
      .where(inArray(productMapExecution.projectId, projectIds));
    await tx
      .delete(productMapSource)
      .where(inArray(productMapSource.projectId, projectIds));
    await tx
      .delete(productMapRun)
      .where(inArray(productMapRun.projectId, projectIds));
    await tx.delete(aiMessage).where(inArray(aiMessage.projectId, projectIds));
    await tx.delete(aiThread).where(inArray(aiThread.projectId, projectIds));
    await tx
      .delete(auditEvent)
      .where(
        and(
          inArray(auditEvent.projectId, projectIds),
          sql`${auditEvent.eventType} like 'product_map_%'`,
        ),
      );
  });
}

async function auditTypesForRun(runId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ eventType: auditEvent.eventType })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.projectId, projectAId),
        eq(auditEvent.entityId, runId),
        sql`${auditEvent.eventType} like 'product_map_%'`,
      ),
    );
  return rows.map((row) => row.eventType);
}

async function auditCountForEntity(
  entityId: string,
  eventType: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.projectId, projectAId),
        eq(auditEvent.entityId, entityId),
        eq(auditEvent.eventType, eventType),
      ),
    );
  return row?.count ?? 0;
}

async function waitForBlockedProductMapQuery(tableName: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await getPool().query<{ waiting: boolean }>(
      `select exists (
        select 1
        from pg_stat_activity
        where pid <> pg_backend_pid()
          and state = 'active'
          and wait_event_type = 'Lock'
          and query ilike $1
      ) as waiting`,
      [`%${tableName}%`],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a blocked ${tableName} query.`);
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(
    databaseUrl.pathname,
    /test|ci/i,
    "Product Map tests must use a test/CI database",
  );
  assert.ok(
    ["127.0.0.1", "localhost", "postgres", "db"].includes(databaseUrl.hostname),
    "Product Map tests refuse remote databases",
  );
  const users = await Promise.all([
    findUserByEmail(required("SEED_ADMIN_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
    findUserByEmail(required("SEED_MEMBER_A_EMAIL")),
    findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
  ]);
  users.forEach((user) => assert.ok(user, "seed user should exist"));
  [admin, manager, outsider, member, viewer] = users as UserRecord[];
  await getDb().transaction(async (tx) => {
    await tx.insert(project).values([
      {
        id: projectAId,
        name: "Product Map A",
        clientName: "Fictional Client",
        description: "Runtime-generated fictional fixture",
        createdBy: admin.id,
      },
      {
        id: projectBId,
        name: "Product Map B",
        clientName: "Fictional Client B",
        description: "Cross-project fixture",
        createdBy: admin.id,
      },
    ]);
    await tx.insert(projectMember).values([
      {
        id: `${prefix}-manager`,
        projectId: projectAId,
        userId: manager.id,
        role: "project_manager",
        createdBy: admin.id,
      },
      {
        id: `${prefix}-member`,
        projectId: projectAId,
        userId: member.id,
        role: "project_member",
        createdBy: admin.id,
      },
      {
        id: `${prefix}-viewer`,
        projectId: projectAId,
        userId: viewer.id,
        role: "viewer",
        createdBy: admin.id,
      },
      {
        id: `${prefix}-outsider`,
        projectId: projectBId,
        userId: outsider.id,
        role: "project_manager",
        createdBy: admin.id,
      },
    ]);
  });
  setupCompleted = true;
});

after(async () => {
  try {
    if (setupCompleted) await cleanup();
  } finally {
    if (setupCompleted) await closeDatabasePool();
  }
});

beforeEach(async () => {
  await clearProductMapState();
});

describe("Product Map isolated database integration", () => {
  it("installs migration 0033 with the expected ledger hash and scoped constraints", async () => {
    const migrationSql = await readFile(
      new URL("../../drizzle/0033_product_map_skill.sql", import.meta.url),
      "utf8",
    );
    const expectedHash = createHash("sha256")
      .update(migrationSql)
      .digest("hex");
    const ledger = await getPool().query<{
      hash: string;
      created_at: string;
    }>(
      `select hash, created_at::text
       from drizzle.__drizzle_migrations
       where hash = $1`,
      [expectedHash],
    );
    assert.equal(ledger.rows.length, 1);
    assert.equal(ledger.rows[0]?.created_at, "1786089600000");

    const catalog = await getPool().query<{
      relation_name: string | null;
      constraint_name: string | null;
      definition: string | null;
    }>(`
      select null::text as relation_name,
             c.conname::text as constraint_name,
             pg_get_constraintdef(c.oid)::text as definition
      from pg_constraint c
      where c.conname in (
        'ai_scenario_binding_name_check',
        'product_map_runs_id_project_unique',
        'product_map_runs_type_check',
        'product_map_sources_run_project_fk',
        'product_map_sources_document_project_fk',
        'product_map_sources_version_scope_fk',
        'product_map_executions_run_project_fk',
        'product_map_artifacts_run_project_fk',
        'product_map_artifacts_published_document_fk',
        'product_map_artifacts_published_version_fk',
        'product_map_artifacts_id_project_unique',
        'product_map_artifact_versions_artifact_project_fk'
      )
      union all
      select to_regclass(name)::text, null::text, null::text
      from unnest(array[
        'product_map_runs',
        'product_map_sources',
        'product_map_executions',
        'product_map_artifacts',
        'product_map_artifact_versions'
      ]) as name
    `);
    const relationNames = new Set(
      catalog.rows
        .map((row) => row.relation_name)
        .filter((value): value is string => Boolean(value)),
    );
    assert.deepEqual(
      relationNames,
      new Set([
        "product_map_runs",
        "product_map_sources",
        "product_map_executions",
        "product_map_artifacts",
        "product_map_artifact_versions",
      ]),
    );
    const constraints = new Map(
      catalog.rows
        .filter((row) => row.constraint_name)
        .map((row) => [row.constraint_name!, row.definition ?? ""]),
    );
    for (const name of [
      "product_map_runs_id_project_unique",
      "product_map_sources_run_project_fk",
      "product_map_sources_document_project_fk",
      "product_map_sources_version_scope_fk",
      "product_map_executions_run_project_fk",
      "product_map_artifacts_run_project_fk",
      "product_map_artifacts_published_document_fk",
      "product_map_artifacts_published_version_fk",
      "product_map_artifacts_id_project_unique",
      "product_map_artifact_versions_artifact_project_fk",
    ]) {
      assert.ok(constraints.has(name), `${name} should exist`);
    }
    assert.match(
      constraints.get("ai_scenario_binding_name_check") ?? "",
      /product_map_generation/,
    );
    assert.match(
      constraints.get("product_map_runs_type_check") ?? "",
      /skill_execution.*product_map_generation/,
    );
    const hardcodedProfile = await getPool().query<{ count: string }>(`
      select count(*)::text as count
      from ai_generation_models
      where id = 'qwen-product-map-cn-v1'
         or model_id = 'qwen-product-map-cn-v1'
    `);
    assert.equal(hardcodedProfile.rows[0]?.count, "0");
  });

  it("keeps unpublished runs private, denies viewer mutations, and hides cross-project sources", async () => {
    const sourceA = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-acl-a`,
    );
    const sourceB = await uploadAndIndex(
      projectBId,
      outsider,
      `${prefix}-acl-b`,
    );
    const created = await createProductMapRun({
      principal: principal(member),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [sourceA.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    await assert.rejects(
      () =>
        createProductMapRun({
          principal: principal(viewer),
          projectId: projectAId,
          requestHeaders: headers,
          request: {
            selectedSourceIds: [sourceA.document.id],
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      (error) => assertProductMapError(error, 403),
    );
    const [executionCountBeforeRead] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapExecution)
      .where(eq(productMapExecution.runId, created.run.id));
    await assert.rejects(
      () =>
        getProductMapRun({
          principal: principal(viewer),
          projectId: projectAId,
          runId: created.run.id,
          requestHeaders: headers,
        }),
      (error) => assertProductMapError(error, 404, "NOT_FOUND"),
    );
    const [executionCountAfterRead] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapExecution)
      .where(eq(productMapExecution.runId, created.run.id));
    assert.equal(
      executionCountAfterRead?.count,
      executionCountBeforeRead?.count,
      "denied draft reads must not schedule Product Map execution",
    );
    await assert.rejects(
      () =>
        createProductMapRun({
          principal: principal(manager),
          projectId: projectAId,
          requestHeaders: headers,
          request: {
            selectedSourceIds: [sourceB.document.id],
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      (error) =>
        assertProductMapError(error, 404, "PRODUCT_MAP_SOURCE_NOT_FOUND"),
    );
    await assert.rejects(
      () =>
        getProductMapRun({
          principal: principal(outsider),
          projectId: projectBId,
          runId: created.run.id,
          requestHeaders: headers,
        }),
      (error) => assertProductMapError(error, 404, "NOT_FOUND"),
    );
    const managerView = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(managerView.sources.length, 1);
    assert.equal(managerView.sources[0]?.status, "ready");
    const [storedSource] = await getDb()
      .select({ sourceProjectId: productMapSource.sourceProjectId })
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, created.run.id),
          eq(productMapSource.projectId, projectAId),
        ),
      );
    assert.equal(storedSource?.sourceProjectId, projectAId);
  });

  it("pauses with insufficient evidence and only continues after explicit limited-evidence consent", async () => {
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        userInput: "仅有一句虚构说明",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(`${prefix}-limited-worker`);
    assert.equal(claimed?.id, created.run.id);
    await processProductMapRun(claimed!);
    const paused = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(paused.run.status, "needs_input");
    assert.equal(paused.executions.length, 0);
    const [pausedSnapshot] = await getDb()
      .select({
        evidenceSnapshotDigest: productMapRun.evidenceSnapshotDigest,
        skillFileSha256: productMapRun.skillFileSha256,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.match(pausedSnapshot?.evidenceSnapshotDigest ?? "", /^[a-f0-9]{64}$/u);
    assert.match(pausedSnapshot?.skillFileSha256 ?? "", /^[a-f0-9]{64}$/u);
    await getDb()
      .update(productMapRun)
      .set({ userInput: "SNAPSHOT-DRIFT-MUST-NOT-APPEAR" })
      .where(eq(productMapRun.id, created.run.id));
    const continued = await continueLimitedEvidence({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      limitedEvidence: true,
      requestHeaders: headers,
    });
    assert.equal(continued.run.status, "queued");
    assert.equal(continued.run.limitedEvidence, true);
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_run_continued",
      ),
    );
    const resumed = await claimProductMapRun(`${prefix}-limited-resume-worker`);
    assert.equal(resumed?.id, created.run.id);
    await processProductMapRun(resumed!);
    const completed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(completed.run.status, "reviewing");
    assert.equal(completed.artifacts.length, 1);
    const artifact = productMapArtifactSchema.parse(
      completed.versions[0]?.content,
    );
    assert.equal(artifact.completeness.limitedEvidence, true);
    assert.ok(artifact.analysisContract.evidenceCoverage.missing > 0);
    assert.ok(artifact.analysisContract.evidenceCoverage.inferred > 0);
    assert.doesNotMatch(JSON.stringify(artifact), /SNAPSHOT-DRIFT-MUST-NOT-APPEAR/u);
    assert.ok(
      artifact.analysisContract.exceptionPaths.some(
        (path) => path.evidenceStatus === "MISSING",
      ),
    );
  });

  it("serializes idempotent replays and completes a reviewed artifact with fake provider", async () => {
    const source = await uploadAndIndex(projectAId, manager, `${prefix}-e2e`);
    const request = {
      selectedSourceIds: [source.document.id],
      userInput:
        "用户本次明确补充：目标上线时间为 2026-12-31；若项目资料记录了其他日期，必须保留为 CONFLICT 并等待人工确认。",
      contextReferences: [
        {
          type: "document" as const,
          documentId: source.document.id,
          documentVersionId: source.version.id,
          sourceType: "project" as const,
          label: "不可信客户端标签",
        },
      ],
      idempotencyKey: crypto.randomUUID(),
    };
    const [first, replay] = await Promise.all([
      createProductMapRun({
        principal: principal(manager),
        projectId: projectAId,
        requestHeaders: headers,
        request,
      }),
      createProductMapRun({
        principal: principal(manager),
        projectId: projectAId,
        requestHeaders: headers,
        request,
      }),
    ]);
    assert.equal(first.run.id, replay.run.id);
    assert.equal([first.created, replay.created].filter(Boolean).length, 1);
    await assert.rejects(
      () =>
        createProductMapRun({
          principal: principal(manager),
          projectId: projectAId,
          requestHeaders: headers,
          request: { ...request, userInput: "同一幂等键的不同虚构输入" },
        }),
      (error) =>
        assertProductMapError(error, 409, "PRODUCT_MAP_IDEMPOTENCY_CONFLICT"),
    );
    const [count] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapRun)
      .where(eq(productMapRun.id, first.run.id));
    assert.equal(count?.count, 1);
    const claimed = await claimProductMapRun(`${prefix}-e2e-worker`);
    assert.equal(claimed?.id, first.run.id);
    await processProductMapRun(claimed!);
    const completed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: first.run.id,
      requestHeaders: headers,
    });
    assert.equal(completed.run.status, "reviewing");
    assert.equal(completed.artifacts.length, 1);
    assert.equal(completed.versions.length, 1);
    assert.ok(completed.executions.length >= 6);
    const artifact = productMapArtifactSchema.parse(
      completed.versions[0]?.content,
    );
    assert.ok(
      artifact.analysisContract.sources.some(
        (sourceEntry) => sourceEntry.kind === "explicit_file_reference",
      ),
    );
    assert.ok(artifact.analysisContract.evidenceCoverage.conflict > 0);
    assert.equal(artifact.quality.overall, "需确认");
    assert.equal(
      artifact.quality.checks.find(
        (check) => check.id === "evidence_traceability",
      )?.result,
      "待确认",
    );
    assert.ok(
      completed.executions.every(
        (execution) => execution.attempt >= 1,
      ),
    );
  });

  it("persists unknown provider outcomes without auto-retry and requires manual recovery", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-provider-unknown`,
    );
    const recoverySource = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-provider-unknown-recovery`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        userInput: "FAKE_TIMEOUT",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(`${prefix}-unknown-worker`);
    assert.equal(claimed?.id, created.run.id);
    await assert.rejects(
      () => processProductMapRun(claimed!),
      (error) => assertProductMapError(error, 503, "AI_PROVIDER_TIMEOUT"),
    );
    const unknown = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(unknown.run.status, "unknown");
    assert.equal(unknown.run.failureCode, "AI_PROVIDER_TIMEOUT");
    assert.equal(
      unknown.run.failureMessage,
      "模型响应状态未知，请人工确认后再重试",
    );
    assert.equal(unknown.run.completedAt, null);
    assert.ok(unknown.run.failureReference);
    assert.equal(unknown.executions.at(-1)?.status, "unknown");
    assert.equal(await claimProductMapRun(`${prefix}-unknown-auto-worker`), null);
    const attached = await attachProductMapSource({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      documentId: recoverySource.document.id,
      requestHeaders: headers,
    });
    assert.equal(attached.run.status, "queued");
    const recoveryClaim = await claimProductMapRun(
      `${prefix}-unknown-recovery-worker`,
    );
    assert.equal(recoveryClaim?.id, created.run.id);
    await assert.rejects(
      () => processProductMapRun(recoveryClaim!),
      (error) => assertProductMapError(error, 503, "AI_PROVIDER_TIMEOUT"),
    );
    const retried = await retryProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(retried.run.status, "queued");
  });

  it("keeps private Thread source text out of a manager-visible draft", async () => {
    const threadId = `${prefix}-private-thread`;
    const privateText =
      "PRIVATE-THREAD-SENTINEL-DO-NOT-PERSIST：目标用户是项目经理，平台为 Web，核心需求是形成可审核产品结构，规则是未经人工审核不得发布。";
    await getDb().transaction(async (tx) => {
      await tx.insert(aiThread).values({
        id: threadId,
        projectId: projectAId,
        createdBy: member.id,
        title: "私有会话脱敏验证",
      });
      await tx.insert(aiMessage).values({
        id: `${prefix}-private-message`,
        projectId: projectAId,
        threadId,
        createdBy: member.id,
        role: "user",
        status: "completed",
        content: privateText,
        sequence: 1,
      });
    });
    const created = await createProductMapRun({
      principal: principal(member),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        conversationId: threadId,
        includeConversationContext: true,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const firstClaim = await claimProductMapRun(
      `${prefix}-private-thread-worker`,
    );
    assert.equal(firstClaim?.id, created.run.id);
    await processProductMapRun(firstClaim!);

    const managerView = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(managerView.run.status, "reviewing");
    const serialized = JSON.stringify(managerView.versions[0]?.content);
    assert.doesNotMatch(serialized, /PRIVATE-THREAD-SENTINEL-DO-NOT-PERSIST/u);
    const artifact = productMapArtifactSchema.parse(
      managerView.versions[0]?.content,
    );
    const conversationEvidence = artifact.materialInventory.evidence.find(
      (item) => item.locator === "conversation:user_messages",
    );
    assert.ok(conversationEvidence);
    assert.match(conversationEvidence.excerpt, /原文未写入项目草稿/u);
    assert.ok(
      artifact.analysisContract.sources.some(
        (sourceEntry) => sourceEntry.kind === "conversation",
      ),
    );
  });

  it("allocates monotonic step attempts and never exposes internal input on retry", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-execution-retry`,
    );
    const sentinel = "FAKE_401 SECRET-SQL-SENTINEL";
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        userInput: sentinel,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const claimed = await claimProductMapRun(
        `${prefix}-retry-worker-${cycle}`,
      );
      assert.equal(claimed?.id, created.run.id);
      await assert.rejects(
        () => processProductMapRun(claimed!),
        (error) => assertProductMapError(error, 403, "MODEL_UNAUTHORIZED"),
      );
      const failed = await getProductMapRun({
        principal: principal(manager),
        projectId: projectAId,
        runId: created.run.id,
        requestHeaders: headers,
      });
      assert.equal(failed.run.status, "failed");
      assert.doesNotMatch(failed.run.failureMessage ?? "", /SECRET|SQL|SENTINEL/u);
      if (cycle === 0) {
        await retryProductMapRun({
          principal: principal(manager),
          projectId: projectAId,
          runId: created.run.id,
          requestHeaders: headers,
        });
      }
    }
    const attempts = await getDb()
      .select({ attempt: productMapExecution.attempt })
      .from(productMapExecution)
      .where(
        and(
          eq(productMapExecution.runId, created.run.id),
          eq(productMapExecution.stepId, "evidence_inventory"),
        ),
      )
      .orderBy(productMapExecution.attempt);
    assert.deepEqual(
      attempts.map((item) => item.attempt),
      [1, 2],
    );
  });

  it("accounts for paid invalid output before a successful repair", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-invalid-output-repair`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        userInput: "FAKE_PRODUCT_MAP_INVALID_ONCE",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(`${prefix}-invalid-repair-worker`);
    assert.equal(claimed?.id, created.run.id);
    await processProductMapRun(claimed!);

    const executions = await getDb()
      .select()
      .from(productMapExecution)
      .where(eq(productMapExecution.runId, created.run.id))
      .orderBy(productMapExecution.startedAt);
    const rejected = executions.filter(
      (execution) =>
        execution.status === "failed" &&
        execution.failureCode === "PRODUCT_MAP_MODEL_OUTPUT_INVALID",
    );
    assert.ok(rejected.length >= 1);
    assert.ok(executions.some((execution) => execution.status === "succeeded"));
    for (const execution of rejected) {
      assert.match(execution.providerRequestId ?? "", /^fake-/u);
      assert.ok((execution.inputTokens ?? 0) > 0);
      assert.ok((execution.outputTokens ?? 0) > 0);
      assert.ok((execution.totalTokens ?? 0) > 0);
      assert.ok(execution.reservedTokens > 0);
      assert.equal(execution.latencyMs, 5);
      assert.equal(execution.costUsdMicros, 0);
      assert.equal(execution.costAccountingStatus, "recorded");
    }
    const budget = await getDb().execute<{ accounted: string | number }>(sql`
      select coalesce(sum(coalesce(total_tokens, reserved_tokens)), 0) as accounted
      from product_map_executions
      where run_id = ${created.run.id}
    `);
    assert.equal(
      Number(budget.rows[0]?.accounted ?? 0),
      executions.reduce(
        (total, execution) =>
          total + (execution.totalTokens ?? execution.reservedTokens),
        0,
      ),
    );
  });

  it("accounts for both invalid provider responses when repair also fails", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-invalid-output-final`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        userInput: "FAKE_PRODUCT_MAP_INVALID_ALWAYS",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(`${prefix}-invalid-final-worker`);
    assert.equal(claimed?.id, created.run.id);
    await assert.rejects(
      () => processProductMapRun(claimed!),
      (error) =>
        assertProductMapError(
          error,
          502,
          "PRODUCT_MAP_MODEL_OUTPUT_INVALID",
        ),
    );
    const executions = await getDb()
      .select()
      .from(productMapExecution)
      .where(eq(productMapExecution.runId, created.run.id))
      .orderBy(productMapExecution.attempt);
    assert.equal(executions.length, 2);
    assert.deepEqual(
      executions.map((execution) => execution.attempt),
      [1, 2],
    );
    assert.ok(
      executions.every(
        (execution) =>
          execution.status === "failed" &&
          execution.failureCode === "PRODUCT_MAP_MODEL_OUTPUT_INVALID" &&
          (execution.totalTokens ?? 0) > 0 &&
          execution.reservedTokens > 0 &&
          execution.costUsdMicros === 0 &&
          execution.costAccountingStatus === "recorded",
      ),
    );
  });

  it("rejects a prospective reservation at the daily limit without dispatch", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-budget-reservation`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        userInput: "预算门禁虚构验证",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const [run] = await getDb()
      .select()
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.ok(run);
    await getDb().insert(productMapExecution).values({
      id: `${prefix}-budget-seed`,
      runId: run.id,
      projectId: run.projectId,
      stepId: "budget_seed",
      attempt: 1,
      generationModelId: run.generationModelId,
      skillFileSha256: run.skillFileSha256,
      status: "succeeded",
      inputDigest: "0".repeat(64),
      outputDigest: "1".repeat(64),
      inputTokens: 50_000,
      outputTokens: 49_999,
      totalTokens: 99_999,
      reservedTokens: 1,
      latencyMs: 1,
      costUsdMicros: 0,
      costAccountingStatus: "recorded",
      startedAt: new Date(Date.now() - 2 * 60_000),
      completedAt: new Date(Date.now() - 2 * 60_000),
    });
    const claimed = await claimProductMapRun(`${prefix}-budget-worker`);
    assert.equal(claimed?.id, created.run.id);
    await assert.rejects(
      () => processProductMapRun(claimed!),
      (error) =>
        assertProductMapError(
          error,
          429,
          "AI_USER_DAILY_LIMIT_REACHED",
        ),
    );
    const [executionCount] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapExecution)
      .where(eq(productMapExecution.runId, created.run.id));
    assert.equal(executionCount?.count, 1);
  });

  it("persists cancellation and does not reclaim a cancelled queued run", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-cancel`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const cancelled = await cancelProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(cancelled.run.status, "cancelled");
    const [row] = await getDb()
      .select({
        cancellationRequestedAt: productMapRun.cancellationRequestedAt,
        completedAt: productMapRun.completedAt,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.ok(row?.cancellationRequestedAt);
    assert.ok(row?.completedAt);
    assert.equal(await claimProductMapRun(`${prefix}-cancel-worker`), null);
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_run_cancelled",
      ),
    );
  });

  it("rolls back an in-flight source attach when cancellation wins and rejects later attaches", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-cancel-attach`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        userInput: "等待补充资料的虚构任务",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const lockClient = await getPool().connect();
    let attachPromise: ReturnType<typeof attachProductMapSource> | null = null;
    let committed = false;
    try {
      await lockClient.query("begin");
      await lockClient.query(
        "select id from product_map_runs where id = $1 for update",
        [created.run.id],
      );
      attachPromise = attachProductMapSource({
        principal: principal(manager),
        projectId: projectAId,
        runId: created.run.id,
        documentId: source.document.id,
        requestHeaders: headers,
      });
      await waitForBlockedProductMapQuery("product_map_runs");
      await lockClient.query(
        `update product_map_runs
         set status = 'cancelled',
             cancellation_requested_at = now(),
             completed_at = now(),
             updated_at = now(),
             version = version + 1
         where id = $1`,
        [created.run.id],
      );
      await lockClient.query("commit");
      committed = true;
    } finally {
      if (!committed) await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
    assert.ok(attachPromise);
    await assert.rejects(attachPromise, (error) =>
      assertProductMapError(error, 409, "PRODUCT_MAP_SOURCE_ATTACH_NOT_READY"),
    );
    await assert.rejects(
      () =>
        attachProductMapSource({
          principal: principal(manager),
          projectId: projectAId,
          runId: created.run.id,
          documentId: source.document.id,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(
          error,
          409,
          "PRODUCT_MAP_SOURCE_ATTACH_NOT_READY",
        ),
    );
    const [storedRun] = await getDb()
      .select({ status: productMapRun.status })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    const [sourceCount] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapSource)
      .where(eq(productMapSource.runId, created.run.id));
    assert.equal(storedRun?.status, "cancelled");
    assert.equal(sourceCount?.count, 0);
    assert.equal(
      await auditCountForEntity(created.run.id, "product_map_source_attached"),
      0,
    );
  });

  it("terminally cancels an active lease and prevents the old worker from writing an artifact", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-leased-cancel`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(`${prefix}-leased-cancel-worker`);
    assert.equal(claimed?.id, created.run.id);
    const cancelled = await cancelProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(cancelled.run.status, "cancelled");
    const [cancelMarker] = await getDb()
      .select({
        cancellationRequestedAt: productMapRun.cancellationRequestedAt,
        leaseToken: productMapRun.leaseToken,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id))
      .limit(1);
    assert.ok(cancelMarker?.cancellationRequestedAt);
    assert.equal(cancelMarker?.leaseToken, null);
    await assert.rejects(
      () => processProductMapRun(claimed!),
      (error) => assertProductMapError(error, 409, "PRODUCT_MAP_LEASE_LOST"),
    );
    const persisted = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(persisted.run.status, "cancelled");
    assert.equal(persisted.artifacts.length, 0);
    assert.equal(persisted.versions.length, 0);
    const events = await auditTypesForRun(created.run.id);
    assert.ok(events.includes("product_map_run_cancelled"));
  });

  it("cancels an uploading run instead of returning a false success", async () => {
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        initialAttachment: true,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    assert.equal(created.run.status, "uploading");

    const cancelled = await cancelProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(cancelled.run.status, "cancelled");
    assert.equal(await claimProductMapRun(`${prefix}-uploading-cancel-worker`), null);
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_run_cancelled",
      ),
    );
  });

  it("terminally cancels an expired crashed-App lease instead of stranding the run", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-expired-lease-cancel`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const claimed = await claimProductMapRun(
      `${prefix}-expired-lease-cancel-worker`,
    );
    assert.equal(claimed?.id, created.run.id);
    await getDb()
      .update(productMapRun)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(
        and(
          eq(productMapRun.id, created.run.id),
          eq(productMapRun.projectId, projectAId),
        ),
      );

    const cancelled = await cancelProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(cancelled.run.status, "cancelled");
    const [stored] = await getDb()
      .select({
        cancellationRequestedAt: productMapRun.cancellationRequestedAt,
        completedAt: productMapRun.completedAt,
        leaseOwner: productMapRun.leaseOwner,
        leaseToken: productMapRun.leaseToken,
        leaseExpiresAt: productMapRun.leaseExpiresAt,
        heartbeatAt: productMapRun.heartbeatAt,
      })
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, created.run.id),
          eq(productMapRun.projectId, projectAId),
        ),
      )
      .limit(1);
    assert.ok(stored?.cancellationRequestedAt);
    assert.ok(stored?.completedAt);
    assert.equal(stored?.leaseOwner, null);
    assert.equal(stored?.leaseToken, null);
    assert.equal(stored?.leaseExpiresAt, null);
    assert.equal(stored?.heartbeatAt, null);
    assert.equal(
      await claimProductMapRun(`${prefix}-expired-lease-reclaim-worker`),
      null,
    );
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_run_cancelled",
      ),
    );
  });

  it("records parse and stale-version failures, then resumes the same run with the current source", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-failure`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    await getDb()
      .update(productMapSource)
      .set({ status: "pending" })
      .where(
        and(
          eq(productMapSource.runId, created.run.id),
          eq(productMapSource.projectId, projectAId),
        ),
      );
    await getDb()
      .update(documentIngestionJob)
      .set({ status: "failed", failureCode: "FIXTURE_PARSE_FAILED" })
      .where(
        and(
          eq(documentIngestionJob.documentId, source.document.id),
          eq(documentIngestionJob.versionId, source.version.id),
          eq(documentIngestionJob.projectId, projectAId),
        ),
      );
    const claimed = await claimProductMapRun(`${prefix}-failure-worker`);
    assert.ok(claimed);
    await assert.rejects(
      () => processProductMapRun(claimed!),
      (error) =>
        assertProductMapError(error, 422, "PRODUCT_MAP_SOURCE_PARSE_FAILED"),
    );
    const failed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(failed.run.status, "failed");
    assert.equal(failed.run.failureCode, "PRODUCT_MAP_SOURCE_PARSE_FAILED");
    const retried = await retryProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(retried.run.status, "queued");
    assert.equal(retried.run.failureCode, null);
    const lifecycleAudits = await auditTypesForRun(created.run.id);
    assert.ok(lifecycleAudits.includes("product_map_run_failed"));
    assert.ok(lifecycleAudits.includes("product_map_run_retried"));

    const newVersion = await uploadDocument({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      idempotencyKey: crypto.randomUUID(),
      documentId: source.document.id,
      file: createTextFixture(
        `${prefix}-failure-v2.txt`,
        "更新后的虚构项目资料：业务目标、用户、平台、需求和规则均已确认。",
      ),
      displayName: source.document.displayName,
    });
    await runDocumentWorker({
      once: true,
      workerId: `${prefix}-document-worker-v2`,
    });
    const embeddingWorkerId = `${prefix}-embedding-worker-v2`;
    embeddingWorkerIds.push(embeddingWorkerId);
    await runEmbeddingWorker({ once: true, workerId: embeddingWorkerId });
    const staleClaim = await claimProductMapRun(`${prefix}-stale-worker`);
    assert.ok(staleClaim);
    await assert.rejects(
      () => processProductMapRun(staleClaim!),
      (error) =>
        assertProductMapError(error, 409, "PRODUCT_MAP_SOURCE_VERSION_STALE"),
    );
    assert.ok(newVersion.version.id !== source.version.id);
    const staleFailure = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(staleFailure.run.status, "failed");
    assert.equal(
      staleFailure.run.failureCode,
      "PRODUCT_MAP_SOURCE_VERSION_STALE",
    );
    await retryProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    const reattached = await attachProductMapSource({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      documentId: source.document.id,
      requestHeaders: headers,
    });
    assert.equal(reattached.run.id, created.run.id);
    assert.equal(reattached.run.status, "queued");
    const activeSources = await getDb()
      .select({
        versionId: productMapSource.versionId,
        status: productMapSource.status,
      })
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, created.run.id),
          eq(productMapSource.projectId, projectAId),
        ),
      );
    assert.ok(
      activeSources.some(
        (item) =>
          item.versionId === newVersion.version.id && item.status === "ready",
      ),
    );
    const resumed = await claimProductMapRun(`${prefix}-retry-worker`);
    assert.equal(resumed?.id, created.run.id);
    await processProductMapRun(resumed!);
    const completed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(completed.run.status, "reviewing");
    assert.equal(completed.artifacts.length, 1);
  });

  it("re-arms an exhausted failed run only after an explicit manual retry", async () => {
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        userInput: "用于验证人工重试边界的虚构说明。",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const failedAt = new Date();
    await getDb()
      .update(productMapRun)
      .set({
        status: "failed",
        attempt: 3,
        maxAttempts: 3,
        failureCode: "FIXTURE_ATTEMPTS_EXHAUSTED",
        failureMessage: "fixture",
        completedAt: failedAt,
      })
      .where(eq(productMapRun.id, created.run.id));
    assert.equal(await claimProductMapRun(`${prefix}-exhausted-before-retry`), null);

    await retryProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    const [rearmed] = await getDb()
      .select({
        status: productMapRun.status,
        attempt: productMapRun.attempt,
        completedAt: productMapRun.completedAt,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.equal(rearmed?.status, "queued");
    assert.equal(rearmed?.attempt, 0);
    assert.equal(rearmed?.completedAt, null);
    const claimed = await claimProductMapRun(`${prefix}-exhausted-after-retry`);
    assert.equal(claimed?.id, created.run.id);
    assert.equal(claimed?.attempt, 1);
  });

  it("fails an expired hard-crash lease after the final automatic attempt", async () => {
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        userInput: "用于验证最大尝试次数崩溃收口的虚构说明。",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    await getDb()
      .update(productMapRun)
      .set({
        status: "running",
        attempt: 3,
        maxAttempts: 3,
        leaseOwner: `${prefix}-crashed-worker`,
        leaseToken: `${prefix}-crashed-token`,
        leaseExpiresAt: new Date(Date.now() - 1_000),
        heartbeatAt: new Date(Date.now() - 2_000),
      })
      .where(eq(productMapRun.id, created.run.id));

    assert.equal(await claimProductMapRun(`${prefix}-post-crash-worker`), null);
    const failed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(failed.run.status, "failed");
    assert.equal(
      failed.run.failureCode,
      "PRODUCT_MAP_ATTEMPTS_EXHAUSTED",
    );
    assert.ok(failed.run.completedAt);
    const [stored] = await getDb()
      .select({
        leaseOwner: productMapRun.leaseOwner,
        leaseToken: productMapRun.leaseToken,
        leaseExpiresAt: productMapRun.leaseExpiresAt,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.equal(stored?.leaseOwner, null);
    assert.equal(stored?.leaseToken, null);
    assert.equal(stored?.leaseExpiresAt, null);
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_run_failed",
      ),
    );
  });

  it("attaches a ready authorized source to the same run and rejects cross-project attachment", async () => {
    const sourceA = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-attach-a`,
    );
    const sourceB = await uploadAndIndex(
      projectBId,
      outsider,
      `${prefix}-attach-b`,
    );
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        userInput: "仅有背景，待补充证据",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const attached = await attachProductMapSource({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      documentId: sourceA.document.id,
      requestHeaders: headers,
    });
    assert.equal(attached.run.id, created.run.id);
    assert.equal(attached.run.status, "queued");
    assert.equal(
      attached.sources.filter((source) => source.status !== "revoked").length,
      1,
    );
    assert.ok(
      (await auditTypesForRun(created.run.id)).includes(
        "product_map_source_attached",
      ),
    );
    await assert.rejects(
      () =>
        attachProductMapSource({
          principal: principal(manager),
          projectId: projectAId,
          runId: created.run.id,
          documentId: sourceB.document.id,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(error, 404, "PRODUCT_MAP_SOURCE_NOT_FOUND"),
    );
  });

  it("uploads once, attaches a pending source, and resumes the same run after parse and embedding", async () => {
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [],
        initialAttachment: true,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    assert.equal(created.run.status, "uploading");
    const uploadKey = crypto.randomUUID();
    const uploadText = [
      "这是运行时生成的虚构补充资料。",
      "业务目标：降低需求遗漏。目标用户：项目经理。",
      "平台：Web。核心需求：生成可审核产品结构。",
      "业务规则：发布前必须人工审核并保留引用。",
    ].join("\n");
    const firstUpload = await uploadDocument({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      idempotencyKey: uploadKey,
      file: createTextFixture(`${prefix}-pending-upload.txt`, uploadText),
      displayName: null,
      temporaryWorkflowId: created.run.id,
    });
    const replayedUpload = await uploadDocument({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      idempotencyKey: uploadKey,
      file: createTextFixture(`${prefix}-pending-upload.txt`, uploadText),
      displayName: null,
      temporaryWorkflowId: created.run.id,
    });
    assert.equal(replayedUpload.document.id, firstUpload.document.id);
    assert.equal(replayedUpload.version.id, firstUpload.version.id);
    assert.match(firstUpload.version.sha256, /^[a-f0-9]{64}$/);

    const attached = await attachProductMapSource({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      documentId: firstUpload.document.id,
      requestHeaders: headers,
    });
    assert.equal(attached.run.id, created.run.id);
    assert.equal(attached.run.status, "indexing");
    assert.equal(attached.sources[0]?.sourceType, "upload");
    const [promoted] = await getDb()
      .select({
        workflowTemporary: projectDocument.workflowTemporary,
        temporaryWorkflowId: projectDocument.temporaryWorkflowId,
        temporaryPromotedAt: projectDocument.temporaryPromotedAt,
      })
      .from(projectDocument)
      .where(eq(projectDocument.id, firstUpload.document.id));
    assert.equal(promoted?.workflowTemporary, false);
    assert.equal(promoted?.temporaryWorkflowId, null);
    assert.ok(promoted?.temporaryPromotedAt);
    const [storedSource] = await getDb()
      .select({ sha256: productMapSource.sha256 })
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, created.run.id),
          eq(productMapSource.projectId, projectAId),
          eq(productMapSource.documentId, firstUpload.document.id),
        ),
      )
      .limit(1);
    assert.equal(storedSource?.sha256, firstUpload.version.sha256);

    const waiting = await claimProductMapRun(`${prefix}-pending-worker`);
    assert.equal(waiting?.id, created.run.id);
    await processProductMapRun(waiting!);
    const stillIndexing = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(stillIndexing.run.status, "indexing");
    assert.equal(stillIndexing.artifacts.length, 0);

    await runDocumentWorker({
      once: true,
      workerId: `${prefix}-pending-document-worker`,
    });
    const embeddingWorkerId = `${prefix}-pending-embedding-worker`;
    embeddingWorkerIds.push(embeddingWorkerId);
    await runEmbeddingWorker({ once: true, workerId: embeddingWorkerId });
    const [pipelineState] = await getDb()
      .select({
        ingestionStatus: documentIngestionJob.status,
        embeddingStatus: documentEmbeddingJob.status,
      })
      .from(documentIngestionJob)
      .innerJoin(
        documentEmbeddingJob,
        and(
          eq(documentEmbeddingJob.documentId, documentIngestionJob.documentId),
          eq(documentEmbeddingJob.versionId, documentIngestionJob.versionId),
          eq(documentEmbeddingJob.projectId, documentIngestionJob.projectId),
        ),
      )
      .where(
        and(
          eq(documentIngestionJob.documentId, firstUpload.document.id),
          eq(documentIngestionJob.versionId, firstUpload.version.id),
          eq(documentIngestionJob.projectId, projectAId),
        ),
      )
      .limit(1);
    assert.equal(pipelineState?.ingestionStatus, "succeeded");
    assert.equal(pipelineState?.embeddingStatus, "succeeded");
    await getDb()
      .update(productMapRun)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(productMapRun.id, created.run.id));
    const readinessClaim = await claimProductMapRun(
      `${prefix}-pending-readiness-worker`,
    );
    assert.equal(readinessClaim?.id, created.run.id);
    await processProductMapRun(readinessClaim!);
    const afterReadiness = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.ok(
      ["queued", "reviewing"].includes(afterReadiness.run.status),
      `unexpected post-indexing status: ${afterReadiness.run.status}`,
    );
    if (afterReadiness.run.status === "queued") {
      const generationClaim = await claimProductMapRun(
        `${prefix}-pending-generation-worker`,
      );
      assert.equal(generationClaim?.id, created.run.id);
      await processProductMapRun(generationClaim!);
    }
    const completed = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: created.run.id,
      requestHeaders: headers,
    });
    assert.equal(completed.run.status, "reviewing");
    assert.equal(completed.artifacts.length, 1);
    assert.equal(
      completed.sources.filter((source) => source.status !== "revoked").length,
      1,
    );
    const [{ count }] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.equal(count, 1);
  });

  it("does not write a successful review audit when a concurrent edit wins the artifact CAS", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-review-cas`,
    );
    const completed = await createAndProcessProductMapRunForTest({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const artifact = completed.artifacts[0]!;
    const lockClient = await getPool().connect();
    let reviewPromise: ReturnType<typeof reviewProductMapArtifact> | null =
      null;
    let committed = false;
    try {
      await lockClient.query("begin");
      await lockClient.query(
        "select id from product_map_artifacts where id = $1 for update",
        [artifact.id],
      );
      reviewPromise = reviewProductMapArtifact({
        principal: principal(manager),
        projectId: projectAId,
        runId: completed.run.id,
        artifactId: artifact.id,
        decision: "approve",
        requestHeaders: headers,
      });
      await waitForBlockedProductMapQuery("product_map_artifacts");
      const cloned = await lockClient.query(
        `insert into product_map_artifact_versions (
           id, artifact_id, project_id, version, content, markdown, mermaid,
           source_references, content_digest, created_by
         )
         select $1, artifact_id, project_id, 2, content, markdown, mermaid,
                source_references, content_digest, $2
         from product_map_artifact_versions
         where artifact_id = $3 and project_id = $4 and version = 1`,
        [crypto.randomUUID(), manager.id, artifact.id, projectAId],
      );
      assert.equal(cloned.rowCount, 1);
      await lockClient.query(
        `update product_map_artifacts
         set current_version = 2, status = 'draft', updated_at = now()
         where id = $1 and project_id = $2`,
        [artifact.id, projectAId],
      );
      await lockClient.query("commit");
      committed = true;
    } finally {
      if (!committed) await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
    assert.ok(reviewPromise);
    await assert.rejects(reviewPromise, (error) =>
      assertProductMapError(error, 409, "PRODUCT_MAP_VERSION_CONFLICT"),
    );
    const [storedArtifact] = await getDb()
      .select({
        status: productMapArtifact.status,
        currentVersion: productMapArtifact.currentVersion,
      })
      .from(productMapArtifact)
      .where(eq(productMapArtifact.id, artifact.id));
    assert.equal(storedArtifact?.status, "draft");
    assert.equal(storedArtifact?.currentVersion, 2);
    assert.equal(
      await auditCountForEntity(artifact.id, "product_map_artifact_reviewed"),
      0,
    );
  });

  it("requires manager review, preserves immutable edits, and publishes only reviewed artifacts", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-publish`,
    );
    const completed = await createAndProcessProductMapRunForTest({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const artifact = completed.artifacts[0]!;
    const original = completed.versions[0]!;
    await assert.rejects(
      () =>
        reviewProductMapArtifact({
          principal: principal(viewer),
          projectId: projectAId,
          runId: completed.run.id,
          artifactId: artifact.id,
          decision: "approve",
          requestHeaders: headers,
        }),
      (error) => assertProductMapError(error, 403),
    );
    await assert.rejects(
      () =>
        publishProductMapArtifact({
          principal: principal(manager),
          projectId: projectAId,
          runId: completed.run.id,
          artifactId: artifact.id,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(error, 409, "PRODUCT_MAP_REVIEW_REQUIRED"),
    );
    const forged = structuredClone(
      productMapArtifactSchema.parse(original.content),
    );
    const forgedEvidence = forged.materialInventory.evidence[0];
    assert.ok(forgedEvidence);
    forgedEvidence.excerpt = "客户端伪造的证据正文";
    forgedEvidence.excerptDigest = createHash("sha256")
      .update(forgedEvidence.excerpt)
      .digest("hex");
    const forgedBinding = forged.citations
      .flatMap((citation) => citation.evidenceBindings)
      .find((binding) => binding.evidenceId === forgedEvidence.id);
    assert.ok(forgedBinding);
    forgedBinding.excerptDigest = forgedEvidence.excerptDigest;
    productMapArtifactSchema.parse(forged);
    await assert.rejects(
      () =>
        editProductMapArtifact({
          principal: principal(manager),
          projectId: projectAId,
          runId: completed.run.id,
          artifactId: artifact.id,
          expectedVersion: 1,
          content: forged,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(
          error,
          422,
          "PRODUCT_MAP_PROVENANCE_IMMUTABLE",
        ),
    );
    const [versionCountAfterForgery] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapArtifactVersion)
      .where(eq(productMapArtifactVersion.artifactId, artifact.id));
    assert.equal(versionCountAfterForgery?.count, 1);
    const edited = await editProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      expectedVersion: 1,
      content: original.content,
      requestHeaders: headers,
    });
    assert.equal(edited.artifacts[0]?.currentVersion, 2);
    assert.equal(edited.versions.length, 2);
    await assert.rejects(
      () =>
        editProductMapArtifact({
          principal: principal(manager),
          projectId: projectAId,
          runId: completed.run.id,
          artifactId: artifact.id,
          expectedVersion: 1,
          content: original.content,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(error, 409, "PRODUCT_MAP_VERSION_CONFLICT"),
    );
    await reviewProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      decision: "approve",
      requestHeaders: headers,
    });
    const published = await publishProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      requestHeaders: headers,
    });
    assert.equal(published.artifacts[0]?.status, "published");
    assert.ok(published.artifacts[0]?.publishedDocumentId);
    const viewerPublished = await getProductMapRun({
      principal: principal(viewer),
      projectId: projectAId,
      runId: completed.run.id,
      requestHeaders: headers,
    });
    assert.equal(viewerPublished.run.status, "published");
    assert.equal(viewerPublished.artifacts[0]?.status, "published");
  });

  it("fails closed when a previously selected source is no longer authorized", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-revoked-source`,
    );
    const completed = await createAndProcessProductMapRunForTest({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const artifact = completed.artifacts[0]!;
    const current = completed.versions[0]!;
    const denyId = `${prefix}-product-map-source-deny`;
    await getDb().insert(documentGrant).values({
      id: denyId,
      organizationId: "org-legacy-default",
      projectId: projectAId,
      documentId: source.document.id,
      subjectType: "user",
      subjectId: manager.id,
      permission: "view",
      effect: "deny",
      createdBy: admin.id,
    });
    try {
      const operations = [
        () =>
          getProductMapRun({
            principal: principal(manager),
            projectId: projectAId,
            runId: completed.run.id,
            requestHeaders: headers,
          }),
        () =>
          editProductMapArtifact({
            principal: principal(manager),
            projectId: projectAId,
            runId: completed.run.id,
            artifactId: artifact.id,
            expectedVersion: 1,
            content: current.content,
            requestHeaders: headers,
          }),
        () =>
          reviewProductMapArtifact({
            principal: principal(manager),
            projectId: projectAId,
            runId: completed.run.id,
            artifactId: artifact.id,
            decision: "approve",
            requestHeaders: headers,
          }),
        () =>
          publishProductMapArtifact({
            principal: principal(manager),
            projectId: projectAId,
            runId: completed.run.id,
            artifactId: artifact.id,
            requestHeaders: headers,
          }),
      ];
      for (const operation of operations) {
        await assert.rejects(
          operation,
          (error) =>
            assertProductMapError(
              error,
              409,
              "PRODUCT_MAP_SOURCE_ACCESS_REVOKED",
            ),
        );
      }
      const [denials] = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.entityId, completed.run.id),
            eq(auditEvent.eventType, "product_map_source_access_denied"),
          ),
        );
      assert.equal(denials?.count, operations.length);
    } finally {
      await getDb().delete(documentGrant).where(eq(documentGrant.id, denyId));
    }
    const restored = await getProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      requestHeaders: headers,
    });
    assert.equal(restored.artifacts.length, 1);
  });

  it("publishes only the current reviewed version and restores an archived idempotent upload replay", async () => {
    const source = await uploadAndIndex(
      projectAId,
      manager,
      `${prefix}-publish-cas`,
    );
    const completed = await createAndProcessProductMapRunForTest({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const artifact = completed.artifacts[0]!;
    await reviewProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      decision: "approve",
      requestHeaders: headers,
    });
    const existingPublishedDocuments = await getDb()
      .select({ id: projectDocument.id })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.projectId, projectAId),
          eq(projectDocument.displayName, `${projectAId} 产品结构`),
        ),
      );
    const existingPublishedDocumentIds = new Set(
      existingPublishedDocuments.map((document) => document.id),
    );

    const lockClient = await getPool().connect();
    let stalePublishPromise: ReturnType<
      typeof publishProductMapArtifact
    > | null = null;
    let committed = false;
    try {
      await lockClient.query("begin");
      await lockClient.query(
        "select id from product_map_artifacts where id = $1 for update",
        [artifact.id],
      );
      stalePublishPromise = publishProductMapArtifact({
        principal: principal(manager),
        projectId: projectAId,
        runId: completed.run.id,
        artifactId: artifact.id,
        requestHeaders: headers,
      });
      await waitForBlockedProductMapQuery("product_map_artifacts");
      const cloned = await lockClient.query(
        `insert into product_map_artifact_versions (
           id, artifact_id, project_id, version, content, markdown, mermaid,
           source_references, content_digest, created_by
         )
         select $1, artifact_id, project_id, 2, content, markdown, mermaid,
                source_references, content_digest, $2
         from product_map_artifact_versions
         where artifact_id = $3 and project_id = $4 and version = 1`,
        [crypto.randomUUID(), manager.id, artifact.id, projectAId],
      );
      assert.equal(cloned.rowCount, 1);
      await lockClient.query(
        `update product_map_artifacts
         set current_version = 2,
             status = 'draft',
             reviewed_by = null,
             reviewed_at = null,
             updated_at = now()
         where id = $1 and project_id = $2`,
        [artifact.id, projectAId],
      );
      await lockClient.query("commit");
      committed = true;
    } finally {
      if (!committed) await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
    assert.ok(stalePublishPromise);
    await assert.rejects(stalePublishPromise, (error) =>
      assertProductMapError(error, 409, "PRODUCT_MAP_REVIEW_REQUIRED"),
    );
    const [afterStalePublish] = await getDb()
      .select({
        status: productMapArtifact.status,
        currentVersion: productMapArtifact.currentVersion,
        publishedDocumentId: productMapArtifact.publishedDocumentId,
      })
      .from(productMapArtifact)
      .where(eq(productMapArtifact.id, artifact.id));
    assert.equal(afterStalePublish?.status, "draft");
    assert.equal(afterStalePublish?.currentVersion, 2);
    assert.equal(afterStalePublish?.publishedDocumentId, null);
    const documentsAfterStalePublish = await getDb()
      .select({ id: projectDocument.id })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.projectId, projectAId),
          eq(projectDocument.displayName, `${projectAId} 产品结构`),
        ),
      );
    assert.deepEqual(
      new Set(documentsAfterStalePublish.map((document) => document.id)),
      existingPublishedDocumentIds,
    );

    await reviewProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      decision: "approve",
      requestHeaders: headers,
    });
    await getDb()
      .update(productMapRun)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(productMapRun.id, completed.run.id));
    await assert.rejects(
      () =>
        publishProductMapArtifact({
          principal: principal(manager),
          projectId: projectAId,
          runId: completed.run.id,
          artifactId: artifact.id,
          requestHeaders: headers,
        }),
      (error) =>
        assertProductMapError(error, 409, "PRODUCT_MAP_REVIEW_REQUIRED"),
    );
    const productMapDocuments = await getDb()
      .select({
        id: projectDocument.id,
        status: projectDocument.status,
      })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.projectId, projectAId),
          eq(projectDocument.displayName, `${projectAId} 产品结构`),
        ),
      );
    const compensatedDocument = productMapDocuments.find(
      (document) => !existingPublishedDocumentIds.has(document.id),
    );
    assert.ok(compensatedDocument?.id);
    assert.equal(compensatedDocument.status, "archived");
    const [afterFailedPublish] = await getDb()
      .select({
        status: productMapArtifact.status,
        currentVersion: productMapArtifact.currentVersion,
        publishedDocumentId: productMapArtifact.publishedDocumentId,
      })
      .from(productMapArtifact)
      .where(eq(productMapArtifact.id, artifact.id));
    assert.equal(afterFailedPublish?.status, "reviewed");
    assert.equal(afterFailedPublish?.currentVersion, 2);
    assert.equal(afterFailedPublish?.publishedDocumentId, null);
    assert.equal(
      await auditCountForEntity(artifact.id, "product_map_artifact_published"),
      0,
    );

    await getDb()
      .update(productMapRun)
      .set({ status: "reviewing", updatedAt: new Date() })
      .where(eq(productMapRun.id, completed.run.id));
    const published = await publishProductMapArtifact({
      principal: principal(manager),
      projectId: projectAId,
      runId: completed.run.id,
      artifactId: artifact.id,
      requestHeaders: headers,
    });
    const publishedDocumentId = published.artifacts[0]?.publishedDocumentId;
    const publishedDocumentVersionId =
      published.artifacts[0]?.publishedDocumentVersionId;
    assert.ok(publishedDocumentId);
    assert.ok(publishedDocumentVersionId);
    const [linkedDocument] = await getDb()
      .select({ status: projectDocument.status })
      .from(projectDocument)
      .where(eq(projectDocument.id, publishedDocumentId));
    const [linkedVersion] = await getDb()
      .select({
        isCurrent: projectDocumentVersion.isCurrent,
        storageStatus: projectDocumentVersion.storageStatus,
      })
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.id, publishedDocumentVersionId));
    assert.equal(linkedDocument?.status, "active");
    assert.equal(linkedVersion?.isCurrent, true);
    assert.equal(linkedVersion?.storageStatus, "stored");
  });

  it("reclaims only expired leases and rejects an old worker", async () => {
    const source = await uploadAndIndex(projectAId, manager, `${prefix}-lease`);
    const created = await createProductMapRun({
      principal: principal(manager),
      projectId: projectAId,
      requestHeaders: headers,
      request: {
        selectedSourceIds: [source.document.id],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    const first = await claimProductMapRun(`${prefix}-worker-one`);
    assert.equal(first?.id, created.run.id);
    assert.equal(await claimProductMapRun(`${prefix}-worker-two`), null);
    await getDb()
      .update(productMapRun)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(productMapRun.id, created.run.id));
    const second = await claimProductMapRun(`${prefix}-worker-two`);
    assert.equal(second?.id, created.run.id);
    assert.notEqual(second?.leaseToken, first?.leaseToken);
    await assert.rejects(
      () => processProductMapRun(first!),
      (error) => assertProductMapError(error, 409, "PRODUCT_MAP_LEASE_LOST"),
    );
    const [latest] = await getDb()
      .select({
        leaseToken: productMapRun.leaseToken,
        attempt: productMapRun.attempt,
      })
      .from(productMapRun)
      .where(eq(productMapRun.id, created.run.id));
    assert.equal(latest?.leaseToken, second?.leaseToken);
    assert.equal(latest?.attempt, 2);
  });
});
