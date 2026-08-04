import { requireApiPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { requireProjectDocumentVersionResource } from "@/lib/files/authorization";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { getObjectStorage } from "@/lib/files/object-storage";

type Context = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

function etag(value: string | null) {
  return value?.replace(/^"|"$/g, "") ?? null;
}
export async function GET(request: Request, context: Context) {
  try {
    const { projectId, documentId, versionId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const { version } = await requireProjectDocumentVersionResource(
      principal,
      projectId,
      documentId,
      versionId,
      request.headers,
      "view",
    );
    if (version.storageStatus !== "stored") {
      throw new FileOperationError(409, "FILE_PREVIEW_NOT_READY", "文件尚未准备好预览");
    }
    const object = await getObjectStorage().getObject(version.objectKey).catch(() => {
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
    });
    if (
      object.size !== version.sizeBytes ||
      object.sha256 !== version.sha256 ||
      etag(object.etag) !== etag(version.storageEtag)
    ) {
      await object.body.cancel().catch(() => undefined);
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件完整性校验失败");
    }
    await writeAuditEvent({
      actorUserId: principal.user.id,
      projectId,
      eventType: "document_previewed",
      entityType: "project_document_version",
      entityId: versionId,
      result: "succeeded",
      metadata: { documentId, versionId, extension: version.normalizedExtension },
      ...getRequestAuditContext(request.headers),
    });
    return new Response(object.body, {
      headers: {
        "content-type": version.detectedMimeType,
        "content-length": String(version.sizeBytes),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
