import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabasePool, getDb } from "../../lib/db/client";

function assertTestDatabase(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("NODE_ENV=test is required for a database reset.");
  }
  if (process.env.ALLOW_TEST_DATABASE_RESET !== "true") {
    throw new Error("ALLOW_TEST_DATABASE_RESET=true is required for a database reset.");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");
  const localHost = ["127.0.0.1", "localhost", "postgres", "db"].includes(
    parsed.hostname,
  );
  if (!localHost || !/test|ci/i.test(databaseName)) {
    throw new Error("Refusing to reset a database not explicitly named for test/CI.");
  }
}

async function main(): Promise<void> {
  assertTestDatabase();
  const db = getDb();
  // Drizzle stores its migration ledger in a separate `drizzle` schema. A
  // test reset must clear that ledger together with `public`; otherwise a
  // second reset can report success while skipping every committed migration.
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`create schema public`);
  await migrate(db, { migrationsFolder: "drizzle" });
  process.stdout.write("Test database reset and migrations completed.\n");
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Test database reset failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
