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
import { productRoleEnum, systemRoleEnum, userStatusEnum } from "./enums";

export const user = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    systemRole: systemRoleEnum("system_role")
      .notNull()
      .default("standard_user"),
    productRole: productRoleEnum("product_role").notNull().default("member"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_status_idx").on(table.status),
    check("users_email_normalized", sql`${table.email} = lower(${table.email})`),
    check("users_email_not_blank", sql`length(trim(${table.email})) > 3`),
  ],
);

export type UserRecord = typeof user.$inferSelect;
export type NewUserRecord = typeof user.$inferInsert;
