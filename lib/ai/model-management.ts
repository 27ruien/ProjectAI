import { and, eq, or } from "drizzle-orm";
import {
  createProjectAssistantGateway,
  getAiRuntimeConfig,
  validateQwenBaseUrl,
} from "@/lib/ai/project-assistant";
import {
  createEmbeddingGateway,
  getEmbeddingRuntimeConfig,
} from "@/lib/ai/embeddings";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  aiEmbeddingModel,
  aiGenerationModel,
  aiProviderCredential,
  aiProviderProfile,
  aiScenarioBinding,
  organizationMember,
  project,
} from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { type AuthenticatedPrincipal } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/session";
import {
  encryptProviderApiKey,
  maskProviderApiKey,
  resolveProviderApiKey,
} from "./provider-credentials";
import { ProjectAssistantError } from "./project-assistant/errors";

export const AI_SCENARIOS = [
  "general_chat",
  "project_grounded_chat",
  "requirement_overview_prefill",
  "requirement_overview_guidance",
  "requirement_markdown_generation",
] as const;
export type AiScenario = (typeof AI_SCENARIOS)[number];

const defaultIds = {
  provider: (orgId: string) => `dashscope-${orgId}`,
  generation: (orgId: string) => `qwen3.7-flash-${orgId}`,
  embedding: (orgId: string) => `qwen3.7-text-embedding-${orgId}`,
  scenario: (orgId: string, scenario: AiScenario) =>
    `scenario-${orgId}-${scenario}`,
};

type ProviderType = "dashscope" | "openai_compatible";
type ProviderRow = typeof aiProviderProfile.$inferSelect;

function providerBaseUrl(): string {
  return (
    process.env.QWEN_BASE_URL?.trim() ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  );
}

function modelError(error: unknown): string {
  return error instanceof ProjectAssistantError
    ? error.code
    : "PROVIDER_UNAVAILABLE";
}

function modelStatus(error: unknown): number | null {
  return error instanceof ProjectAssistantError ? error.status : null;
}

function validateOpenAiCompatibleBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProjectAssistantError(
      400,
      "PROVIDER_NOT_CONFIGURED",
      "Provider 地址无效",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname === "localhost" ||
    hostname.includes(":") ||
    /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)
  ) {
    throw new ProjectAssistantError(
      400,
      "PROVIDER_NOT_CONFIGURED",
      "Provider 地址必须是受信任的 HTTPS 公网地址",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  return url.toString().replace(/\/$/, "");
}

export function validateProviderBaseUrl(
  providerType: ProviderType,
  baseUrl: string,
): string {
  return providerType === "dashscope"
    ? validateQwenBaseUrl(baseUrl)
    : validateOpenAiCompatibleBaseUrl(baseUrl);
}

export async function requireAiConfigurationAdmin(
  principal: AuthenticatedPrincipal,
  organizationId: string,
  db: DatabaseExecutor = getDb(),
): Promise<void> {
  if (await hasAiConfigurationAdmin(principal, organizationId, db)) return;
  throw new AuthorizationError(403, "FORBIDDEN", "无权管理此组织的 AI 配置");
}

export async function hasAiConfigurationAdmin(
  principal: AuthenticatedPrincipal,
  organizationId: string,
  db: DatabaseExecutor = getDb(),
): Promise<boolean> {
  if (principal.user.systemRole === "system_admin") return true;
  const [membership] = await db
    .select({ id: organizationMember.id })
    .from(organizationMember)
    .where(
      and(
        eq(organizationMember.organizationId, organizationId),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.role, "organization_admin"),
        eq(organizationMember.isActive, true),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

export async function organizationForProject(
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<string> {
  const [row] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!row)
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "项目不存在",
    );
  return row.organizationId;
}

/** The legacy file-backed Provider remains available until an admin replaces its key. */
export async function ensureOrganizationAiDefaults(input: {
  organizationId: string;
  actorId: string;
  db?: DatabaseExecutor;
}): Promise<void> {
  const db = input.db ?? getDb();
  const orgId = input.organizationId;
  const providerId = defaultIds.provider(orgId);
  const generationId = defaultIds.generation(orgId);
  const embeddingId = defaultIds.embedding(orgId);
  await db
    .insert(aiProviderProfile)
    .values({
      id: providerId,
      organizationId: orgId,
      name: "DashScope（默认）",
      providerType: "dashscope",
      baseUrl: providerBaseUrl(),
      region: "cn-beijing",
      secretRef: "QWEN_API_KEY_FILE",
      credentialMode: "environment",
      enabled: true,
      // This is the deployment-managed legacy profile, not an administrator
      // supplied model. Existing installations already use the same mounted
      // credential and fake CI validates it deterministically; every managed
      // Provider/model begins as not_tested and must pass an explicit probe.
      lastTestStatus: "passed",
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing();
  await db
    .insert(aiGenerationModel)
    .values({
      id: generationId,
      organizationId: orgId,
      providerProfileId: providerId,
      displayName: "Qwen 3.7 Flash",
      modelId: "qwen3.7-flash",
      enabled: true,
      supportsJson: true,
      supportsThinking: false,
      disableThinkingForJson: true,
      lastTestStatus: "passed",
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing();
  await db
    .insert(aiEmbeddingModel)
    .values({
      id: embeddingId,
      organizationId: orgId,
      providerProfileId: providerId,
      displayName: "Qwen 3.7 Text Embedding",
      modelId: "qwen3.7-text-embedding",
      dimensions: 1024,
      enabled: true,
      lastTestStatus: "not_tested",
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onConflictDoNothing();
  for (const scenario of AI_SCENARIOS) {
    await db
      .insert(aiScenarioBinding)
      .values({
        id: defaultIds.scenario(orgId, scenario),
        organizationId: orgId,
        scenario,
        generationModelId: generationId,
        embeddingModelId: [
          "project_grounded_chat",
          "requirement_overview_prefill",
        ].includes(scenario)
          ? embeddingId
          : null,
        enabled: true,
        updatedBy: input.actorId,
      })
      .onConflictDoNothing();
  }
}

async function providerCredentialStatus(
  providerId: string,
  mode: string,
  db: DatabaseExecutor,
) {
  if (mode === "environment") {
    try {
      await resolveProviderApiKey(providerId, db);
      return { hasApiKey: true, apiKeyMasked: null as string | null };
    } catch {
      return { hasApiKey: false, apiKeyMasked: null as string | null };
    }
  }
  const [credential] = await db
    .select({ apiKeyLast4: aiProviderCredential.apiKeyLast4 })
    .from(aiProviderCredential)
    .where(eq(aiProviderCredential.providerProfileId, providerId))
    .limit(1);
  return {
    hasApiKey: Boolean(credential),
    apiKeyMasked: maskProviderApiKey(credential?.apiKeyLast4),
  };
}

async function requireUsableProvider(
  provider: ProviderRow,
  db: DatabaseExecutor,
): Promise<string> {
  if (!provider.enabled) {
    throw new ProjectAssistantError(
      503,
      "PROVIDER_NOT_CONFIGURED",
      "Provider 尚未通过连接测试或未启用",
    );
  }
  assertProviderCanBeEnabled(provider);
  return resolveProviderApiKey(provider.id, db);
}

export function assertProviderCanBeEnabled(
  provider: Pick<ProviderRow, "credentialMode" | "lastTestStatus">,
): void {
  if (
    provider.credentialMode === "managed" &&
    provider.lastTestStatus !== "passed"
  ) {
    throw new ProjectAssistantError(
      409,
      "PROVIDER_NOT_CONFIGURED",
      "Provider 需要先通过连接测试",
    );
  }
}

async function audit(
  principal: AuthenticatedPrincipal,
  eventType: string,
  entityType: "ai_provider" | "ai_model" | "ai_scenario",
  entityId: string,
  result: "succeeded" | "failed",
  metadata: Record<string, unknown>,
  db: DatabaseExecutor,
) {
  await writeAuditEvent(
    {
      actorUserId: principal.user.id,
      eventType,
      entityType,
      entityId,
      result,
      metadata,
    },
    db,
  );
}

export async function createManagedProvider(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  region: string;
  apiKey?: string | null;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const id = crypto.randomUUID();
  const apiKey = input.apiKey?.trim() || "";
  await db.transaction(async (tx) => {
    await tx.insert(aiProviderProfile).values({
      id,
      organizationId: input.organizationId,
      name: input.name.trim(),
      providerType: input.providerType,
      baseUrl: validateProviderBaseUrl(input.providerType, input.baseUrl),
      region: input.region.trim(),
      secretRef: "managed_provider_credential",
      credentialMode: "managed",
      enabled: false,
      lastTestStatus: "not_tested",
      createdBy: input.principal.user.id,
      updatedBy: input.principal.user.id,
    });
    if (apiKey) {
      const encrypted = await encryptProviderApiKey(apiKey);
      await tx.insert(aiProviderCredential).values({
        providerProfileId: id,
        ...encrypted,
        createdBy: input.principal.user.id,
        updatedBy: input.principal.user.id,
      });
    }
    await audit(
      input.principal,
      "provider_created",
      "ai_provider",
      id,
      "succeeded",
      { providerId: id, providerType: input.providerType },
      tx,
    );
  });
  return id;
}

export async function updateManagedProvider(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  providerId: string;
  name: string;
  providerType: ProviderType;
  baseUrl: string;
  region: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const result = await db
    .update(aiProviderProfile)
    .set({
      name: input.name.trim(),
      providerType: input.providerType,
      baseUrl: validateProviderBaseUrl(input.providerType, input.baseUrl),
      region: input.region.trim(),
      enabled: false,
      lastTestStatus: "not_tested",
      lastTestErrorCode: null,
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiProviderProfile.id, input.providerId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .returning({ id: aiProviderProfile.id });
  if (!result[0])
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  await audit(
    input.principal,
    "provider_updated",
    "ai_provider",
    input.providerId,
    "succeeded",
    { providerId: input.providerId },
    db,
  );
}

export async function replaceProviderApiKey(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  providerId: string;
  apiKey: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const encrypted = await encryptProviderApiKey(input.apiKey);
  const [provider] = await db
    .select({ id: aiProviderProfile.id })
    .from(aiProviderProfile)
    .where(
      and(
        eq(aiProviderProfile.id, input.providerId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!provider)
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  await db.transaction(async (tx) => {
    await tx
      .insert(aiProviderCredential)
      .values({
        providerProfileId: provider.id,
        ...encrypted,
        createdBy: input.principal.user.id,
        updatedBy: input.principal.user.id,
      })
      .onConflictDoUpdate({
        target: aiProviderCredential.providerProfileId,
        set: {
          ...encrypted,
          updatedBy: input.principal.user.id,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(aiProviderProfile)
      .set({
        credentialMode: "managed",
        secretRef: "managed_provider_credential",
        enabled: false,
        lastTestStatus: "not_tested",
        lastTestErrorCode: null,
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiProviderProfile.id, provider.id));
    await audit(
      input.principal,
      "api_key_replaced",
      "ai_provider",
      provider.id,
      "succeeded",
      { providerId: provider.id },
      tx,
    );
  });
}

function providerFailure(status: number): ProjectAssistantError {
  if (status === 401)
    return new ProjectAssistantError(
      401,
      "PROVIDER_UNAUTHORIZED",
      "API Key 无效，请检查后重新保存",
    );
  if (status === 403)
    return new ProjectAssistantError(
      403,
      "PROVIDER_FORBIDDEN",
      "当前 API Key 没有访问该资源或模型的权限",
    );
  if (status === 429)
    return new ProjectAssistantError(
      429,
      "PROVIDER_RATE_LIMITED",
      "当前账号额度、并发或限流已达到上限",
    );
  if (status >= 500)
    return new ProjectAssistantError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Provider 服务暂时不可用，请稍后再试",
    );
  return new ProjectAssistantError(
    400,
    "PROVIDER_NOT_CONFIGURED",
    "Provider 地址或请求配置无效",
  );
}

export async function testProvider(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  providerId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [provider] = await db
    .select()
    .from(aiProviderProfile)
    .where(
      and(
        eq(aiProviderProfile.id, input.providerId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!provider)
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  const started = performance.now();
  try {
    const apiKey = await resolveProviderApiKey(provider.id, db);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(
        `${validateProviderBaseUrl(provider.providerType as ProviderType, provider.baseUrl)}/models`,
        {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new ProjectAssistantError(
        503,
        error instanceof DOMException && error.name === "AbortError"
          ? "PROVIDER_TIMEOUT"
          : "PROVIDER_UNAVAILABLE",
        "Provider 连接未完成",
      );
    } finally {
      clearTimeout(timeout);
    }
    const requestId =
      response.headers.get("x-request-id")?.trim().slice(0, 240) || null;
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const discoveryUnsupported =
      response.status === 404 && provider.providerType === "dashscope";
    if (!response.ok && !discoveryUnsupported)
      throw providerFailure(response.status);
    let modelIds: string[] = [];
    if (response.ok) {
      try {
        const body = (await response.json()) as {
          data?: Array<{ id?: unknown }>;
        };
        modelIds = (body.data ?? [])
          .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
          .filter((modelId) =>
            /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(modelId),
          )
          .slice(0, 200);
      } catch {
        modelIds = [];
      }
    }
    await db
      .update(aiProviderProfile)
      .set({
        lastTestStatus: "passed",
        lastTestedAt: new Date(),
        lastTestErrorCode: null,
        lastTestLatencyMs: latencyMs,
        lastTestRequestId: requestId,
        modelDiscoverySupported: !discoveryUnsupported,
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiProviderProfile.id, provider.id));
    await audit(
      input.principal,
      "provider_tested",
      "ai_provider",
      provider.id,
      "succeeded",
      {
        providerId: provider.id,
        httpStatus: response.status,
        requestId,
        latencyMs,
        modelDiscoverySupported: !discoveryUnsupported,
      },
      db,
    );
    return {
      ok: true,
      modelDiscoverySupported: !discoveryUnsupported,
      modelIds,
    };
  } catch (error) {
    await db
      .update(aiProviderProfile)
      .set({
        lastTestStatus: "failed",
        lastTestedAt: new Date(),
        lastTestErrorCode: modelError(error),
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiProviderProfile.id, provider.id));
    await audit(
      input.principal,
      "provider_tested",
      "ai_provider",
      provider.id,
      "failed",
      {
        providerId: provider.id,
        errorCode: modelError(error),
        httpStatus: modelStatus(error),
      },
      db,
    );
    throw error;
  }
}

export async function setProviderEnabled(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  providerId: string;
  enabled: boolean;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [provider] = await db
    .select()
    .from(aiProviderProfile)
    .where(
      and(
        eq(aiProviderProfile.id, input.providerId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!provider)
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  if (input.enabled) {
    assertProviderCanBeEnabled(provider);
    await resolveProviderApiKey(provider.id, db);
  }
  await db
    .update(aiProviderProfile)
    .set({
      enabled: input.enabled,
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(eq(aiProviderProfile.id, provider.id));
  await audit(
    input.principal,
    input.enabled ? "provider_enabled" : "provider_disabled",
    "ai_provider",
    provider.id,
    "succeeded",
    { providerId: provider.id },
    db,
  );
}

export async function deleteProvider(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  providerId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [[generationModel], [embeddingModel]] = await Promise.all([
    db
      .select({ id: aiGenerationModel.id })
      .from(aiGenerationModel)
      .where(
        and(
          eq(aiGenerationModel.providerProfileId, input.providerId),
          eq(aiGenerationModel.organizationId, input.organizationId),
        ),
      )
      .limit(1),
    db
      .select({ id: aiEmbeddingModel.id })
      .from(aiEmbeddingModel)
      .where(
        and(
          eq(aiEmbeddingModel.providerProfileId, input.providerId),
          eq(aiEmbeddingModel.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  ]);
  if (generationModel || embeddingModel)
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "Provider 仍有关联模型，不能删除",
    );
  const deleted = await db
    .delete(aiProviderProfile)
    .where(
      and(
        eq(aiProviderProfile.id, input.providerId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .returning({ id: aiProviderProfile.id });
  if (!deleted[0])
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  await audit(
    input.principal,
    "provider_deleted",
    "ai_provider",
    input.providerId,
    "succeeded",
    { providerId: input.providerId },
    db,
  );
}

export async function resolveGenerationScenario(input: {
  projectId: string;
  actorId: string;
  scenario: AiScenario;
  generationModelId?: string | null;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({
    organizationId,
    actorId: input.actorId,
    db,
  });
  const [row] = input.generationModelId
    ? await db
        .select({
          binding: aiScenarioBinding,
          model: aiGenerationModel,
          provider: aiProviderProfile,
        })
        .from(aiScenarioBinding)
        .innerJoin(
          aiGenerationModel,
          eq(aiGenerationModel.id, input.generationModelId),
        )
        .innerJoin(
          aiProviderProfile,
          eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
        )
        .where(
          and(
            eq(aiScenarioBinding.organizationId, organizationId),
            eq(aiScenarioBinding.scenario, input.scenario),
            eq(aiGenerationModel.organizationId, organizationId),
          ),
        )
        .limit(1)
    : await db
        .select({
          binding: aiScenarioBinding,
          model: aiGenerationModel,
          provider: aiProviderProfile,
        })
        .from(aiScenarioBinding)
        .innerJoin(
          aiGenerationModel,
          eq(aiScenarioBinding.generationModelId, aiGenerationModel.id),
        )
        .innerJoin(
          aiProviderProfile,
          eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
        )
        .where(
          and(
            eq(aiScenarioBinding.organizationId, organizationId),
            eq(aiScenarioBinding.scenario, input.scenario),
          ),
        )
        .limit(1);
  if (
    !row ||
    !row.binding.enabled ||
    !row.model.enabled ||
    row.model.lastTestStatus !== "passed"
  )
    throw new ProjectAssistantError(
      503,
      "AI_MODEL_PROFILE_DISABLED",
      "当前场景尚未绑定可用的文本模型",
    );
  const runtime = {
    ...getAiRuntimeConfig(),
    qwenBaseUrl: validateProviderBaseUrl(
      row.provider.providerType as ProviderType,
      row.provider.baseUrl,
    ),
  };
  // CI's Fake Provider never receives, reads, or validates a real Provider
  // credential. Real runtimes resolve the currently configured credential at
  // the point of each server-side invocation.
  const apiKey =
    runtime.provider === "fake"
      ? undefined
      : await requireUsableProvider(row.provider, db);
  return {
    modelId: row.model.modelId,
    modelRecordId: row.model.id,
    providerName: row.provider.name,
    apiKey,
    runtime,
    disableThinkingForJson: row.model.disableThinkingForJson,
  };
}

export async function listEnabledGenerationModels(input: {
  projectId: string;
  actorId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({
    organizationId,
    actorId: input.actorId,
    db,
  });
  return db
    .select({
      id: aiGenerationModel.id,
      displayName: aiGenerationModel.displayName,
      modelId: aiGenerationModel.modelId,
    })
    .from(aiGenerationModel)
    .innerJoin(
      aiProviderProfile,
      eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiGenerationModel.organizationId, organizationId),
        eq(aiGenerationModel.enabled, true),
        eq(aiGenerationModel.lastTestStatus, "passed"),
        eq(aiProviderProfile.enabled, true),
        or(
          eq(aiProviderProfile.credentialMode, "environment"),
          eq(aiProviderProfile.lastTestStatus, "passed"),
        ),
      ),
    );
}

export type RequirementOverviewModelOption = {
  id: string;
  displayName: string;
  modelId: string;
  isDefault: boolean;
  lastTestStatus: string;
};

export async function listRequirementOverviewModelOptions(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({
    organizationId,
    actorId: input.principal.user.id,
    db,
  });
  const [defaultRow] = await db
    .select({ model: aiGenerationModel })
    .from(aiScenarioBinding)
    .innerJoin(
      aiGenerationModel,
      eq(aiScenarioBinding.generationModelId, aiGenerationModel.id),
    )
    .innerJoin(
      aiProviderProfile,
      eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiScenarioBinding.organizationId, organizationId),
        eq(aiScenarioBinding.scenario, "requirement_overview_prefill"),
        eq(aiScenarioBinding.enabled, true),
        eq(aiGenerationModel.enabled, true),
        eq(aiGenerationModel.supportsJson, true),
        eq(aiGenerationModel.lastTestStatus, "passed"),
        eq(aiProviderProfile.enabled, true),
        or(
          eq(aiProviderProfile.credentialMode, "environment"),
          eq(aiProviderProfile.lastTestStatus, "passed"),
        ),
      ),
    )
    .limit(1);
  if (!defaultRow)
    throw new ProjectAssistantError(
      503,
      "AI_MODEL_PROFILE_DISABLED",
      "需求概览默认模型不可用",
    );
  const defaultOption: RequirementOverviewModelOption = {
    id: defaultRow.model.id,
    displayName: defaultRow.model.displayName,
    modelId: defaultRow.model.modelId,
    isDefault: true,
    lastTestStatus: defaultRow.model.lastTestStatus,
  };
  const canManageModels = await hasAiConfigurationAdmin(
    input.principal,
    organizationId,
    db,
  );
  if (!canManageModels)
    return {
      defaultModel: defaultOption,
      alternatives: [],
      canCompare: false,
      canSelectOther: false,
    };
  const alternatives = await db
    .select({
      id: aiGenerationModel.id,
      displayName: aiGenerationModel.displayName,
      modelId: aiGenerationModel.modelId,
      lastTestStatus: aiGenerationModel.lastTestStatus,
    })
    .from(aiGenerationModel)
    .innerJoin(
      aiProviderProfile,
      eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiGenerationModel.organizationId, organizationId),
        eq(aiGenerationModel.enabled, true),
        eq(aiGenerationModel.supportsJson, true),
        eq(aiGenerationModel.lastTestStatus, "passed"),
        eq(aiProviderProfile.enabled, true),
        or(
          eq(aiProviderProfile.credentialMode, "environment"),
          eq(aiProviderProfile.lastTestStatus, "passed"),
        ),
      ),
    );
  const options = alternatives.map((model) => ({
    ...model,
    isDefault: model.id === defaultOption.id,
  }));
  return {
    defaultModel: defaultOption,
    alternatives: options.filter((model) => !model.isDefault),
    canCompare:
      defaultOption.lastTestStatus === "passed" && options.length >= 2,
    canSelectOther: true,
  };
}

export async function resolveRequirementOverviewGenerationModel(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  generationModelId?: string | null;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const options = await listRequirementOverviewModelOptions({
    principal: input.principal,
    projectId: input.projectId,
    db,
  });
  const requestedId = input.generationModelId ?? options.defaultModel.id;
  if (
    requestedId !== options.defaultModel.id &&
    (!options.canSelectOther ||
      !options.alternatives.some((item) => item.id === requestedId))
  )
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "所选模型未通过 JSON 能力测试或不可用",
    );
  const resolved = await resolveGenerationScenario({
    projectId: input.projectId,
    actorId: input.principal.user.id,
    scenario: "requirement_overview_prefill",
    generationModelId: requestedId,
    db,
  });
  return {
    ...resolved,
    displayName:
      requestedId === options.defaultModel.id
        ? options.defaultModel.displayName
        : options.alternatives.find((item) => item.id === requestedId)!
            .displayName,
    isDefault: requestedId === options.defaultModel.id,
  };
}

export async function testGenerationModel(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  modelId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await requireAiConfigurationAdmin(input.principal, organizationId, db);
  const [row] = await db
    .select({ model: aiGenerationModel, provider: aiProviderProfile })
    .from(aiGenerationModel)
    .innerJoin(
      aiProviderProfile,
      eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiGenerationModel.id, input.modelId),
        eq(aiGenerationModel.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row)
    throw new ProjectAssistantError(
      404,
      "AI_MODEL_PROFILE_NOT_FOUND",
      "模型不存在",
    );
  const started = performance.now();
  try {
    const apiKey = await resolveProviderApiKey(row.provider.id, db);
    const runtime = {
      ...getAiRuntimeConfig(),
      qwenBaseUrl: validateProviderBaseUrl(
        row.provider.providerType as ProviderType,
        row.provider.baseUrl,
      ),
    };
    const result = await createProjectAssistantGateway(runtime, {
      apiKey,
    }).generate({
      model: row.model.modelId,
      purpose: "probe",
      forceJsonObject: true,
      disableThinkingForJson: row.model.disableThinkingForJson,
      systemPrompt: "Return a JSON object with ok=true.",
      userPrompt: "Return a JSON object with ok=true.",
    });
    let json: unknown;
    try {
      json = JSON.parse(result.text);
    } catch {
      throw new ProjectAssistantError(
        502,
        "MODEL_OUTPUT_INVALID",
        "模型未返回有效 JSON",
      );
    }
    if (
      !json ||
      typeof json !== "object" ||
      (json as { ok?: unknown }).ok !== true
    )
      throw new ProjectAssistantError(
        502,
        "MODEL_OUTPUT_INVALID",
        "模型未返回预期 JSON",
      );
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    await db
      .update(aiGenerationModel)
      .set({
        lastTestStatus: "passed",
        lastTestedAt: new Date(),
        lastTestErrorCode: null,
        lastTestLatencyMs: latencyMs,
        lastTestRequestId: result.providerRequestId,
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiGenerationModel.id, row.model.id));
    await audit(
      input.principal,
      "model_tested",
      "ai_model",
      row.model.id,
      "succeeded",
      {
        providerId: row.provider.id,
        modelId: row.model.modelId,
        httpStatus: 200,
        requestId: result.providerRequestId,
        latencyMs,
      },
      db,
    );
    return {
      ok: true,
      actualModel: result.actualModel,
      requestId: result.providerRequestId,
      latencyMs,
    };
  } catch (error) {
    await db
      .update(aiGenerationModel)
      .set({
        lastTestStatus: "failed",
        lastTestedAt: new Date(),
        lastTestErrorCode: modelError(error),
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiGenerationModel.id, row.model.id));
    await audit(
      input.principal,
      "model_tested",
      "ai_model",
      row.model.id,
      "failed",
      {
        providerId: row.provider.id,
        modelId: row.model.modelId,
        errorCode: modelError(error),
        httpStatus: modelStatus(error),
      },
      db,
    );
    throw error;
  }
}

export async function testEmbeddingModel(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  modelId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await requireAiConfigurationAdmin(input.principal, organizationId, db);
  const [row] = await db
    .select({ model: aiEmbeddingModel, provider: aiProviderProfile })
    .from(aiEmbeddingModel)
    .innerJoin(
      aiProviderProfile,
      eq(aiEmbeddingModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiEmbeddingModel.id, input.modelId),
        eq(aiEmbeddingModel.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row)
    throw new ProjectAssistantError(
      404,
      "AI_MODEL_PROFILE_NOT_FOUND",
      "向量模型不存在",
    );
  if (row.model.dimensions !== 1024)
    throw new ProjectAssistantError(
      409,
      "EMBEDDING_DIMENSION_MISMATCH",
      "当前向量索引只支持 1024 维模型",
    );
  if (row.provider.credentialMode !== "environment")
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "自助 Provider 的向量模型需要独立重向量化发布流程",
    );
  try {
    const runtime = {
      ...getEmbeddingRuntimeConfig(),
      model: row.model.modelId,
      qwenBaseUrl: validateProviderBaseUrl(
        row.provider.providerType as ProviderType,
        row.provider.baseUrl,
      ),
      dimensions: 1024 as const,
    };
    const result = await createEmbeddingGateway(runtime).embed([
      "ProjectAI embedding probe",
    ]);
    await db
      .update(aiEmbeddingModel)
      .set({
        lastTestStatus: "passed",
        lastTestedAt: new Date(),
        lastTestErrorCode: null,
        lastTestLatencyMs: result.latencyMs,
        lastTestRequestId: result.providerRequestId,
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiEmbeddingModel.id, row.model.id));
    return {
      ok: true,
      actualModel: result.actualModel,
      dimensions: result.dimensions,
    };
  } catch (error) {
    await db
      .update(aiEmbeddingModel)
      .set({
        lastTestStatus: "failed",
        lastTestedAt: new Date(),
        lastTestErrorCode: modelError(error),
        updatedBy: input.principal.user.id,
        updatedAt: new Date(),
      })
      .where(eq(aiEmbeddingModel.id, row.model.id));
    throw error;
  }
}

async function assertScenarioModel(input: {
  organizationId: string;
  generationModelId: string | null;
  embeddingModelId: string | null;
  db: DatabaseExecutor;
}) {
  if (input.generationModelId) {
    const [model] = await input.db
      .select({
        id: aiGenerationModel.id,
        enabled: aiGenerationModel.enabled,
        lastTestStatus: aiGenerationModel.lastTestStatus,
        providerEnabled: aiProviderProfile.enabled,
        providerTest: aiProviderProfile.lastTestStatus,
        providerCredentialMode: aiProviderProfile.credentialMode,
      })
      .from(aiGenerationModel)
      .innerJoin(
        aiProviderProfile,
        eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
      )
      .where(
        and(
          eq(aiGenerationModel.id, input.generationModelId),
          eq(aiGenerationModel.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (
      !model ||
      !model.enabled ||
      model.lastTestStatus !== "passed" ||
      !model.providerEnabled ||
      (model.providerCredentialMode === "managed" &&
        model.providerTest !== "passed")
    )
      throw new ProjectAssistantError(
        409,
        "AI_MODEL_PROFILE_DISABLED",
        "场景只能绑定已启用且测试成功的文本模型",
      );
  }
  if (input.embeddingModelId) {
    const [model] = await input.db
      .select({
        id: aiEmbeddingModel.id,
        dimensions: aiEmbeddingModel.dimensions,
        enabled: aiEmbeddingModel.enabled,
        lastTestStatus: aiEmbeddingModel.lastTestStatus,
      })
      .from(aiEmbeddingModel)
      .where(
        and(
          eq(aiEmbeddingModel.id, input.embeddingModelId),
          eq(aiEmbeddingModel.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (
      !model ||
      model.dimensions !== 1024 ||
      !model.enabled ||
      model.lastTestStatus !== "passed"
    )
      throw new ProjectAssistantError(
        409,
        "AI_MODEL_PROFILE_DISABLED",
        "场景只能绑定已验证的 1024 维向量模型",
      );
  }
}

export async function bindScenario(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  scenario: AiScenario;
  generationModelId: string | null;
  embeddingModelId: string | null;
  enabled: boolean;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  await assertScenarioModel({ ...input, db });
  const result = await db
    .update(aiScenarioBinding)
    .set({
      generationModelId: input.generationModelId,
      embeddingModelId: input.embeddingModelId,
      enabled: input.enabled,
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiScenarioBinding.organizationId, input.organizationId),
        eq(aiScenarioBinding.scenario, input.scenario),
      ),
    )
    .returning({ id: aiScenarioBinding.id });
  if (!result[0])
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "场景不存在",
    );
  await audit(
    input.principal,
    "scenario_binding_changed",
    "ai_scenario",
    result[0].id,
    "succeeded",
    {
      scenario: input.scenario,
      generationModelId: input.generationModelId,
      embeddingModelId: input.embeddingModelId,
    },
    db,
  );
}

export async function setGenerationModelEnabled(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  modelId: string;
  enabled: boolean;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [model] = await db
    .select({ model: aiGenerationModel, provider: aiProviderProfile })
    .from(aiGenerationModel)
    .innerJoin(
      aiProviderProfile,
      eq(aiGenerationModel.providerProfileId, aiProviderProfile.id),
    )
    .where(
      and(
        eq(aiGenerationModel.id, input.modelId),
        eq(aiGenerationModel.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!model)
    throw new ProjectAssistantError(
      404,
      "AI_MODEL_PROFILE_NOT_FOUND",
      "模型不存在",
    );
  if (
    input.enabled &&
    (!model.model.supportsJson ||
      model.model.lastTestStatus !== "passed" ||
      !model.provider.enabled ||
      (model.provider.credentialMode === "managed" &&
        model.provider.lastTestStatus !== "passed"))
  )
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "文本模型需先通过 JSON 能力测试且 Provider 已启用",
    );
  await db
    .update(aiGenerationModel)
    .set({
      enabled: input.enabled,
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(eq(aiGenerationModel.id, model.model.id));
  await audit(
    input.principal,
    input.enabled ? "model_enabled" : "model_disabled",
    "ai_model",
    model.model.id,
    "succeeded",
    { modelId: model.model.modelId, providerId: model.provider.id },
    db,
  );
}

/**
 * A model change deliberately revokes its previous verification.  A changed
 * Model ID or JSON/Thinking capability must be proven again before it can be
 * used by a scenario.
 */
export async function updateGenerationModel(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  modelId: string;
  displayName: string;
  providerProfileId: string;
  providerModelId: string;
  supportsJson: boolean;
  supportsThinking: boolean;
  disableThinkingForJson: boolean;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [provider] = await db
    .select({ id: aiProviderProfile.id })
    .from(aiProviderProfile)
    .where(
      and(
        eq(aiProviderProfile.id, input.providerProfileId),
        eq(aiProviderProfile.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!provider)
    throw new ProjectAssistantError(
      404,
      "AI_CONFIGURATION_INVALID",
      "Provider 不存在",
    );
  const updated = await db
    .update(aiGenerationModel)
    .set({
      displayName: input.displayName.trim(),
      providerProfileId: provider.id,
      modelId: input.providerModelId.trim(),
      supportsJson: input.supportsJson,
      supportsThinking: input.supportsThinking,
      disableThinkingForJson: input.disableThinkingForJson,
      enabled: false,
      lastTestStatus: "not_tested",
      lastTestedAt: null,
      lastTestErrorCode: null,
      lastTestLatencyMs: null,
      lastTestRequestId: null,
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiGenerationModel.id, input.modelId),
        eq(aiGenerationModel.organizationId, input.organizationId),
      ),
    )
    .returning({ id: aiGenerationModel.id });
  if (!updated[0])
    throw new ProjectAssistantError(
      404,
      "AI_MODEL_PROFILE_NOT_FOUND",
      "模型不存在",
    );
  await audit(
    input.principal,
    "model_updated",
    "ai_model",
    input.modelId,
    "succeeded",
    {
      providerId: provider.id,
      modelId: input.providerModelId.trim(),
    },
    db,
  );
}

export async function deleteGenerationModel(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  modelId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  const [inUse] = await db
    .select({ id: aiScenarioBinding.id })
    .from(aiScenarioBinding)
    .where(
      and(
        eq(aiScenarioBinding.organizationId, input.organizationId),
        eq(aiScenarioBinding.generationModelId, input.modelId),
      ),
    )
    .limit(1);
  if (inUse)
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "模型仍被业务场景使用，先调整场景绑定后再删除",
    );
  try {
    const deleted = await db
      .delete(aiGenerationModel)
      .where(
        and(
          eq(aiGenerationModel.id, input.modelId),
          eq(aiGenerationModel.organizationId, input.organizationId),
        ),
      )
      .returning({ id: aiGenerationModel.id });
    if (!deleted[0])
      throw new ProjectAssistantError(
        404,
        "AI_MODEL_PROFILE_NOT_FOUND",
        "模型不存在",
      );
  } catch (error) {
    if (error instanceof ProjectAssistantError) throw error;
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "模型已有历史产物引用，不能删除",
    );
  }
  await audit(
    input.principal,
    "model_deleted",
    "ai_model",
    input.modelId,
    "succeeded",
    { modelId: input.modelId },
    db,
  );
}

export async function modelManagementSnapshot(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  await requireAiConfigurationAdmin(input.principal, input.organizationId, db);
  await ensureOrganizationAiDefaults({
    organizationId: input.organizationId,
    actorId: input.principal.user.id,
    db,
  });
  const [providers, generationModels, embeddingModels, scenarios] =
    await Promise.all([
      db
        .select({
          provider: aiProviderProfile,
          credential: aiProviderCredential,
        })
        .from(aiProviderProfile)
        .leftJoin(
          aiProviderCredential,
          eq(aiProviderCredential.providerProfileId, aiProviderProfile.id),
        )
        .where(eq(aiProviderProfile.organizationId, input.organizationId)),
      db
        .select()
        .from(aiGenerationModel)
        .where(eq(aiGenerationModel.organizationId, input.organizationId)),
      db
        .select()
        .from(aiEmbeddingModel)
        .where(eq(aiEmbeddingModel.organizationId, input.organizationId)),
      db
        .select()
        .from(aiScenarioBinding)
        .where(eq(aiScenarioBinding.organizationId, input.organizationId)),
    ]);
  return {
    providers: await Promise.all(
      providers.map(async ({ provider, credential }) => {
        const hasApiKey =
          provider.credentialMode === "managed"
            ? Boolean(credential)
            : (
                await providerCredentialStatus(
                  provider.id,
                  provider.credentialMode,
                  db,
                )
              ).hasApiKey;
        return {
          id: provider.id,
          name: provider.name,
          providerType: provider.providerType,
          baseUrl: provider.baseUrl,
          region: provider.region,
          credentialMode: provider.credentialMode,
          hasApiKey,
          apiKeyMasked:
            provider.credentialMode === "managed"
              ? maskProviderApiKey(credential?.apiKeyLast4)
              : null,
          enabled: provider.enabled,
          lastTestStatus: provider.lastTestStatus,
          lastTestedAt: provider.lastTestedAt,
          lastTestErrorCode: provider.lastTestErrorCode,
          lastTestLatencyMs: provider.lastTestLatencyMs,
          lastTestRequestId: provider.lastTestRequestId,
          modelDiscoverySupported: provider.modelDiscoverySupported,
        };
      }),
    ),
    generationModels,
    embeddingModels,
    scenarios,
    vectorDimensions: 1024,
  };
}
