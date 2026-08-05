import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { requireProjectDocumentVersionResource } from "@/lib/files/authorization";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { getObjectStorage } from "@/lib/files/object-storage";
import { decodeTextPreview } from "@/lib/files/text-preview";

type Context = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

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
    if (!new Set(["md", "markdown", "txt"]).has(version.normalizedExtension)) {
      throw new FileOperationError(415, "FILE_PREVIEW_UNSUPPORTED", "该格式不能使用文本预览");
    }
    if (version.sizeBytes > 8 * 1024 * 1024) {
      throw new FileOperationError(413, "FILE_PREVIEW_TOO_LARGE", "文本文件过大，请下载后查看");
    }
    const object = await getObjectStorage().getObject(version.objectKey).catch(() => {
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件存储服务暂不可用");
    });
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (bytes.byteLength !== version.sizeBytes || object.sha256 !== version.sha256) {
      throw new FileOperationError(503, "STORAGE_UNAVAILABLE", "文件完整性校验失败");
    }
    return jsonResponse({
      ...decodeTextPreview(bytes),
      parserVersion: "user-preview-v1",
      previewGeneratedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
