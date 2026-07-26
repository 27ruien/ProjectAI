import type { SourceLocator } from "@/lib/documents/processing/source-locator";

export type KnowledgeChunkManagementDto = {
  id: string;
  documentId: string;
  versionId: string;
  sectionId: string;
  chunkIndex: number;
  chunkType: string;
  content: string;
  parentContent: string | null;
  headingPath: string[];
  source: SourceLocator;
  estimatedTokenCount: number;
  parseQualityBps: number;
  keywords: string[];
  summary: string | null;
  embeddingStatus: string;
  isEffective: boolean;
  contentSha256: string;
};

export type KnowledgeChunkListResponse = {
  chunks: KnowledgeChunkManagementDto[];
  currentVersionId: string;
  parserVersion: string;
  chunkerVersion: string;
};

export type KnowledgeChunkMutationResponse = {
  chunk: Pick<
    KnowledgeChunkManagementDto,
    "id" | "isEffective" | "embeddingStatus" | "contentSha256"
  >;
  embeddingJob: { id: string; status: string } | null;
};
