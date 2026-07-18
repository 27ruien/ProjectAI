import { closeDatabasePool } from "../lib/db/client";
import { runEmbeddingWorker } from "../lib/ai/embeddings/worker";
import { getEmbeddingRuntimeConfig } from "../lib/ai/embeddings/config";

const once = process.argv.includes("--once");
const controller = new AbortController();
const config = getEmbeddingRuntimeConfig();
let forcedShutdown: NodeJS.Timeout | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (controller.signal.aborted) return;
    controller.abort(new Error(signal));
    forcedShutdown = setTimeout(() => {
      process.stderr.write("Embedding worker drain deadline exceeded.\n");
      process.exit(1);
    }, config.shutdownDrainMs + 10_000);
  });
}

runEmbeddingWorker({ once, signal: controller.signal, config })
  .then(async () => {
    if (forcedShutdown) clearTimeout(forcedShutdown);
    await closeDatabasePool();
  })
  .catch(async (error: unknown) => {
    if (forcedShutdown) clearTimeout(forcedShutdown);
    process.stderr.write(
      `Embedding worker failed: ${
        error instanceof Error ? error.name : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
