import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  createKnowledgeSpace,
  listKnowledgeAdministration,
} from "@/lib/knowledge/management";

const schema = z
  .object({
    organizationId: z.string().min(1).max(200),
    departmentId: z.string().min(1).max(200).nullable().optional(),
    projectId: z.string().min(1).max(200).nullable().optional(),
    type: z.enum(["organization", "department", "project", "restricted"]),
    visibility: z.enum([
      "private",
      "organization_shared",
      "department_shared",
      "restricted",
    ]),
    name: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional().default(""),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const data = await listKnowledgeAdministration(principal);
    return jsonResponse({
      knowledgeSpaces: data.knowledgeSpaces,
      grants: data.grants,
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "知识空间信息无效" } },
        { status: 400 },
      );
    }
    return jsonResponse(
      {
        knowledgeSpace: await createKnowledgeSpace({
          principal,
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
