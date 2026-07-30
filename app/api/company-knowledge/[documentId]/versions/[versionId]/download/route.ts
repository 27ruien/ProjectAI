import { requireApiPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse, safeAttachmentDisposition } from "@/lib/files/http";
import { getObjectStorage } from "@/lib/files/object-storage";
import { requireReadableCompanyVersion } from "@/lib/focused-mvp/company-knowledge";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

type Context = { params: Promise<{ documentId: string; versionId: string }> };

function normalizedEtag(value: string | null): string | null {
  return value?.replace(/^"|"$/g, "") ?? null;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { documentId, versionId } = await context.params;
    const { document, version } = await requireReadableCompanyVersion({ principal, documentId, versionId });
    if (version.storageStatus !== "stored") throw new FileOperationError(409, "VERSION_NOT_AVAILABLE", "文件版本暂不可下载");
    const object = await getObjectStorage().getObject(version.objectKey).catch(() => {
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
    });
    if (
      object.size !== version.sizeBytes ||
      object.sha256 !== version.sha256 ||
      normalizedEtag(object.etag) !== normalizedEtag(version.storageEtag)
    ) {
      await object.body.cancel().catch(() => undefined);
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件完整性校验失败");
    }
    await writeAuditEvent({
      actorUserId: principal.user.id,
      projectId: document.projectId,
      eventType: "company_document_downloaded",
      entityType: "project_document_version",
      entityId: version.id,
      result: "succeeded",
      metadata: { documentId, versionId, extension: version.normalizedExtension, sizeBytes: version.sizeBytes },
      ...getRequestAuditContext(request.headers),
    });
    const preview = new URL(request.url).searchParams.get("preview") === "true";
    return new Response(object.body, {
      headers: {
        "content-type": version.detectedMimeType,
        "content-length": String(version.sizeBytes),
        "content-disposition": preview ? "inline" : safeAttachmentDisposition(version.originalFilename),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const knowledgeResponse = knowledgeManagementErrorResponse(error);
    if (knowledgeResponse.status !== 500) return knowledgeResponse;
    return fileRouteErrorResponse(error);
  }
}
