"use client";

import { withBasePath } from "@/lib/base-path";

export class ProjectManagementApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ProjectManagementApiError";
  }
}

export async function projectManagementRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try { body = (await response.json()) as typeof body; } catch { /* sanitized fallback */ }
    throw new ProjectManagementApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? "项目管理操作失败",
    );
  }
  return response.json() as Promise<T>;
}

export function projectManagementMutation<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  return projectManagementRequest<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
