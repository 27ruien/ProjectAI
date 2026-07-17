import { eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/lib/db/client";
import { aiModelProfile } from "@/lib/db/schema";
import {
  AI_GATEWAY_VERSION,
  PROJECT_ASSISTANT_FALLBACK_MODEL,
  PROJECT_ASSISTANT_PRIMARY_MODEL,
  PROJECT_ASSISTANT_PROFILE_ID,
  PROJECT_ASSISTANT_REGION,
} from "./config";
import { ProjectAssistantError } from "./errors";

export async function requireProjectAssistantProfile(
  db: DatabaseExecutor,
  profileId: string,
) {
  const [profile] = await db
    .select()
    .from(aiModelProfile)
    .where(eq(aiModelProfile.id, profileId))
    .limit(1);
  if (!profile) {
    throw new ProjectAssistantError(
      400,
      "AI_MODEL_PROFILE_NOT_FOUND",
      "模型配置不存在",
    );
  }
  if (!profile.enabled) {
    throw new ProjectAssistantError(
      409,
      "AI_MODEL_PROFILE_DISABLED",
      "模型配置尚未启用",
    );
  }
  if (
    profile.id !== PROJECT_ASSISTANT_PROFILE_ID ||
    profile.provider !== "qwen" ||
    profile.purpose !== "project_assistant" ||
    profile.primaryModel !== PROJECT_ASSISTANT_PRIMARY_MODEL ||
    profile.fallbackModel !== PROJECT_ASSISTANT_FALLBACK_MODEL ||
    profile.region !== PROJECT_ASSISTANT_REGION ||
    profile.gatewayVersion !== AI_GATEWAY_VERSION
  ) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "模型配置无效",
    );
  }
  return profile;
}
