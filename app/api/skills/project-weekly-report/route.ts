import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  loadWeeklyReportSkill,
  weeklyReportErrorResponse,
} from "@/lib/weekly-report";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireApiPrincipal(request.headers);
    return jsonResponse({ skill: await loadWeeklyReportSkill() });
  } catch (error) {
    return weeklyReportErrorResponse(error);
  }
}
