import { and, eq } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  projectDocument,
  projectDocumentVersion,
} from "../lib/db/schema";
import { ensureIngestionJob } from "../lib/documents/processing/jobs";

async function main(): Promise<void> {
  const rows = await getDb()
    .select({
      projectId: projectDocumentVersion.projectId,
      documentId: projectDocumentVersion.documentId,
      versionId: projectDocumentVersion.id,
      createdBy: projectDocumentVersion.uploadedBy,
    })
    .from(projectDocumentVersion)
    .innerJoin(
      projectDocument,
      and(
        eq(projectDocument.id, projectDocumentVersion.documentId),
        eq(projectDocument.projectId, projectDocumentVersion.projectId),
      ),
    )
    .where(
      and(
        eq(projectDocument.status, "active"),
        eq(projectDocumentVersion.storageStatus, "stored"),
        eq(projectDocumentVersion.isCurrent, true),
      ),
    );
  for (const row of rows) {
    await getDb().transaction(async (tx) => {
      await tx
        .select({ id: projectDocumentVersion.id })
        .from(projectDocumentVersion)
        .where(eq(projectDocumentVersion.id, row.versionId))
        .for("update", { of: projectDocumentVersion });
      await ensureIngestionJob({
        ...row,
        reason: "version_upgrade",
        db: tx,
      });
    });
  }
  process.stdout.write(`Ensured ingestion jobs for ${rows.length} current document(s).\n`);
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Document ingestion enqueue failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
