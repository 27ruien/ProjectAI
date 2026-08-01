"use client";

import { withBasePath } from "@/lib/base-path";
import type {
  AssistantContextReference,
  ProjectAssistantMessageResponse,
  ProjectAssistantThreadResponse,
  ProjectAssistantThreadsResponse,
} from "@/types/project-assistant";
import { PROJECT_ASSISTANT_MODEL_PROFILE_ID } from "@/types/project-assistant";

export class ProjectAssistantApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAssistantApiError";
  }
}

async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Raw upstream responses are never exposed to the UI.
    }
    throw new ProjectAssistantApiError(
      response.status,
      body.error?.code || `HTTP_${response.status}`,
      body.error?.message || "项目 AI 助手请求失败",
    );
  }
  return (await response.json()) as T;
}

function projectPath(projectId: string | null, suffix: string): string {
  return projectId
    ? `/api/projects/${encodeURIComponent(projectId)}/ai/threads${suffix}`
    : `/api/ai/threads${suffix}`;
}

export function listProjectAssistantThreads(
  projectId: string | null,
  signal?: AbortSignal,
): Promise<ProjectAssistantThreadsResponse> {
  return api(projectPath(projectId, ""), { signal });
}

export function createProjectAssistantThread(
  projectId: string | null,
): Promise<ProjectAssistantThreadResponse> {
  return api(projectPath(projectId, ""), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function getProjectAssistantThread(
  projectId: string | null,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProjectAssistantThreadResponse> {
  return api(
    projectPath(projectId, `/${encodeURIComponent(threadId)}`),
    { signal },
  );
}

export function archiveProjectAssistantThread(
  projectId: string | null,
  threadId: string,
): Promise<{ archived: true }> {
  return api(
    projectPath(projectId, `/${encodeURIComponent(threadId)}/archive`),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
}

export async function deleteProjectAssistantThread(
  projectId: string | null,
  threadId: string,
): Promise<void> {
  const response = await fetch(withBasePath(projectPath(projectId, `/${encodeURIComponent(threadId)}`)), {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new ProjectAssistantApiError(response.status, body.error?.code ?? `HTTP_${response.status}`, body.error?.message ?? "删除对话失败");
  }
}

export function askProjectAssistant(
  projectId: string | null,
  threadId: string,
  question: string,
  requestId: string,
  sourceDocumentIds: string[] = [],
  contextReferences: AssistantContextReference[] = [],
): Promise<ProjectAssistantMessageResponse> {
  return api(
    projectPath(projectId, `/${encodeURIComponent(threadId)}/messages`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": requestId,
      },
      body: JSON.stringify({
        question,
        modelProfileId: PROJECT_ASSISTANT_MODEL_PROFILE_ID,
        sourceDocumentIds,
        contextReferences,
      }),
    },
  );
}

export function listGeneralAssistantModels(): Promise<{ models: Array<{ id: string; displayName: string; modelId: string }> }> {
  return api("/api/ai/session-models");
}

export function setGeneralAssistantThreadModel(threadId: string, generationModelId: string | null): Promise<{ ok: true }> {
  return api(`/api/ai/threads/${encodeURIComponent(threadId)}/model`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ generationModelId }) });
}
