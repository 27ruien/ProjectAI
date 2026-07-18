import { closeDatabasePool } from "../lib/db/client";
import { getEmbeddingStatus } from "../lib/ai/embeddings/operations";

getEmbeddingStatus()
  .then((status) => process.stdout.write(`${JSON.stringify(status)}\n`))
  .finally(() => closeDatabasePool());
