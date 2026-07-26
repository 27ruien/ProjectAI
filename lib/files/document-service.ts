import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { requireProjectRole } from "@/lib/auth/authorization";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
} from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import {
  getDb,
  type DatabaseExecutor,
  type DatabaseTransaction,
} from "@/lib/db/client";
import { getPostgresErrorCode } from "@/lib/db/errors";
import {
  findProjectDocument,
  findProjectDocumentVersion,
  findProjectVersionByUploadId,
  listProjectDocumentVersions,
} from "@/lib/db/repositories/document-repository";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";
import { requireUploadableKnowledgeSpace } from "@/lib/knowledge/management";
import {
  projectDocument,
  projectDocumentVersion,
  type ProjectDocumentRecord,
  type ProjectDocumentVersionRecord,
  type ProjectRole,
} from "@/lib/db/schema";
import { FileOperationError } from "./errors";
import { generateObjectKey, validateUploadFile } from "./validation";
import { getObjectStorage, type ObjectStorage } from "./object-storage";
import {
  activateOrQueueVersionIndex,
  deactivateDocumentIndex,
} from "@/lib/documents/processing/jobs";

const UPLOAD_ROLES = ["project_manager", "project_member"] as const;
const MANAGE_ROLES = ["project_manager"] as const;

export const documentRoles = {
  upload: UPLOAD_ROLES,
  manage: MANAGE_ROLES,
};

async function authorizedDocumentTransaction<T>(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  allowedRoles: readonly ProjectRole[];
  requestHeaders: Headers;
  operation: (tx: DatabaseTransaction) => Promise<T>;
}): Promise<T> {
  const result = await getDb().transaction(async (tx) => {
    try {
      await requireProjectRole(
        input.principal,
        input.projectId,
        input.allowedRoles,
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return { kind: "authorization_error", error } as const;
      }
      throw error;
    }
    return { kind: "success", value: await input.operation(tx) } as const;
  });
  if (result.kind === "authorization_error") throw result.error;
  return result.value;
}

const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedDisplayName(value: string | null, fallback: string): string {
  const candidate = (value ?? fallback)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  if (!candidate) {
    throw new FileOperationError(400, "INVALID_REQUEST", "资料名称不能为空");
  }
  return candidate;
}

function uploadIdFor(
  projectId: string,
  actorUserId: string,
  idempotencyKey: string,
): string {
  const key = idempotencyKey.trim().toLowerCase();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new FileOperationError(400, "INVALID_REQUEST", "Idempotency-Key 必须是 UUID");
  }
  return createHash("sha256")
    .update(projectId)
    .update("\0")
    .update(actorUserId)
    .update("\0")
    .update(key)
    .digest("hex");
}

type UploadReservation = {
  document: ProjectDocumentRecord;
  version: ProjectDocumentVersionRecord;
  isNewDocument: boolean;
  replayed: boolean;
};

function uploadMetadataMatches(
  version: ProjectDocumentVersionRecord,
  validated: Awaited<ReturnType<typeof validateUploadFile>>,
): boolean {
  return (
    version.originalFilename === validated.originalFilename &&
    version.normalizedExtension === validated.extension &&
    version.declaredMimeType === validated.declaredMimeType &&
    version.detectedMimeType === validated.detectedMimeType &&
    version.sizeBytes === validated.sizeBytes &&
    version.sha256 === validated.sha256
  );
}

async function resumeFailedUpload(
  replay: UploadReservation,
  validated: Awaited<ReturnType<typeof validateUploadFile>>,
  principal: AuthenticatedPrincipal,
  requestHeaders: Headers,
): Promise<UploadReservation> {
  if (!uploadMetadataMatches(replay.version, validated)) {
    throw new FileOperationError(
      409,
      "UPLOAD_ALREADY_EXISTS",
      "该幂等键已用于其他文件内容",
    );
  }
  return authorizedDocumentTransaction({
    principal,
    projectId: replay.document.projectId,
    allowedRoles: documentRoles.upload,
    requestHeaders,
    operation: async (tx) => {
    const document = await findProjectDocument(
      replay.document.projectId,
      replay.document.id,
      tx,
      { lockForUpdate: true },
    );
    const version = await findProjectDocumentVersion(
      replay.document.projectId,
      replay.document.id,
      replay.version.id,
      tx,
      { lockForUpdate: true },
    );
    if (!document || !version) {
      throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
    }
    if (version.storageStatus !== "failed") {
      return { ...replay, document, version, replayed: true };
    }
    if (replay.isNewDocument && document.status !== "failed") {
      throw new FileOperationError(409, "UPLOAD_FAILED", "资料当前不可重试");
    }
    if (!replay.isNewDocument && document.status !== "active") {
      throw new FileOperationError(
        409,
        document.status === "archived" ? "DOCUMENT_ARCHIVED" : "UPLOAD_FAILED",
        document.status === "archived" ? "请先恢复归档资料" : "资料当前不可重试",
      );
    }
    const [pendingVersion] = await tx
      .update(projectDocumentVersion)
      .set({ storageStatus: "pending", failureCode: null, isCurrent: false })
      .where(eq(projectDocumentVersion.id, version.id))
      .returning();
    const activeDocument = replay.isNewDocument
      ? (
          await tx
            .update(projectDocument)
            .set({ status: "pending", updatedAt: new Date() })
            .where(eq(projectDocument.id, document.id))
            .returning()
        )[0]
      : document;
    await writeAuditEvent(
      {
        actorUserId: principal.user.id,
        projectId: document.projectId,
        eventType: "document_upload_started",
        entityType: "project_document_version",
        entityId: version.id,
        result: "succeeded",
        metadata: {
          documentId: document.id,
          versionId: version.id,
          retry: true,
          extension: version.normalizedExtension,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
        },
        ...getRequestAuditContext(requestHeaders),
      },
      tx,
    );
    return {
      document: activeDocument,
      version: pendingVersion,
      isNewDocument: replay.isNewDocument,
      replayed: false,
    };
    },
  });
}

async function replayForUpload(
  projectId: string,
  actorUserId: string,
  uploadId: string,
  requestedDocumentId?: string,
  db: DatabaseExecutor = getDb(),
): Promise<UploadReservation | null> {
  const version = await findProjectVersionByUploadId(projectId, uploadId, db);
  if (!version) return null;
  if (
    version.uploadedBy !== actorUserId ||
    (requestedDocumentId && version.documentId !== requestedDocumentId)
  ) {
    throw new FileOperationError(
      409,
      "UPLOAD_ALREADY_EXISTS",
      "该幂等键已用于其他上传操作",
    );
  }
  const document = await findProjectDocument(projectId, version.documentId, db);
  if (!document) {
    throw new FileOperationError(409, "UPLOAD_ALREADY_EXISTS", "上传记录状态异常");
  }
  return {
    document,
    version,
    isNewDocument: version.versionNumber === 1,
    replayed: true,
  };
}

async function reserveUpload(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestedDocumentId?: string;
  uploadId: string;
  displayName: string;
  knowledgeSpaceId: string | null;
  knowledgeVisibility:
    | "private"
    | "organization_shared"
    | "department_shared"
    | "restricted"
    | null;
  originalFilename: string;
  extension: string;
  declaredMimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
  temporaryWorkflowId?: string | null;
  requestHeaders: Headers;
}): Promise<UploadReservation> {
  const existing = await replayForUpload(
    input.projectId,
    input.principal.user.id,
    input.uploadId,
    input.requestedDocumentId,
  );
  if (existing) return existing;

  try {
    return await authorizedDocumentTransaction({
      principal: input.principal,
      projectId: input.projectId,
      allowedRoles: documentRoles.upload,
      requestHeaders: input.requestHeaders,
      operation: async (tx) => {
      const replay = await replayForUpload(
        input.projectId,
        input.principal.user.id,
        input.uploadId,
        input.requestedDocumentId,
        tx,
      );
      if (replay) return replay;

      let document: ProjectDocumentRecord;
      let isNewDocument = false;
      if (input.requestedDocumentId) {
        const existingDocument = await findProjectDocument(
          input.projectId,
          input.requestedDocumentId,
          tx,
          { lockForUpdate: true },
        );
        if (!existingDocument) {
          throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
        }
        if (existingDocument.status === "archived") {
          throw new FileOperationError(409, "DOCUMENT_ARCHIVED", "请先恢复归档资料");
        }
        if (existingDocument.status !== "active") {
          throw new FileOperationError(409, "UPLOAD_FAILED", "资料当前不可创建新版本");
        }
        document = existingDocument;
      } else {
        isNewDocument = true;
        if (!input.knowledgeSpaceId || !input.knowledgeVisibility) {
          throw new FileOperationError(
            400,
            "INVALID_REQUEST",
            "新资料必须绑定知识空间",
          );
        }
        const destination = await resolveUploadDestination({
          principal: input.principal,
          projectId: input.projectId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          requestHeaders: input.requestHeaders,
          db: tx,
        });
        if (destination.visibility !== input.knowledgeVisibility) {
          throw new FileOperationError(
            409,
            "UPLOAD_ALREADY_EXISTS",
            "知识空间在上传期间发生变化",
          );
        }
        const [created] = await tx
          .insert(projectDocument)
          .values({
            id: crypto.randomUUID(),
            projectId: input.projectId,
            knowledgeSpaceId: destination.id,
            visibility: destination.visibility,
            displayName: input.displayName,
            workflowTemporary: Boolean(input.temporaryWorkflowId),
            temporaryWorkflowId: input.temporaryWorkflowId ?? null,
            temporaryExpiresAt: input.temporaryWorkflowId
              ? new Date(Date.now() + 24 * 60 * 60 * 1_000)
              : null,
            status: "pending",
            createdBy: input.principal.user.id,
          })
          .returning();
        document = created;
      }

      const [latestVersion] = await tx
        .select({ versionNumber: projectDocumentVersion.versionNumber })
        .from(projectDocumentVersion)
        .where(
          and(
            eq(projectDocumentVersion.projectId, input.projectId),
            eq(projectDocumentVersion.documentId, document.id),
          ),
        )
        .orderBy(desc(projectDocumentVersion.versionNumber))
        .limit(1);
      const versionId = crypto.randomUUID();
      const [version] = await tx
        .insert(projectDocumentVersion)
        .values({
          id: versionId,
          documentId: document.id,
          projectId: input.projectId,
          versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
          uploadId: input.uploadId,
          objectKey: generateObjectKey(input.projectId, document.id, versionId),
          originalFilename: input.originalFilename,
          normalizedExtension: input.extension,
          declaredMimeType: input.declaredMimeType,
          detectedMimeType: input.detectedMimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          storageStatus: "pending",
          uploadedBy: input.principal.user.id,
        })
        .returning();
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "document_upload_started",
          entityType: "project_document_version",
          entityId: version.id,
          result: "succeeded",
          metadata: {
            documentId: document.id,
            versionId: version.id,
            extension: input.extension,
            sizeBytes: input.sizeBytes,
            sha256: input.sha256,
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return { document, version, isNewDocument, replayed: false };
      },
    });
  } catch (error) {
    if (getPostgresErrorCode(error) === "23505") {
      const replay = await replayForUpload(
        input.projectId,
        input.principal.user.id,
        input.uploadId,
        input.requestedDocumentId,
      );
      if (replay) return replay;
    }
    throw error;
  }
}

async function resolveUploadDestination(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  knowledgeSpaceId: string | null;
  requestHeaders: Headers;
  db?: DatabaseExecutor;
}) {
  try {
    return await requireUploadableKnowledgeSpace(input);
  } catch (error) {
    if (
      error instanceof KnowledgeManagementError ||
      error instanceof AuthorizationError
    ) {
      throw new FileOperationError(
        404,
        "KNOWLEDGE_SPACE_NOT_FOUND",
        "知识空间不存在或不可上传",
      );
    }
    throw error;
  }
}

async function markUploadFailed(
  reservation: UploadReservation,
  principal: AuthenticatedPrincipal,
  requestHeaders: Headers,
  failureCode: string,
  quarantined: boolean,
): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      const document = await findProjectDocument(
        reservation.document.projectId,
        reservation.document.id,
        tx,
        { lockForUpdate: true },
      );
      const version = await findProjectDocumentVersion(
        reservation.document.projectId,
        reservation.document.id,
        reservation.version.id,
        tx,
        { lockForUpdate: true },
      );
      if (!document || !version || version.storageStatus === "stored") return;
      await tx
        .update(projectDocumentVersion)
        .set({
          storageStatus: quarantined ? "quarantined" : "failed",
          failureCode,
          isCurrent: false,
        })
        .where(eq(projectDocumentVersion.id, version.id));
      if (reservation.isNewDocument && document.status === "pending") {
        await tx
          .update(projectDocument)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(projectDocument.id, document.id));
      }
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId: document.projectId,
          eventType: "document_upload_failed",
          entityType: "project_document_version",
          entityId: version.id,
          result: "failed",
          metadata: {
            documentId: document.id,
            versionId: version.id,
            failureCode,
          },
          ...getRequestAuditContext(requestHeaders),
        },
        tx,
      );
    });
  } catch {
    // Best effort only: reconciliation reports stale pending/object states.
  }
}

async function finalizeUpload(
  reservation: UploadReservation,
  principal: AuthenticatedPrincipal,
  requestHeaders: Headers,
  storageEtag: string,
): Promise<{ document: ProjectDocumentRecord; version: ProjectDocumentVersionRecord }> {
  return authorizedDocumentTransaction({
    principal,
    projectId: reservation.document.projectId,
    allowedRoles: documentRoles.upload,
    requestHeaders,
    operation: async (tx) => {
    const document = await findProjectDocument(
      reservation.document.projectId,
      reservation.document.id,
      tx,
      { lockForUpdate: true },
    );
    const version = await findProjectDocumentVersion(
      reservation.document.projectId,
      reservation.document.id,
      reservation.version.id,
      tx,
      { lockForUpdate: true },
    );
    if (!document || !version) {
      throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
    }
    if (version.storageStatus === "stored") return { document, version };
    if (version.storageStatus !== "pending") {
      throw new FileOperationError(409, "UPLOAD_FAILED", "上传记录已结束");
    }
    if (
      (reservation.isNewDocument && document.status !== "pending") ||
      (!reservation.isNewDocument && document.status !== "active")
    ) {
      throw new FileOperationError(
        409,
        document.status === "archived" ? "DOCUMENT_ARCHIVED" : "UPLOAD_FAILED",
        document.status === "archived" ? "资料已归档" : "资料状态已变化",
      );
    }
    const now = new Date();
    await tx
      .update(projectDocumentVersion)
      .set({
        storageStatus: "stored",
        storageEtag,
        storedAt: now,
        failureCode: null,
        isCurrent: false,
      })
      .where(eq(projectDocumentVersion.id, version.id));
    const [latestStored] = await tx
      .select({ id: projectDocumentVersion.id })
      .from(projectDocumentVersion)
      .where(
        and(
          eq(projectDocumentVersion.projectId, document.projectId),
          eq(projectDocumentVersion.documentId, document.id),
          eq(projectDocumentVersion.storageStatus, "stored"),
        ),
      )
      .orderBy(desc(projectDocumentVersion.versionNumber))
      .limit(1);
    await tx
      .update(projectDocumentVersion)
      .set({ isCurrent: false, supersededAt: now })
      .where(
        and(
          eq(projectDocumentVersion.projectId, document.projectId),
          eq(projectDocumentVersion.documentId, document.id),
          eq(projectDocumentVersion.isCurrent, true),
        ),
      );
    if (!latestStored) throw new Error("Stored version selection failed.");
    await tx
      .update(projectDocumentVersion)
      .set({ isCurrent: true, supersededAt: null })
      .where(eq(projectDocumentVersion.id, latestStored.id))
      .returning();
    const [activeDocument] = await tx
      .update(projectDocument)
      .set({ status: "active", updatedAt: now })
      .where(eq(projectDocument.id, document.id))
      .returning();
    await activateOrQueueVersionIndex({
      projectId: document.projectId,
      documentId: document.id,
      versionId: latestStored.id,
      actorUserId: principal.user.id,
      reason: "stored",
      db: tx,
    });
    if (reservation.isNewDocument) {
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId: document.projectId,
          eventType: "document_created",
          entityType: "project_document",
          entityId: document.id,
          result: "succeeded",
          metadata: { documentId: document.id },
          ...getRequestAuditContext(requestHeaders),
        },
        tx,
      );
    }
    await writeAuditEvent(
      {
        actorUserId: principal.user.id,
        projectId: document.projectId,
        eventType: "document_version_stored",
        entityType: "project_document_version",
        entityId: version.id,
        result: "succeeded",
        metadata: {
          documentId: document.id,
          versionId: version.id,
          versionNumber: version.versionNumber,
          extension: version.normalizedExtension,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
        },
        ...getRequestAuditContext(requestHeaders),
      },
      tx,
    );
    const refreshedVersion = await findProjectDocumentVersion(
      document.projectId,
      document.id,
      version.id,
      tx,
    );
    if (!refreshedVersion) throw new Error("Stored version refresh failed.");
    return { document: activeDocument, version: refreshedVersion };
    },
  });
}

export async function uploadDocument(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
  idempotencyKey: string;
  file: File;
  displayName: string | null;
  knowledgeSpaceId?: string | null;
  temporaryWorkflowId?: string;
  documentId?: string;
  storage?: ObjectStorage;
}): Promise<{
  document: ProjectDocumentRecord;
  version: ProjectDocumentVersionRecord;
  replayed: boolean;
}> {
  const uploadId = uploadIdFor(
    input.projectId,
    input.principal.user.id,
    input.idempotencyKey,
  );
  const replay = await replayForUpload(
    input.projectId,
    input.principal.user.id,
    uploadId,
    input.documentId,
  );
  const destination = input.documentId
    ? null
    : await resolveUploadDestination({
        principal: input.principal,
        projectId: input.projectId,
        knowledgeSpaceId: input.knowledgeSpaceId ?? null,
        requestHeaders: input.requestHeaders,
      });
  if (
    replay &&
    destination &&
    replay.document.knowledgeSpaceId !== destination.id
  ) {
    throw new FileOperationError(
      409,
      "UPLOAD_ALREADY_EXISTS",
      "该幂等键已绑定其他知识空间",
    );
  }
  const validated = await validateUploadFile(input.file);
  if (replay && !uploadMetadataMatches(replay.version, validated)) {
    throw new FileOperationError(
      409,
      "UPLOAD_ALREADY_EXISTS",
      "该幂等键已用于其他文件内容",
    );
  }
  if (replay && replay.version.storageStatus !== "failed") {
    return { ...replay, replayed: true };
  }
  const reservation = replay
    ? await resumeFailedUpload(
        replay,
        validated,
        input.principal,
        input.requestHeaders,
      )
    : await reserveUpload({
        principal: input.principal,
        projectId: input.projectId,
        requestedDocumentId: input.documentId,
        uploadId,
        displayName: normalizedDisplayName(input.displayName, validated.displayName),
        knowledgeSpaceId: destination?.id ?? null,
        knowledgeVisibility: destination?.visibility ?? null,
        originalFilename: validated.originalFilename,
        extension: validated.extension,
        declaredMimeType: validated.declaredMimeType,
        detectedMimeType: validated.detectedMimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        temporaryWorkflowId: input.temporaryWorkflowId ?? null,
        requestHeaders: input.requestHeaders,
      });
  if (reservation.replayed) {
    return {
      document: reservation.document,
      version: reservation.version,
      replayed: true,
    };
  }

  const storage = input.storage ?? getObjectStorage();
  let storedEtag: string | null = null;
  try {
    const stored = await storage.putObject({
      key: reservation.version.objectKey,
      body: validated.bytes,
      contentType: validated.detectedMimeType,
      sha256: validated.sha256,
    });
    storedEtag = stored.etag;
    if (
      !storedEtag ||
      stored.size !== validated.sizeBytes ||
      stored.sha256 !== validated.sha256
    ) {
      throw new Error("Object metadata mismatch.");
    }
  } catch {
    let compensationFailed = false;
    try {
      await storage.deleteObject(reservation.version.objectKey);
    } catch {
      compensationFailed = true;
    }
    await markUploadFailed(
      reservation,
      input.principal,
      input.requestHeaders,
      compensationFailed ? "OBJECT_PUT_COMPENSATION_FAILED" : "OBJECT_PUT_FAILED",
      compensationFailed,
    );
    throw new FileOperationError(503, "UPLOAD_FAILED", "文件存储失败，请稍后重试");
  }

  try {
    const finalized = await finalizeUpload(
      reservation,
      input.principal,
      input.requestHeaders,
      storedEtag,
    );
    return { ...finalized, replayed: false };
  } catch (error) {
    let compensationFailed = false;
    try {
      await storage.deleteObject(reservation.version.objectKey);
    } catch {
      compensationFailed = true;
    }
    await markUploadFailed(
      reservation,
      input.principal,
      input.requestHeaders,
      compensationFailed ? "FINALIZE_COMPENSATION_FAILED" : "FINALIZE_FAILED",
      compensationFailed,
    );
    if (error instanceof FileOperationError || error instanceof AuthorizationError) {
      throw error;
    }
    throw new FileOperationError(503, "UPLOAD_FAILED", "文件存储确认失败，请稍后重试");
  }
}

export async function setCurrentDocumentVersion(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  versionId: string;
  requestHeaders: Headers;
}): Promise<ProjectDocumentVersionRecord> {
  return authorizedDocumentTransaction({
    principal: input.principal,
    projectId: input.projectId,
    allowedRoles: documentRoles.manage,
    requestHeaders: input.requestHeaders,
    operation: async (tx) => {
    const document = await findProjectDocument(input.projectId, input.documentId, tx, {
      lockForUpdate: true,
    });
    if (!document) throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
    if (document.status === "archived") {
      throw new FileOperationError(409, "DOCUMENT_ARCHIVED", "请先恢复归档资料");
    }
    const version = await findProjectDocumentVersion(
      input.projectId,
      input.documentId,
      input.versionId,
      tx,
      { lockForUpdate: true },
    );
    if (!version) throw new FileOperationError(404, "VERSION_NOT_FOUND", "文件版本不存在");
    if (version.storageStatus !== "stored") {
      throw new FileOperationError(409, "VERSION_NOT_AVAILABLE", "该版本不可设为当前版本");
    }
    const now = new Date();
    await tx
      .update(projectDocumentVersion)
      .set({ isCurrent: false, supersededAt: now })
      .where(
        and(
          eq(projectDocumentVersion.projectId, input.projectId),
          eq(projectDocumentVersion.documentId, input.documentId),
          eq(projectDocumentVersion.isCurrent, true),
        ),
      );
    const [updated] = await tx
      .update(projectDocumentVersion)
      .set({ isCurrent: true, supersededAt: null })
      .where(eq(projectDocumentVersion.id, version.id))
      .returning();
    await tx
      .update(projectDocument)
      .set({ updatedAt: now })
      .where(eq(projectDocument.id, document.id));
    await activateOrQueueVersionIndex({
      projectId: input.projectId,
      documentId: input.documentId,
      versionId: version.id,
      actorUserId: input.principal.user.id,
      reason: "current_version",
      db: tx,
    });
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "document_current_version_changed",
        entityType: "project_document_version",
        entityId: version.id,
        result: "succeeded",
        metadata: { documentId: document.id, versionId: version.id },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return updated;
    },
  });
}

export async function finalizeTemporaryWorkflowDocument(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  workflowId: string;
  action: "promote" | "discard";
  targetKnowledgeSpaceId?: string;
  requestHeaders: Headers;
}): Promise<ProjectDocumentRecord> {
  return authorizedDocumentTransaction({
    principal: input.principal,
    projectId: input.projectId,
    allowedRoles: documentRoles.upload,
    requestHeaders: input.requestHeaders,
    operation: async (tx) => {
      const document = await findProjectDocument(input.projectId, input.documentId, tx, {
        lockForUpdate: true,
      });
      if (!document || !document.workflowTemporary || document.temporaryWorkflowId !== input.workflowId) {
        throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "临时附件不存在");
      }
      if (
        document.createdBy !== input.principal.user.id &&
        input.principal.user.productRole === "member"
      ) {
        throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "临时附件不存在");
      }
      const now = new Date();
      if (
        input.action === "promote" &&
        document.temporaryExpiresAt &&
        document.temporaryExpiresAt.getTime() <= now.getTime()
      ) {
        throw new FileOperationError(
          409,
          "TEMPORARY_DOCUMENT_EXPIRED",
          "临时附件已过期，只能退出活动索引后重新上传",
        );
      }
      const target =
        input.action === "promote" && input.targetKnowledgeSpaceId
          ? await requireUploadableKnowledgeSpace({
              principal: input.principal,
              projectId: input.projectId,
              knowledgeSpaceId: input.targetKnowledgeSpaceId,
              requestHeaders: input.requestHeaders,
              db: tx,
            })
          : null;
      const [updated] = await tx
        .update(projectDocument)
        .set(
          input.action === "promote"
            ? {
                workflowTemporary: false,
                temporaryWorkflowId: null,
                temporaryExpiresAt: null,
                temporaryPromotedAt: now,
                ...(target
                  ? {
                      knowledgeSpaceId: target.id,
                      visibility: target.visibility,
                    }
                  : {}),
                updatedAt: now,
              }
            : {
                status: "archived",
                archivedBy: input.principal.user.id,
                archivedAt: now,
                updatedAt: now,
              },
        )
        .where(eq(projectDocument.id, document.id))
        .returning();
      if (input.action === "discard") {
        await deactivateDocumentIndex(
          input.projectId,
          input.documentId,
          input.principal.user.id,
          "temporary_workflow_discarded",
          tx,
        );
      }
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType:
            input.action === "promote"
              ? "temporary_workflow_document_promoted"
              : "temporary_workflow_document_discarded",
          entityType: "project_document",
          entityId: input.documentId,
          result: "succeeded",
          metadata: {
            workflowIdHash: createHash("sha256").update(input.workflowId).digest("hex"),
            targetKnowledgeSpaceId: target?.id ?? null,
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return updated;
    },
  });
}

export async function setDocumentArchived(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  archived: boolean;
  requestHeaders: Headers;
}): Promise<ProjectDocumentRecord> {
  return authorizedDocumentTransaction({
    principal: input.principal,
    projectId: input.projectId,
    allowedRoles: documentRoles.manage,
    requestHeaders: input.requestHeaders,
    operation: async (tx) => {
    const document = await findProjectDocument(input.projectId, input.documentId, tx, {
      lockForUpdate: true,
    });
    if (!document) throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
    const targetStatus = input.archived ? "archived" : "active";
    if (document.status === targetStatus) return document;
    if (input.archived && document.status !== "active") {
      throw new FileOperationError(409, "VERSION_NOT_AVAILABLE", "资料当前不可归档");
    }
    if (!input.archived && document.status !== "archived") {
      throw new FileOperationError(409, "VERSION_NOT_AVAILABLE", "资料当前不可恢复");
    }
    const now = new Date();
    const [updated] = await tx
      .update(projectDocument)
      .set({
        status: targetStatus,
        archivedBy: input.archived ? input.principal.user.id : null,
        archivedAt: input.archived ? now : null,
        updatedAt: now,
      })
      .where(eq(projectDocument.id, document.id))
      .returning();
    if (input.archived) {
      await deactivateDocumentIndex(
        input.projectId,
        input.documentId,
        input.principal.user.id,
        "archived",
        tx,
      );
    } else {
      const [currentVersion] = await tx
        .select({ id: projectDocumentVersion.id })
        .from(projectDocumentVersion)
        .where(
          and(
            eq(projectDocumentVersion.projectId, input.projectId),
            eq(projectDocumentVersion.documentId, input.documentId),
            eq(projectDocumentVersion.isCurrent, true),
            eq(projectDocumentVersion.storageStatus, "stored"),
          ),
        )
        .limit(1);
      if (currentVersion) {
        await activateOrQueueVersionIndex({
          projectId: input.projectId,
          documentId: input.documentId,
          versionId: currentVersion.id,
          actorUserId: input.principal.user.id,
          reason: "restored",
          db: tx,
        });
      }
    }
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: input.archived ? "document_archived" : "document_restored",
        entityType: "project_document",
        entityId: document.id,
        result: "succeeded",
        metadata: { documentId: document.id },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return updated;
    },
  });
}

export async function updateDocumentMetadata(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  displayName?: string;
  visibility?: ProjectDocumentRecord["visibility"];
  requestHeaders: Headers;
}): Promise<ProjectDocumentRecord> {
  const displayName =
    input.displayName === undefined
      ? undefined
      : normalizedDisplayName(input.displayName, "");
  return authorizedDocumentTransaction({
    principal: input.principal,
    projectId: input.projectId,
    allowedRoles:
      input.visibility === undefined ? documentRoles.upload : documentRoles.manage,
    requestHeaders: input.requestHeaders,
    operation: async (tx) => {
      const document = await findProjectDocument(
        input.projectId,
        input.documentId,
        tx,
        { lockForUpdate: true },
      );
      if (!document) {
        throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
      }
      const [updated] = await tx
        .update(projectDocument)
        .set({
          ...(displayName === undefined ? {} : { displayName }),
          ...(input.visibility === undefined
            ? {}
            : { visibility: input.visibility }),
          updatedAt: new Date(),
        })
        .where(eq(projectDocument.id, document.id))
        .returning();
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "document_metadata_changed",
          entityType: "project_document",
          entityId: document.id,
          result: "succeeded",
          metadata: {
            changedFields: [
              ...(displayName === undefined ? [] : ["displayName"]),
              ...(input.visibility === undefined ? [] : ["visibility"]),
            ],
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return updated;
    },
  });
}

export async function getDownloadVersion(input: {
  projectId: string;
  documentId: string;
  versionId: string;
}): Promise<{
  document: ProjectDocumentRecord;
  version: ProjectDocumentVersionRecord;
}> {
  const document = await findProjectDocument(input.projectId, input.documentId);
  if (!document) throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
  const version = await findProjectDocumentVersion(
    input.projectId,
    input.documentId,
    input.versionId,
  );
  if (!version) throw new FileOperationError(404, "VERSION_NOT_FOUND", "文件版本不存在");
  if (version.storageStatus !== "stored") {
    throw new FileOperationError(409, "VERSION_NOT_AVAILABLE", "文件版本暂不可下载");
  }
  return { document, version };
}

export async function getDocumentWithVersions(
  projectId: string,
  documentId: string,
): Promise<{
  document: ProjectDocumentRecord;
  versions: Awaited<ReturnType<typeof listProjectDocumentVersions>>;
}> {
  const document = await findProjectDocument(projectId, documentId);
  if (!document) throw new FileOperationError(404, "DOCUMENT_NOT_FOUND", "资料不存在");
  return {
    document,
    versions: await listProjectDocumentVersions(projectId, documentId),
  };
}
