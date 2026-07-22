import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import {
  projectDocument,
  projectDocumentVersion,
  user,
  type DocumentStatus,
  type ProjectDocumentRecord,
  type ProjectDocumentVersionRecord,
} from "../schema";

export type DocumentVersionWithUploader = ProjectDocumentVersionRecord & {
  uploaderDisplayName: string;
};

export type DocumentWithCurrentVersion = ProjectDocumentRecord & {
  currentVersion: DocumentVersionWithUploader | null;
};

export async function findProjectDocument(
  projectId: string,
  documentId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<ProjectDocumentRecord | null> {
  const query = db
    .select()
    .from(projectDocument)
    .where(
      and(
        eq(projectDocument.id, documentId),
        eq(projectDocument.projectId, projectId),
      ),
    )
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: projectDocument })
    : await query;
  return record ?? null;
}

export async function findProjectDocumentVersion(
  projectId: string,
  documentId: string,
  versionId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<ProjectDocumentVersionRecord | null> {
  const query = db
    .select()
    .from(projectDocumentVersion)
    .where(
      and(
        eq(projectDocumentVersion.id, versionId),
        eq(projectDocumentVersion.documentId, documentId),
        eq(projectDocumentVersion.projectId, projectId),
      ),
    )
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: projectDocumentVersion })
    : await query;
  return record ?? null;
}

export async function findProjectVersionByUploadId(
  projectId: string,
  uploadId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<ProjectDocumentVersionRecord | null> {
  const query = db
    .select()
    .from(projectDocumentVersion)
    .where(
      and(
        eq(projectDocumentVersion.projectId, projectId),
        eq(projectDocumentVersion.uploadId, uploadId),
      ),
    )
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: projectDocumentVersion })
    : await query;
  return record ?? null;
}

export async function listProjectDocumentVersions(
  projectId: string,
  documentId: string,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentVersionWithUploader[]> {
  return db
    .select({
      id: projectDocumentVersion.id,
      documentId: projectDocumentVersion.documentId,
      projectId: projectDocumentVersion.projectId,
      versionNumber: projectDocumentVersion.versionNumber,
      isCurrent: projectDocumentVersion.isCurrent,
      uploadId: projectDocumentVersion.uploadId,
      objectKey: projectDocumentVersion.objectKey,
      originalFilename: projectDocumentVersion.originalFilename,
      normalizedExtension: projectDocumentVersion.normalizedExtension,
      declaredMimeType: projectDocumentVersion.declaredMimeType,
      detectedMimeType: projectDocumentVersion.detectedMimeType,
      sizeBytes: projectDocumentVersion.sizeBytes,
      sha256: projectDocumentVersion.sha256,
      storageEtag: projectDocumentVersion.storageEtag,
      storageStatus: projectDocumentVersion.storageStatus,
      failureCode: projectDocumentVersion.failureCode,
      uploadedBy: projectDocumentVersion.uploadedBy,
      createdAt: projectDocumentVersion.createdAt,
      storedAt: projectDocumentVersion.storedAt,
      supersededAt: projectDocumentVersion.supersededAt,
      uploaderDisplayName: user.displayName,
    })
    .from(projectDocumentVersion)
    .innerJoin(user, eq(user.id, projectDocumentVersion.uploadedBy))
    .where(
      and(
        eq(projectDocumentVersion.projectId, projectId),
        eq(projectDocumentVersion.documentId, documentId),
      ),
    )
    .orderBy(desc(projectDocumentVersion.versionNumber));
}

export async function listProjectDocuments(
  projectId: string,
  status: DocumentStatus,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentWithCurrentVersion[]> {
  const documents = await db
    .select()
    .from(projectDocument)
    .where(
      and(
        eq(projectDocument.projectId, projectId),
        eq(projectDocument.status, status),
      ),
    )
    .orderBy(desc(projectDocument.updatedAt));
  if (documents.length === 0) return [];
  const currentVersions = await db
    .select({
      id: projectDocumentVersion.id,
      documentId: projectDocumentVersion.documentId,
      projectId: projectDocumentVersion.projectId,
      versionNumber: projectDocumentVersion.versionNumber,
      isCurrent: projectDocumentVersion.isCurrent,
      uploadId: projectDocumentVersion.uploadId,
      objectKey: projectDocumentVersion.objectKey,
      originalFilename: projectDocumentVersion.originalFilename,
      normalizedExtension: projectDocumentVersion.normalizedExtension,
      declaredMimeType: projectDocumentVersion.declaredMimeType,
      detectedMimeType: projectDocumentVersion.detectedMimeType,
      sizeBytes: projectDocumentVersion.sizeBytes,
      sha256: projectDocumentVersion.sha256,
      storageEtag: projectDocumentVersion.storageEtag,
      storageStatus: projectDocumentVersion.storageStatus,
      failureCode: projectDocumentVersion.failureCode,
      uploadedBy: projectDocumentVersion.uploadedBy,
      createdAt: projectDocumentVersion.createdAt,
      storedAt: projectDocumentVersion.storedAt,
      supersededAt: projectDocumentVersion.supersededAt,
      uploaderDisplayName: user.displayName,
    })
    .from(projectDocumentVersion)
    .innerJoin(user, eq(user.id, projectDocumentVersion.uploadedBy))
    .where(
      and(
        inArray(
          projectDocumentVersion.documentId,
          documents.map((document) => document.id),
        ),
        eq(projectDocumentVersion.projectId, projectId),
        eq(projectDocumentVersion.isCurrent, true),
      ),
    );
  const currentByDocument = new Map(
    currentVersions.map((version) => [version.documentId, version]),
  );
  return documents.map((document) => ({
    ...document,
    currentVersion: currentByDocument.get(document.id) ?? null,
  }));
}

export async function listAuthorizedDocuments(
  documentIds: string[],
  status: DocumentStatus,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentWithCurrentVersion[]> {
  if (documentIds.length === 0) return [];
  const documents = await db
    .select()
    .from(projectDocument)
    .where(
      and(
        inArray(projectDocument.id, documentIds),
        eq(projectDocument.status, status),
      ),
    )
    .orderBy(desc(projectDocument.updatedAt));
  if (documents.length === 0) return [];
  const currentVersions = await db
    .select({
      id: projectDocumentVersion.id,
      documentId: projectDocumentVersion.documentId,
      projectId: projectDocumentVersion.projectId,
      versionNumber: projectDocumentVersion.versionNumber,
      isCurrent: projectDocumentVersion.isCurrent,
      uploadId: projectDocumentVersion.uploadId,
      objectKey: projectDocumentVersion.objectKey,
      originalFilename: projectDocumentVersion.originalFilename,
      normalizedExtension: projectDocumentVersion.normalizedExtension,
      declaredMimeType: projectDocumentVersion.declaredMimeType,
      detectedMimeType: projectDocumentVersion.detectedMimeType,
      sizeBytes: projectDocumentVersion.sizeBytes,
      sha256: projectDocumentVersion.sha256,
      storageEtag: projectDocumentVersion.storageEtag,
      storageStatus: projectDocumentVersion.storageStatus,
      failureCode: projectDocumentVersion.failureCode,
      uploadedBy: projectDocumentVersion.uploadedBy,
      createdAt: projectDocumentVersion.createdAt,
      storedAt: projectDocumentVersion.storedAt,
      supersededAt: projectDocumentVersion.supersededAt,
      uploaderDisplayName: user.displayName,
    })
    .from(projectDocumentVersion)
    .innerJoin(user, eq(user.id, projectDocumentVersion.uploadedBy))
    .where(
      and(
        inArray(
          projectDocumentVersion.documentId,
          documents.map((document) => document.id),
        ),
        eq(projectDocumentVersion.isCurrent, true),
      ),
    );
  const currentByDocument = new Map(
    currentVersions.map((version) => [version.documentId, version]),
  );
  return documents.map((document) => ({
    ...document,
    currentVersion: currentByDocument.get(document.id) ?? null,
  }));
}

export async function countAuthorizedDocumentsByStatus(
  documentIds: string[],
  db: DatabaseExecutor = getDb(),
): Promise<Record<DocumentStatus, number>> {
  const counts: Record<DocumentStatus, number> = {
    pending: 0,
    active: 0,
    archived: 0,
    failed: 0,
  };
  if (documentIds.length === 0) return counts;
  const rows = await db
    .select({ status: projectDocument.status })
    .from(projectDocument)
    .where(inArray(projectDocument.id, documentIds));
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export async function countProjectDocumentsByStatus(
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<Record<DocumentStatus, number>> {
  const rows = await db
    .select({ status: projectDocument.status, id: projectDocument.id })
    .from(projectDocument)
    .where(eq(projectDocument.projectId, projectId));
  const counts: Record<DocumentStatus, number> = {
    pending: 0,
    active: 0,
    archived: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}
