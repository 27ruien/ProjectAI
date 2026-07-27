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
      insert into projects (id, organization_id, name, client_name, description, created_by)
      values (
        'v3-upgrade-normal-uat-project', 'v3-upgrade-org',
        'Client UAT Roadmap', 'Normal Client', 'Normal project whose name contains UAT',
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
      insert into requirement_extraction_runs (
        id, project_id, actor_user_id, idempotency_key_hash,
        source_selection_digest, status, model_profile_id, completed_at
      ) values (
        'v3-upgrade-legacy-requirement', 'v3-upgrade-fixture-project',
        'v3-upgrade-user', '${"1".repeat(64)}', '${"2".repeat(64)}',
        'awaiting_review', 'qwen-project-assistant-cn-v1', now()
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
    await apply(target, "0035_slow_big_bertha.sql");
    const result = await target.query<{
      request_id: string;
      status: string;
      fixture_count: string;
      fixture_columns: string;
      workflow_definitions: string;
      legacy_workflow: string;
      source_project_column: string;
      composite_guards: string;
      publication_columns: string;
      structured_chunk_columns: string;
      retrieval_v3_columns: string;
      legacy_misclassification_count: string;
      source_deleting_status: string;
    }>(`
      select
        (select request_id from timesheet_ai_executions where id = 'v3-upgrade-ai') as request_id,
        (select status from timesheet_ai_executions where id = 'v3-upgrade-ai') as status,
        (select count(*)::text from test_fixtures where entity_type = 'project' and entity_id = 'v3-upgrade-fixture-project') as fixture_count,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'test_fixtures' and column_name in ('is_test_fixture', 'fixture_run_id', 'environment', 'expires_at')) as fixture_columns,
        (select count(*)::text from workflow_definitions where workflow_type in ('requirement_framework', 'meeting_minutes') and is_active) as workflow_definitions,
        (select count(*)::text from workflow_runs where legacy_requirement_run_id = 'v3-upgrade-legacy-requirement' and workflow_type = 'requirement_framework' and status = 'legacy_read_only') as legacy_workflow,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'workflow_run_sources' and column_name = 'source_project_id' and is_nullable = 'NO') as source_project_column,
        (select count(*)::text from pg_constraint where conname in ('workflow_runs_project_organization_fk', 'workflow_runs_project_department_fk', 'workflow_runs_department_organization_fk', 'workflow_run_sources_document_project_fk', 'workflow_run_sources_version_document_project_fk')) as composite_guards,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'workflow_artifacts' and column_name in ('published_document_id', 'published_document_version_id', 'published_at')) as publication_columns,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'document_chunks' and column_name in ('chunk_type', 'parent_content', 'parent_content_sha256', 'parse_quality_bps', 'keywords', 'summary', 'embedding_status')) as structured_chunk_columns,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ai_retrieval_runs' and column_name in ('normalized_query_sha256', 'rewritten_query_count', 'query_processing_latency_ms', 'rerank_latency_ms', 'context_expansion_latency_ms', 'rerank_fallback_reason')) as retrieval_v3_columns,
        (select count(*)::text from test_fixtures where fixture_run_id = 'uat-legacy-import-0025' and entity_type = 'project' and entity_id = 'v3-upgrade-normal-uat-project') as legacy_misclassification_count,
        (select count(*)::text from pg_constraint where conname = 'workflow_run_sources_status_check' and pg_get_constraintdef(oid) like '%deleting%') as source_deleting_status
    `);
    const row = result.rows[0];
    if (
      row.request_id !== "v3-upgrade-ai" ||
      row.status !== "completed" ||
      row.fixture_count !== "1" ||
      row.fixture_columns !== "4" ||
      row.workflow_definitions !== "2" ||
      row.legacy_workflow !== "1" ||
      row.source_project_column !== "1" ||
      row.composite_guards !== "5" ||
      row.publication_columns !== "3" ||
      row.structured_chunk_columns !== "7" ||
      row.retrieval_v3_columns !== "6" ||
      row.legacy_misclassification_count !== "0" ||
      row.source_deleting_status !== "1"
    ) {
      throw new Error("V3_MIGRATION_UPGRADE_ASSERTION_FAILED");
    }
    process.stdout.write(
      `V3 migration upgrade passed through ${files.at(-1)}; legacy data, workflows, structured chunks, privacy-safe retrieval metrics, publication recovery, fixture correction, and composite isolation guards preserved.\n`,
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
