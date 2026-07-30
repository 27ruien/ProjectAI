import { and, desc, eq, inArray } from "drizzle-orm";
import {
  EMBEDDING_MODEL,
  EMBEDDING_PROFILE_ID,
} from "@/lib/ai/embeddings/config";
import { EMBEDDING_VECTOR_DIMENSIONS } from "@/lib/db/schema/document-embeddings";
import { getDb, type DatabaseExecutor } from "../client";
import {
  documentEmbeddingJob,
  type DocumentEmbeddingJobRecord,
} from "../schema";

export type EmbeddingSummary = {
  status: "pending" | "running" | "succeeded" | "failed" | "unknown";
  profileId: string;
  model: string;
  dimensions: number;
  generatedAt: Date | null;
  failureCode: string | null;
};

function publicStatus(
  status: DocumentEmbeddingJobRecord["status"],
  failureCode: string | null,
): EmbeddingSummary["status"] {
  if (status === "failed" && failureCode === "PROVIDER_RESULT_UNKNOWN") {
    return "unknown";
  }
  return status === "cancelled" ? "failed" : status;
}

export async function latestEmbeddingJobForVersion(
  projectId: string,
  documentId: string,
  versionId: string,
  db: DatabaseExecutor = getDb(),
): Promise<DocumentEmbeddingJobRecord | null> {
  const [record] = await db
    .select()
    .from(documentEmbeddingJob)
    .where(
      and(
        eq(documentEmbeddingJob.projectId, projectId),
        eq(documentEmbeddingJob.documentId, documentId),
        eq(documentEmbeddingJob.versionId, versionId),
        eq(documentEmbeddingJob.embeddingProfileId, EMBEDDING_PROFILE_ID),
      ),
    )
    .orderBy(desc(documentEmbeddingJob.generation))
    .limit(1);
  return record ?? null;
}

export async function embeddingSummariesForVersions(
  versionIds: string[],
  db: DatabaseExecutor = getDb(),
): Promise<Map<string, EmbeddingSummary>> {
  if (!versionIds.length) return new Map();
  const rows = await db
    .select()
    .from(documentEmbeddingJob)
    .where(
      and(
        inArray(documentEmbeddingJob.versionId, versionIds),
        eq(documentEmbeddingJob.embeddingProfileId, EMBEDDING_PROFILE_ID),
      ),
    )
    .orderBy(
      documentEmbeddingJob.versionId,
      desc(documentEmbeddingJob.generation),
    );
  const summaries = new Map<string, EmbeddingSummary>();
  for (const row of rows) {
    if (summaries.has(row.versionId)) continue;
    summaries.set(row.versionId, {
      status: publicStatus(row.status, row.failureCode),
      profileId: row.embeddingProfileId,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_VECTOR_DIMENSIONS,
      generatedAt: row.status === "succeeded" ? row.completedAt : null,
      failureCode: row.failureCode,
    });
  }
  return summaries;
}
