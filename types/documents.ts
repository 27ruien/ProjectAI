export type ProjectDocumentStatus =
  | "pending"
  | "active"
  | "archived"
  | "failed";

export type DocumentStorageStatus =
  | "pending"
  | "stored"
  | "failed"
  | "quarantined"
  | "deleted";

export type PublicDocumentFailureCode =
  | "UPLOAD_FAILED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "INVALID_OFFICE_CONTAINER"
  | "STORAGE_UNAVAILABLE";

export interface DocumentActorDto {
  displayName: string;
}

/**
 * Browser-safe version metadata. Storage identifiers, ETags, checksums,
 * upload IDs and provider configuration deliberately do not belong here.
 */
export interface ProjectDocumentVersionDto {
  id: string;
  documentId: string;
  versionNumber: number;
  isCurrent: boolean;
  originalFilename: string;
  extension: string;
  detectedMimeType: string;
  sizeBytes: number;
  storageStatus: DocumentStorageStatus;
  failureCode: PublicDocumentFailureCode | null;
  uploadedBy: DocumentActorDto;
  createdAt: string;
  storedAt: string | null;
  supersededAt: string | null;
  ingestion: DocumentIngestionDto;
}

export type PublicDocumentIngestionStatus =
  | "not_started"
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "needs_ocr";

export interface DocumentIngestionDto {
  status: PublicDocumentIngestionStatus;
  indexedVersion: number | null;
  generation: number | null;
  parserVersion: string | null;
  chunkerVersion: string | null;
  sectionCount: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  failureCode: string | null;
}

export interface ProjectDocumentPermissionsDto {
  canDownload: boolean;
  canUploadVersion: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canSetCurrent: boolean;
  canReindex: boolean;
}

/** A logical project document with its current, immutable object version. */
export interface ProjectDocumentDto {
  id: string;
  projectId: string;
  knowledgeSpaceId: string;
  visibility: "private" | "organization_shared" | "department_shared" | "restricted";
  displayName: string;
  status: ProjectDocumentStatus;
  createdBy: DocumentActorDto;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  currentVersion: ProjectDocumentVersionDto | null;
  permissions: ProjectDocumentPermissionsDto;
}

export interface DocumentListCountsDto {
  active: number;
  archived: number;
}

export interface DocumentUploadPolicyDto {
  maxBytes: number;
  /** Lower-case extensions without a leading dot. */
  allowedExtensions: string[];
}

export interface DocumentListPermissionsDto {
  canUpload: boolean;
}

export interface ProjectDocumentListResponse {
  documents: ProjectDocumentDto[];
  counts: DocumentListCountsDto;
  uploadPolicy: DocumentUploadPolicyDto;
  permissions: DocumentListPermissionsDto;
}

export interface ProjectDocumentResponse {
  document: ProjectDocumentDto;
}

export interface ProjectDocumentVersionsResponse {
  document?: ProjectDocumentDto;
  versions: ProjectDocumentVersionDto[];
}

export interface ProjectDocumentUploadResponse {
  document: ProjectDocumentDto;
  version: ProjectDocumentVersionDto;
  replayed: boolean;
  uploadStatus: DocumentStorageStatus;
}

export interface ProjectDocumentVersionMutationResponse {
  document: ProjectDocumentDto;
  version: ProjectDocumentVersionDto;
}

export interface ProjectDocumentApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
