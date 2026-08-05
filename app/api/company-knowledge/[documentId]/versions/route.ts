import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse, idempotencyKeyFrom } from "@/lib/files/http";
import {
  listCompanyKnowledgeVersions,
  uploadCompanyKnowledgeVersion,
} from "@/lib/focused-mvp/company-knowledge";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

type Context = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { documentId } = await context.params;
    return jsonResponse(await listCompanyKnowledgeVersions({ principal, documentId }));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request, { allowedMediaTypes: ["multipart/form-data"] });
    const principal = await requireApiPrincipal(request.headers);
    const { documentId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new FileOperationError(400, "INVALID_REQUEST", "请选择一个文件");
    const versionNoteValue = form.get("versionNote");
    if (
      versionNoteValue !== null &&
      (typeof versionNoteValue !== "string" || versionNoteValue.trim().length > 500)
    ) {
      throw new FileOperationError(400, "INVALID_REQUEST", "版本说明不能超过 500 个字符");
    }
    const uploaded = await uploadCompanyKnowledgeVersion({
      principal,
      documentId,
      requestHeaders: request.headers,
      idempotencyKey: idempotencyKeyFrom(request),
      file,
      versionNote:
        typeof versionNoteValue === "string" && versionNoteValue.trim()
          ? versionNoteValue.trim()
          : null,
    });
    return jsonResponse({ documentId, versionId: uploaded.version.id, replayed: uploaded.replayed }, { status: uploaded.replayed ? 200 : 201 });
  } catch (error) {
    const knowledgeResponse = knowledgeManagementErrorResponse(error);
    if (knowledgeResponse.status !== 500) return knowledgeResponse;
    return fileRouteErrorResponse(error);
  }
}
