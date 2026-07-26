import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

async function migrationFiles(): Promise<string[]> {
  return (await readdir(path.resolve("drizzle")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
}

async function apply(client: Client, filename: string): Promise<void> {
  const contents = await readFile(path.resolve("drizzle", filename), "utf8");
  for (const statement of contents.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  const base = new URL(raw);
  const databaseName = `projectai_v3_upgrade_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  let target: Client | undefined;
  try {
    await admin.query(`create database "${databaseName}"`);
    const targetUrl = new URL(base);
    targetUrl.pathname = `/${databaseName}`;
    target = new Client({ connectionString: targetUrl.toString() });
    await target.connect();
    const files = await migrationFiles();
    const boundary = files.indexOf("0025_marvelous_stephen_strange.sql");
    if (boundary < 0) throw new Error("V3_MIGRATION_0025_MISSING");
    for (const filename of files.slice(0, boundary)) await apply(target, filename);
    const v3Migration = await readFile(
      path.resolve("drizzle", "0025_marvelous_stephen_strange.sql"),
      "utf8",
    );
    const partialFirstStatement = v3Migration.split("--> statement-breakpoint")[0];
    if (!partialFirstStatement.trim()) throw new Error("V3_MIGRATION_0025_EMPTY");
    await target.query(partialFirstStatement);
    await target.query(`
      insert into users (id, email, display_name)
      values ('v3-upgrade-user', 'v3-upgrade@projectai.invalid', 'V3 Upgrade User');
      insert into organizations (id, name, slug, created_by)
      values ('v3-upgrade-org', '[TEST] V3 Upgrade', 'v3-upgrade', 'v3-upgrade-user');
      insert into projects (id, organization_id, name, client_name, description, created_by)
      values (
        'v3-upgrade-fixture-project', 'v3-upgrade-org',
        'Product V2 ACL UAT migration', '[TEST] Client', '[UAT] migration fixture',
        'v3-upgrade-user'
      );
      insert into timesheet_ai_executions (
        id, organization_id, user_id, report_date, execution_id, skill_id,
        model_profile_id, prompt_version, status, source_selection_digest, source_count
      ) values (
        'v3-upgrade-ai', 'v3-upgrade-org', 'v3-upgrade-user', '2026-07-27',
        'v3-upgrade-ai', 'pm-daily-timesheet-generation',
        'qwen-project-assistant-cn-v1', 'pm-daily-report-v1', 'succeeded',
        '${"0".repeat(64)}', 1
      );
      insert into test_fixtures (
        id, entity_type, entity_id, fixture_run_id, environment, expires_at
      ) values (
        'fixture-project-' || md5('v3-upgrade-fixture-project'),
        'project', 'v3-upgrade-fixture-project', 'partial-v3-upgrade', 'staging',
        now() + interval '1 day'
      );
    `);
    for (const filename of files.slice(boundary)) await apply(target, filename);
    await apply(target, "0025_marvelous_stephen_strange.sql");
    const result = await target.query<{
      request_id: string;
      status: string;
      fixture_count: string;
      fixture_columns: string;
    }>(`
      select
        (select request_id from timesheet_ai_executions where id = 'v3-upgrade-ai') as request_id,
        (select status from timesheet_ai_executions where id = 'v3-upgrade-ai') as status,
        (select count(*)::text from test_fixtures where entity_type = 'project' and entity_id = 'v3-upgrade-fixture-project') as fixture_count,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'test_fixtures' and column_name in ('is_test_fixture', 'fixture_run_id', 'environment', 'expires_at')) as fixture_columns
    `);
    const row = result.rows[0];
    if (
      row.request_id !== "v3-upgrade-ai" ||
      row.status !== "completed" ||
      row.fixture_count !== "1" ||
      row.fixture_columns !== "4"
    ) {
      throw new Error("V3_MIGRATION_UPGRADE_ASSERTION_FAILED");
    }
    process.stdout.write(
      `V3 migration upgrade passed through ${files.at(-1)}; legacy execution and fixture registry preserved.\n`,
    );
  } finally {
    await target?.end().catch(() => undefined);
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [databaseName],
    );
    await admin.query(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `V3 migration verification failed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`,
  );
  process.exitCode = 1;
});
