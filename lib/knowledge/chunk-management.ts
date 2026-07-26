import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ensureEmbeddingJob } from "@/lib/ai/embeddings/jobs";
import { requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { findAuthorizedDocument } from "@/lib/knowledge/authorization";
import {
  documentChunk,
  documentChunkEmbedding,
  documentIngestionJob,
  projectDocument,
  projectDocumentVersion,
} from "@/lib/db/schema";
import { validateSourceLocator } from "@/lib/documents/processing/source-locator";
import type {
  KnowledgeChunkListResponse,
  KnowledgeChunkManagementDto,
  KnowledgeChunkMutationResponse,
} from "@/types/knowledge-chunks";

const mutationSchema = z
  .object({
    action: z.enum(["disable", "enable", "regenerate_embedding"]),
    expectedContentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export class KnowledgeChunkManagementError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    public readonly code:
      | "INVALID_CHUNK_REQUEST"
      | "DOCUMENT_NOT_FOUND"
      | "CHUNK_NOT_FOUND"
      | "CHUNK_VERSION_CONFLICT"
      | "CHUNK_NOT_CURRENT",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeChunkManagementError";
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 24)
    : [];
}

export async function listManagedKnowledgeChunks(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  requestHeaders: Headers;
}): Promise<KnowledgeChunkListResponse> {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  const authorized = await findAuthorizedDocument({
    principal: input.principal,
    projectId: input.projectId,
    documentId: input.documentId,
    permission: "view",
  });
  if (
    !authorized ||
    authorized.scope.sourceProjectId !== input.projectId ||
    authorized.document.status !== "active"
  ) {
    throw new KnowledgeChunkManagementError(
      404,
      "DOCUMENT_NOT_FOUND",
      "资料不存在",
    );
  }
  const [current] = await getDb()
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
  if (!current) {
    throw new KnowledgeChunkManagementError(
      409,
      "CHUNK_NOT_CURRENT",
      "当前文件版本尚不可管理分块",
    );
  }
  const rows = await getDb()
    .select({
      chunk: documentChunk,
      parserVersion: documentIngestionJob.parserVersion,
      chunkerVersion: documentIngestionJob.chunkerVersion,
    })
    .from(documentChunk)
    .innerJoin(
      documentIngestionJob,
      and(
        eq(documentIngestionJob.id, documentChunk.ingestionJobId),
        eq(documentIngestionJob.projectId, documentChunk.projectId),
        eq(documentIngestionJob.status, "succeeded"),
      ),
    )
    .where(
      and(
        eq(documentChunk.projectId, input.projectId),
        eq(documentChunk.documentId, input.documentId),
        eq(documentChunk.versionId, current.id),
      ),
    )
    .orderBy(asc(documentChunk.chunkIndex))
    .limit(500);
  const chunks: KnowledgeChunkManagementDto[] = rows.map(({ chunk }) => ({
    id: chunk.id,
    documentId: chunk.documentId,
    versionId: chunk.versionId,
    sectionId: chunk.sectionId,
    chunkIndex: chunk.chunkIndex,
    chunkType: chunk.chunkType,
    content: chunk.content.slice(0, 4_000),
    parentContent: chunk.parentContent?.slice(0, 4_000) ?? null,
    headingPath: stringArray(chunk.headingPath),
    source: validateSourceLocator(chunk.sourceLocator),
    estimatedTokenCount: chunk.estimatedTokenCount,
    parseQualityBps: chunk.parseQualityBps,
    keywords: stringArray(chunk.keywords),
    summary: chunk.summary?.slice(0, 500) ?? null,
    embeddingStatus: chunk.embeddingStatus,
    isEffective: chunk.isEffective,
    contentSha256: chunk.contentSha256,
  }));
  return {
    chunks,
    currentVersionId: current.id,
    parserVersion: rows[0]?.parserVersion ?? "unknown",
    chunkerVersion: rows[0]?.chunkerVersion ?? "unknown",
  };
}

export async function mutateManagedKnowledgeChunk(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  chunkId: string;
  requestHeaders: Headers;
  body: unknown;
}): Promise<KnowledgeChunkMutationResponse> {
  const parsed = mutationSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new KnowledgeChunkManagementError(
      400,
      "INVALID_CHUNK_REQUEST",
      "分块操作请求无效",
    );
  }
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const authorized = await findAuthorizedDocument({
      principal: input.principal,
      projectId: input.projectId,
      documentId: input.documentId,
      permission: "manage_versions",
      db: tx,
    });
    if (!authorized || authorized.scope.sourceProjectId !== input.projectId) {
      throw new KnowledgeChunkManagementError(
        404,
        "DOCUMENT_NOT_FOUND",
        "资料不存在",
      );
    }
    const [chunk] = await tx
      .select()
      .from(documentChunk)
      .where(
        and(
          eq(documentChunk.id, input.chunkId),
          eq(documentChunk.projectId, input.projectId),
          eq(documentChunk.documentId, input.documentId),
        ),
      )
      .for("update", { of: documentChunk })
      .limit(1);
    if (!chunk) {
      throw new KnowledgeChunkManagementError(
        404,
        "CHUNK_NOT_FOUND",
        "分块不存在",
      );
    }
    if (chunk.contentSha256 !== parsed.data.expectedContentSha256) {
      throw new KnowledgeChunkManagementError(
        409,
        "CHUNK_VERSION_CONFLICT",
        "分块已发生变化，请刷新后重试",
      );
    }
    const [current] = await tx
      .select({
        id: projectDocumentVersion.id,
        documentStatus: projectDocument.status,
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
          eq(projectDocumentVersion.id, chunk.versionId),
          eq(projectDocumentVersion.projectId, input.projectId),
          eq(projectDocumentVersion.documentId, input.documentId),
          eq(projectDocumentVersion.isCurrent, true),
          eq(projectDocumentVersion.storageStatus, "stored"),
          eq(projectDocument.status, "active"),
        ),
      )
      .for("update", { of: projectDocumentVersion })
      .limit(1);
    if (!current) {
      throw new KnowledgeChunkManagementError(
        409,
        "CHUNK_NOT_CURRENT",
        "只允许管理当前有效版本的分块",
      );
    }

    const disabling = parsed.data.action === "disable";
    if (disabling) {
      await tx
        .update(documentChunk)
        .set({
          isEffective: false,
          embeddingStatus: "disabled",
        })
        .where(eq(documentChunk.id, chunk.id));
    } else {
      await tx
        .update(documentChunk)
        .set({
          isEffective: true,
          embeddingStatus: "pending",
        })
        .where(eq(documentChunk.id, chunk.id));
    }
    await tx
      .update(documentChunkEmbedding)
      .set({ status: "invalid", updatedAt: sql`now()` })
      .where(
        and(
          eq(documentChunkEmbedding.chunkId, chunk.id),
          eq(documentChunkEmbedding.projectId, input.projectId),
          eq(documentChunkEmbedding.documentId, input.documentId),
        ),
      );

    let embeddingJob = null;
    if (!disabling) {
      embeddingJob = await ensureEmbeddingJob({
        projectId: input.projectId,
        documentId: input.documentId,
        versionId: chunk.versionId,
        createdBy: input.principal.user.id,
        reason: "manual_regeneration",
        db: tx,
      });
      if (!embeddingJob) {
        await tx
          .update(documentChunk)
          .set({ embeddingStatus: "disabled" })
          .where(eq(documentChunk.id, chunk.id));
      }
    }

    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: `knowledge_chunk_${parsed.data.action}`,
        entityType: "document_chunk",
        entityId: chunk.id,
        result: "succeeded",
        metadata: {
          documentId: input.documentId,
          versionId: chunk.versionId,
          contentSha256: chunk.contentSha256,
          embeddingJobId: embeddingJob?.id ?? null,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    const [updated] = await tx
      .select({
        id: documentChunk.id,
        isEffective: documentChunk.isEffective,
        embeddingStatus: documentChunk.embeddingStatus,
        contentSha256: documentChunk.contentSha256,
      })
      .from(documentChunk)
      .where(eq(documentChunk.id, chunk.id))
      .limit(1);
    return {
      chunk: updated!,
      embeddingJob: embeddingJob
        ? { id: embeddingJob.id, status: embeddingJob.status }
        : null,
    };
  });
}
