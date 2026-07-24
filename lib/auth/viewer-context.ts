import "server-only";

import type {
  AuthorizedProjectSummary,
  ProjectUiPermissions,
  ViewerContext,
} from "./ui-types";
import { getProjectPermissions } from "./authorization";
import type { AuthenticatedPrincipal } from "./session";
import {
  listAuthorizedProjects,
  listProjectRosterSummaries,
} from "@/lib/db/repositories/project-repository";

function toUiPermissions(
  principal: AuthenticatedPrincipal,
  projectRole: "project_manager" | "project_member" | "viewer" | null,
): ProjectUiPermissions {
  const permissions = getProjectPermissions(principal, projectRole);
  return {
    canManageProject: permissions.canEditProject,
    canEditProject: permissions.canEditProject,
    canManageMembers: permissions.canManageProjectMembers,
    canViewAudit: permissions.canViewAudit,
    canUploadDocuments: permissions.canUploadDocuments,
    canManageDocuments: permissions.canManageDocuments,
  };
}

export async function buildViewerContext(
  principal: AuthenticatedPrincipal,
): Promise<ViewerContext> {
  const projects = await listAuthorizedProjects(
    principal.user.id,
    principal.user.productRole,
  );
  const rosters = await listProjectRosterSummaries(
    projects.map((project) => project.id),
  );
  const rosterByProjectId = new Map(
    rosters.map((roster) => [roster.projectId, roster]),
  );
  const projectSummaries: AuthorizedProjectSummary[] = projects.map((project) => {
    const roster = rosterByProjectId.get(project.id);
    return {
      id: project.id,
      organizationId: project.organizationId,
      departmentId: project.departmentId,
      name: project.name,
      clientName: project.clientName,
      description: project.description,
      status: project.status,
      stage: project.stage,
      health: project.health,
      targetLaunchDate: project.targetLaunchDate,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      projectRole: project.projectRole,
      managerDisplayName: roster?.managerDisplayName ?? null,
      memberCount: roster?.memberCount ?? 0,
      permissions: toUiPermissions(principal, project.projectRole),
    };
  });
  const superAdmin = principal.user.productRole === "super_admin";
  return {
    user: {
      id: principal.user.id,
      email: principal.user.email,
      displayName: principal.user.displayName,
      systemRole: principal.user.systemRole,
      productRole: principal.user.productRole,
    },
    projects: projectSummaries,
    canCreateProject: true,
    canViewAudit: superAdmin,
  };
}
