import { and, eq } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import {
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
  db: DatabaseExecutor = getDb(),
): Promise<ProjectMemberRecord> {
  const [record] = await db.insert(projectMember).values(input).returning();
  return record;
}

export async function updateProjectMemberRole(
  memberId: string,
  projectId: string,
  role: ProjectRole,
  db: DatabaseExecutor = getDb(),
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

export async function removeProjectMember(
  memberId: string,
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectMemberRecord | null> {
  const [record] = await db
    .delete(projectMember)
    .where(
      and(eq(projectMember.id, memberId), eq(projectMember.projectId, projectId)),
    )
    .returning();
  return record ?? null;
}
