import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import type {
  DocumentVersionWithUploader,
  DocumentWithCurrentVersion,
} from "@/lib/db/repositories/document-repository";
import { findUserById } from "@/lib/db/repositories/user-repository";
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

export function serializeDocumentVersion(
  version: VersionWithOptionalUploader,
  fallbackUploaderDisplayName = "项目成员",
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
    extension: version.normalizedExtension,
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
  };
}

export function documentPermissions(
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
  status: ProjectDocumentRecord["status"],
): ProjectDocumentPermissionsDto {
  const admin = principal.user.systemRole === "system_admin";
  const writer = admin || projectRole === "project_manager" || projectRole === "project_member";
  const manager = admin || projectRole === "project_manager";
  return {
    canDownload: true,
    canUploadVersion: writer && status === "active",
    canArchive: manager && status === "active",
    canRestore: manager && status === "archived",
    canSetCurrent: manager && status === "active",
  };
}

export async function serializeProjectDocument(
  document: ProjectDocumentRecord,
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
  currentVersion: VersionWithOptionalUploader | null = null,
): Promise<ProjectDocumentDto> {
  const creator = await findUserById(document.createdBy);
  return {
    id: document.id,
    projectId: document.projectId,
    displayName: document.displayName,
    status: document.status,
    createdBy: { displayName: creator?.displayName ?? "项目成员" },
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    archivedAt: document.archivedAt?.toISOString() ?? null,
    currentVersion: currentVersion
      ? serializeDocumentVersion(currentVersion)
      : null,
    permissions: documentPermissions(principal, projectRole, document.status),
  };
}

export async function serializeDocumentList(
  documents: DocumentWithCurrentVersion[],
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
): Promise<ProjectDocumentDto[]> {
  return Promise.all(
    documents.map((document) =>
      serializeProjectDocument(
        document,
        principal,
        projectRole,
        document.currentVersion as DocumentVersionWithUploader | null,
      ),
    ),
  );
}
