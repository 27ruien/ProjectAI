import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabasePool, getDb } from "../../lib/db/client";

async function main(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: "drizzle" });
  process.stdout.write("Database migrations are current.\n");
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Database migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
