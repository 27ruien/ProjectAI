import { stat } from "node:fs/promises";
import { ProjectAssistantError } from "./errors";

export const AI_GATEWAY_VERSION = "1";
export const PROJECT_ASSISTANT_PROMPT_VERSION = "1";
export const PROJECT_ASSISTANT_RETRIEVAL_VERSION = "b2-lexical-1";
export const PROJECT_ASSISTANT_PROFILE_ID =
  "qwen-project-assistant-cn-v1";
export const PROJECT_ASSISTANT_PRIMARY_MODEL = "qwen3.7-plus";
export const PROJECT_ASSISTANT_FALLBACK_MODEL = "qwen3.6-flash";
export const PROJECT_ASSISTANT_REGION = "cn-beijing";
const BEIJING_WORKSPACE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/;

export type AiProviderKind = "qwen" | "fake";

export type AiRuntimeConfig = {
  enabled: boolean;
  provider: AiProviderKind;
  region: typeof PROJECT_ASSISTANT_REGION;
  profileId: typeof PROJECT_ASSISTANT_PROFILE_ID;
  qwenBaseUrl: string | null;
  qwenApiKeyFile: string | null;
  timeoutMs: number;
  executionStaleAfterMs: number;
  maxOutputTokens: number;
  temperature: number;
};

function booleanEnvironment(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ProjectAssistantError(
    503,
    "AI_CONFIGURATION_INVALID",
    "AI 助手配置无效",
  );
}

function integerEnvironment(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  return value;
}

export function validateQwenBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/compatible-mode/v1")) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  if (
    (environment === "staging" || environment === "production") &&
    parsed.hostname !== "dashscope.aliyuncs.com" &&
    !BEIJING_WORKSPACE_HOST.test(parsed.hostname)
  ) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  parsed.pathname = pathname;
  return parsed.toString().replace(/\/$/, "");
}

export function getAiRuntimeConfig(): AiRuntimeConfig {
  const providerValue = process.env.AI_PROVIDER?.trim() || "qwen";
  if (providerValue !== "qwen" && providerValue !== "fake") {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
  const rawNodeEnvironment = Reflect.get(process.env, "NODE_ENV");
  const nodeEnvironment =
    typeof rawNodeEnvironment === "string"
      ? rawNodeEnvironment.trim()
      : "";
  if (
    providerValue === "fake" &&
    (nodeEnvironment !== "test" || environment !== "test")
  ) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  const region = process.env.AI_REGION?.trim() || PROJECT_ASSISTANT_REGION;
  const profileId =
    process.env.AI_PROJECT_ASSISTANT_PROFILE_ID?.trim() ||
    PROJECT_ASSISTANT_PROFILE_ID;
  if (
    region !== PROJECT_ASSISTANT_REGION ||
    profileId !== PROJECT_ASSISTANT_PROFILE_ID
  ) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  const configuredBaseUrl = process.env.QWEN_BASE_URL?.trim() || "";
  return {
    enabled: booleanEnvironment("AI_ASSISTANT_ENABLED"),
    provider: providerValue,
    region,
    profileId,
    qwenBaseUrl:
      providerValue === "qwen" && configuredBaseUrl
        ? validateQwenBaseUrl(configuredBaseUrl)
        : null,
    qwenApiKeyFile: process.env.QWEN_API_KEY_FILE?.trim() || null,
    timeoutMs: integerEnvironment(
      "AI_PROVIDER_TIMEOUT_MS",
      60_000,
      1_000,
      120_000,
    ),
    executionStaleAfterMs: integerEnvironment(
      "AI_EXECUTION_STALE_AFTER_MS",
      900_000,
      300_000,
      3_600_000,
    ),
    maxOutputTokens: integerEnvironment(
      "AI_MAX_OUTPUT_TOKENS",
      1_800,
      64,
      4_096,
    ),
    temperature: 0.2,
  };
}

export function requireAiAssistantEnabled(): AiRuntimeConfig {
  const config = getAiRuntimeConfig();
  if (!config.enabled) {
    throw new ProjectAssistantError(
      503,
      "AI_ASSISTANT_DISABLED",
      "项目 AI 助手尚未启用",
    );
  }
  if (config.provider === "qwen" && !config.qwenBaseUrl) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI 助手配置无效",
    );
  }
  return config;
}

export async function isAiProviderConfigured(): Promise<boolean> {
  try {
    const config = getAiRuntimeConfig();
    if (config.provider === "fake") return true;
    if (!config.qwenBaseUrl) return false;
    if (config.qwenApiKeyFile) {
      const details = await stat(config.qwenApiKeyFile);
      return details.isFile() && details.size > 0;
    }
    const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
    return (
      environment !== "staging" &&
      environment !== "production" &&
      Boolean(process.env.QWEN_API_KEY?.trim())
    );
  } catch {
    return false;
  }
}
