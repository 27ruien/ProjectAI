import type { SourceLocator } from "@/lib/documents/processing/source-locator";

export type KnowledgeSearchResultDto = {
  chunkId: string;
  documentId: string;
  versionId: string;
  displayName: string;
  versionNumber: number;
  mimeType: string;
  excerpt: string;
  headingPath: string[];
  source: SourceLocator;
  score: number;
};

export type KnowledgeSearchResponse = {
  query: string;
  results: KnowledgeSearchResultDto[];
  resultCount: number;
};

export type KnowledgeSearchRequest = {
  query: string;
  documentIds?: string[];
  limit?: number;
};
