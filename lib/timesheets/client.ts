"use client";

import { withBasePath } from "@/lib/base-path";

export class TimesheetApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TimesheetApiError";
  }
}

export async function timesheetRequest<T>(
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
      // The fallback deliberately contains no response body.
    }
    throw new TimesheetApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? "工作日报操作失败",
    );
  }
  return response.json() as Promise<T>;
}

export function timesheetMutation<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  return timesheetRequest<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
