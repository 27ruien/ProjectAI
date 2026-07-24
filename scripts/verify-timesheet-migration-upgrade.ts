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

async function expectConstraintFailure(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (error) {
    if ((error as { code?: string }).code === "23514") return;
    throw error;
  }
  throw new Error("Expected a check-constraint failure.");
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
      insert into organizations (id, name, slug, created_by)
      values ('timesheet-upgrade-org', '[TEST] Timesheet Upgrade Organization', 'timesheet-upgrade', 'timesheet-upgrade-user');
      insert into departments (id, organization_id, name, code, created_by)
      values ('timesheet-upgrade-dept', 'timesheet-upgrade-org', '[TEST] Timesheet Upgrade Department', 'TIMESHEET-UPGRADE', 'timesheet-upgrade-user');
      insert into projects (id, organization_id, department_id, name, client_name, created_by)
      values ('timesheet-upgrade-project', 'timesheet-upgrade-org', 'timesheet-upgrade-dept', '[TEST] Legacy Project', '[TEST] Client', 'timesheet-upgrade-user');
    `);
    await apply(upgrade, "0016_tricky_revanche.sql");
    await upgrade.query(`
      insert into daily_timesheet_drafts (
        id, organization_id, user_id, report_date, status, version, total_hours
      ) values (
        'timesheet-upgrade-draft', 'timesheet-upgrade-org', 'timesheet-upgrade-user',
        '2026-07-22', 'confirmed', 1, 1.25
      );
      insert into timesheet_tasks (
        id, draft_id, description, project_id, project_name_snapshot, hours,
        category_id, category_name_snapshot, work_status, work_status_name_snapshot,
        confidence, needs_review, review_fields, source_record_ids, sort_order
      ) values (
        'timesheet-upgrade-task', 'timesheet-upgrade-draft', 'Legacy confirmed task',
        'timesheet-upgrade-project', '[TEST] Legacy Project', 1.25,
        'communication', 'Project communication', 'completed', 'Completed',
        '{}', false, '[]', '["legacy-record"]', 0
      );
      insert into timesheet_ai_executions (
        id, organization_id, user_id, report_date, execution_id, skill_id,
        model_profile_id, prompt_version, status, source_selection_digest, source_count
      ) values (
        'timesheet-upgrade-ai', 'timesheet-upgrade-org', 'timesheet-upgrade-user',
        '2026-07-22', 'timesheet-upgrade-ai', 'pm-daily-timesheet-generation',
        'qwen-project-assistant-cn-v1', 'pm-daily-report-v1', 'failed',
        '${"0".repeat(64)}', 0
      );
    `);
    await apply(upgrade, "0017_nosy_boomer.sql");
    await upgrade.query(`
      insert into timesheet_tasks (
        id, draft_id, description, project_id, project_name_snapshot, hours,
        overtime_hours, category_name_snapshot, work_status_name_snapshot,
        confidence, needs_review, review_fields, source_record_ids, sort_order, progress
      ) values (
        'timesheet-upgrade-zero-task', 'timesheet-upgrade-draft', 'Explicit zero-hour task',
        'timesheet-upgrade-project', '[TEST] Legacy Project', 0,
        0, '', '', '{}', true, '["hours","overtimeHours"]', '["legacy-record"]', 1, 0
      );
    `);
    await expectConstraintFailure(upgrade, `
      insert into timesheet_tasks (
        id, draft_id, description, project_name_snapshot, hours, overtime_hours,
        category_name_snapshot, work_status_name_snapshot, confidence,
        review_fields, source_record_ids, sort_order
      ) values (
        'timesheet-upgrade-invalid-total', 'timesheet-upgrade-draft', 'Invalid total task',
        '', 20, 5, '', '', '{}', '[]', '["legacy-record"]', 2
      )
    `);
    await expectConstraintFailure(upgrade, `
      update timesheet_tasks set progress = 101 where id = 'timesheet-upgrade-zero-task'
    `);
    await apply(upgrade, "0018_simple_sue_storm.sql");
    await expectConstraintFailure(upgrade, `
      update timesheet_tasks
      set submission_status = 'submitted'
      where id = 'timesheet-upgrade-zero-task'
    `);
    await apply(upgrade, "0019_lame_dracula.sql");
    const result = await upgrade.query<{
      legacy_project: string;
      ai_execution: string;
      draft_table: string | null;
      work_log_table: string | null;
      sync_table: string | null;
      trigger_count: string;
      active_batch_index: string | null;
      legacy_task: string;
      zero_task: string;
      overtime_column: string | null;
      urgency_column: string | null;
      progress_column: string | null;
      new_constraint_count: string;
      lifecycle_column: string | null;
      verified_column: string | null;
      conservative_task_count: string;
      batch_snapshot_column_count: string;
    }>(`
      select
        (select count(*)::text from projects where id = 'timesheet-upgrade-project') as legacy_project,
        (select count(*)::text from timesheet_ai_executions where id = 'timesheet-upgrade-ai') as ai_execution,
        to_regclass('public.daily_timesheet_drafts')::text as draft_table,
        to_regclass('public.work_log_records')::text as work_log_table,
        to_regclass('public.timesheet_sync_batches')::text as sync_table,
        (select count(*)::text from pg_trigger where tgname like 'timesheet_%_scope_guard_trigger' or tgname = 'work_log_records_scope_guard_trigger') as trigger_count,
        to_regclass('public.timesheet_sync_batches_active_draft_uidx')::text as active_batch_index,
        (select count(*)::text from timesheet_tasks where id = 'timesheet-upgrade-task' and hours = 1.25 and overtime_hours is null and urgency_name_snapshot is null and progress is null) as legacy_task,
        (select count(*)::text from timesheet_tasks where id = 'timesheet-upgrade-zero-task' and hours = 0 and overtime_hours = 0 and progress = 0) as zero_task,
        (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_tasks' and column_name = 'overtime_hours') as overtime_column,
        (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_tasks' and column_name = 'urgency_name_snapshot') as urgency_column,
        (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_tasks' and column_name = 'progress') as progress_column,
        (select count(*)::text from pg_constraint where conname in ('timesheet_tasks_hours_check', 'timesheet_tasks_overtime_hours_check', 'timesheet_tasks_total_daily_hours_check', 'timesheet_tasks_progress_check')) as new_constraint_count,
        (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_tasks' and column_name = 'submission_status') as lifecycle_column,
        (select column_name from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_sync_items' and column_name = 'verified') as verified_column,
        (select count(*)::text from timesheet_tasks where draft_id = 'timesheet-upgrade-draft' and submission_status = 'confirmed' and submitted_at is null) as conservative_task_count,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'timesheet_sync_batches' and column_name in ('draft_version', 'confirmed_at_snapshot') and is_nullable = 'NO') as batch_snapshot_column_count
    `);
    const row = result.rows[0];
    if (
      row.legacy_project !== "1" ||
      row.ai_execution !== "1" ||
      row.draft_table !== "daily_timesheet_drafts" ||
      row.work_log_table !== "work_log_records" ||
      row.sync_table !== "timesheet_sync_batches" ||
      row.trigger_count !== "5" ||
      row.active_batch_index !== "timesheet_sync_batches_active_draft_uidx"
      || row.legacy_task !== "1"
      || row.zero_task !== "1"
      || row.overtime_column !== "overtime_hours"
      || row.urgency_column !== "urgency_name_snapshot"
      || row.progress_column !== "progress"
      || row.new_constraint_count !== "4"
      || row.lifecycle_column !== "submission_status"
      || row.verified_column !== "verified"
      || row.conservative_task_count !== "2"
      || row.batch_snapshot_column_count !== "2"
    ) {
      throw new Error(`Timesheet migration contract failed: ${JSON.stringify(row)}`);
    }
    process.stdout.write("Non-empty 0015 to 0016 to 0017 to 0018 to 0019 timesheet migration upgrade verified.\n");
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
