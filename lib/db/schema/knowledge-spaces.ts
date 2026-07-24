import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  knowledgeSpaceMemberRoleEnum,
  knowledgeAccessLevelEnum,
  knowledgeSpaceTypeEnum,
  knowledgeVisibilityEnum,
} from "./enums";
import { department, organization } from "./organizations";
import { project } from "./projects";
import { user } from "./users";

export const knowledgeSpace = pgTable(
  "knowledge_spaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    departmentId: text("department_id").references(() => department.id, {
      onDelete: "restrict",
    }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    type: knowledgeSpaceTypeEnum("space_type").notNull(),
    visibility: knowledgeVisibilityEnum("visibility")
      .notNull()
      .default("private"),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
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
    uniqueIndex("knowledge_spaces_project_uidx")
      .on(table.projectId)
      .where(sql`${table.type} = 'project'`),
    index("knowledge_spaces_org_type_idx").on(
      table.organizationId,
      table.type,
      table.isActive,
    ),
    index("knowledge_spaces_department_idx").on(
      table.departmentId,
      table.visibility,
    ),
    check("knowledge_spaces_name_check", sql`length(btrim(${table.name})) > 0`),
    check("knowledge_spaces_scope_check", sql`
      (${table.type} = 'organization' and ${table.departmentId} is null and ${table.projectId} is null)
      or (${table.type} = 'department' and ${table.departmentId} is not null and ${table.projectId} is null)
      or (${table.type} = 'project' and ${table.projectId} is not null)
      or (${table.type} = 'restricted')
    `),
  ],
);

export const knowledgeSpaceMember = pgTable(
  "knowledge_space_members",
  {
    id: text("id").primaryKey(),
    knowledgeSpaceId: text("knowledge_space_id")
      .notNull()
      .references(() => knowledgeSpace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: knowledgeSpaceMemberRoleEnum("role").notNull(),
    accessLevel: knowledgeAccessLevelEnum("access_level").notNull().default("view"),
    isActive: boolean("is_active").notNull().default(true),
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
    uniqueIndex("knowledge_space_members_space_user_uidx").on(
      table.knowledgeSpaceId,
      table.userId,
    ),
    index("knowledge_space_members_user_idx").on(table.userId, table.isActive),
  ],
);

export type KnowledgeSpaceRecord = typeof knowledgeSpace.$inferSelect;
