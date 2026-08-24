import { and, eq, inArray } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import { projectAlias, type ProjectAliasRecord } from "../schema";

export async function listProjectAliases(
  projectIds: string[],
  db: DatabaseExecutor = getDb(),
): Promise<ProjectAliasRecord[]> {
  if (projectIds.length === 0) return [];
  return db
    .select()
    .from(projectAlias)
    .where(inArray(projectAlias.projectId, projectIds));
}

export async function saveProjectAlias(
  input: {
    projectId: string;
    alias: string;
    normalizedAlias: string;
    actorUserId: string;
  },
  db: DatabaseExecutor = getDb(),
): Promise<ProjectAliasRecord> {
  await db
    .insert(projectAlias)
    .values({
      id: `project-alias-${crypto.randomUUID()}`,
      projectId: input.projectId,
      alias: input.alias,
      normalizedAlias: input.normalizedAlias,
      createdBy: input.actorUserId,
    })
    .onConflictDoNothing({
      target: [projectAlias.projectId, projectAlias.normalizedAlias],
    });
  const [record] = await db
    .select()
    .from(projectAlias)
    .where(
      and(
        eq(projectAlias.projectId, input.projectId),
        eq(projectAlias.normalizedAlias, input.normalizedAlias),
      ),
    )
    .limit(1);
  if (!record) throw new Error("PROJECT_ALIAS_SAVE_FAILED");
  return record;
}
