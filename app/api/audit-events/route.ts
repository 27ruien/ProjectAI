import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal, requireSystemAdmin } from "@/lib/auth/session";
import { listRecentAuditEvents } from "@/lib/db/repositories/audit-repository";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireApiPrincipal(request.headers);
    await requireSystemAdmin(request.headers);
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") || 100);
    const events = await listRecentAuditEvents(
      Number.isFinite(requestedLimit) ? requestedLimit : 100,
    );
    return jsonResponse({ events });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}
