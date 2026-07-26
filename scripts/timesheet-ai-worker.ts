import { closeDatabasePool } from "../lib/db/client";
import { runTimesheetAiWorker } from "../lib/timesheets/ai-jobs";

const once = process.argv.includes("--once");
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (!controller.signal.aborted) controller.abort(new Error(signal));
  });
}

runTimesheetAiWorker({ once, signal: controller.signal })
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Timesheet AI worker failed: ${
        error instanceof Error ? error.name : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
