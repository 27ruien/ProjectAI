"use client";

import { withBasePath } from "@/lib/base-path";
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@/types/knowledge-search";
import type {
  KnowledgeChunkListResponse,
  KnowledgeChunkMutationResponse,
} from "@/types/knowledge-chunks";

export class KnowledgeSearchApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeSearchApiError";
  }
}

export async function searchProjectKnowledge(
  projectId: string,
  input: KnowledgeSearchRequest,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResponse> {
  const response = await fetch(
    withBasePath(
      `/api/projects/${encodeURIComponent(projectId)}/knowledge/search`,
    ),
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    },
  );
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Never surface a raw proxy or database response.
    }
    throw new KnowledgeSearchApiError(
      response.status,
      body.error?.code || `HTTP_${response.status}`,
      body.error?.message || "项目知识搜索失败",
    );
  }
  return (await response.json()) as KnowledgeSearchResponse;
}

async function managedChunkResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Never surface a raw proxy or database response.
    }
    throw new KnowledgeSearchApiError(
      response.status,
      body.error?.code || `HTTP_${response.status}`,
      body.error?.message || "分块管理操作失败",
    );
  }
  return (await response.json()) as T;
}

function chunksPath(projectId: string, documentId: string, suffix = ""): string {
  return withBasePath(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/chunks${suffix}`,
  );
}

export async function listManagedKnowledgeChunks(
  projectId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<KnowledgeChunkListResponse> {
  const response = await fetch(chunksPath(projectId, documentId), {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  return managedChunkResponse(response);
}

export async function mutateManagedKnowledgeChunk(input: {
  projectId: string;
  documentId: string;
  chunkId: string;
  action: "disable" | "enable" | "regenerate_embedding";
  expectedContentSha256: string;
}): Promise<KnowledgeChunkMutationResponse> {
  const response = await fetch(
    chunksPath(
      input.projectId,
      input.documentId,
      `/${encodeURIComponent(input.chunkId)}`,
    ),
    {
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: input.action,
        expectedContentSha256: input.expectedContentSha256,
      }),
    },
  );
  return managedChunkResponse(response);
}
