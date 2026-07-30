import { jsonResponse } from "@/lib/auth/http";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { requireApiPrincipal } from "@/lib/auth/session";
import { listAuthorizedDocuments } from "@/lib/db/repositories/document-repository";
import { serializeDocumentList } from "@/lib/files/serialization";
import { listCompanyKnowledge } from "@/lib/focused-mvp/company-knowledge";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { projectAssistantErrorResponse } from "@/lib/ai/project-assistant";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const access = await requireProjectAccess(principal, projectId, request.headers);
    const scope = await listAuthorizedDocumentScope({ principal, projectId, permission: "view" });
    const projectIds = scope.filter((item) => item.sourceScope === "project" && item.sourceProjectId === projectId).map((item) => item.documentId);
    const projectDocuments = projectIds.length ? await serializeDocumentList(await listAuthorizedDocuments(projectIds, "active"), principal, access.projectRole) : [];
    const company = await listCompanyKnowledge({ principal });
    return jsonResponse({
      documents: [
        ...projectDocuments.map((document) => ({ ...document, sourceScope: "project" as const })),
        ...company.documents.filter((document) => document.lifecycleStatus === "published").map((document) => ({ ...document, sourceScope: "organization" as const })),
      ],
    });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
