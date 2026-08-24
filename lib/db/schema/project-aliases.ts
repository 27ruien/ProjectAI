import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { project } from "./projects";
import { user } from "./users";

export const projectAlias = pgTable(
  "project_aliases",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    alias: varchar("alias", { length: 200 }).notNull(),
    normalizedAlias: varchar("normalized_alias", { length: 200 }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_aliases_project_normalized_uidx").on(
      table.projectId,
      table.normalizedAlias,
    ),
    index("project_aliases_normalized_idx").on(table.normalizedAlias),
    check(
      "project_aliases_nonempty_check",
      sql`length(btrim(${table.alias})) > 0 and length(btrim(${table.normalizedAlias})) > 0`,
    ),
  ],
);

export type ProjectAliasRecord = typeof projectAlias.$inferSelect;
export type NewProjectAliasRecord = typeof projectAlias.$inferInsert;
