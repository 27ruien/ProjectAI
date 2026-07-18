import { readQwenApiKey } from "@/lib/ai/project-assistant/secrets";
import { EmbeddingProviderError } from "./errors";
import type {
  EmbeddingProvider,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
} from "./provider-types";

type QwenEmbeddingResponse = {
  id?: unknown;
  model?: unknown;
  data?: Array<{
    embedding?: unknown;
    index?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    total_tokens?: unknown;
  };
};

function nullableUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function unknownProviderResult(
  classification: "post_dispatch" | "explicit_http_rejection",
): EmbeddingProviderError {
  return new EmbeddingProviderError(
    "PROVIDER_RESULT_UNKNOWN",
    false,
    classification,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

export class QwenEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "qwen" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async embed(
    request: EmbeddingProviderRequest,
  ): Promise<EmbeddingProviderResult> {
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true, "pre_dispatch");
    }
    let apiKey: string;
    try {
      apiKey = await readQwenApiKey();
    } catch {
      throw new EmbeddingProviderError(
        "SECRET_NOT_CONFIGURED",
        false,
        "pre_dispatch",
      );
    }
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true, "pre_dispatch");
    }
    await request.onRequestStarted?.();
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true, "pre_dispatch");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, request.timeoutMs);
    const onShutdown = () => {
      controller.abort();
    };
    request.signal?.addEventListener("abort", onShutdown, { once: true });
    const started = performance.now();
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          input: request.inputs,
          dimensions: request.dimensions,
          encoding_format: "float",
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw unknownProviderResult("post_dispatch");
      }
      throw unknownProviderResult("post_dispatch");
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onShutdown);
    }
    if (!response.ok) throw unknownProviderResult("explicit_http_rejection");

    let body: QwenEmbeddingResponse;
    try {
      body = (await response.json()) as QwenEmbeddingResponse;
    } catch {
      throw unknownProviderResult("post_dispatch");
    }
    if (!Array.isArray(body.data) || body.data.length !== request.inputs.length) {
      throw unknownProviderResult("post_dispatch");
    }
    const ordered = [...body.data].sort((left, right) => {
      const leftIndex = typeof left.index === "number" ? left.index : -1;
      const rightIndex = typeof right.index === "number" ? right.index : -1;
      return leftIndex - rightIndex;
    });
    const vectors = ordered.map((item, index) => {
      if (item.index !== index || !Array.isArray(item.embedding)) {
        throw unknownProviderResult("post_dispatch");
      }
      const vector = item.embedding;
      if (
        vector.length !== request.dimensions ||
        vector.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      ) {
        throw unknownProviderResult("post_dispatch");
      }
      return vector as number[];
    });
    return {
      vectors,
      actualModel:
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : request.model,
      inputTokens: nullableUsage(body.usage?.prompt_tokens),
      totalTokens: nullableUsage(body.usage?.total_tokens),
      providerRequestId:
        response.headers.get("x-request-id")?.trim().slice(0, 240) ||
        (typeof body.id === "string" ? body.id.slice(0, 240) : null),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      dispatchClassification: "successful_response",
    };
  }
}
