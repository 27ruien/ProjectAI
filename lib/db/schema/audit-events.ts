import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { auditResultEnum } from "./enums";
import { project } from "./projects";
import { user } from "./users";

export const auditEvent = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: text("entity_id"),
    result: auditResultEnum("result").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_events_project_idx").on(table.projectId, table.createdAt),
    index("audit_events_type_idx").on(table.eventType, table.createdAt),
  ],
);

export type AuditEventRecord = typeof auditEvent.$inferSelect;
