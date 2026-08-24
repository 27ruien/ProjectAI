import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import type { TimelineWorkbenchData } from "@/lib/timeline/persistence";
import { project } from "./projects";
import { user } from "./users";

export const projectTimeline = pgTable(
  "project_timelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    dataJson: jsonb("data_json").$type<TimelineWorkbenchData>().notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_timelines_project_uidx").on(table.projectId),
    index("project_timelines_updated_at_idx").on(table.updatedAt),
    check("project_timelines_name_check", sql`length(btrim(${table.name})) > 0`),
    check("project_timelines_version_check", sql`${table.version} > 0`),
    check(
      "project_timelines_data_object_check",
      sql`jsonb_typeof(${table.dataJson}) = 'object'`,
    ),
  ],
);

export type ProjectTimelineRecord = typeof projectTimeline.$inferSelect;
export type NewProjectTimelineRecord = typeof projectTimeline.$inferInsert;
