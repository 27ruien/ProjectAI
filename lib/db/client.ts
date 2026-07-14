import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __projectAiPostgresPool: Pool | undefined;
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database-backed routes.");
  }
  return databaseUrl;
}

export function getPool(): Pool {
  if (!globalThis.__projectAiPostgresPool) {
    globalThis.__projectAiPostgresPool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "project-ai-os",
    });
  }
  return globalThis.__projectAiPostgresPool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export type Database = ReturnType<typeof getDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export async function closeDatabasePool(): Promise<void> {
  const pool = globalThis.__projectAiPostgresPool;
  globalThis.__projectAiPostgresPool = undefined;
  if (pool) await pool.end();
}
