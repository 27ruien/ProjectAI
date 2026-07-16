import { requireTrustedMutationRequest, jsonResponse } from "@/lib/auth/http";
import {
  AuthorizationError,
  requireApiPrincipal,
  type AuthenticatedPrincipal,
} from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { documentProcessingErrorResponse } from "@/lib/documents/processing/http";
import { searchProjectKnowledge } from "@/lib/documents/processing/search-service";

type SearchRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(
  request: Request,
  context: SearchRouteContext,
): Promise<Response> {
  let principal: AuthenticatedPrincipal | null = null;
  let projectId = "";
  try {
    requireTrustedMutationRequest(request);
    ({ projectId } = await context.params);
    principal = await requireApiPrincipal(request.headers);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    return jsonResponse(
      await searchProjectKnowledge({
        principal,
        projectId,
        requestHeaders: request.headers,
        body,
      }),
    );
  } catch (error) {
    if (
      principal &&
      error instanceof AuthorizationError &&
      error.status === 404
    ) {
      await writeAuditEvent({
        actorUserId: principal.user.id,
        eventType: "knowledge_search_denied",
        entityType: "project",
        entityId: projectId,
        result: "denied",
        metadata: { reason: "not_authorized_or_not_found" },
        ...getRequestAuditContext(request.headers),
      });
    }
    return documentProcessingErrorResponse(error);
  }
}
