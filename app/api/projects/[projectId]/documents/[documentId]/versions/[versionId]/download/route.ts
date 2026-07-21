import { requireProjectAccess } from "@/lib/auth/authorization";
import { requireApiPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { requireProjectDocumentVersionResource } from "@/lib/files/authorization";
import { FileOperationError } from "@/lib/files/errors";
import {
  fileRouteErrorResponse,
  safeAttachmentDisposition,
} from "@/lib/files/http";
import { getObjectStorage } from "@/lib/files/object-storage";

type DownloadRouteContext = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

function normalizedEtag(value: string | null): string | null {
  return value?.replace(/^"|"$/g, "") ?? null;
}

export async function GET(
  request: Request,
  context: DownloadRouteContext,
): Promise<Response> {
  try {
    const { projectId, documentId, versionId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const { version } = await requireProjectDocumentVersionResource(
      principal,
      projectId,
      documentId,
      versionId,
      request.headers,
      "download",
    );
    if (version.storageStatus !== "stored") {
      throw new FileOperationError(
        409,
        "VERSION_NOT_AVAILABLE",
        "文件版本暂不可下载",
      );
    }

    let object: Awaited<ReturnType<ReturnType<typeof getObjectStorage>["getObject"]>>;
    try {
      object = await getObjectStorage().getObject(version.objectKey);
    } catch {
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
    }
    if (
      object.size !== version.sizeBytes ||
      object.sha256 !== version.sha256 ||
      normalizedEtag(object.etag) !== normalizedEtag(version.storageEtag)
    ) {
      await object.body.cancel().catch(() => undefined);
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件完整性校验失败");
    }

    try {
      await writeAuditEvent({
        actorUserId: principal.user.id,
        projectId,
        eventType: "document_downloaded",
        entityType: "project_document_version",
        entityId: version.id,
        result: "succeeded",
        metadata: {
          documentId,
          versionId,
          extension: version.normalizedExtension,
          sizeBytes: version.sizeBytes,
          sha256: version.sha256,
        },
        ...getRequestAuditContext(request.headers),
      });
    } catch (error) {
      await object.body.cancel().catch(() => undefined);
      throw error;
    }

    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": version.detectedMimeType,
        "content-length": String(version.sizeBytes),
        "content-disposition": safeAttachmentDisposition(
          version.originalFilename,
        ),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
