import { and, eq, ne } from "drizzle-orm";
import {
  getDb,
  type DatabaseExecutor,
  type DatabaseTransaction,
} from "../client";
import {
  project,
  projectMember,
  type ProjectMemberRecord,
  type ProjectRole,
  user,
} from "../schema";

export type ProjectMemberWithUser = ProjectMemberRecord & {
  email: string;
  displayName: string;
  status: "active" | "disabled";
};

export async function findProjectMembership(
  userId: string,
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectMemberRecord | null> {
  const [record] = await db
    .select()
    .from(projectMember)
    .where(
      and(
        eq(projectMember.userId, userId),
        eq(projectMember.projectId, projectId),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function listProjectMemberships(
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectMemberRecord[]> {
  return db
    .select()
    .from(projectMember)
    .where(eq(projectMember.projectId, projectId));
}

export async function listProjectMembersWithUsers(
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectMemberWithUser[]> {
  return db
    .select({
      id: projectMember.id,
      projectId: projectMember.projectId,
      userId: projectMember.userId,
      role: projectMember.role,
      createdAt: projectMember.createdAt,
      createdBy: projectMember.createdBy,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
    })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, projectId));
}

export async function findProjectMemberById(
  memberId: string,
  projectId: string,
  db: DatabaseExecutor = getDb(),
  options: { lockForUpdate?: boolean } = {},
): Promise<ProjectMemberRecord | null> {
  const query = db
    .select()
    .from(projectMember)
    .where(
      and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)),
    )
    .limit(1);
  const [record] = options.lockForUpdate
    ? await query.for("update", { of: projectMember })
    : await query;
  return record ?? null;
}

export async function addProjectMember(
  input: {
    id: string;
    projectId: string;
    userId: string;
    role: ProjectRole;
    createdBy: string;
  },
  db: DatabaseTransaction,
): Promise<ProjectMemberRecord> {
  await lockProjectMembershipChanges(input.projectId, db);
  const [record] = await db.insert(projectMember).values(input).returning();
  return record;
}

async function lockProjectMembershipChanges(
  projectId: string,
  db: DatabaseTransaction,
): Promise<boolean> {
  const [lockedProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1)
    .for("update", { of: project });
  return Boolean(lockedProject);
}

async function hasOtherProjectManager(
  projectId: string,
  memberId: string,
  db: DatabaseTransaction,
): Promise<boolean> {
  const [otherManager] = await db
    .select({ id: projectMember.id })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.role, "project_manager"),
        ne(projectMember.id, memberId),
      ),
    )
    .limit(1);
  return Boolean(otherManager);
}

async function updateProjectMemberRole(
  memberId: string,
  projectId: string,
  role: ProjectRole,
  db: DatabaseTransaction,
): Promise<ProjectMemberRecord | null> {
  const [record] = await db
    .update(projectMember)
    .set({ role })
    .where(
      and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)),
    )
    .returning();
  return record ?? null;
}

async function removeProjectMember(
  memberId: string,
  projectId: string,
  db: DatabaseTransaction,
): Promise<ProjectMemberRecord | null> {
  const [record] = await db
    .delete(projectMember)
    .where(
      and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)),
    )
    .returning();
  return record ?? null;
}

export type ChangeProjectMemberRoleResult =
  | {
      kind: "updated";
      member: ProjectMemberRecord;
      previousRole: ProjectRole;
    }
  | { kind: "not_found" }
  | {
      kind: "last_project_manager";
      member: ProjectMemberRecord;
    };

export async function changeProjectMemberRoleSafely(
  memberId: string,
  projectId: string,
  role: ProjectRole,
  db: DatabaseTransaction,
): Promise<ChangeProjectMemberRoleResult> {
  if (!(await lockProjectMembershipChanges(projectId, db))) {
    return { kind: "not_found" };
  }
  const previous = await findProjectMemberById(memberId, projectId, db, {
    lockForUpdate: true,
  });
  if (!previous) return { kind: "not_found" };
  if (
    previous.role === "project_manager" &&
    role !== "project_manager" &&
    !(await hasOtherProjectManager(projectId, memberId, db))
  ) {
    return { kind: "last_project_manager", member: previous };
  }
  const changed = await updateProjectMemberRole(memberId, projectId, role, db);
  return changed
    ? { kind: "updated", member: changed, previousRole: previous.role }
    : { kind: "not_found" };
}

export type RemoveProjectMemberResult =
  | { kind: "removed"; member: ProjectMemberRecord }
  | { kind: "not_found" }
  | {
      kind: "last_project_manager";
      member: ProjectMemberRecord;
    };

export async function removeProjectMemberSafely(
  memberId: string,
  projectId: string,
  db: DatabaseTransaction,
): Promise<RemoveProjectMemberResult> {
  if (!(await lockProjectMembershipChanges(projectId, db))) {
    return { kind: "not_found" };
  }
  const previous = await findProjectMemberById(memberId, projectId, db, {
    lockForUpdate: true,
  });
  if (!previous) return { kind: "not_found" };
  if (
    previous.role === "project_manager" &&
    !(await hasOtherProjectManager(projectId, memberId, db))
  ) {
    return { kind: "last_project_manager", member: previous };
  }
  const deleted = await removeProjectMember(memberId, projectId, db);
  return deleted
    ? { kind: "removed", member: deleted }
    : { kind: "not_found" };
}
