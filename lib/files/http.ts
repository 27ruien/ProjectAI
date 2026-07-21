import { authorizationErrorResponse } from "@/lib/auth/http";
import { FileOperationError, fileErrorResponse } from "./errors";
import { maxUploadBytes } from "./config";

export function fileRouteErrorResponse(error: unknown): Response {
  if (error instanceof FileOperationError) return fileErrorResponse(error);
  return authorizationErrorResponse(error);
}

export async function readUploadForm(request: Request): Promise<{
  file: File;
  displayName: string | null;
  knowledgeSpaceId: string | null;
}> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > maxUploadBytes() + 1024 * 1024
  ) {
    throw new FileOperationError(413, "FILE_TOO_LARGE", "文件超过上传大小限制");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new FileOperationError(400, "INVALID_REQUEST", "上传表单无效");
  }
  const file = form.get("file");
  const displayName = form.get("displayName");
  const knowledgeSpaceId = form.get("knowledgeSpaceId");
  if (!(file instanceof File)) {
    throw new FileOperationError(400, "INVALID_REQUEST", "请选择一个文件");
  }
  if (displayName !== null && typeof displayName !== "string") {
    throw new FileOperationError(400, "INVALID_REQUEST", "资料名称无效");
  }
  if (
    knowledgeSpaceId !== null &&
    (typeof knowledgeSpaceId !== "string" ||
      knowledgeSpaceId.length < 1 ||
      knowledgeSpaceId.length > 200)
  ) {
    throw new FileOperationError(400, "INVALID_REQUEST", "知识空间无效");
  }
  return { file, displayName, knowledgeSpaceId };
}

export function idempotencyKeyFrom(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) {
    throw new FileOperationError(400, "INVALID_REQUEST", "缺少 Idempotency-Key");
  }
  return key;
}

export function safeAttachmentDisposition(filename: string): string {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[\r\n"\\/\u0000-\u001f\u007f-\u009f]/g, "_")
    .trim()
    .slice(0, 180);
  const ascii = normalized.replace(/[^\x20-\x7e]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(normalized || "download")}`;
}
