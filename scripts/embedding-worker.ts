import { closeDatabasePool } from "../lib/db/client";
import { runEmbeddingWorker } from "../lib/ai/embeddings/worker";

const once = process.argv.includes("--once");
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort());
}

runEmbeddingWorker({ once, signal: controller.signal })
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Embedding worker failed: ${
        error instanceof Error ? error.name : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
