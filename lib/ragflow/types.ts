export type RagflowDataset = {
  id: string;
  name: string;
  documentCount: number;
};

export type RagflowDocumentParseStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

export type RagflowDocument = {
  id: string;
  datasetId: string;
  name: string;
  size: number | null;
  run: string;
  parseStatus: RagflowDocumentParseStatus;
  progress: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type RagflowEvidence = {
  id: string;
  datasetId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number | null;
};

export type RagflowRetrievalResult = {
  evidence: RagflowEvidence[];
  total: number;
  latencyMs: number;
};
