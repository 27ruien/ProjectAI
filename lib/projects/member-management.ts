import type { RequestAuditContext } from "@/lib/auth/request-context";
import type { DatabaseTransaction } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  changeProjectMemberRoleSafely,
  removeProjectMemberSafely,
  type ChangeProjectMemberRoleResult,
  type RemoveProjectMemberResult,
} from "@/lib/db/repositories/membership-repository";
import type { ProjectRole } from "@/lib/db/schema";

export const LAST_PROJECT_MANAGER_ERROR = {
  error: {
    code: "LAST_PROJECT_MANAGER",
    message: "项目必须至少保留一名项目经理",
  },
} as const;

type MemberMutationContext = RequestAuditContext & {
  actorUserId: string;
};

export async function changeProjectMemberRole(
  input: {
    projectId: string;
    memberId: string;
    role: ProjectRole;
  },
  context: MemberMutationContext,
  db: DatabaseTransaction,
): Promise<ChangeProjectMemberRoleResult> {
  const result = await changeProjectMemberRoleSafely(
    input.memberId,
    input.projectId,
    input.role,
    db,
  );
  if (result.kind === "last_project_manager") {
    await writeAuditEvent(
      {
        actorUserId: context.actorUserId,
        projectId: input.projectId,
        eventType: "project_member_change_denied",
        entityType: "project_member",
        entityId: input.memberId,
        result: "denied",
        metadata: {
          reason: "last_project_manager",
          attemptedAction: "change_role",
          fromRole: result.member.role,
          toRole: input.role,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      db,
    );
  } else if (result.kind === "updated") {
    await writeAuditEvent(
      {
        actorUserId: context.actorUserId,
        projectId: input.projectId,
        eventType: "project_member_role_changed",
        entityType: "project_member",
        entityId: input.memberId,
        result: "succeeded",
        metadata: {
          fromRole: result.previousRole,
          toRole: result.member.role,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      db,
    );
  }
  return result;
}

export async function removeProjectMember(
  input: { projectId: string; memberId: string },
  context: MemberMutationContext,
  db: DatabaseTransaction,
): Promise<RemoveProjectMemberResult> {
  const result = await removeProjectMemberSafely(
    input.memberId,
    input.projectId,
    db,
  );
  if (result.kind === "last_project_manager") {
    await writeAuditEvent(
      {
        actorUserId: context.actorUserId,
        projectId: input.projectId,
        eventType: "project_member_change_denied",
        entityType: "project_member",
        entityId: input.memberId,
        result: "denied",
        metadata: {
          reason: "last_project_manager",
          attemptedAction: "remove_member",
          fromRole: result.member.role,
        },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      db,
    );
  } else if (result.kind === "removed") {
    await writeAuditEvent(
      {
        actorUserId: context.actorUserId,
        projectId: input.projectId,
        eventType: "project_member_removed",
        entityType: "project_member",
        entityId: input.memberId,
        result: "succeeded",
        metadata: { role: result.member.role, userId: result.member.userId },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      db,
    );
  }
  return result;
}
