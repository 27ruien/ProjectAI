import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listProductKnowledgeSpaces } from "@/lib/knowledge/product-v2";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const context = await listProductKnowledgeSpaces(principal);
    return jsonResponse({ departments: context.departments, manager: { id: principal.user.id, displayName: principal.user.displayName } });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
