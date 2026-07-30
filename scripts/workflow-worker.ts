import { closeDatabasePool } from "../lib/db/client";
import { runWorkflowWorker } from "../lib/workflows/worker";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort(signal));

runWorkflowWorker({ once: process.argv.includes("--once"), signal: controller.signal })
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(`Workflow worker failed: ${error instanceof Error ? error.name : "unknown"}\n`);
    await closeDatabasePool();
    process.exitCode = 1;
  });
