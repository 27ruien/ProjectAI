import { z } from "zod";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal, AuthorizationError } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  AI_SCENARIOS,
  bindScenario,
  createManagedProvider,
  deleteGenerationModel,
  deleteProvider,
  ensureOrganizationAiDefaults,
  modelManagementSnapshot,
  requireAiConfigurationAdmin,
  replaceProviderApiKey,
  setGenerationModelEnabled,
  setProviderEnabled,
  testEmbeddingModel,
  testGenerationModel,
  testProvider,
  updateManagedProvider,
  updateGenerationModel,
} from "@/lib/ai/model-management";
import {
  aiEmbeddingModel,
  aiGenerationModel,
  aiProviderProfile,
  project,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";

const key = z
  .string()
  .trim()
  .min(8)
  .max(2_048)
  .refine((value) => !/[\r\n]/.test(value), "API Key 格式无效");
const providerFields = z
  .object({
    name: z.string().trim().min(1).max(120),
    providerType: z.enum(["dashscope", "openai_compatible"]),
    baseUrl: z.string().url().max(500),
    region: z.string().trim().min(1).max(80),
  })
  .strict();
const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create_provider"),
      organizationId: z.string().min(1),
      ...providerFields.shape,
      apiKey: key.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_provider"),
      organizationId: z.string().min(1),
      providerId: z.string().min(1),
      ...providerFields.shape,
    })
    .strict(),
  z
    .object({
      action: z.literal("replace_provider_api_key"),
      organizationId: z.string().min(1),
      providerId: z.string().min(1),
      apiKey: key,
    })
    .strict(),
  z
    .object({
      action: z.literal("test_provider"),
      organizationId: z.string().min(1),
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_provider_enabled"),
      organizationId: z.string().min(1),
      providerId: z.string().min(1),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete_provider"),
      organizationId: z.string().min(1),
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_generation_model"),
      organizationId: z.string().min(1),
      providerProfileId: z.string().min(1),
      displayName: z.string().trim().min(1).max(120),
      modelId: z.string().trim().min(1).max(160),
      supportsJson: z.boolean(),
      supportsThinking: z.boolean().default(false),
      disableThinkingForJson: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_generation_model"),
      organizationId: z.string().min(1),
      modelId: z.string().min(1),
      providerProfileId: z.string().min(1),
      displayName: z.string().trim().min(1).max(120),
      providerModelId: z.string().trim().min(1).max(160),
      supportsJson: z.boolean(),
      supportsThinking: z.boolean().default(false),
      disableThinkingForJson: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_generation_model_enabled"),
      organizationId: z.string().min(1),
      modelId: z.string().min(1),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("delete_generation_model"),
      organizationId: z.string().min(1),
      modelId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("create_embedding_model"),
      organizationId: z.string().min(1),
      providerProfileId: z.string().min(1),
      displayName: z.string().trim().min(1).max(120),
      modelId: z.string().trim().min(1).max(160),
      dimensions: z.literal(1024),
    })
    .strict(),
  z
    .object({
      action: z.literal("bind_scenario"),
      organizationId: z.string().min(1),
      scenario: z.enum(AI_SCENARIOS),
      generationModelId: z.string().nullable(),
      embeddingModelId: z.string().nullable(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("test_generation_model"),
      organizationId: z.string().min(1),
      projectId: z.string().min(1),
      modelId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("test_embedding_model"),
      organizationId: z.string().min(1),
      projectId: z.string().min(1),
      modelId: z.string().min(1),
    })
    .strict(),
]);

function configurationErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError)
    return authorizationErrorResponse(error);
  const message =
    error instanceof ProjectAssistantError || error instanceof Error
      ? error.message
      : "AI 配置未完成";
  const status = error instanceof ProjectAssistantError ? error.status : 400;
  return jsonResponse(
    {
      error: {
        code:
          error instanceof ProjectAssistantError
            ? error.code
            : "AI_CONFIGURATION_INVALID",
        message,
      },
    },
    { status },
  );
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const organizationId = new URL(request.url).searchParams.get(
      "organizationId",
    );
    if (!organizationId)
      return jsonResponse(
        { error: { code: "ORGANIZATION_REQUIRED", message: "请选择组织" } },
        { status: 400 },
      );
    return jsonResponse(
      await modelManagementSnapshot({ principal, organizationId }),
    );
  } catch (error) {
    return configurationErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const input = mutationSchema.parse(await request.json());
    const db = getDb();
    await requireAiConfigurationAdmin(principal, input.organizationId, db);
    await ensureOrganizationAiDefaults({
      organizationId: input.organizationId,
      actorId: principal.user.id,
      db,
    });
    let operation: Record<string, unknown> | null = null;
    if (input.action === "create_provider") {
      await createManagedProvider({ principal, ...input, db });
    } else if (input.action === "update_provider") {
      await updateManagedProvider({ principal, ...input, db });
    } else if (input.action === "replace_provider_api_key") {
      await replaceProviderApiKey({ principal, ...input, db });
    } else if (input.action === "test_provider") {
      operation = await testProvider({ principal, ...input, db });
    } else if (input.action === "set_provider_enabled") {
      await setProviderEnabled({ principal, ...input, db });
    } else if (input.action === "delete_provider") {
      await deleteProvider({ principal, ...input, db });
    } else if (input.action === "create_generation_model") {
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
      const id = crypto.randomUUID();
      await db.insert(aiGenerationModel).values({
        id,
        organizationId: input.organizationId,
        providerProfileId: provider.id,
        displayName: input.displayName,
        modelId: input.modelId,
        supportsJson: input.supportsJson,
        supportsThinking: input.supportsThinking,
        disableThinkingForJson: input.disableThinkingForJson,
        enabled: false,
        createdBy: principal.user.id,
        updatedBy: principal.user.id,
      });
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          eventType: "model_created",
          entityType: "ai_model",
          entityId: id,
          result: "succeeded",
          metadata: { providerId: provider.id, modelId: input.modelId },
        },
        db,
      );
    } else if (input.action === "update_generation_model") {
      await updateGenerationModel({ principal, ...input, db });
    } else if (input.action === "set_generation_model_enabled") {
      await setGenerationModelEnabled({ principal, ...input, db });
    } else if (input.action === "delete_generation_model") {
      await deleteGenerationModel({ principal, ...input, db });
    } else if (input.action === "create_embedding_model") {
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
      const id = crypto.randomUUID();
      await db.insert(aiEmbeddingModel).values({
        id,
        organizationId: input.organizationId,
        providerProfileId: provider.id,
        displayName: input.displayName,
        modelId: input.modelId,
        dimensions: 1024,
        enabled: false,
        createdBy: principal.user.id,
        updatedBy: principal.user.id,
      });
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          eventType: "model_created",
          entityType: "ai_model",
          entityId: id,
          result: "succeeded",
          metadata: {
            providerId: provider.id,
            modelId: input.modelId,
            kind: "embedding",
          },
        },
        db,
      );
    } else if (input.action === "bind_scenario") {
      await bindScenario({ principal, ...input, db });
    } else if (
      input.action === "test_generation_model" ||
      input.action === "test_embedding_model"
    ) {
      const [owned] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.id, input.projectId),
            eq(project.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!owned) throw new AuthorizationError(404, "NOT_FOUND", "项目不存在");
      operation =
        input.action === "test_generation_model"
          ? await testGenerationModel({
              principal,
              projectId: input.projectId,
              modelId: input.modelId,
              db,
            })
          : await testEmbeddingModel({
              principal,
              projectId: input.projectId,
              modelId: input.modelId,
              db,
            });
    }
    return jsonResponse({
      ...(await modelManagementSnapshot({
        principal,
        organizationId: input.organizationId,
        db,
      })),
      operation: operation ?? {},
    });
  } catch (error) {
    return configurationErrorResponse(error);
  }
}
