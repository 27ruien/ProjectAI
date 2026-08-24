import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  projectDocument,
  user,
  type ProjectDocumentContextKind,
  type ProjectRecord,
  type RagflowDocumentParseStatus,
} from "@/lib/db/schema";
import {
  createRagflowClient,
  type RagflowClient,
  type RagflowDocument,
} from "@/lib/ragflow";
import { KnowledgeServiceError } from "./errors";
import { requireReadyDataset } from "./datasets";

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "pptx",
  "txt",
  "md",
  "markdown",
]);
export const MAX_KNOWLEDGE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_KNOWLEDGE_BATCH_FILES = 20;

export type KnowledgeDocumentDto = {
  id: string;
  name: string;
  contextKind: ProjectDocumentContextKind;
  parseStatus: RagflowDocumentParseStatus;
  failureCode: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
};

function extension(filename: string): string {
  return filename.split(".").pop()?.toLocaleLowerCase() ?? "";
}

function validateFile(file: File): void {
  if (!file.name.trim() || file.name.length > 255) {
    throw new KnowledgeServiceError(400, "INVALID_FILE_NAME", "文件名无效");
  }
  if (!ALLOWED_EXTENSIONS.has(extension(file.name))) {
    throw new KnowledgeServiceError(400, "FILE_TYPE_NOT_ALLOWED", "不支持此文件类型");
  }
  if (file.size <= 0 || file.size > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeServiceError(400, "FILE_SIZE_INVALID", "文件大小无效");
  }
}

function remoteStatusById(documents: RagflowDocument[]): Map<string, RagflowDocument> {
  return new Map(documents.map((item) => [item.id, item]));
}

export async function uploadProjectKnowledgeDocuments(input: {
  project: ProjectRecord;
  actorUserId: string;
  files: File[];
  contextKind?: ProjectDocumentContextKind;
  client?: RagflowClient;
}): Promise<KnowledgeDocumentDto[]> {
  if (input.files.length < 1 || input.files.length > MAX_KNOWLEDGE_BATCH_FILES) {
    throw new KnowledgeServiceError(400, "INVALID_FILE_BATCH", "请选择 1 至 20 个文件");
  }
  input.files.forEach(validateFile);
  const datasetId = requireReadyDataset(input.project);
  const client = input.client ?? (await createRagflowClient());
  for (const file of input.files) {
    const bytes = await file.arrayBuffer();
    const remote = await client.uploadDocument({
      datasetId,
      filename: file.name,
      blob: new Blob([bytes], { type: file.type || "application/octet-stream" }),
    });
    let localDocumentId: string | null = null;
    try {
      const [created] = await getDb()
        .insert(projectDocument)
        .values({
          id: `document-${crypto.randomUUID()}`,
          projectId: input.project.id,
          displayName: file.name,
          contextKind: input.contextKind ?? "general",
          status: "active",
          ragflowDocumentId: remote.id,
          ragflowParseStatus: "processing",
          ragflowFailureCode: null,
          mimeType: file.type || null,
          sizeBytes: file.size,
          sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
          createdBy: input.actorUserId,
        })
        .returning({ id: projectDocument.id });
      localDocumentId = created.id;
      try {
        await client.parseDocuments(datasetId, [remote.id]);
        await writeAuditEvent({
          actorUserId: input.actorUserId,
          projectId: input.project.id,
          eventType: "project_knowledge_document_uploaded",
          entityType: "document",
          entityId: created.id,
          result: "succeeded",
          metadata: { sizeBytes: file.size, mimeType: file.type || null },
        });
      } catch (error) {
        await getDb()
          .update(projectDocument)
          .set({
            ragflowParseStatus: "failed",
            ragflowFailureCode: "KNOWLEDGE_PARSE_START_FAILED",
            updatedAt: new Date(),
          })
          .where(eq(projectDocument.id, created.id));
        await writeAuditEvent({
          actorUserId: input.actorUserId,
          projectId: input.project.id,
          eventType: "project_knowledge_document_parse_failed",
          entityType: "document",
          entityId: created.id,
          result: "failed",
          metadata: { failureCode: "KNOWLEDGE_PARSE_START_FAILED" },
        });
        throw error;
      }
    } catch (error) {
      if (!localDocumentId) {
        await client.deleteDocument(datasetId, remote.id).catch(() => undefined);
      }
      throw error;
    }
  }
  return listProjectKnowledgeDocuments({ project: input.project, client });
}

export async function listProjectKnowledgeDocuments(input: {
  project: ProjectRecord;
  client?: RagflowClient;
}): Promise<KnowledgeDocumentDto[]> {
  const datasetId = requireReadyDataset(input.project);
  const client = input.client ?? (await createRagflowClient());
  const localRows = await getDb()
    .select({
      id: projectDocument.id,
      name: projectDocument.displayName,
      contextKind: projectDocument.contextKind,
      ragflowDocumentId: projectDocument.ragflowDocumentId,
      parseStatus: projectDocument.ragflowParseStatus,
      failureCode: projectDocument.ragflowFailureCode,
      mimeType: projectDocument.mimeType,
      sizeBytes: projectDocument.sizeBytes,
      uploadedById: user.id,
      uploadedByName: user.displayName,
      createdAt: projectDocument.createdAt,
      updatedAt: projectDocument.updatedAt,
    })
    .from(projectDocument)
    .innerJoin(user, eq(user.id, projectDocument.createdBy))
    .where(and(
      eq(projectDocument.projectId, input.project.id),
      eq(projectDocument.status, "active"),
      isNotNull(projectDocument.ragflowDocumentId),
    ))
    .orderBy(desc(projectDocument.createdAt));
  const remote = remoteStatusById(await client.listDocuments(datasetId));
  for (const row of localRows) {
    const remoteDocument = row.ragflowDocumentId
      ? remote.get(row.ragflowDocumentId)
      : undefined;
    const nextStatus = remoteDocument?.parseStatus ?? "failed";
    if (row.parseStatus !== nextStatus) {
      await getDb()
        .update(projectDocument)
        .set({
          ragflowParseStatus: nextStatus,
          ragflowFailureCode: nextStatus === "failed" ? "KNOWLEDGE_DOCUMENT_UNAVAILABLE" : null,
          updatedAt: new Date(),
        })
        .where(eq(projectDocument.id, row.id));
      row.parseStatus = nextStatus;
      row.failureCode = nextStatus === "failed" ? "KNOWLEDGE_DOCUMENT_UNAVAILABLE" : null;
      row.updatedAt = new Date();
    }
  }
  return localRows.map((row) => ({
    id: row.id,
    name: row.name,
    contextKind: row.contextKind,
    parseStatus: row.parseStatus ?? "failed",
    failureCode: row.failureCode,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: { id: row.uploadedById, displayName: row.uploadedByName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function deleteProjectKnowledgeDocument(input: {
  project: ProjectRecord;
  documentId: string;
  actorUserId: string;
  client?: RagflowClient;
}): Promise<void> {
  const datasetId = requireReadyDataset(input.project);
  const [record] = await getDb()
    .select({ ragflowDocumentId: projectDocument.ragflowDocumentId })
    .from(projectDocument)
    .where(and(
      eq(projectDocument.id, input.documentId),
      eq(projectDocument.projectId, input.project.id),
      eq(projectDocument.status, "active"),
      isNotNull(projectDocument.ragflowDocumentId),
    ))
    .limit(1);
  if (!record?.ragflowDocumentId) throw new KnowledgeServiceError(404, "NOT_FOUND", "文件不存在");
  const client = input.client ?? (await createRagflowClient());
  await client.deleteDocument(datasetId, record.ragflowDocumentId);
  await getDb()
    .delete(projectDocument)
    .where(and(eq(projectDocument.id, input.documentId), eq(projectDocument.projectId, input.project.id)));
  await writeAuditEvent({
    actorUserId: input.actorUserId,
    projectId: input.project.id,
    eventType: "project_knowledge_document_deleted",
    entityType: "document",
    entityId: input.documentId,
    result: "succeeded",
  });
}

export async function retryProjectKnowledgeDocument(input: {
  project: ProjectRecord;
  documentId: string;
  actorUserId: string;
  client?: RagflowClient;
}): Promise<void> {
  const datasetId = requireReadyDataset(input.project);
  const [record] = await getDb()
    .select({ ragflowDocumentId: projectDocument.ragflowDocumentId })
    .from(projectDocument)
    .where(and(
      eq(projectDocument.id, input.documentId),
      eq(projectDocument.projectId, input.project.id),
      eq(projectDocument.status, "active"),
      isNotNull(projectDocument.ragflowDocumentId),
    ))
    .limit(1);
  if (!record?.ragflowDocumentId) throw new KnowledgeServiceError(404, "NOT_FOUND", "文件不存在");
  const client = input.client ?? (await createRagflowClient());
  await client.parseDocuments(datasetId, [record.ragflowDocumentId]);
  await getDb()
    .update(projectDocument)
    .set({ ragflowParseStatus: "processing", ragflowFailureCode: null, updatedAt: new Date() })
    .where(eq(projectDocument.id, input.documentId));
  await writeAuditEvent({
    actorUserId: input.actorUserId,
    projectId: input.project.id,
    eventType: "project_knowledge_document_parse_retried",
    entityType: "document",
    entityId: input.documentId,
    result: "succeeded",
  });
}

export async function ragflowDocumentsForProjects(
  projectIds: string[],
): Promise<Map<string, Map<string, string>>> {
  if (projectIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      projectId: projectDocument.projectId,
      ragflowDocumentId: projectDocument.ragflowDocumentId,
      displayName: projectDocument.displayName,
    })
    .from(projectDocument)
    .where(and(
      inArray(projectDocument.projectId, projectIds),
      eq(projectDocument.status, "active"),
      eq(projectDocument.ragflowParseStatus, "ready"),
      isNotNull(projectDocument.ragflowDocumentId),
    ));
  const result = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.ragflowDocumentId) continue;
    const documents = result.get(row.projectId) ?? new Map<string, string>();
    documents.set(row.ragflowDocumentId, row.displayName);
    result.set(row.projectId, documents);
  }
  return result;
}
