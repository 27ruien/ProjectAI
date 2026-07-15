import { closeDatabasePool } from "../lib/db/client";
import { writeAuditEvent } from "../lib/db/repositories/audit-repository";
import { getObjectStorageConfig } from "../lib/files/config";
import { getObjectStorage } from "../lib/files/object-storage";
import {
  isObjectReferenced,
  verifyFileStorage,
} from "../lib/files/reconciliation";

const apply = process.argv.slice(2).includes("--apply");
const storage = getObjectStorage();

try {
  const result = await verifyFileStorage({ storage });
  const orphans = result.findings.filter(
    (finding) => finding.kind === "orphan_object" && finding.objectKey,
  );
  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      orphanCount: orphans.length,
      totalFindingCount: result.findings.length,
      counts: result.counts,
    })}\n`,
  );
  if (!apply) {
    process.stdout.write("Dry run only. No objects were deleted.\n");
  } else {
    const config = getObjectStorageConfig();
    const runtimeEnvironment =
      (process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development")
        .trim()
        .toLowerCase();
    const minimumAgeSeconds = Number(
      process.env.RECONCILE_ORPHAN_MIN_AGE_SECONDS || 3600,
    );
    if (
      runtimeEnvironment === "production" ||
      process.env.ALLOW_STORAGE_RECONCILE_APPLY !== "1" ||
      process.env.OBJECT_STORAGE_BUCKET_CONFIRM !== config.bucket ||
      !Number.isSafeInteger(minimumAgeSeconds) ||
      minimumAgeSeconds < 300
    ) {
      throw new Error(
        "Apply requires a non-production environment, ALLOW_STORAGE_RECONCILE_APPLY=1 and exact bucket confirmation.",
      );
    }
    let deleted = 0;
    const inventory = new Map(
      (await storage.listObjects("projects/")).map((entry) => [entry.key, entry]),
    );
    for (const orphan of orphans) {
      if (!orphan.projectId || !orphan.objectKey) continue;
      const inventoryEntry = inventory.get(orphan.objectKey);
      if (
        !inventoryEntry?.lastModified ||
        Date.now() - inventoryEntry.lastModified.getTime() <
          minimumAgeSeconds * 1000
      ) {
        continue;
      }
      if (await isObjectReferenced(orphan.projectId, orphan.objectKey)) continue;
      await storage.deleteObject(orphan.objectKey);
      deleted += 1;
      await writeAuditEvent({
        projectId: orphan.projectId,
        eventType: "document_storage_reconciliation_detected",
        entityType: "project_document_version",
        result: "succeeded",
        metadata: { action: "orphan_deleted" },
      });
    }
    process.stdout.write(`${JSON.stringify({ deleted })}\n`);
  }
} finally {
  await closeDatabasePool();
}
