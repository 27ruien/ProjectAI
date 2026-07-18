import { closeDatabasePool } from "../lib/db/client";
import { retryUnknownEmbeddingJob } from "../lib/ai/embeddings/jobs";

function argument(prefix: string): string | null {
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length).trim() || null;
}

async function main(): Promise<void> {
  const jobId = argument("--job=");
  const accepted = process.argv.includes("--accept-possible-duplicate-charge");
  const apply = process.argv.includes("--apply");
  if (!jobId || !accepted) {
    throw new Error(
      "A job and explicit possible-duplicate-charge acknowledgement are required.",
    );
  }
  const result = await retryUnknownEmbeddingJob({
    jobId,
    acceptPossibleDuplicateCharge: accepted,
    apply,
  });
  process.stdout.write(
    `${result.dryRun ? "Dry run" : "Applied"}: unknown batches=${result.unknownBatchCount}, requeued=${result.requeued}.\n`,
  );
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Unknown embedding recovery failed: ${error instanceof Error ? error.name : "unknown error"}.\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
