import { createHash } from "node:crypto";
import { EmbeddingProviderError } from "./errors";
import type {
  EmbeddingProvider,
  EmbeddingProviderRequest,
  EmbeddingProviderResult,
} from "./provider-types";

function deterministicVector(text: string, dimensions: number): number[] {
  const seed = createHash("sha256").update(text).digest();
  const values = Array.from({ length: dimensions }, (_, index) => {
    const byte = seed[index % seed.length] ?? 0;
    const paired = seed[(index * 7 + 11) % seed.length] ?? 0;
    return (byte * 256 + paired) / 65_535 - 0.5;
  });
  const magnitude = Math.sqrt(
    values.reduce((total, value) => total + value * value, 0),
  );
  return values.map((value) => value / magnitude);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;

  async embed(
    request: EmbeddingProviderRequest,
  ): Promise<EmbeddingProviderResult> {
    if (request.signal?.aborted) {
      throw new EmbeddingProviderError("SHUTDOWN_ABORTED", true);
    }
    request.onRequestStarted?.();
    const inputTokens = request.inputs.reduce(
      (total, input) => total + Math.max(1, input.trim().split(/\s+/u).length),
      0,
    );
    const digest = createHash("sha256")
      .update(request.inputs.join("\u0000"))
      .digest("hex")
      .slice(0, 24);
    return {
      vectors: request.inputs.map((input) =>
        deterministicVector(input, request.dimensions),
      ),
      actualModel: request.model,
      inputTokens,
      totalTokens: inputTokens,
      providerRequestId: `fake-${digest}`,
      latencyMs: 0,
    };
  }
}
