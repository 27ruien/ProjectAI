export type SystemRole = "system_admin" | "standard_user";
export type ProductRole = "super_admin" | "admin" | "member";

export type ProjectMembershipRole =
  "project_manager" | "project_member" | "viewer";

export interface ProjectUiPermissions {
  canViewProject: boolean;
  canManageProject: boolean;
  canEditProject: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
  canViewAudit: boolean;
  canUploadDocuments: boolean;
  canInviteMembers: boolean;
  canManageDocuments: boolean;
}

export interface AuthorizedProjectSummary {
  id: string;
  organizationId: string;
  departmentId: string | null;
  name: string;
  clientName: string;
  description: string;
  status: string;
  stage: string;
  health: string;
  startDate: string | null;
  targetLaunchDate: string | null;
  knowledgeStatus: "pending" | "ready" | "failed";
  createdAt: string;
  updatedAt: string;
  projectRole: ProjectMembershipRole | null;
  managerDisplayName: string | null;
  memberCount: number;
  permissions: ProjectUiPermissions;
}

export interface ViewerContext {
  user: {
    id: string;
    email: string;
    displayName: string;
    systemRole: SystemRole;
    productRole: ProductRole;
  };
  projects: AuthorizedProjectSummary[];
  /** Server-authorized organization_admin membership for AI configuration. */
  aiConfigurationOrganizationId: string | null;
  canCreateProject: boolean;
  canViewAudit: boolean;
}

export function systemRoleLabel(role: SystemRole): string {
  return role === "system_admin" ? "系统管理员" : "标准用户";
}

export function productRoleLabel(role: ProductRole): string {
  if (role === "super_admin") return "超级管理员";
  if (role === "admin") return "管理员";
  return "成员";
}

export function projectRoleLabel(role: ProjectMembershipRole | null): string {
  if (role === "project_manager") return "项目经理";
  if (role === "project_member") return "项目成员";
  if (role === "viewer") return "只读成员";
  return "系统管理员";
}

export function isReadOnlyProject(project: AuthorizedProjectSummary): boolean {
  return !project.permissions.canEditProject;
}
