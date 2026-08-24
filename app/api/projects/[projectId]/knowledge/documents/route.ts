import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  PROJECT_DOCUMENT_CONTEXT_KINDS,
  type ProjectDocumentContextKind,
} from "@/lib/db/schema";
import {
  KnowledgeServiceError,
  knowledgeServiceErrorResponse,
  listProjectKnowledgeDocuments,
  uploadProjectKnowledgeDocuments,
} from "@/lib/knowledge-slim";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const project = await requireProjectAccess(principal, projectId, request.headers);
    return jsonResponse({
      documents: await listProjectKnowledgeDocuments({ project }),
    });
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request, {
      allowedMediaTypes: ["multipart/form-data"],
    });
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const project = await requireProjectRole(
      principal,
      projectId,
      ["project_manager", "project_member"],
      request.headers,
    );
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const suppliedContextKind = form.get("contextKind");
    if (
      suppliedContextKind !== null &&
      (typeof suppliedContextKind !== "string" ||
        !PROJECT_DOCUMENT_CONTEXT_KINDS.includes(
          suppliedContextKind as ProjectDocumentContextKind,
        ))
    ) {
      throw new KnowledgeServiceError(400, "INVALID_CONTEXT_KIND", "项目资料类型无效");
    }
    const contextKind = typeof suppliedContextKind === "string" &&
      PROJECT_DOCUMENT_CONTEXT_KINDS.includes(
        suppliedContextKind as ProjectDocumentContextKind,
      )
      ? suppliedContextKind as ProjectDocumentContextKind
      : "general";
    const documents = await uploadProjectKnowledgeDocuments({
      project,
      actorUserId: principal.user.id,
      files,
      contextKind,
    });
    return jsonResponse({ documents }, { status: 201 });
  } catch (error) {
    return knowledgeServiceErrorResponse(error);
  }
}
