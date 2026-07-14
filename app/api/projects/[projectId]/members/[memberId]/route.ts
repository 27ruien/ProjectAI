import { z } from "zod";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireProjectRole } from "@/lib/auth/authorization";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { AuthorizationError, requireApiPrincipal } from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  findProjectMemberById,
  removeProjectMember,
  updateProjectMemberRole,
} from "@/lib/db/repositories/membership-repository";
import { getDb } from "@/lib/db/client";

type MemberRouteContext = {
  params: Promise<{ projectId: string; memberId: string }>;
};

const roleSchema = z.object({
  role: z.enum(["project_manager", "project_member", "viewer"]),
}).strict();

export async function PATCH(
  request: Request,
  context: MemberRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, memberId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const requestContext = getRequestAuditContext(request.headers);
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

      const parsed = roleSchema.safeParse(await request.json());
      if (!parsed.success) return { kind: "invalid_input" } as const;

      const previous = await findProjectMemberById(memberId, projectId, tx, {
        lockForUpdate: true,
      });
      if (!previous) return { kind: "not_found" } as const;

      const changed = await updateProjectMemberRole(
        memberId,
        projectId,
        parsed.data.role,
        tx,
      );
      if (!changed) return { kind: "not_found" } as const;
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId,
          eventType: "project_member_role_changed",
          entityType: "project_member",
          entityId: memberId,
          result: "succeeded",
          metadata: { fromRole: previous.role, toRole: parsed.data.role },
          ...requestContext,
        },
        tx,
      );
      return { kind: "updated", member: changed } as const;
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.kind === "invalid_input") {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "角色无效" } },
        { status: 400 },
      );
    }
    if (result.kind === "not_found") {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "成员不存在" } },
        { status: 404 },
      );
    }
    return jsonResponse({ member: result.member });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: { code: "INVALID_JSON", message: "请求格式无效" } },
        { status: 400 },
      );
    }
    return authorizationErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: MemberRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, memberId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const requestContext = getRequestAuditContext(request.headers);
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

      const deleted = await removeProjectMember(memberId, projectId, tx);
      if (!deleted) return { kind: "not_found" } as const;
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId,
          eventType: "project_member_removed",
          entityType: "project_member",
          entityId: memberId,
          result: "succeeded",
          metadata: { role: deleted.role, userId: deleted.userId },
          ...requestContext,
        },
        tx,
      );
      return { kind: "removed" } as const;
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.kind === "not_found") {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "成员不存在" } },
        { status: 404 },
      );
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}
