import { and, eq } from "drizzle-orm";
import { createProjectAssistantGateway, getAiRuntimeConfig, validateQwenBaseUrl } from "@/lib/ai/project-assistant";
import { createEmbeddingGateway, getEmbeddingRuntimeConfig } from "@/lib/ai/embeddings";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { aiEmbeddingModel, aiGenerationModel, aiProviderProfile, aiScenarioBinding, project } from "@/lib/db/schema";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
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
  scenario: (orgId: string, scenario: AiScenario) => `scenario-${orgId}-${scenario}`,
};

function providerBaseUrl(): string {
  return process.env.QWEN_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1";
}

export async function organizationForProject(projectId: string, db: DatabaseExecutor = getDb()): Promise<string> {
  const [row] = await db.select({ organizationId: project.organizationId }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row) throw new ProjectAssistantError(404, "AI_CONFIGURATION_INVALID", "项目不存在");
  return row.organizationId;
}

/** Create safe defaults only; secret contents stay in the configured server secret file. */
export async function ensureOrganizationAiDefaults(input: { organizationId: string; actorId: string; db?: DatabaseExecutor }): Promise<void> {
  const db = input.db ?? getDb();
  const orgId = input.organizationId;
  const providerId = defaultIds.provider(orgId);
  const generationId = defaultIds.generation(orgId);
  const embeddingId = defaultIds.embedding(orgId);
  await db.insert(aiProviderProfile).values({
    id: providerId, organizationId: orgId, name: "DashScope（默认）", providerType: "dashscope", baseUrl: providerBaseUrl(), region: "cn-beijing", secretRef: "QWEN_API_KEY_FILE", enabled: true, lastTestStatus: "not_tested", createdBy: input.actorId, updatedBy: input.actorId,
  }).onConflictDoNothing();
  await db.insert(aiGenerationModel).values({
    id: generationId, organizationId: orgId, providerProfileId: providerId, displayName: "Qwen 3.7 Flash", modelId: "qwen3.7-flash", enabled: true, supportsJson: true, lastTestStatus: "not_tested", createdBy: input.actorId, updatedBy: input.actorId,
  }).onConflictDoNothing();
  await db.insert(aiEmbeddingModel).values({
    id: embeddingId, organizationId: orgId, providerProfileId: providerId, displayName: "Qwen 3.7 Text Embedding", modelId: "qwen3.7-text-embedding", dimensions: 1024, enabled: true, lastTestStatus: "not_tested", createdBy: input.actorId, updatedBy: input.actorId,
  }).onConflictDoNothing();
  for (const scenario of AI_SCENARIOS) {
    await db.insert(aiScenarioBinding).values({
      id: defaultIds.scenario(orgId, scenario), organizationId: orgId, scenario,
      generationModelId: generationId,
      embeddingModelId: ["project_grounded_chat", "requirement_overview_prefill"].includes(scenario) ? embeddingId : null,
      enabled: true, updatedBy: input.actorId,
    }).onConflictDoNothing();
  }
}

export async function resolveGenerationScenario(input: { projectId: string; actorId: string; scenario: Exclude<AiScenario, "requirement_overview_prefill">; generationModelId?: string | null; db?: DatabaseExecutor }) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({ organizationId, actorId: input.actorId, db });
  const [row] = input.generationModelId
    ? await db.select({ binding: aiScenarioBinding, model: aiGenerationModel, provider: aiProviderProfile })
      .from(aiScenarioBinding)
      .innerJoin(aiGenerationModel, eq(aiGenerationModel.id, input.generationModelId))
      .innerJoin(aiProviderProfile, eq(aiGenerationModel.providerProfileId, aiProviderProfile.id))
      .where(and(eq(aiScenarioBinding.organizationId, organizationId), eq(aiScenarioBinding.scenario, input.scenario), eq(aiGenerationModel.organizationId, organizationId)))
      .limit(1)
    : await db.select({ binding: aiScenarioBinding, model: aiGenerationModel, provider: aiProviderProfile })
    .from(aiScenarioBinding)
    .innerJoin(aiGenerationModel, eq(aiScenarioBinding.generationModelId, aiGenerationModel.id))
    .innerJoin(aiProviderProfile, eq(aiGenerationModel.providerProfileId, aiProviderProfile.id))
    .where(and(eq(aiScenarioBinding.organizationId, organizationId), eq(aiScenarioBinding.scenario, input.scenario)))
    .limit(1);
  if (!row || !row.binding.enabled || !row.model.enabled || !row.provider.enabled || row.model.lastTestStatus === "failed") {
    throw new ProjectAssistantError(503, "AI_MODEL_PROFILE_DISABLED", "当前场景尚未绑定可用的文本模型");
  }
  if (row.provider.providerType !== "dashscope" || row.provider.secretRef !== "QWEN_API_KEY_FILE") {
    throw new ProjectAssistantError(503, "AI_CONFIGURATION_INVALID", "当前 Provider 尚未完成受信 Gateway 配置");
  }
  const runtime = getAiRuntimeConfig();
  return { modelId: row.model.modelId, modelRecordId: row.model.id, providerName: row.provider.name, runtime: { ...runtime, qwenBaseUrl: validateQwenBaseUrl(row.provider.baseUrl) } };
}

export async function listEnabledGenerationModels(input: { projectId: string; actorId: string; db?: DatabaseExecutor }) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({ organizationId, actorId: input.actorId, db });
  return db.select({ id: aiGenerationModel.id, displayName: aiGenerationModel.displayName, modelId: aiGenerationModel.modelId })
    .from(aiGenerationModel).innerJoin(aiProviderProfile, eq(aiGenerationModel.providerProfileId, aiProviderProfile.id))
    .where(and(eq(aiGenerationModel.organizationId, organizationId), eq(aiGenerationModel.enabled, true), eq(aiProviderProfile.enabled, true)));
}

export async function testGenerationModel(input: { principal: AuthenticatedPrincipal; projectId: string; modelId: string; db?: DatabaseExecutor }) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({ organizationId, actorId: input.principal.user.id, db });
  const [row] = await db.select({ model: aiGenerationModel, provider: aiProviderProfile }).from(aiGenerationModel)
    .innerJoin(aiProviderProfile, eq(aiGenerationModel.providerProfileId, aiProviderProfile.id))
    .where(and(eq(aiGenerationModel.id, input.modelId), eq(aiGenerationModel.organizationId, organizationId))).limit(1);
  if (!row) throw new ProjectAssistantError(404, "AI_MODEL_PROFILE_NOT_FOUND", "模型不存在");
  try {
    const runtime = { ...getAiRuntimeConfig(), qwenBaseUrl: validateQwenBaseUrl(row.provider.baseUrl) };
    const result = await createProjectAssistantGateway(runtime).generate({ model: row.model.modelId, purpose: "probe", systemPrompt: "Return a short JSON object only.", userPrompt: "<probe>return {\"ok\":true}</probe>" });
    await db.update(aiGenerationModel).set({ lastTestStatus: "passed", lastTestedAt: new Date(), updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiGenerationModel.id, row.model.id));
    await db.update(aiProviderProfile).set({ lastTestStatus: "passed", lastTestedAt: new Date(), lastTestErrorCode: null, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiProviderProfile.id, row.provider.id));
    return { ok: true, actualModel: result.actualModel };
  } catch (error) {
    await db.update(aiGenerationModel).set({ lastTestStatus: "failed", lastTestedAt: new Date(), updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiGenerationModel.id, row.model.id));
    await db.update(aiProviderProfile).set({ lastTestStatus: "failed", lastTestedAt: new Date(), lastTestErrorCode: error instanceof ProjectAssistantError ? error.code : "PROVIDER_FAILED", updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiProviderProfile.id, row.provider.id));
    throw error;
  }
}

/** A one-input, server-side probe. It proves model and 1024-dimension compatibility without touching project data. */
export async function testEmbeddingModel(input: { principal: AuthenticatedPrincipal; projectId: string; modelId: string; db?: DatabaseExecutor }) {
  const db = input.db ?? getDb();
  const organizationId = await organizationForProject(input.projectId, db);
  await ensureOrganizationAiDefaults({ organizationId, actorId: input.principal.user.id, db });
  const [row] = await db.select({ model: aiEmbeddingModel, provider: aiProviderProfile }).from(aiEmbeddingModel)
    .innerJoin(aiProviderProfile, eq(aiEmbeddingModel.providerProfileId, aiProviderProfile.id))
    .where(and(eq(aiEmbeddingModel.id, input.modelId), eq(aiEmbeddingModel.organizationId, organizationId))).limit(1);
  if (!row) throw new ProjectAssistantError(404, "AI_MODEL_PROFILE_NOT_FOUND", "向量模型不存在");
  if (row.model.dimensions !== 1024) throw new ProjectAssistantError(409, "AI_CONFIGURATION_INVALID", "当前向量索引只支持 1024 维模型");
  if (row.provider.providerType !== "dashscope" || row.provider.secretRef !== "QWEN_API_KEY_FILE") throw new ProjectAssistantError(503, "AI_CONFIGURATION_INVALID", "当前 Provider 尚未完成受信 Gateway 配置");
  try {
    const runtime = { ...getEmbeddingRuntimeConfig(), model: row.model.modelId, qwenBaseUrl: validateQwenBaseUrl(row.provider.baseUrl), dimensions: 1024 as const };
    const result = await createEmbeddingGateway(runtime).embed(["ProjectAI embedding probe"]);
    await db.update(aiEmbeddingModel).set({ lastTestStatus: "passed", lastTestedAt: new Date(), updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiEmbeddingModel.id, row.model.id));
    await db.update(aiProviderProfile).set({ lastTestStatus: "passed", lastTestedAt: new Date(), lastTestErrorCode: null, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiProviderProfile.id, row.provider.id));
    return { ok: true, actualModel: result.actualModel, dimensions: result.dimensions };
  } catch (error) {
    await db.update(aiEmbeddingModel).set({ lastTestStatus: "failed", lastTestedAt: new Date(), updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiEmbeddingModel.id, row.model.id));
    await db.update(aiProviderProfile).set({ lastTestStatus: "failed", lastTestedAt: new Date(), lastTestErrorCode: "EMBEDDING_PROVIDER_FAILED", updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(aiProviderProfile.id, row.provider.id));
    throw error;
  }
}

export async function modelManagementSnapshot(input: { principal: AuthenticatedPrincipal; organizationId: string; db?: DatabaseExecutor }) {
  const db = input.db ?? getDb();
  await ensureOrganizationAiDefaults({ organizationId: input.organizationId, actorId: input.principal.user.id, db });
  const [providers, generationModels, embeddingModels, scenarios] = await Promise.all([
    db.select().from(aiProviderProfile).where(eq(aiProviderProfile.organizationId, input.organizationId)),
    db.select().from(aiGenerationModel).where(eq(aiGenerationModel.organizationId, input.organizationId)),
    db.select().from(aiEmbeddingModel).where(eq(aiEmbeddingModel.organizationId, input.organizationId)),
    db.select().from(aiScenarioBinding).where(eq(aiScenarioBinding.organizationId, input.organizationId)),
  ]);
  return { providers: providers.map(({ secretRef, ...item }) => ({ ...item, secretReference: secretRef, hasServerSecret: Boolean(process.env[secretRef]?.trim()), secret: undefined })), generationModels, embeddingModels, scenarios, vectorDimensions: 1024 };
}
