import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const migrations = [
  "0000_lovely_mongu.sql",
  "0001_wide_sunspot.sql",
  "0002_easy_scarlet_witch.sql",
  "0003_tricky_hannibal_king.sql",
  "0004_groovy_nightcrawler.sql",
  "0005_durable_embedding_calls.sql",
  "0006_closed_genesis.sql",
  "0007_cynical_whizzer.sql",
  "0008_material_maggott.sql",
  "0009_fair_tiger_shark.sql",
  "0010_steep_squadron_supreme.sql",
  "0011_giant_living_lightning.sql",
  "0012_parallel_stellaris.sql",
  "0013_knowledge_space_scope_guard.sql",
  "0014_authorization_deny_priority.sql",
  "0015_project_department_scope_guard.sql",
];

async function apply(client: Client, filename: string): Promise<void> {
  const sql = await readFile(path.resolve("drizzle", filename), "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  const base = new URL(raw);
  const name = `projectai_timesheet_upgrade_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  let upgrade: Client | undefined;
  try {
    await admin.query(`create database "${name}"`);
    const target = new URL(base);
    target.pathname = `/${name}`;
    upgrade = new Client({ connectionString: target.toString() });
    await upgrade.connect();
    for (const filename of migrations) await apply(upgrade, filename);
    await upgrade.query(`
      insert into users (id, email, display_name)
      values ('timesheet-upgrade-user', 'timesheet-upgrade@projectai.invalid', 'Timesheet Upgrade User');
      insert into projects (id, organization_id, department_id, name, client_name, created_by)
      values ('timesheet-upgrade-project', 'org-legacy-default', 'dept-legacy-default', '[TEST] Legacy Project', '[TEST] Client', 'timesheet-upgrade-user');
    `);
    await apply(upgrade, "0016_tricky_revanche.sql");
    const result = await upgrade.query<{
      legacy_project: string;
      draft_table: string | null;
      work_log_table: string | null;
      sync_table: string | null;
      trigger_count: string;
      active_batch_index: string | null;
    }>(`
      select
        (select count(*)::text from projects where id = 'timesheet-upgrade-project') as legacy_project,
        to_regclass('public.daily_timesheet_drafts')::text as draft_table,
        to_regclass('public.work_log_records')::text as work_log_table,
        to_regclass('public.timesheet_sync_batches')::text as sync_table,
        (select count(*)::text from pg_trigger where tgname like 'timesheet_%_scope_guard_trigger' or tgname = 'work_log_records_scope_guard_trigger') as trigger_count,
        to_regclass('public.timesheet_sync_batches_active_draft_uidx')::text as active_batch_index
    `);
    const row = result.rows[0];
    if (
      row.legacy_project !== "1" ||
      row.draft_table !== "daily_timesheet_drafts" ||
      row.work_log_table !== "work_log_records" ||
      row.sync_table !== "timesheet_sync_batches" ||
      row.trigger_count !== "5" ||
      row.active_batch_index !== "timesheet_sync_batches_active_draft_uidx"
    ) {
      throw new Error(`Timesheet migration contract failed: ${JSON.stringify(row)}`);
    }
    process.stdout.write("Non-empty 0015 to 0016 timesheet migration upgrade verified.\n");
  } finally {
    if (upgrade) await upgrade.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Timesheet migration verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
