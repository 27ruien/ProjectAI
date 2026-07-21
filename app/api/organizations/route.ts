import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  createOrganization,
  listKnowledgeAdministration,
} from "@/lib/knowledge/management";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listKnowledgeAdministration(principal));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_REQUEST", message: "组织信息无效" } },
        { status: 400 },
      );
    }
    return jsonResponse(
      {
        organization: await createOrganization({
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
