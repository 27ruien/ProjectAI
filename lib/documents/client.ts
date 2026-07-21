"use client";

import { withBasePath } from "@/lib/base-path";
import type {
  ProjectDocumentApiErrorBody,
  ProjectDocumentListResponse,
  ProjectDocumentResponse,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionMutationResponse,
  ProjectDocumentVersionsResponse,
} from "@/types/documents";

export class DocumentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DocumentApiError";
  }
}

function resourcePath(projectId: string, suffix = ""): string {
  const encodedProjectId = encodeURIComponent(projectId);
  return withBasePath(`/api/projects/${encodedProjectId}/documents${suffix}`);
}

function documentPath(
  projectId: string,
  documentId: string,
  suffix = "",
): string {
  return resourcePath(
    projectId,
    `/${encodeURIComponent(documentId)}${suffix}`,
  );
}

async function errorFromResponse(response: Response): Promise<DocumentApiError> {
  let body: ProjectDocumentApiErrorBody | null = null;
  try {
    body = (await response.json()) as ProjectDocumentApiErrorBody;
  } catch {
    // The UI never exposes an upstream or database response body.
  }
  const code = body?.error?.code || `HTTP_${response.status}`;
  return new DocumentApiError(
    response.status,
    code,
    body?.error?.message || "项目资料操作失败",
  );
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as T;
}

function jsonMutation<T>(url: string, method: "POST" | "PATCH", body: unknown) {
  return jsonRequest<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function listProjectDocuments(
  projectId: string,
  status: "active" | "archived",
  signal?: AbortSignal,
): Promise<ProjectDocumentListResponse> {
  const query = new URLSearchParams({ status });
  return jsonRequest<ProjectDocumentListResponse>(
    `${resourcePath(projectId)}?${query.toString()}`,
    { signal },
  );
}

export function getProjectDocument(
  projectId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentResponse> {
  return jsonRequest<ProjectDocumentResponse>(
    documentPath(projectId, documentId),
    { signal },
  );
}

export function renameProjectDocument(
  projectId: string,
  documentId: string,
  displayName: string,
): Promise<ProjectDocumentResponse> {
  return jsonMutation<ProjectDocumentResponse>(
    documentPath(projectId, documentId),
    "PATCH",
    { displayName },
  );
}

export function setProjectDocumentVisibility(
  projectId: string,
  documentId: string,
  visibility: ProjectDocumentResponse["document"]["visibility"],
): Promise<ProjectDocumentResponse> {
  return jsonMutation<ProjectDocumentResponse>(
    documentPath(projectId, documentId),
    "PATCH",
    { visibility },
  );
}

export function listProjectDocumentVersions(
  projectId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentVersionsResponse> {
  return jsonRequest<ProjectDocumentVersionsResponse>(
    documentPath(projectId, documentId, "/versions"),
    { signal },
  );
}

export function archiveProjectDocument(
  projectId: string,
  documentId: string,
): Promise<ProjectDocumentResponse> {
  return jsonMutation<ProjectDocumentResponse>(
    documentPath(projectId, documentId, "/archive"),
    "POST",
    {},
  );
}

export function restoreProjectDocument(
  projectId: string,
  documentId: string,
): Promise<ProjectDocumentResponse> {
  return jsonMutation<ProjectDocumentResponse>(
    documentPath(projectId, documentId, "/restore"),
    "POST",
    {},
  );
}

export function setCurrentProjectDocumentVersion(
  projectId: string,
  documentId: string,
  versionId: string,
): Promise<ProjectDocumentVersionMutationResponse> {
  return jsonMutation<ProjectDocumentVersionMutationResponse>(
    documentPath(
      projectId,
      documentId,
      `/versions/${encodeURIComponent(versionId)}/current`,
    ),
    "POST",
    {},
  );
}

export function reindexProjectDocumentVersion(
  projectId: string,
  documentId: string,
  versionId: string,
): Promise<{
  ingestion: {
    status: string;
    generation: number;
    parserVersion: string;
    chunkerVersion: string;
  };
}> {
  return jsonMutation(
    documentPath(
      projectId,
      documentId,
      `/versions/${encodeURIComponent(versionId)}/reindex`,
    ),
    "POST",
    {},
  );
}

export type DocumentUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type UploadProjectDocumentInput = {
  projectId: string;
  documentId?: string;
  file: File;
  displayName?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: DocumentUploadProgress) => void;
};

function xhrResponseError(xhr: XMLHttpRequest): DocumentApiError {
  let body: ProjectDocumentApiErrorBody | null = null;
  try {
    body = JSON.parse(xhr.responseText) as ProjectDocumentApiErrorBody;
  } catch {
    // Never surface a raw reverse-proxy or object-storage response.
  }
  return new DocumentApiError(
    xhr.status || 0,
    body?.error?.code || (xhr.status ? `HTTP_${xhr.status}` : "UPLOAD_FAILED"),
    body?.error?.message || "文件上传失败",
  );
}

export function uploadProjectDocument(
  input: UploadProjectDocumentInput,
): Promise<ProjectDocumentUploadResponse> {
  return new Promise((resolve, reject) => {
    const suffix = input.documentId
      ? `/${encodeURIComponent(input.documentId)}/versions`
      : "";
    const xhr = new XMLHttpRequest();
    xhr.open("POST", resourcePath(input.projectId, suffix));
    xhr.responseType = "text";
    xhr.timeout = 180_000;
    xhr.withCredentials = true;
    xhr.setRequestHeader("Idempotency-Key", input.idempotencyKey);

    const abort = () => xhr.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => input.signal?.removeEventListener("abort", abort);

    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : input.file.size;
      input.onProgress?.({
        loaded: event.loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0,
      });
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(xhrResponseError(xhr));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as ProjectDocumentUploadResponse);
      } catch {
        reject(new DocumentApiError(xhr.status, "INVALID_RESPONSE", "上传结果无效"));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new DocumentApiError(0, "UPLOAD_FAILED", "网络连接中断，文件上传失败"));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new DocumentApiError(0, "UPLOAD_FAILED", "文件上传超时，请重试"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DocumentApiError(0, "UPLOAD_ABORTED", "文件上传已取消"));
    };

    const form = new FormData();
    form.set("file", input.file, input.file.name);
    if (input.displayName?.trim()) form.set("displayName", input.displayName.trim());
    xhr.send(form);
  });
}

function safeDownloadFilename(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .trim();
  return normalized.slice(0, 255) || "project-document";
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return safeDownloadFilename(decodeURIComponent(encoded));
    } catch {
      // Use the already-sanitized DTO name when the header is malformed.
    }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  return safeDownloadFilename(quoted || fallback);
}

export async function downloadProjectDocumentVersion(
  projectId: string,
  documentId: string,
  versionId: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(
    documentPath(
      projectId,
      documentId,
      `/versions/${encodeURIComponent(versionId)}/download`,
    ),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) throw await errorFromResponse(response);

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = responseFilename(response, fallbackFilename);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function documentErrorMessage(error: unknown): string {
  if (!(error instanceof DocumentApiError)) {
    return "项目资料操作失败，请稍后重试。";
  }
  const messages: Record<string, string> = {
    FILE_TOO_LARGE: "文件为空或超过上传大小限制。",
    UNSUPPORTED_FILE_TYPE: "不支持此文件类型，请选择允许的格式。",
    FILE_SIGNATURE_MISMATCH: "文件内容与扩展名不匹配，请选择正确的文件。",
    INVALID_OFFICE_CONTAINER: "Office 文件结构无效，请重新导出后上传。",
    UPLOAD_ALREADY_EXISTS: "该上传标识已用于其他文件，请重新选择文件后重试。",
    UPLOAD_FAILED: "上传未完成，请检查网络后重试。",
    UPLOAD_ABORTED: "上传已取消。",
    DOCUMENT_NOT_FOUND: "资料不存在或你无权访问。",
    VERSION_NOT_FOUND: "文件版本不存在或你无权访问。",
    VERSION_NOT_AVAILABLE: "该文件版本当前不可下载。",
    DOCUMENT_ARCHIVED: "资料已归档，无法执行此操作。",
    STORAGE_UNAVAILABLE: "文件存储服务暂时不可用，请稍后重试。",
    FORBIDDEN: "你没有执行此操作的权限。",
    UNAUTHENTICATED: "登录已失效，请重新登录。",
  };
  return messages[error.code] || "项目资料操作失败，请稍后重试。";
}
