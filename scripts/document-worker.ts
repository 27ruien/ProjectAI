import { closeDatabasePool } from "../lib/db/client";
import { runDocumentWorker } from "../lib/documents/processing/worker";

const once = process.argv.includes("--once");
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort());
}

runDocumentWorker({ once, signal: controller.signal })
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Document worker failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
