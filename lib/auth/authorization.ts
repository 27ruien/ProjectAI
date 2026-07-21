import {
  findAuthorizedProject,
  type AuthorizedProjectRecord,
} from "@/lib/db/repositories/project-repository";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import type { ProjectRole } from "@/lib/db/schema";
import { getRequestAuditContext } from "./request-context";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
  isSystemAdmin,
} from "./session";

const EDIT_ROLES: readonly ProjectRole[] = ["project_manager", "project_member"];
const MANAGE_MEMBER_ROLES: readonly ProjectRole[] = ["project_manager"];

export type ProjectPermissionSet = {
  canRead: true;
  canEditProject: boolean;
  canManageProjectMembers: boolean;
  canUploadDocuments: boolean;
  canManageDocuments: boolean;
  canCreateProject: boolean;
  canViewAudit: boolean;
};

export type ProjectAuthorizationOptions = {
  db?: DatabaseExecutor;
  lockForUpdate?: boolean;
};

export function getProjectPermissions(
  principal: AuthenticatedPrincipal,
  projectRole: ProjectRole | null,
): ProjectPermissionSet {
  const admin = isSystemAdmin(principal.user.systemRole);
  return {
    canRead: true,
    canEditProject: admin || (projectRole ? EDIT_ROLES.includes(projectRole) : false),
    canManageProjectMembers:
      admin || (projectRole ? MANAGE_MEMBER_ROLES.includes(projectRole) : false),
    canUploadDocuments:
      admin || (projectRole ? EDIT_ROLES.includes(projectRole) : false),
    canManageDocuments:
      admin || (projectRole ? MANAGE_MEMBER_ROLES.includes(projectRole) : false),
    canCreateProject: admin,
    canViewAudit:
      admin || (projectRole ? MANAGE_MEMBER_ROLES.includes(projectRole) : false),
  };
}

export async function canReadProject(
  principal: AuthenticatedPrincipal,
  projectId: string,
): Promise<boolean> {
  return Boolean(
    await findAuthorizedProject(
      principal.user.id,
      principal.user.systemRole,
      projectId,
    ),
  );
}

export async function requireProjectAccess(
  principal: AuthenticatedPrincipal,
  projectId: string,
  requestHeaders?: Headers,
  options: ProjectAuthorizationOptions = {},
): Promise<AuthorizedProjectRecord> {
  const db = options.db ?? getDb();
  const authorizedProject = await findAuthorizedProject(
    principal.user.id,
    principal.user.systemRole,
    projectId,
    db,
    { lockForUpdate: options.lockForUpdate },
  );
  const requestContext = requestHeaders
    ? getRequestAuditContext(requestHeaders)
    : { ipAddress: null, userAgent: null };

  if (!authorizedProject) {
    await writeAuditEvent(
      {
        actorUserId: principal.user.id,
        eventType: "project_access_denied",
        entityType: "project",
        entityId: projectId,
        result: "denied",
        metadata: { reason: "not_authorized_or_not_found" },
        ...requestContext,
      },
      db,
    );
    // A single response for missing and inaccessible IDs prevents enumeration.
    throw new AuthorizationError(404, "NOT_FOUND", "项目不存在");
  }

  await writeAuditEvent(
    {
      actorUserId: principal.user.id,
      projectId: authorizedProject.id,
      eventType: "project_viewed",
      entityType: "project",
      entityId: authorizedProject.id,
      result: "succeeded",
      ...requestContext,
    },
    db,
  );
  return authorizedProject;
}

export async function requireProjectRole(
  principal: AuthenticatedPrincipal,
  projectId: string,
  allowedRoles: readonly ProjectRole[],
  requestHeaders?: Headers,
  options: ProjectAuthorizationOptions = {},
): Promise<AuthorizedProjectRecord> {
  const authorizedProject = await requireProjectAccess(
    principal,
    projectId,
    requestHeaders,
    options,
  );
  if (
    !isSystemAdmin(principal.user.systemRole) &&
    (!authorizedProject.projectRole ||
      !allowedRoles.includes(authorizedProject.projectRole))
  ) {
    const requestContext = requestHeaders
      ? getRequestAuditContext(requestHeaders)
      : { ipAddress: null, userAgent: null };
    await writeAuditEvent(
      {
        actorUserId: principal.user.id,
        projectId: authorizedProject.id,
        eventType: "project_access_denied",
        entityType: "project",
        entityId: authorizedProject.id,
        result: "denied",
        metadata: {
          reason: "insufficient_project_role",
          requiredRoles: [...allowedRoles],
        },
        ...requestContext,
      },
      options.db ?? getDb(),
    );
    throw new AuthorizationError(403, "FORBIDDEN", "无权执行此操作");
  }
  return authorizedProject;
}

export async function canEditProject(
  principal: AuthenticatedPrincipal,
  projectId: string,
): Promise<boolean> {
  const authorizedProject = await findAuthorizedProject(
    principal.user.id,
    principal.user.systemRole,
    projectId,
  );
  if (!authorizedProject) return false;
  return getProjectPermissions(principal, authorizedProject.projectRole)
    .canEditProject;
}

export async function canManageProjectMembers(
  principal: AuthenticatedPrincipal,
  projectId: string,
): Promise<boolean> {
  const authorizedProject = await findAuthorizedProject(
    principal.user.id,
    principal.user.systemRole,
    projectId,
  );
  if (!authorizedProject) return false;
  return getProjectPermissions(principal, authorizedProject.projectRole)
    .canManageProjectMembers;
}
