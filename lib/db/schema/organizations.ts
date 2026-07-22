import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { departmentRoleEnum, organizationRoleEnum } from "./enums";
import { user } from "./users";

export const organization = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
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
    uniqueIndex("organizations_slug_uidx").on(table.slug),
    check("organizations_name_check", sql`length(btrim(${table.name})) > 0`),
    check(
      "organizations_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  ],
);

export const organizationMember = pgTable(
  "organization_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: organizationRoleEnum("role").notNull(),
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
    uniqueIndex("organization_members_org_user_uidx").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_members_user_idx").on(table.userId, table.isActive),
    index("organization_members_admin_idx").on(
      table.organizationId,
      table.role,
      table.isActive,
    ),
  ],
);

export const department = pgTable(
  "departments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    code: varchar("code", { length: 80 }).notNull(),
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
    unique("departments_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("departments_org_code_uidx").on(
      table.organizationId,
      table.code,
    ),
    index("departments_org_active_idx").on(
      table.organizationId,
      table.isActive,
    ),
    check("departments_name_check", sql`length(btrim(${table.name})) > 0`),
  ],
);

export const departmentMember = pgTable(
  "department_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    departmentId: text("department_id")
      .notNull()
      .references(() => department.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: departmentRoleEnum("role").notNull(),
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
    uniqueIndex("department_members_department_user_uidx").on(
      table.departmentId,
      table.userId,
    ),
    index("department_members_user_idx").on(table.userId, table.isActive),
    index("department_members_admin_idx").on(
      table.departmentId,
      table.role,
      table.isActive,
    ),
  ],
);

export type OrganizationRecord = typeof organization.$inferSelect;
export type DepartmentRecord = typeof department.$inferSelect;
