import {
  createProjectAssistantGateway,
  getAiRuntimeConfig,
  ProjectAssistantError,
} from "../lib/ai/project-assistant";

const expected = "PROJECT_AI_QWEN_PROBE_OK";

async function main(): Promise<void> {
  const config = getAiRuntimeConfig();
  if (config.provider !== "qwen" || !config.qwenBaseUrl) {
    throw new ProjectAssistantError(
      503,
      "AI_CONFIGURATION_INVALID",
      "AI provider is not configured for the Qwen Probe.",
    );
  }
  const result = await createProjectAssistantGateway(config).generate({
    purpose: "probe",
    systemPrompt:
      "Return only the exact fixed text requested by the user. Do not add punctuation or explanation.",
    userPrompt: `Return exactly: ${expected}`,
  });
  if (!result.text.includes(expected)) {
    throw new ProjectAssistantError(
      503,
      "AI_PROVIDER_UNAVAILABLE",
      "Qwen Probe response validation failed.",
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      model: result.actualModel,
      fallbackUsed: result.fallbackUsed,
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
      },
      latencyMs: result.latencyMs,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const code =
    error instanceof ProjectAssistantError
      ? error.code
      : "AI_PROVIDER_UNAVAILABLE";
  process.stderr.write(`${JSON.stringify({ status: "failed", code })}\n`);
  process.exitCode = 1;
});
