import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

function databaseUrl(): URL {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  return new URL(raw);
}

async function applyMigration(client: Client, filename: string): Promise<void> {
  const contents = await readFile(path.resolve("drizzle", filename), "utf8");
  for (const statement of contents.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function main(): Promise<void> {
  const baseUrl = databaseUrl();
  const databaseName = `projectai_phase1_upgrade_${process.pid}_${Date.now()}`;
  if (!/^[a-z0-9_]+$/.test(databaseName))
    throw new Error("Unsafe database name.");
  const admin = new Client({ connectionString: baseUrl.toString() });
  await admin.connect();
  let upgrade: Client | undefined;
  try {
    await admin.query(`create database "${databaseName}"`);
    const upgradeUrl = new URL(baseUrl);
    upgradeUrl.pathname = `/${databaseName}`;
    upgrade = new Client({ connectionString: upgradeUrl.toString() });
    await upgrade.connect();
    for (const filename of [
      "0000_lovely_mongu.sql",
      "0001_wide_sunspot.sql",
      "0002_easy_scarlet_witch.sql",
      "0003_tricky_hannibal_king.sql",
      "0004_groovy_nightcrawler.sql",
      "0005_durable_embedding_calls.sql",
      "0006_closed_genesis.sql",
      "0007_cynical_whizzer.sql",
    ]) {
      await applyMigration(upgrade, filename);
    }
    await upgrade.query(`
      insert into users (id, email, display_name)
      values ('phase1-upgrade-user', 'phase1-upgrade@projectai.invalid', 'Phase 1 Upgrade User');
      insert into projects (id, name, client_name, created_by)
      values ('phase1-upgrade-project', 'Fictional Legacy Project', 'Fictional Client', 'phase1-upgrade-user');
      insert into project_members (id, project_id, user_id, role, created_by)
      values (
        'phase1-upgrade-member', 'phase1-upgrade-project', 'phase1-upgrade-user',
        'project_manager', 'phase1-upgrade-user'
      );
      insert into project_documents (
        id, project_id, display_name, document_status, created_by
      ) values (
        'phase1-upgrade-document', 'phase1-upgrade-project',
        'Fictional Legacy Document', 'active', 'phase1-upgrade-user'
      );
    `);
    await upgrade.query("begin");
    try {
      for (const filename of [
        "0008_material_maggott.sql",
        "0009_fair_tiger_shark.sql",
        "0010_steep_squadron_supreme.sql",
        "0011_giant_living_lightning.sql",
        "0012_parallel_stellaris.sql",
        "0013_knowledge_space_scope_guard.sql",
      ]) {
        await applyMigration(upgrade, filename);
      }
      await upgrade.query("commit");
    } catch (error) {
      await upgrade.query("rollback");
      throw error;
    }
    const verified = await upgrade.query<{
      project_count: string;
      document_count: string;
      project_space_count: string;
      project_source_count: string;
      authorized_count: string;
      requirements_table: string | null;
      source_selection_column: string | null;
      action_items_table: string | null;
      risks_table: string | null;
      weekly_reports_table: string | null;
      management_ai_executions_table: string | null;
      requirement_skill_column: string | null;
      scope_guard_trigger_count: string;
    }>(`
      select
        (select count(*)::text from projects
          where id = 'phase1-upgrade-project'
            and organization_id = 'org-legacy-default'
            and department_id = 'dept-legacy-default') as project_count,
        (select count(*)::text
          from project_documents document
          join knowledge_spaces space on space.id = document.knowledge_space_id
          where document.id = 'phase1-upgrade-document'
            and space.project_id = 'phase1-upgrade-project') as document_count,
        (select count(*)::text from knowledge_spaces
          where project_id = 'phase1-upgrade-project' and space_type = 'project')
          as project_space_count,
        (select count(*)::text from project_knowledge_sources
          where project_id = 'phase1-upgrade-project'
            and source_type = 'knowledge_space' and is_active) as project_source_count,
        (select count(*)::text from projectai_authorized_documents(
          'phase1-upgrade-user', 'phase1-upgrade-project', 'view'
        ) where document_id = 'phase1-upgrade-document') as authorized_count,
        to_regclass('public.requirements')::text as requirements_table,
        (
          select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'ai_executions'
            and column_name = 'source_selection_digest'
        ) as source_selection_column,
        to_regclass('public.action_items')::text as action_items_table,
        to_regclass('public.risks')::text as risks_table,
        to_regclass('public.weekly_report_versions')::text as weekly_reports_table,
        to_regclass('public.project_management_ai_executions')::text as management_ai_executions_table,
        (
          select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'requirement_extraction_runs'
            and column_name = 'skill_id'
        ) as requirement_skill_column
        ,(
          select count(*)::text from pg_trigger
          where tgrelid = 'project_documents'::regclass
            and tgname = 'project_documents_scope_guard_trigger'
            and not tgisinternal
        ) as scope_guard_trigger_count
    `);
    const row = verified.rows[0];
    if (
      row?.project_count !== "1" ||
      row.document_count !== "1" ||
      row.project_space_count !== "1" ||
      row.project_source_count !== "1" ||
      row.authorized_count !== "1" ||
      row.requirements_table !== "requirements" ||
      row.source_selection_column !== "source_selection_digest" ||
      row.action_items_table !== "action_items" ||
      row.risks_table !== "risks" ||
      row.weekly_reports_table !== "weekly_report_versions" ||
      row.management_ai_executions_table !==
        "project_management_ai_executions" ||
      row.requirement_skill_column !== "skill_id" ||
      row.scope_guard_trigger_count !== "1"
    ) {
      throw new Error(
        `Phase 1 non-empty upgrade contract failed: ${JSON.stringify(row)}`,
      );
    }
    await upgrade.query(`
      insert into knowledge_spaces (
        id, organization_id, department_id, space_type, visibility, name, created_by
      ) values (
        'phase1-upgrade-other-department-space', 'org-legacy-default',
        'dept-other-test', 'department', 'department_shared',
        'Other Department Space', 'phase1-upgrade-user'
      )
    `);
    let rejectedInvalidScope = false;
    try {
      await upgrade.query(
        `update project_documents set knowledge_space_id = $1 where id = $2`,
        ["phase1-upgrade-other-department-space", "phase1-upgrade-document"],
      );
    } catch (error) {
      rejectedInvalidScope =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23514";
    }
    if (!rejectedInvalidScope) {
      throw new Error("Phase 1 knowledge-space scope guard accepted cross-department data");
    }
    process.stdout.write(
      "Non-empty 0007 to 0013 Phase 1 migration upgrade verified.\n",
    );
  } finally {
    if (upgrade) await upgrade.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 1 migration upgrade verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
