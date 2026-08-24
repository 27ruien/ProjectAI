import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";

export class WeeklyReportError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413 | 415 | 422 | 500,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WeeklyReportError";
  }
}

export function weeklyReportErrorResponse(error: unknown): Response {
  if (error instanceof WeeklyReportError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  try {
    return authorizationErrorResponse(error);
  } catch {
    console.error("Weekly report request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonResponse(
      { error: { code: "WEEKLY_REPORT_INTERNAL_ERROR", message: "周报上下文生成失败" } },
      { status: 500 },
    );
  }
}
