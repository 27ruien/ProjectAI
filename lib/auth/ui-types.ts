export type SystemRole = "system_admin" | "standard_user";
export type ProductRole = "super_admin" | "admin" | "member";

export type ProjectMembershipRole =
  | "project_manager"
  | "project_member"
  | "viewer";

export interface ProjectUiPermissions {
  canManageProject: boolean;
  canEditProject: boolean;
  canManageMembers: boolean;
  canViewAudit: boolean;
  canUploadDocuments: boolean;
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
  targetLaunchDate: string | null;
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
  canCreateProject: boolean;
  canViewAudit: boolean;
}

export type SerializableRecord = Record<string, unknown>;

export interface ProjectMockPayload {
  projectId: string;
  project: SerializableRecord | null;
  documents: SerializableRecord[];
  citations: SerializableRecord[];
  requirements: SerializableRecord[];
  scopes: SerializableRecord[];
  scopeChanges: SerializableRecord[];
  actions: SerializableRecord[];
  activities: SerializableRecord[];
  decisions: SerializableRecord[];
  reviews: SerializableRecord[];
  risks: SerializableRecord[];
  meetings: SerializableRecord[];
}

/**
 * Mock data that is safe to serialize into the authenticated workspace.
 *
 * Catalogs are global product configuration. Every array that contains a
 * projectId is filtered on the server before it reaches a Client Component.
 */
export interface WorkspaceMockPayload {
  skills: SerializableRecord[];
  workflows: SerializableRecord[];
  aiProviders: SerializableRecord[];
  aiModels: SerializableRecord[];
  aiModelProfiles: SerializableRecord[];
  reviews: SerializableRecord[];
  citations: SerializableRecord[];
  aiExecutions: SerializableRecord[];
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
