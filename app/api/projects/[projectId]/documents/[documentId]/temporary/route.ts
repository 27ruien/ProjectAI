import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { finalizeTemporaryWorkflowDocument } from "@/lib/files/document-service";

const schema = z.object({
  workflowId: z.string().regex(/^[0-9a-f-]{16,80}$/i),
  action: z.enum(["promote", "discard"]),
  targetKnowledgeSpaceId: z.string().min(1).max(200).optional(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; documentId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, documentId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "临时附件操作无效" } }, { status: 400 });
    }
    const document = await finalizeTemporaryWorkflowDocument({
      principal,
      projectId,
      documentId,
      ...parsed.data,
      requestHeaders: request.headers,
    });
    return jsonResponse({ documentId: document.id, action: parsed.data.action });
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
