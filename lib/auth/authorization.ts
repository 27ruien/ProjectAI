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
  isProductAdmin,
} from "./session";

export type ProjectPermissionSet = {
  canViewProject: true;
  canManageProject: boolean;
  canEditProject: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
  canUploadDocuments: boolean;
  canInviteMembers: boolean;
  canManageDocuments: boolean;
  canViewAudit: boolean;
};

export type ProjectAuthorizationOptions = {
  db?: DatabaseExecutor;
  lockForUpdate?: boolean;
};

export function resolveProjectPermissions(
  principal: AuthenticatedPrincipal,
  project: Pick<AuthorizedProjectRecord, "createdBy" | "projectRole">,
): ProjectPermissionSet {
  const admin = isProductAdmin(principal.user.productRole);
  const creator = project.createdBy === principal.user.id;
  const manager = project.projectRole === "project_manager";
  const editor = project.projectRole === "project_member";
  const canEditProject = admin || creator || manager || editor;
  const canManageMembers = admin || creator || manager;
  return {
    canViewProject: true,
    canManageProject: canEditProject,
    canEditProject,
    canManageMembers,
    canDeleteProject: canManageMembers,
    canUploadDocuments: canEditProject,
    canInviteMembers: canManageMembers,
    canManageDocuments: canManageMembers,
    canViewAudit: canManageMembers,
  };
}

export async function canReadProject(
  principal: AuthenticatedPrincipal,
  projectId: string,
): Promise<boolean> {
  return Boolean(
    await findAuthorizedProject(
      principal.user.id,
      principal.user.productRole,
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
    principal.user.productRole,
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
    !isProductAdmin(principal.user.productRole) &&
    !(
      authorizedProject.projectRole &&
      allowedRoles.includes(authorizedProject.projectRole)
    ) &&
    !(
      authorizedProject.createdBy === principal.user.id &&
      allowedRoles.includes("project_manager")
    )
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
    principal.user.productRole,
    projectId,
  );
  if (!authorizedProject) return false;
  return resolveProjectPermissions(principal, authorizedProject)
    .canEditProject;
}

export async function canManageProjectMembers(
  principal: AuthenticatedPrincipal,
  projectId: string,
): Promise<boolean> {
  const authorizedProject = await findAuthorizedProject(
    principal.user.id,
    principal.user.productRole,
    projectId,
  );
  if (!authorizedProject) return false;
  return resolveProjectPermissions(principal, authorizedProject)
    .canManageMembers;
}
