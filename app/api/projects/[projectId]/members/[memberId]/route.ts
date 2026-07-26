import { z } from "zod";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireProjectRole } from "@/lib/auth/authorization";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { AuthorizationError, requireApiPrincipal } from "@/lib/auth/session";
import {
  changeProjectMemberRole,
  LAST_PROJECT_MANAGER_ERROR,
  removeProjectMember,
} from "@/lib/projects/member-management";
import { getDb } from "@/lib/db/client";
import { serializeAuthorizedProject } from "@/lib/projects/serialization";

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
    const parsed = roleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "角色无效" } },
        { status: 400 },
      );
    }
    const result = await getDb().transaction(async (tx) => {
      let authorizedProject: Awaited<ReturnType<typeof requireProjectRole>>;
      try {
        authorizedProject = await requireProjectRole(
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

      const changed = await changeProjectMemberRole(
        { memberId, projectId, role: parsed.data.role },
        { actorUserId: principal.user.id, ...requestContext },
        tx,
      );
      return { changed, authorizedProject } as const;
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.changed.kind === "not_found") {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "成员不存在" } },
        { status: 404 },
      );
    }
    if (result.changed.kind === "last_project_manager") {
      return jsonResponse(LAST_PROJECT_MANAGER_ERROR, { status: 409 });
    }
    return jsonResponse({
      project: serializeAuthorizedProject(result.authorizedProject, principal),
      member: result.changed.member,
    });
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

      return removeProjectMember(
        { memberId, projectId },
        { actorUserId: principal.user.id, ...requestContext },
        tx,
      );
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.kind === "not_found") {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "成员不存在" } },
        { status: 404 },
      );
    }
    if (result.kind === "last_project_manager") {
      return jsonResponse(LAST_PROJECT_MANAGER_ERROR, { status: 409 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}
