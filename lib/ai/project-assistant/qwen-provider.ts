import { readQwenApiKey } from "./secrets";
import { AiProviderError } from "./errors";
import type {
  ProjectAssistantProvider,
  ProjectAssistantProviderRequest,
  ProjectAssistantProviderResult,
} from "./provider-types";

type QwenResponse = {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
};

function nullableUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function httpFailure(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("RATE_LIMITED", true);
  if (status >= 500) return new AiProviderError("SERVER_ERROR", true);
  if (status === 401) return new AiProviderError("UNAUTHORIZED", false);
  if (status === 403) return new AiProviderError("FORBIDDEN", false);
  return new AiProviderError("BAD_REQUEST", false);
}

export class QwenProjectAssistantProvider
  implements ProjectAssistantProvider
{
  readonly provider = "qwen" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async generate(
    request: ProjectAssistantProviderRequest,
  ): Promise<ProjectAssistantProviderResult> {
    const apiKey = await readQwenApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: request.model,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            stream: false,
            ...(request.responseFormat === "json_object"
              ? { response_format: { type: "json_object" } }
              : {}),
          }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AiProviderError("TIMEOUT", true);
      }
      throw new AiProviderError("NETWORK", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw httpFailure(response.status);

    let body: QwenResponse;
    try {
      body = (await response.json()) as QwenResponse;
    } catch {
      throw new AiProviderError("INVALID_RESPONSE", false);
    }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      throw new AiProviderError("INVALID_RESPONSE", false);
    }
    const usage = body.usage;
    return {
      text: text.trim(),
      actualModel:
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : request.model,
      inputTokens: nullableUsage(usage?.prompt_tokens),
      outputTokens: nullableUsage(usage?.completion_tokens),
      totalTokens: nullableUsage(usage?.total_tokens),
      providerRequestId:
        response.headers.get("x-request-id")?.trim() ||
        (typeof body.id === "string" ? body.id.slice(0, 240) : null),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}
