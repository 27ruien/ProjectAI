import type {
  AuthorizedProjectRecord,
} from "@/lib/db/repositories/project-repository";
import type { ProjectRecord } from "@/lib/db/schema";

export function serializeProject(project: ProjectRecord) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function serializeAuthorizedProject(project: AuthorizedProjectRecord) {
  return {
    ...serializeProject(project),
    projectRole: project.projectRole,
  };
}
