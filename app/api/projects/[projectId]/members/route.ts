import { z } from "zod";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { AuthorizationError, requireApiPrincipal } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  addProjectMember,
  listProjectMembersWithUsers,
} from "@/lib/db/repositories/membership-repository";
import { findUserByEmail } from "@/lib/db/repositories/user-repository";
import { getPostgresErrorCode } from "@/lib/db/errors";
import { getDb } from "@/lib/db/client";

type MembersRouteContext = { params: Promise<{ projectId: string }> };

const addMemberSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: z.enum(["project_manager", "project_member", "viewer"]),
  })
  .strict();

export async function GET(
  request: Request,
  context: MembersRouteContext,
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const members = await listProjectMembersWithUsers(projectId);
    return jsonResponse({ members });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: MembersRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const requestContext = getRequestAuditContext(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = addMemberSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查成员字段" } },
        { status: 400 },
      );
    }
    const result = await getDb().transaction(async (tx) => {
      try {
        await requireProjectRole(
          principal,
          projectId,
          ["project_manager"],
          request.headers,
          { db: tx, lockForUpdate: true },
        );
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return { kind: "authorization_error", error } as const;
        }
        throw error;
      }

      const memberUser = await findUserByEmail(parsed.data.email, tx);
      if (!memberUser || memberUser.status !== "active") {
        return { kind: "user_not_available" } as const;
      }

      const created = await addProjectMember(
        {
          id: crypto.randomUUID(),
          projectId,
          userId: memberUser.id,
          role: parsed.data.role,
          createdBy: principal.user.id,
        },
        tx,
      );
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId,
          eventType: "project_member_added",
          entityType: "project_member",
          entityId: created.id,
          result: "succeeded",
          metadata: { role: created.role, userId: created.userId },
          ...requestContext,
        },
        tx,
      );
      return { kind: "created", member: created } as const;
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.kind === "user_not_available") {
      return jsonResponse(
        { error: { code: "USER_NOT_AVAILABLE", message: "无法添加该用户" } },
        { status: 404 },
      );
    }
    return jsonResponse({ member: result.member }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: { code: "INVALID_JSON", message: "请求格式无效" } },
        { status: 400 },
      );
    }
    if (getPostgresErrorCode(error) === "23505") {
      return jsonResponse(
        { error: { code: "MEMBERSHIP_EXISTS", message: "该用户已在项目中" } },
        { status: 409 },
      );
    }
    return authorizationErrorResponse(error);
  }
}
