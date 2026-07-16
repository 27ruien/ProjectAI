"use client";

import { withBasePath } from "@/lib/base-path";
import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@/types/knowledge-search";

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
