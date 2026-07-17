"use client";

import { withBasePath } from "@/lib/base-path";
import type {
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

function projectPath(projectId: string, suffix: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/ai/threads${suffix}`;
}

export function listProjectAssistantThreads(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectAssistantThreadsResponse> {
  return api(projectPath(projectId, ""), { signal });
}

export function createProjectAssistantThread(
  projectId: string,
): Promise<ProjectAssistantThreadResponse> {
  return api(projectPath(projectId, ""), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function getProjectAssistantThread(
  projectId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProjectAssistantThreadResponse> {
  return api(
    projectPath(projectId, `/${encodeURIComponent(threadId)}`),
    { signal },
  );
}

export function archiveProjectAssistantThread(
  projectId: string,
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

export function askProjectAssistant(
  projectId: string,
  threadId: string,
  question: string,
  requestId: string,
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
      }),
    },
  );
}
