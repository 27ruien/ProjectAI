import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  listProjectKnowledgeSources,
  mountProjectKnowledgeSource,
} from "@/lib/knowledge/management";

const schema = z
  .object({
    sourceType: z.enum(["knowledge_space", "document"]),
    knowledgeSpaceId: z.string().min(1).max(200).nullable().optional(),
    documentId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.sourceType === "knowledge_space" &&
        Boolean(value.knowledgeSpaceId) &&
        !value.documentId) ||
      (value.sourceType === "document" &&
        Boolean(value.documentId) &&
        !value.knowledgeSpaceId),
  );

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      sources: await listProjectKnowledgeSources({
        principal,
        projectId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "知识来源无效" } },
        { status: 400 },
      );
    }
    return jsonResponse(
      {
        source: await mountProjectKnowledgeSource({
          principal,
          projectId,
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
