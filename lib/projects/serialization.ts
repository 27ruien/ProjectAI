import type {
  AuthorizedProjectRecord,
} from "@/lib/db/repositories/project-repository";
import type { ProjectRecord } from "@/lib/db/schema";
import { resolveProjectPermissions } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";

export function serializeProject(project: ProjectRecord) {
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
    startDate: project.startDate,
    targetLaunchDate: project.targetLaunchDate,
    knowledgeStatus: project.knowledgeStatus,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function serializeAuthorizedProject(
  project: AuthorizedProjectRecord,
  principal: AuthenticatedPrincipal,
) {
  return {
    ...serializeProject(project),
    projectRole: project.projectRole,
    permissions: resolveProjectPermissions(principal, project),
  };
}
