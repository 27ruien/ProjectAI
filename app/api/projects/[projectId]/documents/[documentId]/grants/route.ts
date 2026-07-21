import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { setDocumentGrant } from "@/lib/knowledge/management";

const schema = z
  .object({
    subjectType: z.enum(["organization", "department", "project", "role", "user"]),
    subjectId: z.string().min(1).max(200),
    permission: z.enum([
      "view",
      "download",
      "upload",
      "edit_metadata",
      "manage_versions",
      "archive",
      "manage_permissions",
      "manage_members",
    ]),
    effect: z.enum(["allow", "deny"]),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; documentId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "文件授权无效" } },
        { status: 400 },
      );
    }
    return jsonResponse(
      {
        grant: await setDocumentGrant({
          principal,
          projectId,
          documentId,
          ...parsed.data,
          requestHeaders: request.headers,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
