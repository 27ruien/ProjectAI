import { z } from "zod";
import type { StructuredProjectTimeline } from "./contracts";

const workbenchTaskSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    stage: z.string().trim().max(200),
    name: z.string().trim().max(500),
    owners: z.array(z.string().trim().min(1).max(200)).max(8),
    status: z.enum(["incomplete", "done"]),
    start: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)]),
    end: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)]),
  })
  .strict();

export const timelineWorkbenchDataSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.enum(["zh", "en"]),
    includeStatus: z.boolean(),
    tasks: z.array(workbenchTaskSchema).max(500),
  })
  .strict();

export const saveProjectTimelineInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    data: timelineWorkbenchDataSchema,
    expectedVersion: z.number().int().positive().nullable(),
  })
  .strict();

export type TimelineWorkbenchData = z.infer<typeof timelineWorkbenchDataSchema>;
export type SaveProjectTimelineInput = z.infer<typeof saveProjectTimelineInputSchema>;

export function workbenchDataToStructuredTimeline(
  projectId: string,
  data: TimelineWorkbenchData,
): StructuredProjectTimeline {
  return {
    projectId,
    tasks: data.tasks.map((task) => ({
      id: task.id,
      stage: task.stage || null,
      name: task.name,
      owners: task.owners,
      startDate: task.start,
      endDate: task.end,
      status: task.status,
    })),
  };
}
