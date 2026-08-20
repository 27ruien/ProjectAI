import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { isProductAdmin } from "@/lib/auth/session";
import {
  requireProjectAccess,
  requireProjectRole,
} from "@/lib/auth/authorization";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { findUserById } from "@/lib/db/repositories/user-repository";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { listUploadableKnowledgeSpaces } from "@/lib/knowledge/management";
import {
  finalizeTemporaryWorkflowDocument,
  setDocumentArchived,
  uploadDocument,
} from "@/lib/files/document-service";
import {
  retrieveAuthorizedProjectContextCandidates,
  retrieveLexicalProjectCandidates,
  type RankedProjectKnowledgeEvidence,
} from "@/lib/documents/processing/search-service";
import {
  resolveGenerationScenario,
  resolveGenerationScenarioMetadata,
} from "@/lib/ai/model-management";
import {
  AiGatewayObservedError,
  createProjectAssistantGateway,
  type AiGatewayResult,
} from "@/lib/ai/project-assistant/gateway";
import { ProjectAssistantError } from "@/lib/ai/project-assistant/errors";
import { resolveAssistantContextReferences } from "@/lib/ai/project-assistant/context";
import type { AssistantContextReference } from "@/types/project-assistant";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { embeddingSummariesForVersions } from "@/lib/db/repositories/embedding-repository";
import { ingestionSummariesForVersions } from "@/lib/db/repositories/ingestion-repository";
import {
  aiThread,
  aiMessage,
  productMapArtifact,
  productMapArtifactVersion,
  productMapExecution,
  productMapRun,
  productMapSource,
  projectDocument,
  projectDocumentVersion,
  type ProductMapRunRecord,
  type ProductMapSourceRecord,
} from "@/lib/db/schema";
import {
  PRODUCT_MAP_MAX_EVIDENCE_ITEMS,
  PRODUCT_MAP_MAX_SELECTED_SOURCES,
  PRODUCT_MAP_MAX_UPLOADED_SOURCES,
  PRODUCT_MAP_QUALITY_CHECK_IDS,
  PRODUCT_MAP_SCHEMA_VERSION,
  PRODUCT_MAP_SKILL_VERSION,
  PRODUCT_MAP_STEP_IDS,
  PRODUCT_MAP_STEP_LABELS,
  PRODUCT_MAP_STEP_SCHEMAS,
  bindProductMapQualityToCompleteness,
  describeProductMapSchemaFailure,
  evaluateProductMapCompleteness,
  productMapAnalysisContractSchema,
  productMapArtifactSchema,
  productMapConfigInputSchema,
  productMapEvidenceSchema,
  productMapEvidenceInventorySchema,
  productMapQualitySchema,
  productMapStepOutputSchema,
  type ProductMapAnalysisContract,
  type ProductMapCompletenessField,
  type ProductMapEvidenceInventory,
  type ProductMapQuality,
  type ProductMapStepOutput,
  type ProductMapStructureIssue,
  runProductMapStructureLint,
  type ProductMapArtifact,
  type ProductMapEvidence,
  type ProductMapStepId,
} from "./contracts";
import {
  getProductMapSkill,
  loadTrustedProductMapInstructions,
} from "./registry";
import { getProductMapAiLimits } from "./config";

export class ProductMapError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductMapError";
  }
}

const MUTATION_ROLES = ["project_manager", "project_member"] as const;
const MANAGER_ROLES = ["project_manager"] as const;
const LEASE_MS = 5 * 60 * 1_000;
const APP_PROCESSOR_DELAY_MS = 1_000;
const PRIVATE_CONVERSATION_REDACTION =
  "已使用创建者明确授权的当前会话作为分析证据；为保护私有 Thread，原文未写入项目草稿。";
const activeAppProcessors = new Set<string>();
const SAFE_PRODUCT_MAP_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  PRODUCT_MAP_ACTOR_INACTIVE: "任务创建者已停用",
  PRODUCT_MAP_SOURCE_ACCESS_REVOKED: "Product Map 来源权限已变化，请重新选择资料",
  PRODUCT_MAP_SOURCE_VERSION_STALE: "部分资料已产生新版本，请重新选择当前版本",
  PRODUCT_MAP_SOURCE_PARSE_FAILED: "部分资料解析失败或需要 OCR，请更换资料后重试",
  PRODUCT_MAP_SOURCE_EMBEDDING_FAILED: "部分资料向量化失败，请更换资料后重试",
  PRODUCT_MAP_SKILL_DIGEST_MISMATCH: "Product Map Skill 版本已变化，请创建新的任务",
  PRODUCT_MAP_MODEL_OUTPUT_INVALID: "模型返回格式无效，请稍后重试",
  PRODUCT_MAP_ATTEMPTS_EXHAUSTED:
    "Product Map 多次执行未完成，请人工检查后重试",
  AI_MODEL_PROFILE_DISABLED: "Product Map 尚未配置可用模型，请联系管理员",
  AI_RATE_LIMITED: "Product Map 请求过于频繁，请稍后重试",
  AI_USER_DAILY_LIMIT_REACHED: "今日个人 AI 用量已达上限",
  AI_PROJECT_DAILY_LIMIT_REACHED: "今日项目 AI 用量已达上限",
  AI_CONCURRENCY_LIMIT_REACHED: "AI 服务繁忙，请稍后重试",
  AI_PROVIDER_TIMEOUT: "模型响应状态未知，请人工确认后再重试",
  AI_PROVIDER_UNAVAILABLE: "模型服务暂时不可用，请稍后重试",
  PROVIDER_TIMEOUT: "模型响应状态未知，请人工确认后再重试",
  PROVIDER_UNAVAILABLE: "模型服务暂时不可用，请稍后重试",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function digest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function productMapPublishIdempotencyKey(artifactId: string, version: number): string {
  const hash = sha256(`product-map-publish:${artifactId}:${version}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}
function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function requestDigest(input: {
  selectedSourceIds: string[];
  contextReferences?: AssistantContextReference[];
  retrievalInstruction?: string;
  userInput?: string;
  conversationId?: string;
  includeConversationContext?: boolean;
  initialAttachment?: boolean;
}): string {
  return digest({
    selectedSourceIds: [...input.selectedSourceIds].sort(),
    contextReferences: [...(input.contextReferences ?? [])]
      .map((reference) =>
        reference.type === "project"
          ? { type: reference.type, projectId: reference.projectId }
          : {
              type: reference.type,
              documentId: reference.documentId,
              documentVersionId: reference.documentVersionId ?? null,
              sourceType: reference.sourceType,
            },
      )
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    retrievalInstruction: input.retrievalInstruction ?? null,
    userInput: input.userInput ?? null,
    conversationId: input.conversationId ?? null,
    includeConversationContext: input.includeConversationContext === true,
    initialAttachment: input.initialAttachment === true,
  });
}

async function assertRunViewer(
  principal: AuthenticatedPrincipal,
  run: ProductMapRunRecord,
  requestHeaders?: Headers,
  db?: DatabaseExecutor,
) {
  const executor = db ?? getDb();
  const access = await requireProjectAccess(
    principal,
    run.projectId,
    requestHeaders,
    { db: executor },
  );
  const canReadUnpublished =
    isProductAdmin(principal.user.productRole) ||
    access.projectRole === "project_manager" ||
    run.creatorId === principal.user.id;
  // A Product Map draft may contain private conversation context.  Project
  // readers can inspect it only after the artifact has been explicitly
  // published; this is a server-side boundary, not a UI visibility choice.
  if (run.status !== "published" && !canReadUnpublished) {
    await writeAuditEvent(
      {
        actorUserId: principal.user.id,
        projectId: run.projectId,
        eventType: "product_map_run_access_denied",
        entityType: "product_map_run",
        entityId: run.id,
        result: "denied",
        metadata: { reason: "unpublished_run_private" },
        ...getRequestAuditContext(requestHeaders ?? new Headers()),
      },
      executor,
    );
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  }
  return access;
}

async function assertRunMutation(
  principal: AuthenticatedPrincipal,
  run: ProductMapRunRecord,
  requestHeaders: Headers,
  db?: DatabaseExecutor,
): Promise<void> {
  const executor = db ?? getDb();
  const access = await assertRunViewer(
    principal,
    run,
    requestHeaders,
    executor,
  );
  const canMutate =
    isProductAdmin(principal.user.productRole) ||
    access.projectRole === "project_manager" ||
    access.createdBy === principal.user.id ||
    (run.creatorId === principal.user.id &&
      access.projectRole === "project_member");
  if (canMutate) return;
  await writeAuditEvent(
    {
      actorUserId: principal.user.id,
      projectId: run.projectId,
      eventType: "product_map_run_access_denied",
      entityType: "product_map_run",
      entityId: run.id,
      result: "denied",
      metadata: { reason: "mutation_not_allowed" },
      ...getRequestAuditContext(requestHeaders),
    },
    executor,
  );
  throw new ProductMapError(403, "FORBIDDEN", "无权修改此 Product Map 任务");
}

async function assertProductMapSourcesStillAuthorized(input: {
  principal: AuthenticatedPrincipal;
  run: ProductMapRunRecord;
  requestHeaders: Headers;
  sources?: ProductMapSourceRecord[];
  db?: DatabaseExecutor;
}): Promise<void> {
  const executor = input.db ?? getDb();
  const sources =
    input.sources ??
    (await executor
      .select()
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, input.run.id),
          eq(productMapSource.projectId, input.run.projectId),
        ),
      ));
  const activeSources = sources.filter((source) => source.status !== "revoked");
  if (!activeSources.length) return;
  const authorized = await listAuthorizedDocumentScope({
    principal: input.principal,
    projectId: input.run.projectId,
    permission: "view",
    db: executor,
  });
  const authorizedKeys = new Set(
    authorized.map(
      (source) => `${source.sourceProjectId}:${source.documentId}`,
    ),
  );
  const revokedCount = activeSources.filter(
    (source) =>
      !authorizedKeys.has(`${source.sourceProjectId}:${source.documentId}`),
  ).length;
  if (!revokedCount) return;
  await writeAuditEvent(
    {
      actorUserId: input.principal.user.id,
      projectId: input.run.projectId,
      eventType: "product_map_source_access_denied",
      entityType: "product_map_run",
      entityId: input.run.id,
      result: "denied",
      metadata: {
        reason: "source_access_revoked",
        revokedSourceCount: revokedCount,
      },
      ...getRequestAuditContext(input.requestHeaders),
    },
    executor,
  );
  throw new ProductMapError(
    409,
    "PRODUCT_MAP_SOURCE_ACCESS_REVOKED",
    "Product Map 使用的资料权限已变化，请重新选择当前可访问资料",
  );
}

function serializeRun(
  run: ProductMapRunRecord,
  sourceCount: number,
  artifactCount: number,
) {
  return {
    id: run.id,
    projectId: run.projectId,
    workflowType: run.workflowType,
    skillId: run.skillId,
    skillVersion: run.skillVersion,
    scenario: run.scenario,
    status: run.status,
    currentStep: run.currentStep,
    limitedEvidence: run.limitedEvidence,
    sourceCount,
    artifactCount,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    failureReference: run.failureReference,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

async function sourceCount(
  db: DatabaseExecutor,
  runId: string,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productMapSource)
    .where(
      and(
        eq(productMapSource.runId, runId),
        eq(productMapSource.projectId, projectId),
      ),
    );
  return Number(row?.count ?? 0);
}

async function artifactCount(
  db: DatabaseExecutor,
  runId: string,
  projectId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productMapArtifact)
    .where(
      and(
        eq(productMapArtifact.runId, runId),
        eq(productMapArtifact.projectId, projectId),
      ),
    );
  return Number(row?.count ?? 0);
}

export async function listProductMapSkills(input?: {
  principal: AuthenticatedPrincipal;
  projectId: string;
}) {
  const skill = getProductMapSkill();
  let available = true;
  if (input) {
    try {
      await resolveGenerationScenarioMetadata({
        projectId: input.projectId,
        actorId: input.principal.user.id,
        scenario: "product_map_generation",
      });
    } catch {
      available = false;
    }
  }
  return [
    {
      id: skill.id,
      version: skill.version,
      displayName: skill.displayName,
      description: skill.description,
      enabled: skill.enabled && available,
      status: skill.status === "active" && available ? "active" : "inactive",
      availabilityCode: available
        ? null
        : "PRODUCT_MAP_MODEL_NOT_CONFIGURED",
      approvalRequired: skill.approvalRequired,
      scenario: "product_map_generation",
      skillFileSha256: skill.skillFileSha256,
      steps: skill.steps,
    },
  ];
}

export async function listProductMapRuns(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  const access = await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const canReadAllRuns =
    isProductAdmin(input.principal.user.productRole) ||
    access.projectRole === "project_manager";
  const rows = await getDb()
    .select()
    .from(productMapRun)
    .where(eq(productMapRun.projectId, input.projectId))
    .orderBy(desc(productMapRun.updatedAt))
    .limit(20);
  const visibleRows = rows.filter(
    (run) =>
      canReadAllRuns ||
      run.status === "published" ||
      run.creatorId === input.principal.user.id,
  );
  return Promise.all(
    visibleRows.map(async (run) =>
      serializeRun(
        run,
        await sourceCount(getDb(), run.id, run.projectId),
        await artifactCount(getDb(), run.id, run.projectId),
      ),
    ),
  );
}

/** Create or replay a Product Map run. Browser payload cannot select a model. */
export async function createProductMapRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  request: unknown;
  requestHeaders: Headers;
}) {
  const parsed = productMapConfigInputSchema.safeParse({
    ...(input.request && typeof input.request === "object"
      ? input.request
      : {}),
    projectId: input.projectId,
  });
  if (!parsed.success)
    throw new ProductMapError(
      400,
      "PRODUCT_MAP_INPUT_INVALID",
      "Product Map 输入无效",
    );
  const config = parsed.data;
  const target = await requireProjectRole(
    input.principal,
    input.projectId,
    MUTATION_ROLES,
    input.requestHeaders,
  );
  const skill = getProductMapSkill();
  const model = await resolveGenerationScenarioMetadata({
    projectId: input.projectId,
    actorId: input.principal.user.id,
    scenario: "product_map_generation",
  });
  const context = await resolveAssistantContextReferences({
    principal: input.principal,
    references: config.contextReferences as AssistantContextReference[],
  });
  if (
    context.references.some(
      (reference) =>
        reference.type === "project" &&
        reference.projectId !== input.projectId,
    )
  )
    throw new ProductMapError(
      404,
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
      "Product Map 只能使用当前项目上下文",
    );
  const authorized = await listAuthorizedDocumentScope({
    principal: input.principal,
    projectId: input.projectId,
    permission: "view",
  });
  const authorizedById = new Map(
    authorized.map((item) => [item.documentId, item]),
  );
  const selectedIds = [
    ...new Set([...config.selectedSourceIds, ...context.documentIds]),
  ];
  if (selectedIds.length > PRODUCT_MAP_MAX_SELECTED_SOURCES)
    throw new ProductMapError(
      400,
      "PRODUCT_MAP_INPUT_INVALID",
      "Product Map 所选资料数量超过上限",
    );
  if (selectedIds.some((id) => !authorizedById.has(id)))
    throw new ProductMapError(
      404,
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
      "所选资料不可用或不在当前授权范围内",
    );
  if (config.conversationId) {
    const db = getDb();
    const [thread] = await db
      .select({ id: aiThread.id })
      .from(aiThread)
      .where(
        and(
          eq(aiThread.id, config.conversationId),
          eq(aiThread.projectId, input.projectId),
          eq(aiThread.createdBy, input.principal.user.id),
          eq(aiThread.status, "active"),
        ),
      )
      .limit(1);
    if (!thread)
      throw new ProductMapError(
        404,
        "PRODUCT_MAP_CONVERSATION_NOT_FOUND",
        "会话不存在或不属于当前项目",
      );
  }
  const keyHash = sha256(config.idempotencyKey);
  const reqDigest = requestDigest({
    ...config,
    selectedSourceIds: selectedIds,
    contextReferences: context.references,
  });
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.projectId}:${input.principal.user.id}:${keyHash}:product-map`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.projectId, input.projectId),
          eq(productMapRun.creatorId, input.principal.user.id),
          eq(productMapRun.idempotencyKeyHash, keyHash),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.requestDigest !== reqDigest ||
        existing.generationModelId !== model.generationModelId
      )
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_IDEMPOTENCY_CONFLICT",
          "同一幂等键已用于不同的 Product Map 配置",
        );
      return {
        run: serializeRun(
          existing,
          await sourceCount(tx, existing.id, existing.projectId),
          await artifactCount(tx, existing.id, existing.projectId),
        ),
        created: false,
      };
    }
    const selectedRows = selectedIds.length
      ? await tx
          .select({
            document: projectDocument,
            version: projectDocumentVersion,
          })
          .from(projectDocument)
          .innerJoin(
            projectDocumentVersion,
            and(
              eq(projectDocumentVersion.documentId, projectDocument.id),
              eq(projectDocumentVersion.projectId, projectDocument.projectId),
              eq(projectDocumentVersion.isCurrent, true),
              eq(projectDocumentVersion.storageStatus, "stored"),
            ),
          )
          .where(
            and(
              eq(projectDocument.status, "active"),
              inArray(projectDocument.id, selectedIds),
            ),
          )
      : [];
    if (selectedRows.length !== selectedIds.length)
      throw new ProductMapError(
        404,
        "PRODUCT_MAP_SOURCE_NOT_FOUND",
        "所选资料当前不可用",
      );
    const currentVersionByDocumentId = new Map(
      selectedRows.map((row) => [row.document.id, row.version.id]),
    );
    if (
      context.references.some(
        (reference) =>
          reference.type === "document" &&
          reference.documentVersionId &&
          currentVersionByDocumentId.get(reference.documentId) !==
            reference.documentVersionId,
      )
    )
      throw new ProductMapError(
        404,
        "PRODUCT_MAP_SOURCE_NOT_FOUND",
        "显式引用的资料版本不可用或已不是当前版本",
      );
    const versionIds = selectedRows.map((row) => row.version.id);
    const [ingestionByVersion, embeddingByVersion] = await Promise.all([
      ingestionSummariesForVersions(versionIds, tx),
      embeddingSummariesForVersions(versionIds, tx),
    ]);
    const sourceReady = (row: (typeof selectedRows)[number]) =>
      ingestionByVersion.get(row.version.id)?.status === "succeeded" &&
      embeddingByVersion.get(row.version.id)?.status === "succeeded";
    const pending = selectedRows.some((row) => !sourceReady(row));
    const runId = randomUUID();
    const [run] = await tx
      .insert(productMapRun)
      .values({
        id: runId,
        organizationId: target.organizationId,
        projectId: target.id,
        creatorId: input.principal.user.id,
        threadId: config.conversationId ?? null,
        skillId: skill.id,
        skillVersion: skill.version,
        skillFileSha256: skill.skillFileSha256,
        generationModelId: model.generationModelId,
        contextReferences: context.references,
        includeConversationContext: config.includeConversationContext,
        status: config.initialAttachment
          ? "uploading"
          : pending
            ? "indexing"
            : "queued",
        idempotencyKeyHash: keyHash,
        requestDigest: reqDigest,
        selectedSourceIds: selectedIds,
        uploadedSourceIds: [],
        userInput: config.userInput ?? null,
        userInputDigest: config.userInput ? sha256(config.userInput) : null,
        retrievalInstruction: config.retrievalInstruction ?? null,
        nextAttemptAt: new Date(),
      })
      .returning();
    if (!run)
      throw new ProductMapError(
        503,
        "PRODUCT_MAP_RUN_CREATE_FAILED",
        "Product Map 任务创建失败",
      );
    if (selectedRows.length)
      await tx.insert(productMapSource).values(
        selectedRows.map((row) => ({
          id: randomUUID(),
          runId,
          projectId: target.id,
          sourceProjectId: row.document.projectId,
          sourceType:
            authorizedById.get(row.document.id)?.sourceScope === "organization"
              ? "organization"
              : "project",
          documentId: row.document.id,
          versionId: row.version.id,
          displayName: row.document.displayName,
          mimeType: row.version.detectedMimeType,
          sha256: row.version.sha256,
          status: sourceReady(row) ? "ready" : "pending",
        })),
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: target.id,
        eventType: "product_map_run_created",
        entityType: "product_map_run",
        entityId: runId,
        result: "succeeded",
        metadata: {
          skillId: skill.id,
          skillVersion: skill.version,
          sourceCount: selectedRows.length,
          generationModelId: model.generationModelId,
        },
      },
      tx,
    );
    return { run: serializeRun(run, selectedRows.length, 0), created: true };
  });
}

export async function getProductMapRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  const access = await assertRunViewer(
    input.principal,
    run,
    input.requestHeaders,
  );
  const productAdmin = isProductAdmin(input.principal.user.productRole);
  const projectCreator = access.createdBy === input.principal.user.id;
  const runCreator = run.creatorId === input.principal.user.id;
  const projectManager = access.projectRole === "project_manager";
  const canEdit =
    productAdmin ||
    projectCreator ||
    projectManager ||
    (runCreator && access.projectRole === "project_member");
  const canManage = productAdmin || projectCreator || projectManager;
  const [sources, artifacts, executions] = await Promise.all([
    db
      .select()
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, run.id),
          eq(productMapSource.projectId, run.projectId),
        ),
      )
      .orderBy(asc(productMapSource.createdAt)),
    db
      .select()
      .from(productMapArtifact)
      .where(
        and(
          eq(productMapArtifact.runId, run.id),
          eq(productMapArtifact.projectId, run.projectId),
        ),
      )
      .orderBy(desc(productMapArtifact.updatedAt)),
    db
      .select()
      .from(productMapExecution)
      .where(
        and(
          eq(productMapExecution.runId, run.id),
          eq(productMapExecution.projectId, run.projectId),
        ),
      )
      .orderBy(asc(productMapExecution.startedAt)),
  ]);
  await assertProductMapSourcesStillAuthorized({
    principal: input.principal,
    run,
    requestHeaders: input.requestHeaders,
    sources,
    db,
  });
  const versions = artifacts.length
    ? await db
        .select()
        .from(productMapArtifactVersion)
        .where(
          and(
            eq(productMapArtifactVersion.artifactId, artifacts[0]!.id),
            eq(productMapArtifactVersion.projectId, run.projectId),
          ),
        )
        .orderBy(desc(productMapArtifactVersion.version))
    : [];
  const versionByNumber = new Map(
    versions.map((version) => [version.version, version]),
  );
  return {
    run: serializeRun(
      run,
      sources.filter((source) => source.status !== "revoked").length,
      artifacts.length,
    ),
    sources: sources.map((source) => ({
      id: source.id,
      documentId: source.documentId,
      sourceType: source.sourceType,
      displayName: source.displayName,
      mimeType: source.mimeType,
      status: source.status,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => {
      const current = versionByNumber.get(artifact.currentVersion);
      return {
        id: artifact.id,
        projectId: artifact.projectId,
        title: artifact.title,
        status: artifact.status,
        currentVersion: artifact.currentVersion,
        contentDigest: artifact.contentDigest,
        content: current?.content ?? null,
        markdown: current?.markdown ?? "",
        mermaid: current?.mermaid ?? "",
        reviewedAt: artifact.reviewedAt?.toISOString() ?? null,
        publishedAt: artifact.publishedAt?.toISOString() ?? null,
        publishedDocumentId: artifact.publishedDocumentId,
        publishedDocumentVersionId: artifact.publishedDocumentVersionId,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      };
    }),
    versions: versions.map((version) => ({
      id: version.id,
      artifactId: version.artifactId,
      projectId: version.projectId,
      version: version.version,
      content: version.content,
      markdown: version.markdown,
      mermaid: version.mermaid,
      contentDigest: version.contentDigest,
      createdAt: version.createdAt.toISOString(),
    })),
    executions: executions.map((execution) => ({
      stepId: execution.stepId,
      attempt: execution.attempt,
      status: execution.status,
      inputTokens: execution.inputTokens,
      outputTokens: execution.outputTokens,
      totalTokens: execution.totalTokens,
      reservedTokens: execution.reservedTokens,
      latencyMs: execution.latencyMs,
      costUsdMicros: execution.costUsdMicros,
      costAccountingStatus: execution.costAccountingStatus,
      failureCode: execution.failureCode,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
    })),
    permissions: { canEdit, canReview: canManage, canPublish: canManage },
  };
}

export async function cancelProductMapRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  const requestContext = getRequestAuditContext(input.requestHeaders);
  await getDb().transaction(async (tx) => {
    // Serialize against a concurrent claim and cancel from the row we actually
    // mutate. Cancellation is terminal even while a lease is active: clearing
    // the token makes every subsequent worker write fail closed, while the
    // execution record can still capture an in-flight Provider response/cost.
    // Keeping a cooperative marker with an active lease would strand the Run if
    // the App crashed before observing that marker.
    const [lockedRun] = await tx
      .select({
        id: productMapRun.id,
        projectId: productMapRun.projectId,
        status: productMapRun.status,
        leaseToken: productMapRun.leaseToken,
        leaseExpired: sql<boolean>`${productMapRun.leaseExpiresAt} is null or ${productMapRun.leaseExpiresAt} <= now()`,
      })
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
        ),
      )
      .limit(1)
      .for("update", { of: productMapRun });
    if (!lockedRun)
      throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
    const cancelledAt = new Date();
    const [updated] = await tx
      .update(productMapRun)
      .set({
        cancellationRequestedAt: cancelledAt,
        status: "cancelled",
        completedAt: cancelledAt,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        updatedAt: cancelledAt,
      })
      .where(
        and(
          eq(productMapRun.id, lockedRun.id),
          eq(productMapRun.projectId, lockedRun.projectId),
          inArray(productMapRun.status, [
            "queued",
            "checking_sources",
            "uploading",
            "indexing",
            "retrieving",
            "running",
            "needs_input",
            "unknown",
          ]),
        ),
      )
      .returning({ status: productMapRun.status });
    if (!updated) return;
    const cancelledBeforeDispatch = await tx
      .update(productMapExecution)
      .set({
        status: "cancelled",
        failureCode: "PRODUCT_MAP_CANCELLED_BEFORE_DISPATCH",
        completedAt: sql`now()`,
      })
      .where(
        and(
          eq(productMapExecution.runId, lockedRun.id),
          eq(productMapExecution.projectId, lockedRun.projectId),
          eq(productMapExecution.status, "reserved"),
        ),
      )
      .returning({ id: productMapExecution.id });
    const unknownAfterExpiredLease = lockedRun.leaseExpired
      ? await tx
          .update(productMapExecution)
          .set({
            status: "unknown",
            failureCode: "PRODUCT_MAP_CANCELLED_PROVIDER_RESULT_UNKNOWN",
            completedAt: sql`now()`,
          })
          .where(
            and(
              eq(productMapExecution.runId, lockedRun.id),
              eq(productMapExecution.projectId, lockedRun.projectId),
              eq(productMapExecution.status, "running"),
            ),
          )
          .returning({ id: productMapExecution.id })
      : [];
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: lockedRun.projectId,
        eventType: "product_map_run_cancelled",
        entityType: "product_map_run",
        entityId: lockedRun.id,
        result: "succeeded",
        metadata: {
          previousStatus: lockedRun.status,
          status: updated.status,
          leaseRevoked: Boolean(lockedRun.leaseToken),
          executionsCancelledBeforeDispatch: cancelledBeforeDispatch.length,
          executionsUnknownAfterExpiredLease:
            unknownAfterExpiredLease.length,
        },
        ...requestContext,
      },
      tx,
    );
  });
  return getProductMapRun(input);
}

export async function retryProductMapRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  if (run.status !== "failed" && run.status !== "unknown")
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_RETRY_NOT_READY",
      "只有失败或状态未知的任务可以重试",
    );
  const requestContext = getRequestAuditContext(input.requestHeaders);
  await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(productMapRun)
      .set({
        status: "queued",
        attempt: 0,
        failureCode: null,
        failureMessage: null,
        failureReference: null,
        cancellationRequestedAt: null,
        completedAt: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
        version: sql`${productMapRun.version} + 1`,
      })
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
          inArray(productMapRun.status, ["failed", "unknown"]),
        ),
      )
      .returning({ version: productMapRun.version });
    if (!updated)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_RETRY_NOT_READY",
        "任务状态已变化，请刷新后重试",
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: run.projectId,
        eventType: "product_map_run_retried",
        entityType: "product_map_run",
        entityId: run.id,
        result: "succeeded",
        metadata: {
          previousStatus: run.status,
          status: "queued",
          version: updated.version,
        },
        ...requestContext,
      },
      tx,
    );
  });
  return getProductMapRun(input);
}

/**
 * Explicitly re-arm an active durable Run after an App restart. This is a
 * trusted mutation action rather than a GET side effect, and it never creates
 * a second Run or changes the model/source snapshot.
 */
export async function resumeProductMapRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  if (
    ![
      "queued",
      "checking_sources",
      "indexing",
      "retrieving",
      "running",
    ].includes(run.status)
  )
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_RESUME_NOT_READY",
      "当前任务不需要恢复执行",
    );
  return getProductMapRun(input);
}

export async function continueLimitedEvidence(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  limitedEvidence: boolean;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  if (run.status !== "needs_input")
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_CONTINUE_NOT_READY",
      "当前任务不在待补充状态",
    );
  const requestContext = getRequestAuditContext(input.requestHeaders);
  await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(productMapRun)
      .set({
        limitedEvidence: input.limitedEvidence,
        status: "queued",
        failureCode: null,
        failureMessage: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
        version: sql`${productMapRun.version} + 1`,
      })
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
          eq(productMapRun.status, "needs_input"),
        ),
      )
      .returning({ version: productMapRun.version });
    if (!updated)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_CONTINUE_NOT_READY",
        "任务状态已变化，请刷新后重试",
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: run.projectId,
        eventType: "product_map_run_continued",
        entityType: "product_map_run",
        entityId: run.id,
        result: "succeeded",
        metadata: {
          previousStatus: run.status,
          status: "queued",
          limitedEvidence: input.limitedEvidence,
          version: updated.version,
        },
        ...requestContext,
      },
      tx,
    );
  });
  return getProductMapRun(input);
}

export async function attachProductMapSource(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  documentId: string;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  if (
    ![
      "uploading",
      "indexing",
      "needs_input",
      "failed",
      "unknown",
      "queued",
      "checking_sources",
    ].includes(run.status)
  ) {
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_SOURCE_ATTACH_NOT_READY",
      "当前任务状态不能再补充资料",
    );
  }
  await requireProjectRole(
    input.principal,
    input.projectId,
    MUTATION_ROLES,
    input.requestHeaders,
  );
  const authorized = await listAuthorizedDocumentScope({
    principal: input.principal,
    projectId: input.projectId,
    permission: "view",
  });
  const scope = authorized.find((item) => item.documentId === input.documentId);
  if (!scope)
    throw new ProductMapError(
      404,
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
      "资料不可用或不在当前项目范围内",
    );
  const [row] = await getDb()
    .select({
      document: projectDocument,
      version: projectDocumentVersion,
    })
    .from(projectDocument)
    .innerJoin(
      projectDocumentVersion,
      and(
        eq(projectDocumentVersion.documentId, projectDocument.id),
        eq(projectDocumentVersion.projectId, projectDocument.projectId),
        eq(projectDocumentVersion.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(projectDocument.id, input.documentId),
        eq(projectDocument.status, "active"),
      ),
    )
    .limit(1);
  if (!row)
    throw new ProductMapError(
      404,
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
      "资料不存在",
    );
  const [ingestion, embedding] = await Promise.all([
    ingestionSummariesForVersions([row.version.id]).then((rows) =>
      rows.get(row.version.id),
    ),
    embeddingSummariesForVersions([row.version.id]).then((rows) =>
      rows.get(row.version.id),
    ),
  ]);
  const ready =
    ingestion?.status === "succeeded" && embedding?.status === "succeeded";
  const requestContext = getRequestAuditContext(input.requestHeaders);
  await getDb().transaction(async (tx) => {
    // Keep the common project -> run -> document lock order. Rechecking the
    // membership inside this transaction prevents a concurrent role change
    // from authorizing a permanent document promotion.
    await requireProjectRole(
      input.principal,
      input.projectId,
      MUTATION_ROLES,
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    // Serialize attachment with cancellation/retry and derive JSON ids from
    // the row that is actually being updated. The preflight `run` snapshot is
    // used for authorization only; relying on it here can lose a concurrent
    // attachment or resurrect a run cancelled after that snapshot.
    const [lockedRun] = await tx
      .select()
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
        ),
      )
      .limit(1)
      .for("update", { of: productMapRun });
    const attachableStatuses = [
      "uploading",
      "indexing",
      "needs_input",
      "failed",
      "unknown",
      "queued",
      "checking_sources",
    ] as const;
    if (
      !lockedRun ||
      !attachableStatuses.includes(
        lockedRun.status as (typeof attachableStatuses)[number],
      ) ||
      lockedRun.cancellationRequestedAt
    )
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_SOURCE_ATTACH_NOT_READY",
        "任务状态已变化或已取消，请刷新后重试",
      );
    if (
      row.document.workflowTemporary &&
      row.document.temporaryWorkflowId === lockedRun.id
    ) {
      // Promotion, source attachment and Run re-arm must commit or roll back as
      // one unit. Otherwise cancellation can leave an unattached temporary
      // upload permanently promoted into the project knowledge base.
      await finalizeTemporaryWorkflowDocument({
        principal: input.principal,
        projectId: input.projectId,
        documentId: row.document.id,
        workflowId: lockedRun.id,
        action: "promote",
        targetKnowledgeSpaceId: row.document.knowledgeSpaceId,
        requestHeaders: input.requestHeaders,
        transaction: tx,
      });
    }
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, lockedRun.id),
          eq(productMapSource.projectId, lockedRun.projectId),
        ),
      );
    if (
      Number(count ?? 0) >=
      PRODUCT_MAP_MAX_SELECTED_SOURCES + PRODUCT_MAP_MAX_UPLOADED_SOURCES
    )
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_SOURCE_LIMIT_REACHED",
        "本次 Product Map 资料数量已达上限",
      );
    await tx
      .update(productMapSource)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        and(
          eq(productMapSource.runId, lockedRun.id),
          eq(productMapSource.projectId, lockedRun.projectId),
          or(
            eq(productMapSource.documentId, row.document.id),
            ...([
              "PRODUCT_MAP_SOURCE_PARSE_FAILED",
              "PRODUCT_MAP_SOURCE_EMBEDDING_FAILED",
            ].includes(lockedRun.failureCode ?? "")
              ? [eq(productMapSource.status, "failed")]
              : []),
          ),
        ),
      );
    await tx
      .insert(productMapSource)
      .values({
        id: randomUUID(),
        runId: lockedRun.id,
        projectId: lockedRun.projectId,
        sourceProjectId: row.document.projectId,
        sourceType:
          scope.sourceScope === "organization" ? "organization" : "upload",
        documentId: row.document.id,
        versionId: row.version.id,
        displayName: row.document.displayName,
        mimeType: row.version.detectedMimeType,
        sha256: row.version.sha256,
        status: ready ? "ready" : "pending",
      })
      .onConflictDoUpdate({
        target: [
          productMapSource.runId,
          productMapSource.projectId,
          productMapSource.versionId,
        ],
        set: { status: ready ? "ready" : "pending", updatedAt: new Date() },
      });
    const existing = Array.isArray(lockedRun.uploadedSourceIds)
      ? lockedRun.uploadedSourceIds
      : [];
    const cancelledReservations = await tx
      .update(productMapExecution)
      .set({
        status: "cancelled",
        failureCode: "PRODUCT_MAP_SOURCE_CHANGED_BEFORE_DISPATCH",
        completedAt: sql`now()`,
      })
      .where(
        and(
          eq(productMapExecution.runId, lockedRun.id),
          eq(productMapExecution.projectId, lockedRun.projectId),
          eq(productMapExecution.status, "reserved"),
        ),
      )
      .returning({ id: productMapExecution.id });
    const [updatedRun] = await tx
      .update(productMapRun)
      .set({
        uploadedSourceIds: [...new Set([...existing, row.document.id])].slice(
          0,
          PRODUCT_MAP_MAX_UPLOADED_SOURCES,
        ),
        status: ready ? "queued" : "indexing",
        attempt: 0,
        failureCode: null,
        failureMessage: null,
        failureReference: null,
        evidenceSnapshot: null,
        evidenceSnapshotDigest: null,
        sourceCoverage: {},
        sourceConflicts: [],
        stepOutputs: {},
        currentStep: 0,
        completedAt: null,
        cancellationRequestedAt: null,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        nextAttemptAt: sql`now()`,
        updatedAt: sql`now()`,
        version: sql`${productMapRun.version} + 1`,
      })
      .where(
        and(
          eq(productMapRun.id, lockedRun.id),
          eq(productMapRun.projectId, lockedRun.projectId),
          eq(productMapRun.version, lockedRun.version),
          inArray(productMapRun.status, attachableStatuses),
          isNull(productMapRun.cancellationRequestedAt),
        ),
      )
      .returning({ id: productMapRun.id });
    if (!updatedRun)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_SOURCE_ATTACH_NOT_READY",
        "任务状态已变化或已取消，请刷新后重试",
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: lockedRun.projectId,
        eventType: "product_map_source_attached",
        entityType: "product_map_run",
        entityId: lockedRun.id,
        result: "succeeded",
        metadata: {
          sourceType: scope.sourceScope,
          sourceStatus: ready ? "ready" : "pending",
          sourceCount: Number(count ?? 0) + 1,
          leaseRevoked: Boolean(lockedRun.leaseToken),
          executionsCancelledBeforeDispatch: cancelledReservations.length,
        },
        ...requestContext,
      },
      tx,
    );
  });
  return getProductMapRun({
    principal: input.principal,
    projectId: input.projectId,
    runId: run.id,
    requestHeaders: input.requestHeaders,
  });
}

export async function reviewProductMapArtifact(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  artifactId: string;
  decision: "approve" | "reject";
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await requireProjectRole(
    input.principal,
    input.projectId,
    MANAGER_ROLES,
    input.requestHeaders,
  );
  await assertProductMapSourcesStillAuthorized({
    principal: input.principal,
    run,
    requestHeaders: input.requestHeaders,
  });
  const [artifact] = await getDb()
    .select()
    .from(productMapArtifact)
    .where(
      and(
        eq(productMapArtifact.id, input.artifactId),
        eq(productMapArtifact.runId, run.id),
        eq(productMapArtifact.projectId, run.projectId),
      ),
    )
    .limit(1);
  if (!artifact)
    throw new ProductMapError(404, "NOT_FOUND", "产品结构草稿不存在");
  if (artifact.status === "published")
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_ALREADY_PUBLISHED",
      "已发布版本不能重复审核，请先保存新草稿版本",
    );
  const [version] = await getDb()
    .select({ content: productMapArtifactVersion.content })
    .from(productMapArtifactVersion)
    .where(
      and(
        eq(productMapArtifactVersion.artifactId, artifact.id),
        eq(productMapArtifactVersion.projectId, artifact.projectId),
        eq(productMapArtifactVersion.version, artifact.currentVersion),
      ),
    )
    .limit(1);
  const content = productMapArtifactSchema.safeParse(version?.content);
  if (!content.success)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_VERSION_INVALID",
      "当前草稿版本无效",
    );
  if (input.decision === "approve" && !content.data.structureReview.passed)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_STRUCTURE_REVIEW_REQUIRED",
      "请先修复确定性结构审查中的阻塞项",
    );
  await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(productMapArtifact)
      .set({
        status: input.decision === "approve" ? "reviewed" : "draft",
        reviewedBy:
          input.decision === "approve" ? input.principal.user.id : null,
        reviewedAt: input.decision === "approve" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productMapArtifact.id, artifact.id),
          eq(productMapArtifact.projectId, artifact.projectId),
          eq(productMapArtifact.currentVersion, artifact.currentVersion),
          eq(productMapArtifact.status, artifact.status),
        ),
      )
      .returning({ id: productMapArtifact.id });
    if (!updated)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_VERSION_CONFLICT",
        "草稿已被其他操作更新，请刷新后重试",
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: run.projectId,
        eventType: "product_map_artifact_reviewed",
        entityType: "product_map_artifact",
        entityId: artifact.id,
        result: "succeeded",
        metadata: {
          runId: run.id,
          version: artifact.currentVersion,
          decision: input.decision,
        },
      },
      tx,
    );
  });
  return getProductMapRun({
    principal: input.principal,
    projectId: input.projectId,
    runId: run.id,
    requestHeaders: input.requestHeaders,
  });
}

export async function editProductMapArtifact(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  artifactId: string;
  expectedVersion: number;
  content: unknown;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await assertRunMutation(input.principal, run, input.requestHeaders);
  await assertProductMapSourcesStillAuthorized({
    principal: input.principal,
    run,
    requestHeaders: input.requestHeaders,
  });
  const proposed = productMapArtifactSchema.safeParse(input.content);
  if (!proposed.success)
    throw new ProductMapError(
      422,
      describeProductMapSchemaFailure(input.content),
      "产品结构草稿格式无效",
    );
  await getDb().transaction(async (tx) => {
    const [artifact] = await tx
      .select()
      .from(productMapArtifact)
      .where(
        and(
          eq(productMapArtifact.id, input.artifactId),
          eq(productMapArtifact.runId, run.id),
          eq(productMapArtifact.projectId, run.projectId),
        ),
      )
      .limit(1)
      .for("update", { of: productMapArtifact });
    if (!artifact)
      throw new ProductMapError(404, "NOT_FOUND", "产品结构草稿不存在");
    if (artifact.currentVersion !== input.expectedVersion)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_VERSION_CONFLICT",
        "草稿已被其他操作更新，请刷新后重试",
      );
    const [currentVersion] = await tx
      .select({ content: productMapArtifactVersion.content })
      .from(productMapArtifactVersion)
      .where(
        and(
          eq(productMapArtifactVersion.artifactId, artifact.id),
          eq(productMapArtifactVersion.projectId, artifact.projectId),
          eq(productMapArtifactVersion.version, artifact.currentVersion),
        ),
      )
      .limit(1);
    const trusted = productMapArtifactSchema.safeParse(currentVersion?.content);
    if (!trusted.success)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_VERSION_INVALID",
        "当前草稿版本无效",
      );
    const immutableProvenanceChanged =
      digest(proposed.data.completeness) !== digest(trusted.data.completeness) ||
      digest(proposed.data.materialInventory) !==
        digest(trusted.data.materialInventory) ||
      digest(proposed.data.citations) !== digest(trusted.data.citations) ||
      digest(proposed.data.analysisContract.sources) !==
        digest(trusted.data.analysisContract.sources) ||
      digest(proposed.data.stepOutputs) !== digest(trusted.data.stepOutputs);
    if (immutableProvenanceChanged)
      throw new ProductMapError(
        422,
        "PRODUCT_MAP_PROVENANCE_IMMUTABLE",
        "资料快照、引用和执行证据由系统维护，不能通过草稿编辑修改",
      );
    const analysisContract = productMapAnalysisContractSchema.safeParse({
      ...proposed.data.analysisContract,
      sources: trusted.data.analysisContract.sources,
      evidenceCoverage: evidenceCoverageFromUnknown({
        sources: trusted.data.analysisContract.sources,
        contract: proposed.data.analysisContract,
      }),
    });
    if (!analysisContract.success)
      throw new ProductMapError(
        422,
        describeProductMapSchemaFailure(
          proposed.data.analysisContract,
          productMapAnalysisContractSchema,
        ),
        "产品结构草稿中的 PM 分析契约无效",
      );
    const checkedAt = new Date().toISOString();
    const provenanceBound = {
      ...proposed.data,
      completeness: trusted.data.completeness,
      materialInventory: trusted.data.materialInventory,
      citations: trusted.data.citations,
      analysisContract: analysisContract.data,
      stepOutputs: trusted.data.stepOutputs,
    };
    const issues = deduplicateIssues(runProductMapStructureLint(provenanceBound));
    const structureReview = {
      version: "pm-design-lint-v1" as const,
      checkedAt,
      passed: !issues.some((issue) => issue.severity === "error"),
      issues,
    };
    const quality = qualityFromIssues(
      issues,
      trusted.data.completeness,
      analysisContract.data.evidenceCoverage.conflict,
    );
    const stepOutputs = trusted.data.stepOutputs.map((step) =>
      step.stepId === "final_artifact"
        ? makeStepEnvelope({
            stepId: "final_artifact",
            output: {
              artifactSchemaVersion: PRODUCT_MAP_SCHEMA_VERSION,
              structureIssueCount: issues.length,
              structurePassed: structureReview.passed,
            },
            sourceRefs: trusted.data.analysisContract.sources.map(
              (source) => source.id,
            ),
            createdAt: checkedAt,
          })
        : step,
    );
    const editedCandidate = {
      ...provenanceBound,
      quality,
      structureReview,
      stepOutputs,
    };
    const editedResult = productMapArtifactSchema.safeParse(editedCandidate);
    if (!editedResult.success)
      throw new ProductMapError(
        422,
        describeProductMapSchemaFailure(
          editedCandidate,
          productMapArtifactSchema,
        ),
        "产品结构草稿格式无效",
      );
    const edited = editedResult.data;
    const markdown = renderProductMapMarkdown(edited);
    const mermaid = renderProductMapMermaid(edited);
    const contentDigest = digest({ content: edited, markdown, mermaid });
    const next = artifact.currentVersion + 1;
    await tx
      .insert(productMapArtifactVersion)
      .values({
        id: randomUUID(),
        artifactId: artifact.id,
        projectId: artifact.projectId,
        version: next,
        content: edited as unknown as Record<string, unknown>,
        markdown,
        mermaid,
        sourceReferences: edited.citations,
        contentDigest,
        createdBy: input.principal.user.id,
      });
    await tx
      .update(productMapArtifact)
      .set({
        currentVersion: next,
        contentDigest,
        status: "draft",
        reviewedBy: null,
        reviewedAt: null,
        publishedBy: null,
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productMapArtifact.id, artifact.id),
          eq(productMapArtifact.projectId, artifact.projectId),
          eq(productMapArtifact.currentVersion, input.expectedVersion),
        ),
      );
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: run.projectId,
        eventType: "product_map_artifact_edited",
        entityType: "product_map_artifact",
        entityId: artifact.id,
        result: "succeeded",
        metadata: {
          runId: run.id,
          previousVersion: artifact.currentVersion,
          version: next,
          structurePassed: edited.structureReview.passed,
        },
      },
      tx,
    );
  });
  return getProductMapRun({
    principal: input.principal,
    projectId: input.projectId,
    runId: run.id,
    requestHeaders: input.requestHeaders,
  });
}

export async function publishProductMapArtifact(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  runId: string;
  artifactId: string;
  requestHeaders: Headers;
}) {
  const [run] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, input.runId),
        eq(productMapRun.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!run)
    throw new ProductMapError(404, "NOT_FOUND", "Product Map 任务不存在");
  await requireProjectRole(
    input.principal,
    input.projectId,
    MANAGER_ROLES,
    input.requestHeaders,
  );
  await assertProductMapSourcesStillAuthorized({
    principal: input.principal,
    run,
    requestHeaders: input.requestHeaders,
  });
  const spaces = await listUploadableKnowledgeSpaces({
    principal: input.principal,
    projectId: input.projectId,
    requestHeaders: input.requestHeaders,
  });
  const destination = spaces.find(
    (space) => space.type === "project" && space.projectId === input.projectId,
  );
  if (!destination)
    throw new ProductMapError(
      404,
      "PRODUCT_MAP_UPLOAD_DESTINATION_MISSING",
      "当前项目没有可写资料空间",
    );
  const db = getDb();
  let uploaded: Awaited<ReturnType<typeof uploadDocument>> | null = null;
  let compensationDocumentId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const [artifact] = await tx
        .select()
        .from(productMapArtifact)
        .where(
          and(
            eq(productMapArtifact.id, input.artifactId),
            eq(productMapArtifact.runId, run.id),
            eq(productMapArtifact.projectId, run.projectId),
          ),
        )
        .limit(1)
        .for("update", { of: productMapArtifact });
      if (!artifact)
        throw new ProductMapError(404, "NOT_FOUND", "产品结构草稿不存在");
      if (artifact.status !== "reviewed")
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_REVIEW_REQUIRED",
          "请先完成人工审核",
        );
      const [version] = await tx
        .select()
        .from(productMapArtifactVersion)
        .where(
          and(
            eq(productMapArtifactVersion.artifactId, artifact.id),
            eq(productMapArtifactVersion.projectId, artifact.projectId),
            eq(productMapArtifactVersion.version, artifact.currentVersion),
          ),
        )
        .limit(1);
      if (!version)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_VERSION_MISSING",
          "当前草稿版本不存在",
        );
      uploaded = await uploadDocument({
        principal: input.principal,
        projectId: input.projectId,
        requestHeaders: input.requestHeaders,
        idempotencyKey: productMapPublishIdempotencyKey(
          artifact.id,
          artifact.currentVersion,
        ),
        file: new File([version.markdown], `product-map-v${version.version}.md`, {
          type: "text/markdown",
        }),
        displayName: `${run.projectId} 产品结构`,
        knowledgeSpaceId: destination.id,
        versionNote: `Product Map ${PRODUCT_MAP_SKILL_VERSION} · v${version.version}`,
      });
      // A retry after an uncertain publish acknowledgement may replay the
      // stable upload idempotency key.  The previous attempt can have
      // archived its orphaned document during compensation; restore that
      // exact replay before linking it as the current formal document.
      if (uploaded.document.status === "archived") {
        const restored = await setDocumentArchived({
          principal: input.principal,
          projectId: input.projectId,
          documentId: uploaded.document.id,
          archived: false,
          requestHeaders: input.requestHeaders,
        });
        uploaded = { ...uploaded, document: restored };
      }
      compensationDocumentId = uploaded.document.id;
      const [publishedArtifact] = await tx
        .update(productMapArtifact)
        .set({
          status: "published",
          publishedBy: input.principal.user.id,
          publishedAt: new Date(),
          publishedDocumentId: uploaded.document.id,
          publishedDocumentVersionId: uploaded.version.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapArtifact.id, artifact.id),
            eq(productMapArtifact.projectId, artifact.projectId),
            eq(productMapArtifact.currentVersion, artifact.currentVersion),
            eq(productMapArtifact.status, "reviewed"),
          ),
        )
        .returning({ id: productMapArtifact.id });
      if (!publishedArtifact)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_VERSION_CONFLICT",
          "草稿已被其他操作更新，请刷新后重试",
        );
      const [publishedRun] = await tx
        .update(productMapRun)
        .set({
          status: "published",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.status, "reviewing"),
          ),
        )
        .returning({ id: productMapRun.id });
      if (!publishedRun)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_REVIEW_REQUIRED",
          "任务状态已变化，请刷新后重试",
        );
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: run.projectId,
          eventType: "product_map_artifact_published",
          entityType: "product_map_artifact",
          entityId: artifact.id,
          result: "succeeded",
          metadata: {
            runId: run.id,
            version: artifact.currentVersion,
            documentId: uploaded.document.id,
          },
        },
        tx,
      );
    });
  } catch (error) {
    if (compensationDocumentId) {
      const [linked] = await getDb()
        .select({ id: productMapArtifact.id })
        .from(productMapArtifact)
        .where(
          and(
            eq(productMapArtifact.id, input.artifactId),
            eq(productMapArtifact.projectId, input.projectId),
            eq(productMapArtifact.publishedDocumentId, compensationDocumentId),
          ),
        )
        .limit(1)
        .catch(() => []);
      if (!linked) {
        await setDocumentArchived({
          principal: input.principal,
          projectId: input.projectId,
          documentId: compensationDocumentId,
          archived: true,
          requestHeaders: input.requestHeaders,
        }).catch(() => undefined);
      }
    }
    throw error;
  }
  return getProductMapRun({
    principal: input.principal,
    projectId: input.projectId,
    runId: run.id,
    requestHeaders: input.requestHeaders,
  });
}

export function renderProductMapMarkdown(artifact: ProductMapArtifact): string {
  const understanding = artifact.projectUnderstanding;
  const lines = [
    `# 产品结构`,
    ``,
    `## 项目理解`,
    `- 项目：${understanding.projectName.text} ${understanding.projectName.confidence === "inferred" ? "[推断]" : ""}`,
    `- 定位：${understanding.oneLinePositioning.text}`,
    ``,
    `## 目标与用户路径`,
  ];
  for (const goal of artifact.goals.goals)
    lines.push(`- ${goal.id}：${goal.goal}（${goal.status}）`);
  lines.push(``, `## 产品功能结构`);
  for (const mapModule of artifact.productMap.modules) {
    lines.push(`### ${mapModule.id} ${mapModule.name}`);
    for (const surface of mapModule.surfaces) {
      lines.push(`- ${surface.stableId} ${surface.name}：${surface.purpose}`);
      for (const mapped of surface.features)
        lines.push(
          `  - ${mapped.featureId}（Actions: ${mapped.actionIds.join(", ")}；States: ${mapped.stateIds.join(", ")}）`,
        );
    }
  }
  lines.push(``, `## 页面与功能`);
  for (const page of artifact.pages.pages)
    lines.push(`- ${page.id} ${page.name}：${page.purpose}`);
  for (const feature of artifact.features.features)
    lines.push(`  - ${feature.id} ${feature.name}：${feature.result}`);
  lines.push(``, `## Scope 与角色`);
  for (const item of artifact.analysisContract.scope.inScope)
    lines.push(`- In Scope：${item.statement}（${item.evidenceStatus}）`);
  for (const item of artifact.analysisContract.scope.outOfScope)
    lines.push(`- Out of Scope：${item.statement}（${item.evidenceStatus}）`);
  for (const item of artifact.analysisContract.scope.tbd)
    lines.push(`- TBD：${item.statement}（${item.evidenceStatus}）`);
  for (const role of artifact.analysisContract.roles)
    lines.push(
      `- ${role.role}：查看 ${role.canView.join("、") || "待确认"}；操作 ${role.canOperate.join("、") || "待确认"}`,
    );
  lines.push(``, `## 状态与异常`);
  for (const path of artifact.analysisContract.exceptionPaths)
    lines.push(
      `- ${path.id} ${path.kind}：${path.expectedHandling}（${path.evidenceStatus}）`,
    );
  lines.push(``, `## 待确认与风险`);
  for (const question of artifact.risksAndQuestions.questions)
    lines.push(`- ${question.id} ${question.description}`);
  for (const risk of artifact.risksAndQuestions.risks)
    lines.push(`- ${risk.id} ${risk.description}`);
  lines.push(``, `## 引用`);
  for (const citation of artifact.citations)
    lines.push(`- ${citation.citation}`);
  lines.push(
    ``,
    `## Structure Review`,
    `- ${artifact.structureReview.passed ? "PASS" : "待确认"}`,
  );
  for (const issue of artifact.structureReview.issues)
    lines.push(`- [${issue.severity}] ${issue.issue}：${issue.suggestion}`);
  return lines.join("\n");
}

export function renderProductMapMermaid(artifact: ProductMapArtifact): string {
  const lines = ["flowchart TD", "  ROOT[产品结构]"];
  const label = (value: string) =>
    value
      .replace(/[\[\](){}"`<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  for (const mapModule of artifact.productMap.modules) {
    lines.push(`  ROOT --> ${mapModule.id}["${label(mapModule.name)}"]`);
    for (const surface of mapModule.surfaces) {
      lines.push(
        `  ${mapModule.id} --> ${surface.stableId}["${label(surface.name)}"]`,
      );
      for (const mapped of surface.features)
        lines.push(
          `  ${surface.stableId} --> ${mapped.featureId}["${label(artifact.features.features.find((feature) => feature.id === mapped.featureId)?.name ?? mapped.featureId)}"]`,
        );
    }
  }
  return lines.join("\n");
}

function sourceLabel(
  sourceType: string,
): "document" | "company_document" | "user_input" {
  if (sourceType === "user_input") return "user_input";
  if (sourceType === "company_document") return "company_document";
  return "document";
}

type TrustedAnalysisSource = ProductMapAnalysisContract["sources"][number];

function buildTrustedEvidence(input: {
  rows: Array<typeof productMapSource.$inferSelect>;
  hits: RankedProjectKnowledgeEvidence[];
  conversationText: string | null;
  userInput: string | null;
  contextReferences?: AssistantContextReference[];
  historicalArtifactDocumentIds?: Set<string>;
}): {
  evidence: ProductMapEvidence[];
  sourceIds: Map<string, string>;
  analysisSources: TrustedAnalysisSource[];
} {
  const sourceIds = new Map<string, string>();
  const explicitProjectReference = input.contextReferences?.some(
    (reference) => reference.type === "project",
  ) ?? false;
  const explicitFileReferences = new Set(
    input.contextReferences
      ?.filter(
        (reference): reference is Extract<AssistantContextReference, { type: "document" }> =>
          reference.type === "document",
      )
      .map((reference) => reference.documentId) ?? [],
  );
  const orderedRows = [...input.rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  orderedRows.forEach((row, index) =>
    sourceIds.set(row.documentId, `S${index + 1}`),
  );
  const result: ProductMapEvidence[] = [];
  let index = 1;
  for (const item of input.hits.slice(0, PRODUCT_MAP_MAX_EVIDENCE_ITEMS)) {
    const sourceId = sourceIds.get(item.evidence.documentId);
    if (!sourceId) continue;
    const excerpt = item.evidence.content.slice(0, 2_000);
    result.push(
      productMapEvidenceSchema.parse({
        id: `E${index++}`,
        sourceId,
        sourceType: sourceLabel(
          item.evidence.sourceScope === "organization"
            ? "company_document"
            : "document",
        ),
        displayName: item.evidence.displayName,
        versionId: item.evidence.versionId,
        chunkId: item.evidence.chunkId,
        locator: JSON.stringify(item.evidence.source),
        excerpt,
        excerptDigest: sha256(excerpt),
        relevance: item.evidence.score >= 0.3 ? "high" : "medium",
        reliability: "high",
        sourceRefs: [sourceId],
      }),
    );
  }
  if (input.userInput?.trim()) {
    const sourceId = `S${sourceIds.size + 1}`;
    sourceIds.set("__user_input__", sourceId);
    const excerpt = input.userInput.trim().slice(0, 2_000);
    result.push(
      productMapEvidenceSchema.parse({
        id: `E${index}`,
        sourceId,
        sourceType: "user_input",
        displayName: "本次输入",
        versionId: `input-${sha256(excerpt).slice(0, 24)}`,
        chunkId: `input-${sha256(excerpt).slice(0, 24)}`,
        locator: "user_input",
        excerpt,
        excerptDigest: sha256(excerpt),
        relevance: "high",
        reliability: "high",
        sourceRefs: [sourceId],
      }),
    );
    index += 1;
  }
  if (input.conversationText?.trim()) {
    const sourceId = `S${sourceIds.size + 1}`;
    sourceIds.set("__conversation__", sourceId);
    const excerpt = input.conversationText.trim().slice(0, 2_000);
    result.push(
      productMapEvidenceSchema.parse({
        id: `E${index}`,
        sourceId,
        sourceType: "user_input",
        displayName: "当前会话中的用户确认",
        versionId: `conversation-${sha256(excerpt).slice(0, 24)}`,
        chunkId: `conversation-${sha256(excerpt).slice(0, 24)}`,
        locator: "conversation:user_messages",
        excerpt,
        excerptDigest: sha256(excerpt),
        relevance: "high",
        reliability: "high",
        sourceRefs: [sourceId],
      }),
    );
  }
  const analysisSources = [...sourceIds.entries()].map(
    ([key, sourceId]): TrustedAnalysisSource => {
      const row = orderedRows.find((candidate) => candidate.documentId === key);
      const sourceEvidence = result.filter(
        (item) => item.sourceId === sourceId,
      );
      const kind =
        key === "__user_input__"
          ? ("current_user_input" as const)
          : key === "__conversation__"
            ? ("conversation" as const)
            : input.historicalArtifactDocumentIds?.has(key)
              ? ("historical_artifact" as const)
              : explicitFileReferences.has(key)
                ? ("explicit_file_reference" as const)
                : explicitProjectReference && row?.projectId === row?.sourceProjectId
                  ? ("explicit_project_reference" as const)
            : row?.sourceType === "organization"
              ? ("company_document" as const)
              : row?.sourceType === "upload"
                ? ("uploaded_source" as const)
                : ("project_document" as const);
      const label =
        key === "__user_input__"
          ? "本次输入"
          : key === "__conversation__"
            ? "当前会话"
            : (row?.displayName ?? `资料 ${sourceId}`);
      return {
        id: sourceId,
        kind,
        label,
        evidenceStatus: sourceEvidence.length ? "CONFIRMED" : "MISSING",
        citationIds: sourceEvidence.map((item) => item.id),
      };
    },
  );
  return { evidence: result, sourceIds, analysisSources };
}

function privateConversationSourceIds(
  evidence: ProductMapEvidence[],
): Set<string> {
  return new Set(
    evidence
      .filter((item) => item.locator === "conversation:user_messages")
      .map((item) => item.sourceId),
  );
}

function redactConversationEvidenceForArtifact(
  evidence: ProductMapEvidence[],
): ProductMapEvidence[] {
  const sourceIds = privateConversationSourceIds(evidence);
  return evidence.map((item) =>
    sourceIds.has(item.sourceId)
      ? { ...item, excerpt: PRIVATE_CONVERSATION_REDACTION }
      : item,
  );
}

function redactConversationInventoryForArtifact(
  inventory: ProductMapEvidenceInventory,
  sourceIds: ReadonlySet<string>,
): ProductMapEvidenceInventory {
  return productMapEvidenceInventorySchema.parse({
    ...inventory,
    materials: inventory.materials.map((material) =>
      sourceIds.has(material.sourceId)
        ? { ...material, keyContent: PRIVATE_CONVERSATION_REDACTION }
        : material,
    ),
    evidence: inventory.evidence.map((item) =>
      sourceIds.has(item.sourceId)
        ? { ...item, excerpt: PRIVATE_CONVERSATION_REDACTION }
        : item,
    ),
  });
}

function completenessFor(
  evidence: ProductMapEvidence[],
  sourceCount: number,
  limitedEvidence = false,
) {
  const joined = evidence
    .map((item) => item.excerpt)
    .join(" ")
    .toLowerCase();
  const has = (patterns: RegExp[]) =>
    patterns.some((pattern) => pattern.test(joined));
  const definitions: Array<[ProductMapCompletenessField["field"], boolean]> = [
    ["project_background", evidence.length > 0],
    ["business_goal", has([/目标/u, /目的/u, /解决/u, /提升/u])],
    ["target_user", has([/用户/u, /客户/u, /角色/u])],
    ["platform_context", has([/web/u, /网页/u, /小程序/u, /app/u, /平台/u])],
    ["core_requirements", has([/需求/u, /功能/u, /流程/u, /mvp/iu])],
    ["business_rules", has([/规则/u, /权限/u, /必须/u, /限制/u])],
  ];
  const fields = definitions.map(([field, present]) => ({
    field,
    status: present ? ("present" as const) : ("missing" as const),
    evidenceCount: present ? Math.min(20, evidence.length) : 0,
    reliableEvidenceCount: present ? Math.min(20, evidence.length) : 0,
    summary: present ? "已从授权资料检索到相关证据。" : "资料未覆盖，待确认。",
    sourceRefs: present
      ? [...new Set(evidence.map((item) => item.sourceId))].slice(0, 20)
      : [],
  }));
  return evaluateProductMapCompleteness({
    accessibleSourceCount: sourceCount,
    retrievedEvidenceCount: evidence.length,
    reliableEvidenceCount: evidence.filter(
      (item) => item.reliability === "high",
    ).length,
    fields,
    conflicts: [],
    limitedEvidence,
  });
}

function makeStepEnvelope(input: {
  stepId: ProductMapStepId;
  output: unknown;
  sourceRefs: string[];
  createdAt: string;
}): ProductMapStepOutput {
  return productMapStepOutputSchema.parse({
    stepId: input.stepId,
    stepVersion: PRODUCT_MAP_SCHEMA_VERSION,
    status: "completed",
    output: input.output,
    sourceRefs: input.sourceRefs,
    outputDigest: digest(input.output),
    createdAt: input.createdAt,
  });
}

type TrustedEvidenceSnapshot = {
  evidence: ProductMapEvidence[];
  analysisSources: ProductMapAnalysisContract["sources"];
  sourceIds: string[];
};

function parseTrustedEvidenceSnapshot(value: unknown): TrustedEvidenceSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const evidence = productMapEvidenceSchema.array().safeParse(record.evidence);
  const sources = productMapAnalysisContractSchema.shape.sources.safeParse(
    record.analysisSources,
  );
  const sourceIds = Array.isArray(record.sourceIds)
    ? record.sourceIds.filter((item): item is string => typeof item === "string")
    : [];
  if (!evidence.success || !sources.success || !sourceIds.length) return null;
  return {
    evidence: evidence.data,
    analysisSources: sources.data,
    sourceIds,
  };
}

function evidenceCoverageFromUnknown(input: {
  sources: TrustedAnalysisSource[];
  contract: Record<string, unknown>;
}) {
  const scope =
    input.contract.scope &&
    typeof input.contract.scope === "object" &&
    !Array.isArray(input.contract.scope)
      ? (input.contract.scope as Record<string, unknown>)
      : {};
  const goalLinks = Array.isArray(input.contract.goalLinks)
    ? input.contract.goalLinks
    : [];
  const solutionHypotheses = goalLinks.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const hypothesis = (item as Record<string, unknown>).solutionHypothesis;
    return hypothesis && typeof hypothesis === "object" && !Array.isArray(hypothesis)
      ? [hypothesis]
      : [];
  });
  const arrays = [
    input.sources,
    goalLinks,
    solutionHypotheses,
    scope.inScope,
    scope.outOfScope,
    scope.tbd,
    scope.dependencies,
    input.contract.roles,
    input.contract.exceptionPaths,
  ];
  const items = arrays
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((item): item is { evidenceStatus: string } =>
      Boolean(item && typeof item === "object" && "evidenceStatus" in item),
    );
  const counts = {
    confirmed: items.filter((item) => item.evidenceStatus === "CONFIRMED")
      .length,
    inferred: items.filter((item) => item.evidenceStatus === "INFERRED").length,
    missing: items.filter((item) => item.evidenceStatus === "MISSING").length,
    conflict: items.filter((item) => item.evidenceStatus === "CONFLICT").length,
    notApplicable: items.filter(
      (item) => item.evidenceStatus === "NOT_APPLICABLE",
    ).length,
  };
  const applicable = items.length - counts.notApplicable;
  return {
    ...counts,
    percentage: applicable
      ? Math.round((counts.confirmed / applicable) * 100)
      : 100,
  };
}

function qualityFromIssues(
  issues: ProductMapStructureIssue[],
  completeness: ReturnType<typeof completenessFor>,
  analysisConflictCount = 0,
): ProductMapQuality {
  const errors = issues.filter((issue) => issue.severity === "error");
  const relatedIds = ["G1", "J1", "M1", "P1", "F1"];
  const quality = productMapQualitySchema.parse({
    checks: PRODUCT_MAP_QUALITY_CHECK_IDS.map((id) => ({
      id,
      condition: id,
      result: errors.length ? "待确认" : "PASS",
      note: errors.length
        ? errors
            .map((issue) => issue.issue)
            .join("；")
            .slice(0, 2_000)
        : issues.length
          ? "结构无阻塞项，但仍有警告需要人工复核。"
          : "确定性 PM/Design Lint 通过。",
      relatedIds,
    })),
    overall: errors.length ? "需确认" : issues.length ? "需确认" : "通过",
    blockers: errors.map((issue) => issue.suggestion).slice(0, 20),
  });
  const completenessBound = bindProductMapQualityToCompleteness(
    quality,
    completeness,
  );
  if (analysisConflictCount <= 0) return completenessBound;
  return productMapQualitySchema.parse({
    ...completenessBound,
    overall: "需确认",
    blockers: [
      ...completenessBound.blockers,
      "存在可信来源冲突，必须由用户确认后再发布。",
    ].slice(0, 20),
    checks: completenessBound.checks.map((check) =>
      check.id === "evidence_traceability"
        ? {
            ...check,
            result: "待确认",
            note: "PM Analysis Contract 保留了来源冲突，不能自动判定为通过。",
          }
        : check,
    ),
  });
}

function deduplicateIssues(
  issues: ProductMapStructureIssue[],
): ProductMapStructureIssue[] {
  const seen = new Set<string>();
  return issues
    .filter((issue) => {
      const key = `${issue.issue}:${issue.severity}:${issue.evidence.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

function normalizeArtifact(input: {
  value: unknown;
  evidence: ProductMapEvidence[];
  analysisSources: TrustedAnalysisSource[];
  completeness: ReturnType<typeof completenessFor>;
  evidenceInventory: ProductMapEvidenceInventory;
  preliminaryIssues: ProductMapStructureIssue[];
  stepOutputs: ProductMapStepOutput[];
  createdAt: string;
}): ProductMapArtifact {
  const parsed =
    input.value &&
    typeof input.value === "object" &&
    !Array.isArray(input.value)
      ? (input.value as Record<string, unknown>)
      : {};
  const citations = [
    ...new Set(input.evidence.map((item) => item.sourceId)),
  ].map((sourceId) => {
    const sourceEvidence = input.evidence.filter(
      (item) => item.sourceId === sourceId,
    );
    const first = sourceEvidence[0]!;
    return {
      sourceId,
      sourceType: first.sourceType,
      displayName: first.displayName,
      locator: first.locator,
      citation: `[${sourceId}] ${first.displayName}`,
      evidenceBindings: sourceEvidence.map((item) => ({
        evidenceId: item.id,
        versionId: item.versionId,
        chunkId: item.chunkId,
        locator: item.locator,
        excerptDigest: item.excerptDigest,
      })),
    };
  });
  const materialInventory = productMapEvidenceInventorySchema.parse({
    ...input.evidenceInventory,
    evidence: input.evidence,
    deduplicatedSourceIds: input.analysisSources.map((item) => item.id),
    materials: input.analysisSources.map((item) => {
      const sourceEvidence = input.evidence.filter(
        (candidate) => candidate.sourceId === item.id,
      );
      return {
        sourceId: item.id,
        fileName: item.label,
        fileType:
          sourceEvidence[0]?.sourceType === "user_input"
            ? "text/plain"
            : "authorized_document",
        keyContent: sourceEvidence[0]?.excerpt ?? "当前来源未检索到可用片段。",
        confidence: sourceEvidence.length ? "confirmed" : "unknown",
        sourceRefs: [item.id],
      };
    }),
  });
  const contractRecord =
    parsed.analysisContract &&
    typeof parsed.analysisContract === "object" &&
    !Array.isArray(parsed.analysisContract)
      ? (parsed.analysisContract as Record<string, unknown>)
      : {};
  const contractCandidate = {
    ...contractRecord,
    sources: input.analysisSources,
    evidenceCoverage: evidenceCoverageFromUnknown({
      sources: input.analysisSources,
      contract: contractRecord,
    }),
  };
  const contractResult =
    productMapAnalysisContractSchema.safeParse(contractCandidate);
  if (!contractResult.success)
    throw new ProductMapError(
      502,
      describeProductMapSchemaFailure(
        contractCandidate,
        productMapAnalysisContractSchema,
      ),
      "Product Map PM Analysis Contract 无效",
    );
  const initialIssues = deduplicateIssues(input.preliminaryIssues);
  const initialReview = {
    version: "pm-design-lint-v1" as const,
    checkedAt: input.createdAt,
    passed: !initialIssues.some((issue) => issue.severity === "error"),
    issues: initialIssues,
  };
  const initialQuality = qualityFromIssues(
    initialIssues,
    input.completeness,
    contractResult.data.evidenceCoverage.conflict,
  );
  const initialSummary = {
    artifactSchemaVersion: PRODUCT_MAP_SCHEMA_VERSION,
    structureIssueCount: initialIssues.length,
    structurePassed: initialReview.passed,
  };
  const initialSteps = [
    ...input.stepOutputs,
    makeStepEnvelope({
      stepId: "final_artifact",
      output: initialSummary,
      sourceRefs: input.analysisSources.map((item) => item.id),
      createdAt: input.createdAt,
    }),
  ];
  const initialCandidate = {
    ...parsed,
    schemaVersion: PRODUCT_MAP_SCHEMA_VERSION,
    completeness: input.completeness,
    materialInventory,
    citations,
    analysisContract: contractResult.data,
    quality: initialQuality,
    structureReview: initialReview,
    stepOutputs: initialSteps,
  };
  const firstParse = productMapArtifactSchema.safeParse(initialCandidate);
  if (!firstParse.success)
    throw new ProductMapError(
      502,
      describeProductMapSchemaFailure(initialCandidate),
      "Product Map 最终结构无效",
    );
  const finalIssues = deduplicateIssues([
    ...initialIssues,
    ...runProductMapStructureLint(firstParse.data),
  ]);
  const finalReview = {
    version: "pm-design-lint-v1" as const,
    checkedAt: input.createdAt,
    passed: !finalIssues.some((issue) => issue.severity === "error"),
    issues: finalIssues,
  };
  const finalQuality = qualityFromIssues(
    finalIssues,
    input.completeness,
    contractResult.data.evidenceCoverage.conflict,
  );
  const finalSummary = {
    artifactSchemaVersion: PRODUCT_MAP_SCHEMA_VERSION,
    structureIssueCount: finalIssues.length,
    structurePassed: finalReview.passed,
  };
  const finalSteps = [
    ...input.stepOutputs,
    makeStepEnvelope({
      stepId: "final_artifact",
      output: finalSummary,
      sourceRefs: input.analysisSources.map((item) => item.id),
      createdAt: input.createdAt,
    }),
  ];
  return productMapArtifactSchema.parse({
    ...firstParse.data,
    quality: finalQuality,
    structureReview: finalReview,
    stepOutputs: finalSteps,
  });
}

async function heartbeat(
  runId: string,
  projectId: string,
  leaseToken: string,
): Promise<void> {
  const updated = await getDb()
    .update(productMapRun)
    .set({
      heartbeatAt: sql`now()`,
      leaseExpiresAt: sql`now() + (${LEASE_MS} * interval '1 millisecond')`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(productMapRun.id, runId),
        eq(productMapRun.projectId, projectId),
        eq(productMapRun.leaseToken, leaseToken),
        sql`${productMapRun.leaseExpiresAt} > now()`,
        isNull(productMapRun.cancellationRequestedAt),
      ),
    )
    .returning({ id: productMapRun.id });
  if (updated.length !== 1)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_LEASE_LOST",
      "Product Map 执行租约已失效",
    );
}

async function getOwnedRun(
  run: ProductMapRunRecord,
): Promise<ProductMapRunRecord> {
  const [current] = await getDb()
    .select()
    .from(productMapRun)
    .where(
      and(
        eq(productMapRun.id, run.id),
        eq(productMapRun.projectId, run.projectId),
        eq(productMapRun.leaseToken, run.leaseToken!),
        sql`${productMapRun.leaseExpiresAt} > now()`,
        isNull(productMapRun.cancellationRequestedAt),
      ),
    )
    .limit(1);
  if (!current)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_LEASE_LOST",
      "Product Map 执行租约已失效或已取消",
    );
  return current;
}

function productMapLimitError(
  code:
    | "AI_RATE_LIMITED"
    | "AI_USER_DAILY_LIMIT_REACHED"
    | "AI_PROJECT_DAILY_LIMIT_REACHED"
    | "AI_CONCURRENCY_LIMIT_REACHED",
): ProductMapError {
  return new ProductMapError(
    code === "AI_CONCURRENCY_LIMIT_REACHED" ? 503 : 429,
    code,
    SAFE_PRODUCT_MAP_FAILURE_MESSAGES[code] ?? "AI 服务繁忙，请稍后重试",
  );
}

async function reserveProductMapExecution(input: {
  run: ProductMapRunRecord;
  stepId: ProductMapStepId;
  inputDigest: string;
  reservedTokens: number;
}): Promise<string> {
  const productMapAiLimits = getProductMapAiLimits();
  const reservation = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('projectai-ai-global-concurrency', 0))`,
    );
    // Serialize with cancellation/source replacement. A successful heartbeat
    // is not enough: either mutation may have revoked this lease while the
    // worker was waiting for the global concurrency lock.
    const [ownedRun] = await tx
      .select({ id: productMapRun.id })
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, input.run.id),
          eq(productMapRun.projectId, input.run.projectId),
          eq(productMapRun.leaseToken, input.run.leaseToken!),
          sql`${productMapRun.leaseExpiresAt} > now()`,
          isNull(productMapRun.cancellationRequestedAt),
        ),
      )
      .limit(1)
      .for("update", { of: productMapRun });
    if (!ownedRun) return { leaseLost: true } as const;
    await tx.execute(sql`
      update product_map_executions
      set status = 'unknown',
          failure_code = 'PRODUCT_MAP_EXECUTION_STALE',
          completed_at = now()
      where status in ('reserved', 'running')
        and started_at <= now() - interval '15 minutes'
    `);
    const minuteBoundary = new Date(Date.now() - 60_000);
    const dayBoundary = new Date();
    dayBoundary.setUTCHours(0, 0, 0, 0);
    const usage = await tx.execute<{
      user_minute_calls: string | number;
      user_daily_tokens: string | number;
      project_daily_tokens: string | number;
      active_calls: string | number;
    }>(sql`
      select
        (
          select count(*) from ai_executions
          where actor_user_id = ${input.run.creatorId}
            and created_at >= ${minuteBoundary}
        ) + (
          select count(*)
          from product_map_executions execution
          inner join product_map_runs run
            on run.id = execution.run_id and run.project_id = execution.project_id
          where run.creator_id = ${input.run.creatorId}
            and execution.started_at >= ${minuteBoundary}
        ) as user_minute_calls,
        (
          select coalesce(sum(total_token_count), 0) from ai_executions
          where actor_user_id = ${input.run.creatorId}
            and created_at >= ${dayBoundary}
            and total_token_count is not null
        ) + (
          select coalesce(sum(coalesce(execution.total_tokens, execution.reserved_tokens)), 0)
          from product_map_executions execution
          inner join product_map_runs run
            on run.id = execution.run_id and run.project_id = execution.project_id
          where run.creator_id = ${input.run.creatorId}
            and execution.started_at >= ${dayBoundary}
        ) as user_daily_tokens,
        (
          select coalesce(sum(total_token_count), 0) from ai_executions
          where project_id = ${input.run.projectId}
            and created_at >= ${dayBoundary}
            and total_token_count is not null
        ) + (
          select coalesce(sum(coalesce(total_tokens, reserved_tokens)), 0) from product_map_executions
          where project_id = ${input.run.projectId}
            and started_at >= ${dayBoundary}
        ) as project_daily_tokens,
        (
          select count(*) from ai_executions
          where status in ('reserved', 'retrieving', 'calling_provider', 'validating')
        ) + (
          select count(*) from product_map_executions
          where status in ('reserved', 'running')
        ) as active_calls
    `);
    const row = usage.rows[0];
    const limitCode =
      Number(row?.user_minute_calls ?? 0) >= productMapAiLimits.perUserMinute
        ? "AI_RATE_LIMITED"
        : Number(row?.user_daily_tokens ?? 0) + input.reservedTokens > productMapAiLimits.userDailyTokens
          ? "AI_USER_DAILY_LIMIT_REACHED"
          : Number(row?.project_daily_tokens ?? 0) + input.reservedTokens > productMapAiLimits.projectDailyTokens
            ? "AI_PROJECT_DAILY_LIMIT_REACHED"
            : Number(row?.active_calls ?? 0) >= productMapAiLimits.globalConcurrent
              ? "AI_CONCURRENCY_LIMIT_REACHED"
              : null;
    if (limitCode) {
      await writeAuditEvent(
        {
          actorUserId: input.run.creatorId,
          projectId: input.run.projectId,
          eventType: "product_map_execution_rate_limited",
          entityType: "product_map_run",
          entityId: input.run.id,
          result: "denied",
          metadata: { failureCode: limitCode, stepId: input.stepId },
        },
        tx,
      );
      return { limitCode } as const;
    }
    const [attemptRow] = await tx
      .select({ value: sql<number>`coalesce(max(${productMapExecution.attempt}), 0)::int` })
      .from(productMapExecution)
      .where(
        and(
          eq(productMapExecution.runId, input.run.id),
          eq(productMapExecution.projectId, input.run.projectId),
          eq(productMapExecution.stepId, input.stepId),
        ),
      );
    const executionId = randomUUID();
    await tx.insert(productMapExecution).values({
      id: executionId,
      runId: input.run.id,
      projectId: input.run.projectId,
      stepId: input.stepId,
      attempt: Number(attemptRow?.value ?? 0) + 1,
      generationModelId: input.run.generationModelId,
      skillFileSha256: input.run.skillFileSha256,
      status: "reserved",
      inputDigest: input.inputDigest,
      reservedTokens: input.reservedTokens,
      startedAt: new Date(),
    });
    return { executionId } as const;
  });
  if ("leaseLost" in reservation && reservation.leaseLost)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_LEASE_LOST",
      "Product Map 执行租约已失效或已取消",
    );
  if ("limitCode" in reservation && reservation.limitCode)
    throw productMapLimitError(reservation.limitCode);
  return reservation.executionId;
}

async function startProductMapExecution(input: {
  run: ProductMapRunRecord;
  executionId: string;
}): Promise<void> {
  const started = await getDb().transaction(async (tx) => {
    const [ownedRun] = await tx
      .select({ id: productMapRun.id })
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, input.run.id),
          eq(productMapRun.projectId, input.run.projectId),
          eq(productMapRun.leaseToken, input.run.leaseToken!),
          sql`${productMapRun.leaseExpiresAt} > now()`,
          isNull(productMapRun.cancellationRequestedAt),
        ),
      )
      .limit(1)
      .for("update", { of: productMapRun });
    if (!ownedRun) {
      await tx
        .update(productMapExecution)
        .set({
          status: "failed",
          failureCode: "PRODUCT_MAP_LEASE_LOST_BEFORE_DISPATCH",
          completedAt: sql`now()`,
        })
        .where(
          and(
            eq(productMapExecution.id, input.executionId),
            eq(productMapExecution.runId, input.run.id),
            eq(productMapExecution.projectId, input.run.projectId),
            eq(productMapExecution.status, "reserved"),
          ),
        );
      return false;
    }
    const [execution] = await tx
      .update(productMapExecution)
      .set({ status: "running" })
      .where(
        and(
          eq(productMapExecution.id, input.executionId),
          eq(productMapExecution.runId, input.run.id),
          eq(productMapExecution.projectId, input.run.projectId),
          eq(productMapExecution.status, "reserved"),
        ),
      )
      .returning({ id: productMapExecution.id });
    return Boolean(execution);
  });
  if (!started)
    throw new ProductMapError(
      409,
      "PRODUCT_MAP_LEASE_LOST",
      "Product Map 执行租约已失效或已取消",
    );
}

async function callStructuredStep(input: {
  run: ProductMapRunRecord;
  model: Awaited<ReturnType<typeof resolveGenerationScenario>>;
  stepId: ProductMapStepId;
  sourceIds: string[];
  evidence: ProductMapEvidence[];
  previous: Record<string, unknown>[];
  validator: (value: unknown) => unknown;
  repair?: { feedback: string; invalidOutput: unknown };
}): Promise<unknown> {
  await heartbeat(input.run.id, input.run.projectId, input.run.leaseToken!);
  const instructions = await loadTrustedProductMapInstructions();
  const repairSuffix = input.repair
    ? `<product_map_repair_feedback_json>${JSON.stringify(input.repair.feedback)}</product_map_repair_feedback_json><product_map_invalid_output_json>${JSON.stringify(input.repair.invalidOutput).slice(0, 16_000)}</product_map_invalid_output_json>`
    : "";
  const prompt = `<product_map_step_json>${JSON.stringify({ stepId: input.stepId, label: PRODUCT_MAP_STEP_LABELS[input.stepId] })}</product_map_step_json><product_map_source_ids_json>${JSON.stringify(input.sourceIds)}</product_map_source_ids_json><product_map_evidence_json>${JSON.stringify(input.evidence.slice(0, PRODUCT_MAP_MAX_EVIDENCE_ITEMS))}</product_map_evidence_json><product_map_previous_json>${JSON.stringify(input.previous.slice(-8))}</product_map_previous_json>${repairSuffix}`;
  const systemPrompt = `你是 ProjectAI 的 Product Map 产品经理助手。只输出严格 JSON，不输出思维链。locator=conversation:user_messages 的私有会话证据只能提炼为项目草稿结论，不得逐字复制原文。\n${instructions}`;
  const inputDigest = sha256(prompt);
  // This is a fail-closed pre-dispatch budget reservation, not reported
  // usage. UTF-8 bytes / 2 deliberately over-reserves normal Chinese and
  // English prompts; actual Provider usage replaces it once observed.
  const reservedTokens = Math.max(
    1,
    Math.ceil(
      Buffer.byteLength(`${systemPrompt}\n${prompt}`, "utf8") / 2,
    ) + input.model.runtime.maxOutputTokens + 512,
  );
  const executionId = await reserveProductMapExecution({
    run: input.run,
    stepId: input.stepId,
    inputDigest,
    reservedTokens,
  });
  await startProductMapExecution({ run: input.run, executionId });
  let result: AiGatewayResult | null = null;
  try {
    const gateway = createProjectAssistantGateway(input.model.runtime, {
      apiKey: input.model.apiKey,
    });
    const purpose =
      input.stepId === "final_artifact"
        ? input.repair
          ? "product_map_final_repair"
          : "product_map_final"
        : input.repair
          ? "product_map_step_repair"
          : "product_map_step";
    result = await gateway.generate({
      model: input.model.modelId,
      forceJsonObject: true,
      disableThinkingForJson: input.model.disableThinkingForJson,
      maxAttempts: 1,
      purpose,
      systemPrompt,
      userPrompt: prompt,
    });
    const parsed = parseJson(result.text);
    if (parsed === null)
      throw new ProductMapError(
        502,
        "PRODUCT_MAP_MODEL_OUTPUT_INVALID",
        "Product Map 模型未返回有效 JSON",
      );
    const validated = input.validator(parsed);
    await getDb()
      .update(productMapExecution)
      .set({
        status: "succeeded",
        outputDigest: digest(validated),
        providerRequestId: result.providerRequestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        latencyMs: result.latencyMs,
        costUsdMicros: result.costUsdMicros ?? null,
        costAccountingStatus:
          result.costUsdMicros == null
            ? "provider_not_reported"
            : "recorded",
        completedAt: new Date(),
      })
      .where(eq(productMapExecution.id, executionId));
    return validated;
  } catch (error) {
    const observedResult =
      error instanceof AiGatewayObservedError ? error.observation : result;
    const code =
      error instanceof ProductMapError
        ? error.code
        : error instanceof ProjectAssistantError
          ? error.code
          : "PRODUCT_MAP_MODEL_OUTPUT_INVALID";
    const executionStatus =
      code.includes("UNKNOWN") ||
      ["AI_PROVIDER_TIMEOUT", "AI_PROVIDER_UNAVAILABLE"].includes(code)
        ? "unknown"
        : "failed";
    await getDb()
      .update(productMapExecution)
      .set({
        status: executionStatus,
        failureCode: code,
        providerRequestId: observedResult?.providerRequestId ?? null,
        inputTokens: observedResult?.inputTokens ?? null,
        outputTokens: observedResult?.outputTokens ?? null,
        totalTokens: observedResult?.totalTokens ?? null,
        latencyMs: observedResult?.latencyMs ?? null,
        costUsdMicros: observedResult?.costUsdMicros ?? null,
        costAccountingStatus:
          observedResult?.costUsdMicros == null
            ? "provider_not_reported"
            : "recorded",
        completedAt: new Date(),
      })
      .where(eq(productMapExecution.id, executionId));
    throw error;
  }
}

async function callStructuredStepWithOneRepair(
  input: Parameters<typeof callStructuredStep>[0],
): Promise<unknown> {
  try {
    return await callStructuredStep(input);
  } catch (error) {
    const repairable =
      error instanceof ProductMapError &&
      (error.code.startsWith("PRODUCT_MAP_SCHEMA_") ||
        error.code === "PRODUCT_MAP_MODEL_OUTPUT_INVALID");
    if (!repairable || input.repair) throw error;
    return callStructuredStep({
      ...input,
      repair: {
        feedback: error.code,
        invalidOutput: { rejected: true, stepId: input.stepId },
      },
    });
  }
}

/** Claim one run with FOR UPDATE SKIP LOCKED; stale leases are recoverable. */
async function failExhaustedProductMapRuns(
  tx: DatabaseExecutor,
  scope?: { runId: string; projectId: string },
): Promise<void> {
  const exhaustedAt = new Date();
  const conditions = [
    inArray(productMapRun.status, [
      "queued",
      "checking_sources",
      "retrieving",
      "running",
    ]),
    sql`${productMapRun.attempt} >= ${productMapRun.maxAttempts}`,
    or(
      isNull(productMapRun.leaseExpiresAt),
      sql`${productMapRun.leaseExpiresAt} <= now()`,
    ),
    isNull(productMapRun.cancellationRequestedAt),
  ];
  if (scope) {
    conditions.push(
      eq(productMapRun.id, scope.runId),
      eq(productMapRun.projectId, scope.projectId),
    );
  }
  const exhausted = await tx
    .update(productMapRun)
    .set({
      status: "failed",
      failureCode: "PRODUCT_MAP_ATTEMPTS_EXHAUSTED",
      failureMessage:
        SAFE_PRODUCT_MAP_FAILURE_MESSAGES.PRODUCT_MAP_ATTEMPTS_EXHAUSTED,
      failureReference: null,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      nextAttemptAt: exhaustedAt,
      completedAt: exhaustedAt,
      updatedAt: exhaustedAt,
    })
    .where(and(...conditions))
    .returning({
      id: productMapRun.id,
      projectId: productMapRun.projectId,
      creatorId: productMapRun.creatorId,
      attempt: productMapRun.attempt,
      maxAttempts: productMapRun.maxAttempts,
    });
  for (const run of exhausted) {
    // A crashed App can leave an execution behind after reservation or after
    // Provider dispatch. At lease exhaustion, reserved is a confirmed
    // no-dispatch failure; running is conservatively unknown because the
    // Provider result can no longer be observed.
    const closedExecutions = await tx
      .update(productMapExecution)
      .set({
        status: sql`case when ${productMapExecution.status} = 'reserved' then 'failed' else 'unknown' end`,
        failureCode: sql`case when ${productMapExecution.status} = 'reserved' then 'PRODUCT_MAP_ATTEMPTS_EXHAUSTED_BEFORE_DISPATCH' else 'PRODUCT_MAP_ATTEMPTS_EXHAUSTED_PROVIDER_RESULT_UNKNOWN' end`,
        completedAt: exhaustedAt,
      })
      .where(
        and(
          eq(productMapExecution.runId, run.id),
          eq(productMapExecution.projectId, run.projectId),
          inArray(productMapExecution.status, ["reserved", "running"]),
        ),
      )
      .returning({ status: productMapExecution.status });
    await writeAuditEvent(
      {
        actorUserId: run.creatorId,
        projectId: run.projectId,
        eventType: "product_map_run_failed",
        entityType: "product_map_run",
        entityId: run.id,
        result: "failed",
        metadata: {
          status: "failed",
          failureCode: "PRODUCT_MAP_ATTEMPTS_EXHAUSTED",
          attempt: run.attempt,
          maxAttempts: run.maxAttempts,
          failedBeforeDispatch: closedExecutions.filter(
            (execution) => execution.status === "failed",
          ).length,
          providerResultUnknown: closedExecutions.filter(
            (execution) => execution.status === "unknown",
          ).length,
        },
      },
      tx,
    );
  }
}

export async function claimProductMapRun(
  workerId: string,
): Promise<ProductMapRunRecord | null> {
  return getDb().transaction(async (tx) => {
    await failExhaustedProductMapRuns(tx);
    const [candidate] = await tx
      .select()
      .from(productMapRun)
      .where(
        and(
          inArray(productMapRun.status, [
            "queued",
            "checking_sources",
            "indexing",
            "retrieving",
            "running",
          ]),
          or(
            eq(productMapRun.status, "indexing"),
            sql`${productMapRun.attempt} < ${productMapRun.maxAttempts}`,
          ),
          sql`${productMapRun.nextAttemptAt} <= now()`,
          or(
            isNull(productMapRun.leaseExpiresAt),
            sql`${productMapRun.leaseExpiresAt} <= now()`,
          ),
          isNull(productMapRun.cancellationRequestedAt),
        ),
      )
      .orderBy(asc(productMapRun.nextAttemptAt), asc(productMapRun.createdAt))
      .limit(1)
      .for("update", { skipLocked: true, of: productMapRun });
    if (!candidate) return null;
    const token = randomUUID();
    const [claimed] = await tx
      .update(productMapRun)
      .set({
        leaseOwner: workerId,
        leaseToken: token,
        leaseExpiresAt: sql`now() + (${LEASE_MS} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        attempt: sql`case when ${productMapRun.status} = 'indexing' then ${productMapRun.attempt} else ${productMapRun.attempt} + 1 end`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(productMapRun.id, candidate.id),
          eq(productMapRun.projectId, candidate.projectId),
          or(
            isNull(productMapRun.leaseExpiresAt),
            sql`${productMapRun.leaseExpiresAt} <= now()`,
          ),
        ),
      )
      .returning();
    return claimed ?? null;
  });
}

async function claimProductMapRunById(input: {
  runId: string;
  projectId: string;
  workerId: string;
}): Promise<ProductMapRunRecord | null> {
  return getDb().transaction(async (tx) => {
    await failExhaustedProductMapRuns(tx, {
      runId: input.runId,
      projectId: input.projectId,
    });
    const [candidate] = await tx
      .select()
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, input.runId),
          eq(productMapRun.projectId, input.projectId),
          inArray(productMapRun.status, [
            "queued",
            "checking_sources",
            "indexing",
            "retrieving",
            "running",
          ]),
          or(
            eq(productMapRun.status, "indexing"),
            sql`${productMapRun.attempt} < ${productMapRun.maxAttempts}`,
          ),
          sql`${productMapRun.nextAttemptAt} <= now()`,
          or(
            isNull(productMapRun.leaseExpiresAt),
            sql`${productMapRun.leaseExpiresAt} <= now()`,
          ),
          isNull(productMapRun.cancellationRequestedAt),
        ),
      )
      .limit(1)
      .for("update", { skipLocked: true, of: productMapRun });
    if (!candidate) return null;
    const token = randomUUID();
    const [claimed] = await tx
      .update(productMapRun)
      .set({
        leaseOwner: input.workerId,
        leaseToken: token,
        leaseExpiresAt: sql`now() + (${LEASE_MS} * interval '1 millisecond')`,
        heartbeatAt: sql`now()`,
        attempt: sql`case when ${productMapRun.status} = 'indexing' then ${productMapRun.attempt} else ${productMapRun.attempt} + 1 end`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(productMapRun.id, candidate.id),
          eq(productMapRun.projectId, candidate.projectId),
          or(
            isNull(productMapRun.leaseExpiresAt),
            sql`${productMapRun.leaseExpiresAt} <= now()`,
          ),
        ),
      )
      .returning();
    return claimed ?? null;
  });
}

/**
 * Product Map model calls stay inside the App process, which is the only
 * runtime permitted to resolve Provider credentials. The durable database
 * lease remains authoritative; polling the Run safely re-arms processing
 * after an App restart without exposing credentials to a separate worker.
 */
export function scheduleProductMapRunInApp(input: {
  runId: string;
  projectId: string;
}): void {
  const key = `${input.projectId}:${input.runId}`;
  if (activeAppProcessors.has(key)) return;
  activeAppProcessors.add(key);
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const claimed = await claimProductMapRunById({
          ...input,
          workerId: `app-${process.pid}`,
        });
        if (claimed) await processProductMapRun(claimed);
      } finally {
        activeAppProcessors.delete(key);
        const [latest] = await getDb()
          .select({
            status: productMapRun.status,
            cancellationRequestedAt: productMapRun.cancellationRequestedAt,
          })
          .from(productMapRun)
          .where(
            and(
              eq(productMapRun.id, input.runId),
              eq(productMapRun.projectId, input.projectId),
            ),
          )
          .limit(1)
          .catch(() => []);
        if (
          latest &&
          [
            "queued",
            "checking_sources",
            "indexing",
            "retrieving",
            "running",
          ].includes(latest.status) &&
          !latest.cancellationRequestedAt
        ) {
          scheduleProductMapRunInApp(input);
        }
      }
    })().catch(() => {
      activeAppProcessors.delete(key);
    });
  }, APP_PROCESSOR_DELAY_MS);
  timer.unref?.();
}

export async function processProductMapRun(
  run: ProductMapRunRecord,
): Promise<void> {
  try {
    const skill = getProductMapSkill(run.skillVersion);
    if (run.skillFileSha256 !== skill.skillFileSha256)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_SKILL_DIGEST_MISMATCH",
        "Product Map Skill 版本已变化，请创建新的任务",
      );
    await loadTrustedProductMapInstructions();
    const actor = await findUserById(run.creatorId);
    if (!actor || actor.status !== "active")
      throw new ProductMapError(
        403,
        "PRODUCT_MAP_ACTOR_INACTIVE",
        "任务创建者已停用",
      );
    const principal: AuthenticatedPrincipal = {
      sessionId: `product-map-worker:${run.id}`,
      user: actor,
    };
    await requireProjectAccess(principal, run.projectId);
    const allSources = await getDb()
      .select()
      .from(productMapSource)
      .where(
        and(
          eq(productMapSource.runId, run.id),
          eq(productMapSource.projectId, run.projectId),
        ),
      )
      .orderBy(asc(productMapSource.createdAt));
    const sources = allSources.filter((source) => source.status !== "revoked");
    const authorized = await listAuthorizedDocumentScope({
      principal,
      projectId: run.projectId,
      permission: "view",
    });
    const authorizedKeys = new Set(
      authorized.map((item) => `${item.sourceProjectId}:${item.documentId}`),
    );
    if (
      sources.some(
        (source) =>
          !authorizedKeys.has(`${source.sourceProjectId}:${source.documentId}`),
      )
    )
      throw new ProductMapError(
        403,
        "PRODUCT_MAP_SOURCE_ACCESS_REVOKED",
        "Product Map 来源权限已变化",
      );
    if (sources.length) {
      const currentVersions = await getDb()
        .select({
          documentId: projectDocumentVersion.documentId,
          projectId: projectDocumentVersion.projectId,
          versionId: projectDocumentVersion.id,
        })
        .from(projectDocumentVersion)
        .where(
          and(
            inArray(
              projectDocumentVersion.documentId,
              sources.map((source) => source.documentId),
            ),
            eq(projectDocumentVersion.isCurrent, true),
            eq(projectDocumentVersion.storageStatus, "stored"),
          ),
        );
      const currentKeys = new Set(
        currentVersions.map(
          (version) =>
            `${version.projectId}:${version.documentId}:${version.versionId}`,
        ),
      );
      if (
        sources.some(
          (source) =>
            !currentKeys.has(
              `${source.sourceProjectId}:${source.documentId}:${source.versionId}`,
            ),
        )
      )
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_SOURCE_VERSION_STALE",
          "部分资料已产生新版本，请在同一个 Run 中重新选择当前版本",
        );
    }
    const pendingSources = sources.filter(
      (source) => source.status !== "ready",
    );
    if (pendingSources.length) {
      const ingestions = await ingestionSummariesForVersions(
        sources.map((source) => source.versionId),
      );
      const failedSourceIds = sources
        .filter(
          (source) =>
            ingestions.get(source.versionId)?.status === "failed" ||
            ingestions.get(source.versionId)?.status === "needs_ocr",
        )
        .map((source) => source.id);
      if (failedSourceIds.length) {
        await getDb()
          .update(productMapSource)
          .set({ status: "failed", updatedAt: new Date() })
          .where(inArray(productMapSource.id, failedSourceIds));
        throw new ProductMapError(
          422,
          "PRODUCT_MAP_SOURCE_PARSE_FAILED",
          "部分资料解析失败或需要 OCR，可在同一个 Run 中更换资料后重试",
        );
      }
      const allParsed = sources.every(
        (source) => ingestions.get(source.versionId)?.status === "succeeded",
      );
      const embeddings = allParsed
        ? await embeddingSummariesForVersions(
            sources.map((source) => source.versionId),
          )
        : new Map();
      const failedEmbeddingSourceIds = allParsed
        ? sources
            .filter((source) =>
              ["failed", "unknown"].includes(
                embeddings.get(source.versionId)?.status ?? "pending",
              ),
            )
            .map((source) => source.id)
        : [];
      if (failedEmbeddingSourceIds.length) {
        await getDb()
          .update(productMapSource)
          .set({ status: "failed", updatedAt: new Date() })
          .where(inArray(productMapSource.id, failedEmbeddingSourceIds));
        throw new ProductMapError(
          422,
          "PRODUCT_MAP_SOURCE_EMBEDDING_FAILED",
          "部分资料向量化失败，可在同一个 Run 中更换资料后重试",
        );
      }
      if (
        allParsed &&
        sources.every(
          (source) =>
            embeddings.get(source.versionId)?.status === "succeeded",
        )
      ) {
        await getDb()
          .update(productMapSource)
          .set({ status: "ready", updatedAt: new Date() })
          .where(
            and(
              eq(productMapSource.runId, run.id),
              eq(productMapSource.projectId, run.projectId),
              eq(productMapSource.status, "pending"),
            ),
          );
        const [released] = await getDb()
          .update(productMapRun)
          .set({
            status: "queued",
            nextAttemptAt: new Date(),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productMapRun.id, run.id),
              eq(productMapRun.projectId, run.projectId),
              eq(productMapRun.leaseToken, run.leaseToken!),
            ),
          )
          .returning({ id: productMapRun.id });
        if (!released)
          throw new ProductMapError(
            409,
            "PRODUCT_MAP_LEASE_LOST",
            "Product Map 执行租约已失效",
          );
        return;
      }
      const [released] = await getDb()
        .update(productMapRun)
        .set({
          status: "indexing",
          nextAttemptAt: new Date(Date.now() + 5_000),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        )
        .returning({ id: productMapRun.id });
      if (!released)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_LEASE_LOST",
          "Product Map 执行租约已失效",
        );
      return;
    }
    const currentInput = run.userInput?.trim() || null;
    const conversationRows = run.includeConversationContext && run.threadId
      ? await getDb()
          .select({ content: aiMessage.content })
          .from(aiMessage)
          .where(
            and(
              eq(aiMessage.projectId, run.projectId),
              eq(aiMessage.threadId, run.threadId),
              eq(aiMessage.createdBy, run.creatorId),
              eq(aiMessage.role, "user"),
              eq(aiMessage.status, "completed"),
            ),
          )
          .orderBy(desc(aiMessage.sequence))
          .limit(10)
      : [];
    const conversationText = conversationRows.length
      ? [...conversationRows]
          .reverse()
          .map((row) => row.content)
          .join("\n")
          .slice(-4_000)
      : null;
    let trusted = parseTrustedEvidenceSnapshot(run.evidenceSnapshot);
    if (
      run.evidenceSnapshot &&
      (!trusted || !run.evidenceSnapshotDigest || digest(trusted) !== run.evidenceSnapshotDigest)
    )
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_EVIDENCE_SNAPSHOT_INVALID",
        "Product Map 证据快照校验失败，请创建新的任务",
      );
    if (!trusted) {
      let hits: RankedProjectKnowledgeEvidence[] = [];
      if (sources.length) {
        const documentIds = sources.map((source) => source.documentId);
        const broad = await retrieveAuthorizedProjectContextCandidates({
          actorUserId: run.creatorId,
          projectId: run.projectId,
          documentIds,
          limit: 30,
        });
        const query = run.retrievalInstruction?.trim().slice(0, 200);
        const lexical =
          query && query.length >= 2
            ? await retrieveLexicalProjectCandidates({
                actorUserId: run.creatorId,
                projectId: run.projectId,
                documentIds,
                query,
                limit: 30,
              })
            : [];
        const seenChunks = new Set<string>();
        hits = [...lexical, ...broad]
          .filter((item) => {
            if (seenChunks.has(item.evidence.chunkId)) return false;
            seenChunks.add(item.evidence.chunkId);
            return true;
          })
          .slice(0, 30);
      }
      const historicalArtifactDocumentIds = new Set<string>();
      const publishedDocumentIds = sources.map((source) => source.documentId);
      if (publishedDocumentIds.length) {
        const publishedArtifacts = await getDb()
          .select({ documentId: productMapArtifact.publishedDocumentId })
          .from(productMapArtifact)
          .where(
            and(
              eq(productMapArtifact.projectId, run.projectId),
              inArray(productMapArtifact.publishedDocumentId, publishedDocumentIds),
            ),
          );
        publishedArtifacts.forEach((item) => {
          if (item.documentId) historicalArtifactDocumentIds.add(item.documentId);
        });
      }
      const built = buildTrustedEvidence({
        rows: sources,
        hits,
        userInput: currentInput,
        conversationText,
        contextReferences: run.contextReferences as AssistantContextReference[],
        historicalArtifactDocumentIds,
      });
      const snapshot = {
        evidence: built.evidence,
        analysisSources: built.analysisSources,
        sourceIds: [...built.sourceIds.values()],
      } satisfies TrustedEvidenceSnapshot;
      trusted = snapshot;
      const snapshotDigest = digest(snapshot);
      const [snapshotted] = await getDb()
        .update(productMapRun)
        .set({
          evidenceSnapshot: snapshot,
          evidenceSnapshotDigest: snapshotDigest,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        )
        .returning({ id: productMapRun.id });
      if (!snapshotted)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_LEASE_LOST",
          "Product Map 执行租约已失效",
        );
    }
    const completeness = completenessFor(
      trusted.evidence,
      trusted.analysisSources.length,
      run.limitedEvidence,
    );
    const [coverageUpdated] = await getDb()
      .update(productMapRun)
      .set({
        sourceCoverage: completeness,
        sourceConflicts: completeness.conflicts,
        status:
          completeness.status === "insufficient" && !run.limitedEvidence
            ? "needs_input"
            : "running",
        currentStep: 1,
        updatedAt: new Date(),
        nextAttemptAt: new Date(),
      })
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
          eq(productMapRun.leaseToken, run.leaseToken!),
        ),
      )
      .returning({ id: productMapRun.id });
    if (!coverageUpdated)
      throw new ProductMapError(
        409,
        "PRODUCT_MAP_LEASE_LOST",
        "Product Map 执行租约已失效",
      );
    if (completeness.status === "insufficient" && !run.limitedEvidence) {
      const [released] = await getDb()
        .update(productMapRun)
        .set({
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          nextAttemptAt: new Date(8_640_000_000_000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        )
        .returning({ id: productMapRun.id });
      if (!released)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_LEASE_LOST",
          "Product Map 执行租约已失效",
        );
      return;
    }
    let working = await getOwnedRun(run);
    const outputs: Array<{ stepId: ProductMapStepId; output: unknown }> = [];
    const envelopes: ProductMapStepOutput[] = [];
    const previous =
      working.stepOutputs && typeof working.stepOutputs === "object"
        ? (working.stepOutputs as Record<string, unknown>)
        : {};
    const model = await resolveGenerationScenario({
      projectId: run.projectId,
      actorId: run.creatorId,
      scenario: "product_map_generation",
      generationModelId: run.generationModelId,
    });
    const generatedStepIds = PRODUCT_MAP_STEP_IDS.slice(0, 6);
    for (const [index, stepId] of generatedStepIds.entries()) {
      const schema = PRODUCT_MAP_STEP_SCHEMAS[stepId];
      const prior = previous[stepId];
      let value =
        prior && typeof prior === "object" && "output" in prior
          ? (prior as { output: unknown }).output
          : undefined;
      if (value !== undefined) {
        const replay = schema.safeParse(value);
        value = replay.success ? replay.data : undefined;
      }
      if (value === undefined)
        value = await callStructuredStepWithOneRepair({
          run: working,
          model,
          stepId,
          sourceIds: [...trusted.sourceIds.values()],
          evidence: trusted.evidence,
          previous: outputs,
          validator: (candidate) => {
            const validated = schema.safeParse(candidate);
            if (!validated.success)
              throw new ProductMapError(
                502,
                describeProductMapSchemaFailure(candidate, schema),
                `Product Map ${stepId} 输出无效`,
              );
            return validated.data;
          },
        });
      outputs.push({ stepId, output: value });
      const persistedValue =
        stepId === "evidence_inventory"
          ? redactConversationInventoryForArtifact(
              productMapEvidenceInventorySchema.parse(value),
              privateConversationSourceIds(trusted.evidence),
            )
          : value;
      const envelope = makeStepEnvelope({
        stepId,
        output: persistedValue,
        sourceRefs: [...trusted.sourceIds.values()],
        createdAt: new Date().toISOString(),
      });
      envelopes.push(envelope);
      working = await getOwnedRun(run);
      await getDb()
        .update(productMapRun)
        .set({
          currentStep: index + 1,
          stepOutputs: Object.fromEntries(
            envelopes.map((item) => [item.stepId, item]),
          ),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        );
    }
    const evidenceInventory = productMapEvidenceInventorySchema.parse(
      outputs.find((item) => item.stepId === "evidence_inventory")?.output,
    );
    const pageFeatureOutput = PRODUCT_MAP_STEP_SCHEMAS.pages_and_features.parse(
      outputs.find((item) => item.stepId === "pages_and_features")?.output,
    );
    const reviewIssues = runProductMapStructureLint({
      userPath: PRODUCT_MAP_STEP_SCHEMAS.user_path.parse(
        outputs.find((item) => item.stepId === "user_path")?.output,
      ),
      productMap: PRODUCT_MAP_STEP_SCHEMAS.product_map.parse(
        outputs.find((item) => item.stepId === "product_map")?.output,
      ),
      pages: { pages: pageFeatureOutput.pages },
      features: { features: pageFeatureOutput.features },
    });
    const review = qualityFromIssues(reviewIssues, completeness);
    outputs.push({ stepId: "independent_review", output: review });
    envelopes.push(
      makeStepEnvelope({
        stepId: "independent_review",
        output: review,
        sourceRefs: [...trusted.sourceIds.values()],
        createdAt: new Date().toISOString(),
      }),
    );
    working = await getOwnedRun(run);
    await getDb()
      .update(productMapRun)
      .set({
        currentStep: 7,
        stepOutputs: Object.fromEntries(
          envelopes.map((item) => [item.stepId, item]),
        ),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
          eq(productMapRun.leaseToken, run.leaseToken!),
        ),
      );
    const finalCreatedAt = new Date().toISOString();
    const artifact = (await callStructuredStepWithOneRepair({
      run: working,
      model,
      stepId: "final_artifact",
      sourceIds: [...trusted.sourceIds.values()],
      evidence: trusted.evidence,
      previous: outputs,
      validator: (candidate) =>
        normalizeArtifact({
          value: candidate,
          evidence: redactConversationEvidenceForArtifact(trusted.evidence),
          analysisSources: trusted.analysisSources,
          completeness,
          evidenceInventory,
          preliminaryIssues: reviewIssues,
          stepOutputs: envelopes,
          createdAt: finalCreatedAt,
        }),
    })) as ProductMapArtifact;
    const markdown = renderProductMapMarkdown(artifact);
    const mermaid = renderProductMapMermaid(artifact);
    const contentDigest = digest({ content: artifact, markdown, mermaid });
    await getDb().transaction(async (tx) => {
      const [owned] = await tx
        .select()
        .from(productMapRun)
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
            sql`${productMapRun.leaseExpiresAt} > now()`,
            isNull(productMapRun.cancellationRequestedAt),
          ),
        )
        .limit(1)
        .for("update", { of: productMapRun });
      if (!owned)
        throw new ProductMapError(
          409,
          "PRODUCT_MAP_LEASE_LOST",
          "Product Map 执行租约已失效",
        );
      const [existing] = await tx
        .select()
        .from(productMapArtifact)
        .where(
          and(
            eq(productMapArtifact.runId, run.id),
            eq(productMapArtifact.projectId, run.projectId),
          ),
        )
        .limit(1)
        .for("update", { of: productMapArtifact });
      const artifactId = existing?.id ?? randomUUID();
      const version = (existing?.currentVersion ?? 0) + 1;
      if (!existing)
        await tx
          .insert(productMapArtifact)
          .values({
            id: artifactId,
            runId: run.id,
            projectId: run.projectId,
            title: "产品结构",
            status: "draft",
            currentVersion: version,
            contentDigest,
            createdBy: run.creatorId,
          });
      await tx
        .insert(productMapArtifactVersion)
        .values({
          id: randomUUID(),
          artifactId,
          projectId: run.projectId,
          version,
          content: artifact as unknown as Record<string, unknown>,
          markdown,
          mermaid,
          sourceReferences: artifact.citations,
          contentDigest,
          createdBy: run.creatorId,
        });
      if (existing)
        await tx
          .update(productMapArtifact)
          .set({
            currentVersion: version,
            contentDigest,
            status: "draft",
            reviewedBy: null,
            reviewedAt: null,
            publishedBy: null,
            publishedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(productMapArtifact.id, artifactId),
              eq(productMapArtifact.projectId, run.projectId),
              eq(productMapArtifact.currentVersion, existing.currentVersion),
            ),
          );
      await tx
        .update(productMapRun)
        .set({
          status: "reviewing",
          currentStep: PRODUCT_MAP_STEP_IDS.length,
          stepOutputs: Object.fromEntries(
            artifact.stepOutputs.map((item) => [item.stepId, item]),
          ),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        );
      await writeAuditEvent(
        {
          actorUserId: run.creatorId,
          projectId: run.projectId,
          eventType: "product_map_artifact_generated",
          entityType: "product_map_artifact",
          entityId: artifactId,
          result: "succeeded",
          metadata: {
            runId: run.id,
            version,
            sourceCount: trusted.analysisSources.length,
            structurePassed: artifact.structureReview.passed,
          },
        },
        tx,
      );
    });
  } catch (error) {
    const code =
      error instanceof ProductMapError
        ? error.code
        : error instanceof ProjectAssistantError
          ? error.code
          : "PRODUCT_MAP_RUN_FAILED";
    const [latest] = await getDb()
      .select({
        cancellationRequestedAt: productMapRun.cancellationRequestedAt,
      })
      .from(productMapRun)
      .where(
        and(
          eq(productMapRun.id, run.id),
          eq(productMapRun.projectId, run.projectId),
          eq(productMapRun.leaseToken, run.leaseToken!),
        ),
      )
      .limit(1);
    const cancelled = Boolean(latest?.cancellationRequestedAt);
    const uncertain =
      !cancelled &&
      [
        "AI_PROVIDER_TIMEOUT",
        "AI_PROVIDER_UNAVAILABLE",
        "PROVIDER_TIMEOUT",
        "PROVIDER_UNAVAILABLE",
      ].includes(code);
    const nextStatus = cancelled
      ? "cancelled"
      : uncertain
        ? "unknown"
        : "failed";
    const failureCode = cancelled ? "PRODUCT_MAP_CANCELLED" : code;
    const failureReference = cancelled ? null : randomUUID();
    const failureMessage = cancelled
      ? "用户已取消本次运行"
      : SAFE_PRODUCT_MAP_FAILURE_MESSAGES[failureCode] ??
        "Product Map 运行失败，请稍后重试";
    await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(productMapRun)
        .set({
          status: nextStatus,
          failureCode,
          failureMessage,
          failureReference,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          completedAt: uncertain ? null : new Date(),
          nextAttemptAt: uncertain
            ? new Date(8_640_000_000_000)
            : new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productMapRun.id, run.id),
            eq(productMapRun.projectId, run.projectId),
            eq(productMapRun.leaseToken, run.leaseToken!),
          ),
        )
        .returning({ status: productMapRun.status });
      if (!updated) return;
      await writeAuditEvent(
        {
          actorUserId: run.creatorId,
          projectId: run.projectId,
          eventType: cancelled
            ? "product_map_run_cancelled"
            : uncertain
              ? "product_map_run_state_unknown"
              : "product_map_run_failed",
          entityType: "product_map_run",
          entityId: run.id,
          result: cancelled ? "succeeded" : "failed",
          metadata: { status: updated.status, failureCode, failureReference },
        },
        tx,
      );
    });
    throw error;
  }
}

export async function createAndProcessProductMapRunForTest(
  input: Parameters<typeof createProductMapRun>[0],
) {
  const created = await createProductMapRun(input);
  if (created.created) {
    const claimed = await claimProductMapRun(
      `inline-${input.principal.user.id}`,
    );
    if (claimed) await processProductMapRun(claimed);
  }
  return getProductMapRun({
    principal: input.principal,
    projectId: input.projectId,
    runId: created.run.id,
    requestHeaders: input.requestHeaders,
  });
}
