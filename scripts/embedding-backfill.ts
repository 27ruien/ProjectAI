import { closeDatabasePool } from "../lib/db/client";
import { enqueueEmbeddingBackfill } from "../lib/ai/embeddings/operations";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const rawLimit = argument("limit") ?? "100";
const limit = Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  throw new Error("--limit must be an integer between 1 and 10000.");
}
const projectId = argument("project")?.trim() || undefined;
const apply = process.argv.includes("--apply");

enqueueEmbeddingBackfill({ projectId, limit, apply })
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .finally(() => closeDatabasePool());
