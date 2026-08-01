import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { isProductAdmin, requireApiPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { aiEmbeddingModel, aiGenerationModel, aiProviderProfile, aiScenarioBinding, project } from "@/lib/db/schema";
import { AI_SCENARIOS, ensureOrganizationAiDefaults, modelManagementSnapshot, testEmbeddingModel, testGenerationModel } from "@/lib/ai/model-management";
import { authorizationErrorResponse } from "@/lib/auth/http";
import { AuthorizationError } from "@/lib/auth/session";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_provider"), organizationId: z.string().min(1), name: z.string().trim().min(1).max(120), providerType: z.enum(["dashscope", "openai_compatible"]), baseUrl: z.string().url().max(500), region: z.string().trim().min(1).max(80), secretReference: z.enum(["QWEN_API_KEY_FILE", "OPENAI_API_KEY_FILE"]) }).strict(),
  z.object({ action: z.literal("create_generation_model"), organizationId: z.string().min(1), providerProfileId: z.string().min(1), displayName: z.string().trim().min(1).max(120), modelId: z.string().trim().min(1).max(160), supportsJson: z.boolean() }).strict(),
  z.object({ action: z.literal("create_embedding_model"), organizationId: z.string().min(1), providerProfileId: z.string().min(1), displayName: z.string().trim().min(1).max(120), modelId: z.string().trim().min(1).max(160), dimensions: z.literal(1024) }).strict(),
  z.object({ action: z.literal("bind_scenario"), organizationId: z.string().min(1), scenario: z.enum(AI_SCENARIOS), generationModelId: z.string().nullable(), embeddingModelId: z.string().nullable(), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("test_generation_model"), organizationId: z.string().min(1), projectId: z.string().min(1), modelId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("test_embedding_model"), organizationId: z.string().min(1), projectId: z.string().min(1), modelId: z.string().min(1) }).strict(),
]);

function requireAiAdmin(principal: Awaited<ReturnType<typeof requireApiPrincipal>>) { if (!isProductAdmin(principal.user.productRole) && principal.user.systemRole !== "system_admin") throw new AuthorizationError(403, "FORBIDDEN", "无权管理 AI 配置"); }
function safeHttps(url: string) { const parsed = new URL(url); if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hostname === "localhost" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) throw new Error("Provider endpoint 必须是受信任的 HTTPS 公网地址"); return parsed.toString().replace(/\/$/, ""); }
function configurationErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) return authorizationErrorResponse(error);
  const message = error instanceof ProjectAssistantError || error instanceof Error ? error.message : "AI 配置未完成";
  const status = error instanceof ProjectAssistantError ? error.status : 400;
  return jsonResponse({ error: { code: error instanceof ProjectAssistantError ? error.code : "AI_CONFIGURATION_INVALID", message } }, { status });
}
export async function GET(request: Request) { try { const principal = await requireApiPrincipal(request.headers); requireAiAdmin(principal); const organizationId = new URL(request.url).searchParams.get("organizationId"); if (!organizationId) return jsonResponse({ error: { code: "ORGANIZATION_REQUIRED", message: "请选择组织" } }, { status: 400 }); return jsonResponse(await modelManagementSnapshot({ principal, organizationId })); } catch (error) { return configurationErrorResponse(error); } }
export async function POST(request: Request) { try {
  requireTrustedMutationRequest(request); const principal = await requireApiPrincipal(request.headers); requireAiAdmin(principal); const input = mutationSchema.parse(await request.json()); const db = getDb(); await ensureOrganizationAiDefaults({ organizationId: input.organizationId, actorId: principal.user.id, db });
  if (input.action === "create_provider") await db.insert(aiProviderProfile).values({ id: crypto.randomUUID(), organizationId: input.organizationId, name: input.name, providerType: input.providerType, baseUrl: safeHttps(input.baseUrl), region: input.region, secretRef: input.secretReference, enabled: false, createdBy: principal.user.id, updatedBy: principal.user.id });
  if (input.action === "create_generation_model") await db.insert(aiGenerationModel).values({ id: crypto.randomUUID(), organizationId: input.organizationId, providerProfileId: input.providerProfileId, displayName: input.displayName, modelId: input.modelId, supportsJson: input.supportsJson, enabled: false, createdBy: principal.user.id, updatedBy: principal.user.id });
  if (input.action === "create_embedding_model") await db.insert(aiEmbeddingModel).values({ id: crypto.randomUUID(), organizationId: input.organizationId, providerProfileId: input.providerProfileId, displayName: input.displayName, modelId: input.modelId, dimensions: 1024, enabled: false, createdBy: principal.user.id, updatedBy: principal.user.id });
  if (input.action === "bind_scenario") { const [binding] = await db.select().from(aiScenarioBinding).where(and(eq(aiScenarioBinding.organizationId, input.organizationId), eq(aiScenarioBinding.scenario, input.scenario))).limit(1); if (!binding) throw new Error("场景绑定不存在"); await db.update(aiScenarioBinding).set({ generationModelId: input.generationModelId, embeddingModelId: input.embeddingModelId, enabled: input.enabled, updatedBy: principal.user.id, updatedAt: new Date() }).where(eq(aiScenarioBinding.id, binding.id)); }
  if (input.action === "test_generation_model") { const [owned] = await db.select({ id: project.id }).from(project).where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId))).limit(1); if (!owned) throw new AuthorizationError(404, "NOT_FOUND", "项目不存在"); await testGenerationModel({ principal, projectId: input.projectId, modelId: input.modelId, db }); }
  if (input.action === "test_embedding_model") { const [owned] = await db.select({ id: project.id }).from(project).where(and(eq(project.id, input.projectId), eq(project.organizationId, input.organizationId))).limit(1); if (!owned) throw new AuthorizationError(404, "NOT_FOUND", "项目不存在"); await testEmbeddingModel({ principal, projectId: input.projectId, modelId: input.modelId, db }); }
  return jsonResponse(await modelManagementSnapshot({ principal, organizationId: input.organizationId, db }));
} catch (error) { return configurationErrorResponse(error); } }
