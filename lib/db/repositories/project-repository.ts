import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  getDb,
  type Database,
  type DatabaseExecutor,
} from "../client";
import {
  project,
  projectMember,
  knowledgeSpace,
  knowledgeSpaceMember,
  type NewProjectRecord,
  type ProjectRecord,
  type ProjectRole,
  type ProductRole,
  type SystemRole,
  user,
} from "../schema";

export type AuthorizedProjectRecord = ProjectRecord & {
  projectRole: ProjectRole | null;
};

export type ProjectRosterSummary = {
  projectId: string;
  memberCount: number;
  managerDisplayName: string | null;
};

type RepositoryRole = ProductRole | SystemRole;

function isGlobalProjectReader(role: RepositoryRole): boolean {
  return role === "super_admin" || role === "admin" || role === "system_admin";
}

const projectSelection = {
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
  createdBy: project.createdBy,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

export async function listAuthorizedProjects(
  userId: string,
  productRole: RepositoryRole,
  db: Database = getDb(),
): Promise<AuthorizedProjectRecord[]> {
  if (isGlobalProjectReader(productRole)) {
    const rows = await db
      .select(projectSelection)
      .from(project)
      .orderBy(desc(project.updatedAt));
    return rows.map((row) => ({ ...row, projectRole: null }));
  }

  return db
    .select({ ...projectSelection, projectRole: projectMember.role })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(eq(projectMember.userId, userId))
    .orderBy(desc(project.updatedAt));
}

export async function findAuthorizedProject(
  userId: string,
  productRole: RepositoryRole,
  projectId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<AuthorizedProjectRecord | null> {
  if (options.lockForUpdate) {
    const query = db
      .select(projectSelection)
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    const [lockedProject] = await query.for("update", { of: project });
    if (!lockedProject) return null;
    if (isGlobalProjectReader(productRole)) {
      return { ...lockedProject, projectRole: null };
    }

    // Membership mutations use the project row as their per-project mutex.
    // Read the actor membership only after acquiring it so concurrent role
    // changes cannot authorize against a stale statement snapshot.
    const [membership] = await db
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.userId, userId),
          eq(projectMember.projectId, projectId),
        ),
      )
      .limit(1);
    return membership
      ? { ...lockedProject, projectRole: membership.role }
      : null;
  }

  if (isGlobalProjectReader(productRole)) {
    const [record] = await db
      .select(projectSelection)
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    return record ? { ...record, projectRole: null } : null;
  }

  const query = db
    .select({ ...projectSelection, projectRole: projectMember.role })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(
      and(
        eq(projectMember.userId, userId),
        eq(projectMember.projectId, projectId),
      ),
    )
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: projectMember })
    : await query;
  return record ?? null;
}

export async function listProjectRosterSummaries(
  projectIds: string[],
  db: Database = getDb(),
): Promise<ProjectRosterSummary[]> {
  if (projectIds.length === 0) return [];
  return db
    .select({
      projectId: projectMember.projectId,
      memberCount: count(projectMember.id).mapWith(Number),
      managerDisplayName:
        sql<string | null>`max(case when ${projectMember.role} = 'project_manager' then ${user.displayName} else null end)`,
    })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(inArray(projectMember.projectId, projectIds))
    .groupBy(projectMember.projectId);
}

export async function createProjectWithManager(
  input: NewProjectRecord,
  db?: DatabaseExecutor,
): Promise<ProjectRecord> {
  const create = async (executor: DatabaseExecutor) => {
    const [createdProject] = await executor
      .insert(project)
      .values(input)
      .returning();
    await executor.insert(projectMember).values({
      id: crypto.randomUUID(),
      projectId: createdProject.id,
      userId: input.createdBy,
      role: "project_manager",
      createdBy: input.createdBy,
    });
    const [space] = await executor
      .select({ id: knowledgeSpace.id })
      .from(knowledgeSpace)
      .where(eq(knowledgeSpace.projectId, createdProject.id))
      .limit(1);
    if (!space) throw new Error("Project knowledge-space trigger did not create a space.");
    await executor
      .update(knowledgeSpace)
      .set({
        departmentId: createdProject.departmentId,
        name: createdProject.name,
        description: "项目知识空间",
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSpace.id, space.id));
    await executor.insert(knowledgeSpaceMember).values({
      id: crypto.randomUUID(),
      knowledgeSpaceId: space.id,
      userId: input.createdBy,
      role: "editor",
      accessLevel: "edit",
      createdBy: input.createdBy,
    }).onConflictDoUpdate({
      target: [knowledgeSpaceMember.knowledgeSpaceId, knowledgeSpaceMember.userId],
      set: { role: "manager", accessLevel: "edit", isActive: true, updatedAt: new Date() },
    });
    return createdProject;
  };
  return db ? create(db) : getDb().transaction(create);
}

export async function updateProject(
  projectId: string,
  changes: Partial<
    Pick<
      NewProjectRecord,
      | "name"
      | "clientName"
      | "description"
      | "status"
      | "stage"
      | "health"
      | "targetLaunchDate"
      | "departmentId"
    >
  >,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectRecord | null> {
  const [record] = await db
    .update(project)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(project.id, projectId))
    .returning();
  return record ?? null;
}
