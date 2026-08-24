import { and, eq, sql } from "drizzle-orm";
import {
  getDb,
  type Database,
  type DatabaseExecutor,
} from "../client";
import { projectTimeline, type ProjectTimelineRecord } from "../schema";
import type { StructuredTimelineRepository } from "@/lib/timeline/contracts";
import {
  timelineWorkbenchDataSchema,
  workbenchDataToStructuredTimeline,
  type SaveProjectTimelineInput,
} from "@/lib/timeline/persistence";

export class TimelineVersionConflictError extends Error {
  constructor(public readonly currentVersion: number | null) {
    super("Project Timeline has changed since it was loaded");
    this.name = "TimelineVersionConflictError";
  }
}

export async function findProjectTimelineSnapshot(
  projectId: string,
  db: DatabaseExecutor = getDb(),
): Promise<ProjectTimelineRecord | null> {
  const [record] = await db
    .select()
    .from(projectTimeline)
    .where(eq(projectTimeline.projectId, projectId))
    .limit(1);
  return record ?? null;
}

export async function saveProjectTimelineSnapshot(
  input: SaveProjectTimelineInput & {
    projectId: string;
    actorUserId: string;
  },
  db: DatabaseExecutor = getDb(),
): Promise<ProjectTimelineRecord> {
  const current = await findProjectTimelineSnapshot(input.projectId, db);
  if (!current) {
    if (input.expectedVersion !== null) {
      throw new TimelineVersionConflictError(null);
    }
    const [created] = await db
      .insert(projectTimeline)
      .values({
        id: `project-timeline-${crypto.randomUUID()}`,
        projectId: input.projectId,
        name: input.name,
        dataJson: input.data,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      })
      .returning();
    return created;
  }

  if (input.expectedVersion !== current.version) {
    throw new TimelineVersionConflictError(current.version);
  }
  const [updated] = await db
    .update(projectTimeline)
    .set({
      name: input.name,
      dataJson: input.data,
      version: sql`${projectTimeline.version} + 1`,
      updatedBy: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectTimeline.projectId, input.projectId),
        eq(projectTimeline.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated) throw new TimelineVersionConflictError(current.version);
  return updated;
}

export function createDatabaseStructuredTimelineRepository(
  db: Database = getDb(),
): StructuredTimelineRepository {
  return {
    async findProjectTimeline(projectId) {
      const record = await findProjectTimelineSnapshot(projectId, db);
      if (!record) return null;
      const data = timelineWorkbenchDataSchema.parse(record.dataJson);
      return workbenchDataToStructuredTimeline(projectId, data);
    },
  };
}

export const databaseStructuredTimelineRepository: StructuredTimelineRepository = {
  async findProjectTimeline(projectId) {
    return createDatabaseStructuredTimelineRepository().findProjectTimeline(projectId);
  },
};
