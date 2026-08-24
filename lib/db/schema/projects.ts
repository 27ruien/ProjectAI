import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  projectHealthEnum,
  projectKnowledgeStatusEnum,
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
    isInternal: boolean("is_internal").notNull().default(false),
    status: projectStatusEnum("status").notNull().default("planning"),
    stage: projectStageEnum("stage").notNull().default("discovery"),
    health: projectHealthEnum("health").notNull().default("healthy"),
    startDate: date("start_date", { mode: "string" }),
    targetLaunchDate: date("target_launch_date", { mode: "string" }),
    ragflowDatasetId: varchar("ragflow_dataset_id", { length: 64 }),
    knowledgeStatus: projectKnowledgeStatusEnum("knowledge_status")
      .notNull()
      .default("pending"),
    knowledgeFailureCode: varchar("knowledge_failure_code", { length: 64 }),
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
    uniqueIndex("projects_ragflow_dataset_uidx").on(table.ragflowDatasetId),
    index("projects_knowledge_status_idx").on(table.knowledgeStatus),
    index("projects_created_by_idx").on(table.createdBy),
    index("projects_updated_at_idx").on(table.updatedAt),
  ],
);

export type ProjectRecord = typeof project.$inferSelect;
export type NewProjectRecord = typeof project.$inferInsert;
