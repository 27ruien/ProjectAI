import { z } from "zod";
import { requireTrustedMutationRequest, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { duplicateProjectDocument } from "@/lib/files/document-service";
import { FileOperationError } from "@/lib/files/errors";
import { fileRouteErrorResponse } from "@/lib/files/http";
import { serializeProjectDocument, serializeDocumentVersion } from "@/lib/files/serialization";
import { requireProjectAccess } from "@/lib/auth/authorization";

type Context = { params: Promise<{ projectId: string; documentId: string }> };
const schema = z
  .object({ targetFolderId: z.string().min(1).max(200).nullable().optional() })
  .strict();

export async function POST(request: Request, context: Context) {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new FileOperationError(400, "INVALID_REQUEST", "副本目标无效");
    const access = await requireProjectAccess(principal, projectId, request.headers);
    const result = await duplicateProjectDocument({
      principal,
      projectId,
      documentId,
      targetFolderId: parsed.data.targetFolderId,
      requestHeaders: request.headers,
    });
    return jsonResponse(
      {
        document: await serializeProjectDocument(
          result.document,
          principal,
          access.projectRole,
          result.version,
        ),
        version: serializeDocumentVersion(result.version, principal.user.displayName),
      },
      { status: 201 },
    );
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
