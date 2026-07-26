import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  listProjectSpaceMembers,
  removeProjectSpaceMember,
  setProjectSpaceMember,
} from "@/lib/knowledge/product-v2";

const mutationSchema = z.object({
  userId: z.string().min(1).max(200),
  accessLevel: z.enum(["view", "edit"]),
}).strict();

const removalSchema = z.object({
  userId: z.string().min(1).max(200),
}).strict();

export async function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { spaceId } = await context.params;
    return jsonResponse(await listProjectSpaceMembers({ principal, spaceId }));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { spaceId } = await context.params;
    const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "空间成员权限无效" } }, { status: 400 });
    }
    return jsonResponse(await setProjectSpaceMember({
      principal,
      spaceId,
      ...parsed.data,
      requestHeaders: request.headers,
    }));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ spaceId: string }> },
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const { spaceId } = await context.params;
    const parsed = removalSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "空间成员信息无效" } }, { status: 400 });
    }
    return jsonResponse(await removeProjectSpaceMember({
      principal,
      spaceId,
      ...parsed.data,
      requestHeaders: request.headers,
    }));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
