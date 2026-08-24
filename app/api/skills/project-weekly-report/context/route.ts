import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  buildWeeklyReportExecutionPackage,
  matchOverridesSchema,
  WeeklyReportError,
  weeklyReportErrorResponse,
} from "@/lib/weekly-report";

export const runtime = "nodejs";

function requiredText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new WeeklyReportError(400, "INVALID_INPUT", "缺少字段：" + key);
  }
  return value.trim();
}

function parseOverrides(form: FormData) {
  const raw = form.get("matchOverrides");
  if (raw === null || raw === "") return [];
  if (typeof raw !== "string") {
    throw new WeeklyReportError(400, "INVALID_MATCH_OVERRIDES", "项目确认信息格式无效");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WeeklyReportError(400, "INVALID_MATCH_OVERRIDES", "项目确认信息不是有效 JSON");
  }
  const parsed = matchOverridesSchema.safeParse(value);
  if (!parsed.success) {
    throw new WeeklyReportError(400, "INVALID_MATCH_OVERRIDES", "项目确认信息格式无效");
  }
  return parsed.data;
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    const principal = await requireApiPrincipal(request.headers);
    const form = await request.formData();
    const file = form.get("dailyReport");
    if (!(file instanceof File)) {
      throw new WeeklyReportError(400, "DAILY_REPORT_REQUIRED", "请上传 CSV 或 XLSX 日报");
    }
    const result = await buildWeeklyReportExecutionPackage({
      principal,
      file,
      weekStart: requiredText(form, "weekStart"),
      weekEnd: requiredText(form, "weekEnd"),
      matchOverrides: parseOverrides(form),
    });
    return jsonResponse(result, {
      status: result.status === "finalized" ? 201 : 200,
    });
  } catch (error) {
    return weeklyReportErrorResponse(error);
  }
}
