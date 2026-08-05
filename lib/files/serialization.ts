import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import type {
  DocumentVersionWithUploader,
  DocumentWithCurrentVersion,
} from "@/lib/db/repositories/document-repository";
import { findUserById } from "@/lib/db/repositories/user-repository";
import {
  ingestionSummariesForVersions,
  type IngestionSummary,
} from "@/lib/db/repositories/ingestion-repository";
import {
  embeddingSummariesForVersions,
  type EmbeddingSummary,
} from "@/lib/db/repositories/embedding-repository";
import type {
  ProjectDocumentRecord,
  ProjectDocumentVersionRecord,
  ProjectRole,
} from "@/lib/db/schema";
import type {
  ProjectDocumentDto,
  ProjectDocumentPermissionsDto,
  ProjectDocumentVersionDto,
} from "@/types/documents";
import { isAiReadableExtension } from "./config";

type VersionWithOptionalUploader = ProjectDocumentVersionRecord & {
  uploaderDisplayName?: string;
};

const PUBLIC_FAILURE_CODES = new Set([
  "UPLOAD_FAILED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_SIGNATURE_MISMATCH",
  "INVALID_OFFICE_CONTAINER",
  "STORAGE_UNAVAILABLE",
]);

/**
 * Keep the browser route boundary expressed as an eligibility policy rather
 * than letting route handlers inspect vectorization metadata directly.
 */
export function isCurrentDocumentAiReady(
  document: ProjectDocumentDto,
): boolean {
  return document.currentVersion?.embedding.status === "succeeded";
}

export function serializeDocumentVersion(
  version: VersionWithOptionalUploader,
  fallbackUploaderDisplayName = "项目成员",
  ingestion?: IngestionSummary,
  embedding?: EmbeddingSummary,
): ProjectDocumentVersionDto {
  const failureCode =
    version.failureCode && PUBLIC_FAILURE_CODES.has(version.failureCode)
      ? (version.failureCode as ProjectDocumentVersionDto["failureCode"])
      : version.failureCode
        ? "UPLOAD_FAILED"
        : null;
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    isCurrent: version.isCurrent,
    originalFilename: version.originalFilename,
    versionNote: version.versionNote,
    extension: version.normalizedExtension,
    aiReadable: isAiReadableExtension(version.normalizedExtension),
    detectedMimeType: version.detectedMimeType,
    sizeBytes: version.sizeBytes,
    storageStatus: version.storageStatus,
    failureCode,
    uploadedBy: {
      displayName: version.uploaderDisplayName ?? fallbackUploaderDisplayName,
    },
    createdAt: version.createdAt.toISOString(),
    storedAt: version.storedAt?.toISOString() ?? null,
    supersededAt: version.supersededAt?.toISOString() ?? null,
    ingestion: {
      status: ingestion?.status ?? "not_started",
      indexedVersion:
        ingestion?.status === "succeeded" ? version.versionNumber : null,
      generation: ingestion?.generation ?? null,
      parserVersion: ingestion?.parserVersion ?? null,
      chunkerVersion: ingestion?.chunkerVersion ?? null,
      sectionCount: ingestion?.sectionCount ?? 0,
      chunkCount: ingestion?.chunkCount ?? 0,
      lastIndexedAt: ingestion?.lastIndexedAt?.toISOString() ?? null,
      failureCode: ingestion?.failureCode ?? null,
    },
    embedding: {
      status: embedding?.status ?? "not_started",
      profileId: embedding?.profileId ?? null,
      model: embedding?.model ?? null,
      dimensions: embedding?.dimensions ?? null,
      generatedAt: embedding?.generatedAt?.toISOString() ?? null,
      failureCode: embedding?.failureCode ?? null,
    },
  };
}

export async function serializeDocumentVersions(
  versions: VersionWithOptionalUploader[],
  fallbackUploaderDisplayName = "项目成员",
): Promise<ProjectDocumentVersionDto[]> {
  const summaries = await ingestionSummariesForVersions(
    versions.map((version) => version.id),
  );
  const embeddingSummaries = await embeddingSummariesForVersions(
    versions.map((version) => version.id),
  );
  return versions.map((version) =>
    serializeDocumentVersion(
      version,
      fallbackUploaderDisplayName,
      summaries.get(version.id),
      embeddingSummaries.get(version.id),
    ),
  );
}

export function documentPermissions(
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
  status: ProjectDocumentRecord["status"],
  authorized?: {
    download: boolean;
    manageVersions: boolean;
    archive: boolean;
    managePermissions?: boolean;
  },
): ProjectDocumentPermissionsDto {
  const admin = principal.user.productRole !== "member";
  const writer = admin || projectRole === "project_manager" || projectRole === "project_member";
  const manager = admin || projectRole === "project_manager";
  return {
    canDownload: authorized?.download ?? true,
    canUploadVersion:
      (authorized?.manageVersions ?? writer) && status === "active",
    canDelete: manager,
    canArchive: (authorized?.archive ?? manager) && status === "active",
    canRestore: (authorized?.archive ?? manager) && status === "archived",
    canSetCurrent:
      (authorized?.manageVersions ?? manager) && status === "active",
    canReindex: (authorized?.manageVersions ?? manager) && status === "active",
    canManagePermissions: authorized?.managePermissions ?? manager,
  };
}

export async function serializeProjectDocument(
  document: ProjectDocumentRecord,
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
  currentVersion: VersionWithOptionalUploader | null = null,
  authorizedPermissions?: {
    download: boolean;
    manageVersions: boolean;
    archive: boolean;
    managePermissions?: boolean;
  },
): Promise<ProjectDocumentDto> {
  const creator = await findUserById(document.createdBy);
  const ingestion = currentVersion
    ? (await ingestionSummariesForVersions([currentVersion.id])).get(
        currentVersion.id,
      )
    : undefined;
  const embedding = currentVersion
    ? (await embeddingSummariesForVersions([currentVersion.id])).get(
        currentVersion.id,
      )
    : undefined;
  return {
    id: document.id,
    projectId: document.projectId,
    knowledgeSpaceId: document.knowledgeSpaceId,
    folderId: document.folderId,
    visibility: document.visibility,
    displayName: document.displayName,
    workflowTemporary: document.workflowTemporary,
    temporaryExpiresAt: document.temporaryExpiresAt?.toISOString() ?? null,
    status: document.status,
    createdBy: { displayName: creator?.displayName ?? "项目成员" },
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    archivedAt: document.archivedAt?.toISOString() ?? null,
    currentVersion: currentVersion
      ? serializeDocumentVersion(
          currentVersion,
          "项目成员",
          ingestion,
          embedding,
        )
      : null,
    permissions: documentPermissions(
      principal,
      projectRole,
      document.status,
      authorizedPermissions,
    ),
  };
}

export async function serializeDocumentList(
  documents: DocumentWithCurrentVersion[],
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
  authorizedPermissions?: Map<
    string,
    {
      download: boolean;
      manageVersions: boolean;
      archive: boolean;
      managePermissions?: boolean;
    }
  >,
): Promise<ProjectDocumentDto[]> {
  const summaries = await ingestionSummariesForVersions(
    documents
      .map((document) => document.currentVersion?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const embeddingSummaries = await embeddingSummariesForVersions(
    documents
      .map((document) => document.currentVersion?.id)
      .filter((id): id is string => Boolean(id)),
  );
  return Promise.all(
    documents.map(async (document) => {
      const creator = await findUserById(document.createdBy);
      const currentVersion =
        document.currentVersion as DocumentVersionWithUploader | null;
      return {
        id: document.id,
        projectId: document.projectId,
        knowledgeSpaceId: document.knowledgeSpaceId,
        folderId: document.folderId,
        visibility: document.visibility,
        displayName: document.displayName,
        workflowTemporary: document.workflowTemporary,
        temporaryExpiresAt: document.temporaryExpiresAt?.toISOString() ?? null,
        status: document.status,
        createdBy: { displayName: creator?.displayName ?? "项目成员" },
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        archivedAt: document.archivedAt?.toISOString() ?? null,
        currentVersion: currentVersion
          ? serializeDocumentVersion(
              currentVersion,
              "项目成员",
              summaries.get(currentVersion.id),
              embeddingSummaries.get(currentVersion.id),
            )
          : null,
        permissions: documentPermissions(
          principal,
          projectRole,
          document.status,
          authorizedPermissions?.get(document.id),
        ),
      };
    }),
  );
}
