import { and, eq } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  project,
  projectDocument,
  projectDocumentVersion,
} from "@/lib/db/schema";
import { getObjectStorage, type ObjectStorage } from "./object-storage";

export type StorageFindingKind =
  | "missing_object"
  | "size_mismatch"
  | "etag_mismatch"
  | "sha256_missing"
  | "sha256_metadata_mismatch"
  | "multiple_current_versions"
  | "active_document_without_current"
  | "stale_pending_version"
  | "orphan_object";

export type StorageFinding = {
  kind: StorageFindingKind;
  projectId: string | null;
  documentId?: string;
  versionId?: string;
  /** Internal-only; command output and audit serialization must omit this. */
  objectKey?: string;
};

export type StorageVerificationResult = {
  ok: boolean;
  checkedProjects: number;
  checkedVersions: number;
  checkedObjects: number;
  findings: StorageFinding[];
  counts: Record<StorageFindingKind, number>;
};

const EMPTY_COUNTS: Record<StorageFindingKind, number> = {
  missing_object: 0,
  size_mismatch: 0,
  etag_mismatch: 0,
  sha256_missing: 0,
  sha256_metadata_mismatch: 0,
  multiple_current_versions: 0,
  active_document_without_current: 0,
  stale_pending_version: 0,
  orphan_object: 0,
};

function normalizedEtag(value: string | null): string | null {
  return value?.replace(/^"|"$/g, "") ?? null;
}

export async function verifyFileStorage(options: {
  db?: DatabaseExecutor;
  storage?: ObjectStorage;
  now?: Date;
  pendingMaxAgeMs?: number;
} = {}): Promise<StorageVerificationResult> {
  const db = options.db ?? getDb();
  const storage = options.storage ?? getObjectStorage();
  const now = options.now ?? new Date();
  const pendingMaxAgeMs = options.pendingMaxAgeMs ?? 15 * 60 * 1000;
  const findings: StorageFinding[] = [];
  const projectRows = await db.select({ id: project.id }).from(project);
  const referencedObjectKeys = new Set<string>();
  let checkedVersions = 0;

  for (const projectRow of projectRows) {
    const [documents, versions] = await Promise.all([
      db
        .select()
        .from(projectDocument)
        .where(eq(projectDocument.projectId, projectRow.id)),
      db
        .select()
        .from(projectDocumentVersion)
        .where(eq(projectDocumentVersion.projectId, projectRow.id)),
    ]);
    checkedVersions += versions.length;
    const versionsByDocument = new Map<string, typeof versions>();
    for (const version of versions) {
      const group = versionsByDocument.get(version.documentId) ?? [];
      group.push(version);
      versionsByDocument.set(version.documentId, group);
      referencedObjectKeys.add(version.objectKey);
      if (!/^[0-9a-f]{64}$/.test(version.sha256)) {
        findings.push({
          kind: "sha256_missing",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
      }
      if (
        version.storageStatus === "pending" &&
        now.getTime() - version.createdAt.getTime() > pendingMaxAgeMs
      ) {
        findings.push({
          kind: "stale_pending_version",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
      }
      if (version.storageStatus !== "stored") continue;
      let object: Awaited<ReturnType<ObjectStorage["headObject"]>>;
      try {
        object = await storage.headObject(version.objectKey);
      } catch {
        object = null;
      }
      if (!object) {
        findings.push({
          kind: "missing_object",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
        continue;
      }
      if (object.size !== version.sizeBytes) {
        findings.push({
          kind: "size_mismatch",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
      }
      if (
        normalizedEtag(object.etag) !== normalizedEtag(version.storageEtag)
      ) {
        findings.push({
          kind: "etag_mismatch",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
      }
      const metadataSha =
        "sha256" in object && typeof object.sha256 === "string"
          ? object.sha256
          : null;
      if (metadataSha !== version.sha256) {
        findings.push({
          kind: "sha256_metadata_mismatch",
          projectId: projectRow.id,
          documentId: version.documentId,
          versionId: version.id,
        });
      }
    }
    for (const document of documents) {
      const documentVersions = versionsByDocument.get(document.id) ?? [];
      const current = documentVersions.filter((version) => version.isCurrent);
      if (current.length > 1) {
        findings.push({
          kind: "multiple_current_versions",
          projectId: projectRow.id,
          documentId: document.id,
        });
      }
      if (
        document.status === "active" &&
        !current.some((version) => version.storageStatus === "stored")
      ) {
        findings.push({
          kind: "active_document_without_current",
          projectId: projectRow.id,
          documentId: document.id,
        });
      }
    }
  }

  let allObjects: Awaited<ReturnType<ObjectStorage["listObjects"]>> = [];
  try {
    allObjects = await storage.listObjects("projects/");
  } catch {
    // Fail closed even when the database has no stored versions. The stable
    // message keeps provider endpoints, buckets and object keys out of logs.
    throw new Error("Object storage inventory is unavailable.");
  }
  for (const object of allObjects) {
    if (referencedObjectKeys.has(object.key)) continue;
    const match = /^projects\/([^/]+)\//.exec(object.key);
    findings.push({
      kind: "orphan_object",
      projectId: match?.[1] ?? null,
      objectKey: object.key,
    });
  }
  const counts = { ...EMPTY_COUNTS };
  for (const finding of findings) counts[finding.kind] += 1;
  return {
    ok: findings.length === 0,
    checkedProjects: projectRows.length,
    checkedVersions,
    checkedObjects: allObjects.length,
    findings,
    counts,
  };
}

export async function isObjectReferenced(
  projectId: string,
  objectKey: string,
  db: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const [record] = await db
    .select({ id: projectDocumentVersion.id })
    .from(projectDocumentVersion)
    .where(
      and(
        eq(projectDocumentVersion.projectId, projectId),
        eq(projectDocumentVersion.objectKey, objectKey),
      ),
    )
    .limit(1);
  return Boolean(record);
}
