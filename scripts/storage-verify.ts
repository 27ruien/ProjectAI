import { closeDatabasePool } from "../lib/db/client";
import { verifyFileStorage } from "../lib/files/reconciliation";

try {
  const result = await verifyFileStorage();
  process.stdout.write(
    `${JSON.stringify({
      ok: result.ok,
      checkedProjects: result.checkedProjects,
      checkedVersions: result.checkedVersions,
      checkedObjects: result.checkedObjects,
      counts: result.counts,
    })}\n`,
  );
  if (!result.ok) process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
