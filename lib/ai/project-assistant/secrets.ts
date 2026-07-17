import { readFile } from "node:fs/promises";
import { ProjectAssistantError } from "./errors";

export async function readQwenApiKey(): Promise<string> {
  const secretFile = process.env.QWEN_API_KEY_FILE?.trim();
  if (secretFile) {
    let value = "";
    try {
      value = (await readFile(secretFile, "utf8")).trim();
    } catch {
      throw new ProjectAssistantError(
        503,
        "AI_SECRET_NOT_CONFIGURED",
        "AI 服务凭据未配置",
      );
    }
    if (!value) {
      throw new ProjectAssistantError(
        503,
        "AI_SECRET_NOT_CONFIGURED",
        "AI 服务凭据未配置",
      );
    }
    return value;
  }

  const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
  if (environment === "staging" || environment === "production") {
    throw new ProjectAssistantError(
      503,
      "AI_SECRET_NOT_CONFIGURED",
      "AI 服务凭据未配置",
    );
  }
  const localValue = process.env.QWEN_API_KEY?.trim();
  if (!localValue) {
    throw new ProjectAssistantError(
      503,
      "AI_SECRET_NOT_CONFIGURED",
      "AI 服务凭据未配置",
    );
  }
  return localValue;
}
