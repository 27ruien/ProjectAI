import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projectRoleEnum } from "./enums";
import { project } from "./projects";
import { user } from "./users";

export const projectMember = pgTable(
  "project_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: projectRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("project_members_project_user_unique").on(
      table.projectId,
      table.userId,
    ),
    index("project_members_user_id_idx").on(table.userId),
    index("project_members_project_role_idx").on(table.projectId, table.role),
  ],
);

export type ProjectMemberRecord = typeof projectMember.$inferSelect;
