import { closeDatabasePool } from "../lib/db/client";
import {
  EMBEDDING_MODEL,
  createEmbeddingGateway,
  getEmbeddingRuntimeConfig,
} from "../lib/ai/embeddings";

const config = getEmbeddingRuntimeConfig();
const gateway = createEmbeddingGateway(config);

gateway
  .embed(["Project AI embedding probe"])
  .then((result) => {
    const vector = result.vectors[0] ?? [];
    process.stdout.write(
      `${JSON.stringify({
        model: result.actualModel,
        expectedModel: EMBEDDING_MODEL,
        dimensions: vector.length,
        vectorCount: result.vectors.length,
        finite: vector.every((value) => Number.isFinite(value)),
        inputTokenCount: result.inputTokens,
        totalTokenCount: result.totalTokens,
        latencyMs: result.latencyMs,
      })}\n`,
    );
  })
  .finally(() => closeDatabasePool());
