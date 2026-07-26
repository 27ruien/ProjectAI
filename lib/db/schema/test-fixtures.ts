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

/**
 * Cross-entity ownership registry for synthetic UAT/CI data.
 *
 * The registry deliberately has no foreign key to product tables: a fixture run
 * can own a graph of heterogeneous records and can clean that graph in its
 * dependency-safe order. Normal product queries exclude registered entities in
 * SQL; exact-ID UAT probes can still exercise the real authorization layer.
 */
export const testFixture = pgTable(
  "test_fixtures",
  {
    id: text("id").primaryKey(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: text("entity_id").notNull(),
    isTestFixture: boolean("is_test_fixture").notNull().default(true),
    fixtureRunId: text("fixture_run_id").notNull(),
    environment: varchar("environment", { length: 24 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("test_fixtures_entity_uidx").on(
      table.entityType,
      table.entityId,
    ),
    index("test_fixtures_run_idx").on(
      table.fixtureRunId,
      table.environment,
    ),
    index("test_fixtures_expiry_idx").on(table.expiresAt),
    check("test_fixtures_flag_check", sql`${table.isTestFixture} = true`),
    check(
      "test_fixtures_environment_check",
      sql`${table.environment} in ('local', 'test', 'ci', 'staging')`,
    ),
    check(
      "test_fixtures_entity_type_check",
      sql`length(btrim(${table.entityType})) between 1 and 80`,
    ),
    check(
      "test_fixtures_run_id_check",
      sql`length(btrim(${table.fixtureRunId})) between 1 and 200`,
    ),
  ],
);

export type TestFixtureRecord = typeof testFixture.$inferSelect;
