import { sql } from "drizzle-orm";
import { jsonResponse } from "@/lib/auth/http";
import { getDb } from "@/lib/db/client";
import {
  AI_GATEWAY_VERSION,
  getAiRuntimeConfig,
  isAiProviderConfigured,
} from "@/lib/ai/project-assistant";
import { isRagflowConfigured } from "@/lib/ragflow";

export async function GET(): Promise<Response> {
  let healthStage = "database";
  try {
    await getDb().execute(sql`
      select
        (select count(*) from users limit 1) as users_count,
        (select count(*) from sessions limit 1) as sessions_count,
        (select count(*) from projects limit 1) as projects_count,
        (select count(*) from project_members limit 1) as memberships_count
    `);
    const headers = new Headers({ "cache-control": "no-store" });
    const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
    if (commitSha && /^[0-9a-f]{40}$/iu.test(commitSha)) {
      headers.set("x-projectai-commit-sha", commitSha.toLowerCase());
    }
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
    if (appVersion) headers.set("x-projectai-app-version", appVersion);
    healthStage = "ai_configuration";
    const aiConfig = getAiRuntimeConfig();
    healthStage = "provider_configuration";
    const [aiProviderConfigured, knowledgeServiceConfigured] = await Promise.all([
      isAiProviderConfigured(),
      isRagflowConfigured(),
    ]);
    return jsonResponse(
      {
        status: "ok",
        aiAssistantEnabled: aiConfig.enabled,
        aiProviderConfigured,
        aiGatewayVersion: AI_GATEWAY_VERSION,
        knowledgeServiceConfigured,
      },
      { headers },
    );
  } catch (error) {
    console.error(
      `Project AI health check failed at ${healthStage}`,
      error instanceof Error ? error.name : "UnknownError",
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "NO_ERROR_CODE",
    );
    return jsonResponse(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
