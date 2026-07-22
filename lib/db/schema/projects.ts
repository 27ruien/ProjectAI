import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import {
  projectHealthEnum,
  projectStageEnum,
  projectStatusEnum,
} from "./enums";
import { user } from "./users";

export const project = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .default("org-legacy-default"),
    departmentId: text("department_id"),
    name: varchar("name", { length: 200 }).notNull(),
    clientName: varchar("client_name", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    status: projectStatusEnum("status").notNull().default("planning"),
    stage: projectStageEnum("stage").notNull().default("discovery"),
    health: projectHealthEnum("health").notNull().default("healthy"),
    targetLaunchDate: date("target_launch_date", { mode: "string" }),
    createdBy: text("created_by")
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
    index("projects_organization_idx").on(table.organizationId, table.status),
    index("projects_department_idx").on(table.departmentId, table.status),
    index("projects_status_idx").on(table.status),
    index("projects_created_by_idx").on(table.createdBy),
    index("projects_updated_at_idx").on(table.updatedAt),
  ],
);

export type ProjectRecord = typeof project.$inferSelect;
export type NewProjectRecord = typeof project.$inferInsert;
