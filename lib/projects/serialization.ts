import type {
  AuthorizedProjectRecord,
} from "@/lib/db/repositories/project-repository";
import type { ProjectRecord } from "@/lib/db/schema";
import { resolveProjectPermissions } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";

export function serializeProject(project: ProjectRecord) {
  return {
    ...project,
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
