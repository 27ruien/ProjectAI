import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { ProjectAssistantError } from "@/lib/ai/project-assistant";
import { TimesheetError } from "./errors";
import type { ZodType } from "zod";

export async function parseTimesheetRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new TimesheetError(422, "INVALID_REQUEST", "请求 JSON 无效");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new TimesheetError(422, "INVALID_REQUEST", "请求字段无效");
  }
  return parsed.data;
}

export function timesheetErrorResponse(error: unknown): Response {
  if (error instanceof TimesheetError || error instanceof ProjectAssistantError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return authorizationErrorResponse(error);
}
