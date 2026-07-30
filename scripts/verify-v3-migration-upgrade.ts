import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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

async function applyAtomically(client: Client, filename: string): Promise<void> {
  await client.query("begin");
  try {
    await apply(client, filename);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return postgresErrorCode(error.cause);
  return undefined;
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  const base = new URL(raw);
  const databaseName = `projectai_v3_upgrade_${process.pid}_${Date.now()}`;
  const replayDatabaseName = `${databaseName}_replay`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  let target: Client | undefined;
  let replayTarget: Client | undefined;
  try {
    await admin.query(`create database "${databaseName}"`);
    const targetUrl = new URL(base);
    targetUrl.pathname = `/${databaseName}`;
    target = new Client({ connectionString: targetUrl.toString() });
    await target.connect();
    const files = await migrationFiles();
    const boundary = files.indexOf("0025_marvelous_stephen_strange.sql");
    if (boundary < 0) throw new Error("V3_MIGRATION_0025_MISSING");
    const auditBoundary = files.indexOf("0036_brief_wolverine.sql");
    if (auditBoundary < 0) throw new Error("V3_MIGRATION_0036_MISSING");
    if (auditBoundary !== files.length - 1) {
      throw new Error("V3_MIGRATION_0036_MUST_BE_LATEST");
    }
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
    for (const filename of files.slice(boundary, auditBoundary)) {
      await apply(target, filename);
    }
    await target.query(`
      insert into ai_model_profiles (
        id, provider, purpose, primary_model, fallback_model,
        region, enabled, gateway_version
      ) values (
        'qwen-project-assistant-cn-v1', 'qwen', 'project_assistant',
        'qwen3.7-plus', 'qwen3.6-flash', 'cn-beijing', true, '1'
      ) on conflict (id) do nothing;
      insert into ai_threads (
        id, project_id, created_by, title
      ) values (
        'v3-upgrade-ai-thread', 'v3-upgrade-fixture-project',
        'v3-upgrade-user', 'V3 Upgrade Historical Thread'
      );
      insert into ai_messages (
        id, project_id, thread_id, created_by, role, status, content
      ) values
      (
        'v3-upgrade-ai-user-message', 'v3-upgrade-fixture-project',
        'v3-upgrade-ai-thread', 'v3-upgrade-user', 'user', 'completed',
        'Historical synthetic upgrade question'
      ),
      (
        'v3-upgrade-ai-assistant-message', 'v3-upgrade-fixture-project',
        'v3-upgrade-ai-thread', 'v3-upgrade-user', 'assistant', 'failed',
        'Historical synthetic controlled failure'
      );
      insert into ai_executions (
        id, project_id, thread_id, user_message_id, assistant_message_id,
        actor_user_id, model_profile_id, provider, requested_model,
        actual_model, status, prompt_version, retrieval_version,
        gateway_version, input_token_count, output_token_count,
        total_token_count, latency_ms, question_sha256, idempotency_key,
        failure_code, completed_at
      ) values (
        'v3-upgrade-assistant-execution', 'v3-upgrade-fixture-project',
        'v3-upgrade-ai-thread', 'v3-upgrade-ai-user-message',
        'v3-upgrade-ai-assistant-message', 'v3-upgrade-user',
        'qwen-project-assistant-cn-v1', 'fake', 'fake-model', 'fake-model',
        'failed', 'historical-prompt-v1', 'historical-retrieval-v1', '1',
        2, 3, 5, 7, '${"7".repeat(64)}', 'historical-upgrade-key',
        'CONTROLLED_HISTORICAL_FAILURE', now()
      );
      insert into workflow_executions (
        id, run_id, project_id, step, attempt, status, provider, actual_model,
        latency_ms, input_tokens, output_tokens, result_digest, completed_at
      ) values (
        'v3-upgrade-workflow-execution',
        'workflow-legacy-v3-upgrade-legacy-requirement',
        'v3-upgrade-fixture-project',
        3, 1, 'succeeded', 'fake', 'fake-workflow-model', 25, 7, 11,
        '${"3".repeat(64)}', now()
      );
      insert into project_documents (
        id, project_id, display_name, document_status, created_by
      ) values (
        'v3-upgrade-published-document', 'v3-upgrade-fixture-project',
        'V3 Upgrade Published Document', 'active', 'v3-upgrade-user'
      );
      insert into project_document_versions (
        id, document_id, project_id, version_number, is_current, upload_id,
        object_key, original_filename, normalized_extension,
        declared_mime_type, detected_mime_type, size_bytes, sha256,
        storage_etag, storage_status, uploaded_by, stored_at
      ) values (
        'v3-upgrade-published-version', 'v3-upgrade-published-document',
        'v3-upgrade-fixture-project', 1, true, 'v3-upgrade-published-upload',
        'projects/v3-upgrade-fixture-project/documents/v3-upgrade-published-document/v1',
        'v3-upgrade.md', 'md', 'text/markdown', 'text/markdown', 64,
        '${"4".repeat(64)}', 'v3-upgrade-etag', 'stored',
        'v3-upgrade-user', now()
      );
      insert into workflow_artifacts (
        id, run_id, project_id, artifact_kind, title, status, current_version,
        content_digest, published_document_id, published_document_version_id,
        published_at
      ) values (
        'v3-upgrade-published-artifact',
        'workflow-legacy-v3-upgrade-legacy-requirement',
        'v3-upgrade-fixture-project', 'project_overview',
        'V3 Upgrade Published Artifact', 'published', 1,
        '${"5".repeat(64)}', 'v3-upgrade-published-document',
        'v3-upgrade-published-version', now()
      );
      insert into projects (
        id, organization_id, name, client_name, description, created_by
      ) values (
        'v3-upgrade-cross-project', 'v3-upgrade-org',
        'V3 Upgrade Cross Project', '[TEST] Cross Client',
        '[TEST] invalid publication target', 'v3-upgrade-user'
      );
      insert into project_documents (
        id, project_id, display_name, document_status, created_by
      ) values (
        'v3-upgrade-cross-document', 'v3-upgrade-cross-project',
        'V3 Upgrade Cross Document', 'active', 'v3-upgrade-user'
      );
      insert into project_document_versions (
        id, document_id, project_id, version_number, is_current, upload_id,
        object_key, original_filename, normalized_extension,
        declared_mime_type, detected_mime_type, size_bytes, sha256,
        storage_etag, storage_status, uploaded_by, stored_at
      ) values (
        'v3-upgrade-cross-version', 'v3-upgrade-cross-document',
        'v3-upgrade-cross-project', 1, true, 'v3-upgrade-cross-upload',
        'projects/v3-upgrade-cross-project/documents/v3-upgrade-cross-document/v1',
        'v3-upgrade-cross.md', 'md', 'text/markdown', 'text/markdown', 64,
        '${"6".repeat(64)}', 'v3-upgrade-cross-etag', 'stored',
        'v3-upgrade-user', now()
      );
      update workflow_artifacts
      set published_document_id = 'v3-upgrade-cross-document',
          published_document_version_id = 'v3-upgrade-cross-version'
      where id = 'v3-upgrade-published-artifact';
    `);
    let invalidScopeRejected = false;
    try {
      await applyAtomically(target, "0036_brief_wolverine.sql");
    } catch (error) {
      if (postgresErrorCode(error) !== "23514") throw error;
      invalidScopeRejected = true;
    }
    if (!invalidScopeRejected) {
      throw new Error("V3_MIGRATION_CROSS_PROJECT_HISTORY_ACCEPTED");
    }
    const rollback = await target.query<{
      provider_table: string | null;
      skill_column: string;
      legacy_document_fk: string;
      invalid_artifact: string;
    }>(`
      select
        to_regclass('public.ai_retrieval_provider_calls')::text as provider_table,
        (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'workflow_executions'
            and column_name = 'skill_id') as skill_column,
        (select count(*)::text from pg_constraint
          where conname = 'workflow_artifacts_published_document_id_project_documents_id_fk') as legacy_document_fk,
        (select count(*)::text from workflow_artifacts
          where id = 'v3-upgrade-published-artifact'
            and published_document_id = 'v3-upgrade-cross-document'
            and published_document_version_id = 'v3-upgrade-cross-version') as invalid_artifact
    `);
    const rollbackRow = rollback.rows[0];
    if (
      rollbackRow?.provider_table !== null ||
      rollbackRow.skill_column !== "0" ||
      rollbackRow.legacy_document_fk !== "1" ||
      rollbackRow.invalid_artifact !== "1"
    ) {
      throw new Error("V3_MIGRATION_TRANSACTION_ROLLBACK_FAILED");
    }
    await target.query(`
      update workflow_artifacts
      set published_document_id = 'v3-upgrade-published-document',
          published_document_version_id = 'v3-upgrade-published-version'
      where id = 'v3-upgrade-published-artifact';
      delete from project_document_versions where id = 'v3-upgrade-cross-version';
      delete from project_documents where id = 'v3-upgrade-cross-document';
      delete from projects where id = 'v3-upgrade-cross-project';
    `);
    await applyAtomically(target, "0036_brief_wolverine.sql");
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
      provider_call_table: string;
      project_assistant_profile: string;
      audio_profile: string;
      assistant_execution_cost_column: string;
      historical_assistant_project: string | null;
      historical_assistant_total_tokens: string | null;
      historical_assistant_cost: string | null;
      workflow_execution_audit_columns: string;
      workflow_execution_required_columns: string;
      historical_workflow_skill: string;
      historical_workflow_profile: string;
      historical_workflow_total_tokens: string;
      publication_scope_constraints: string;
      execution_project_unique: string;
      provider_terminal_trigger: string;
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
        (select count(*)::text from pg_constraint where conname = 'workflow_run_sources_status_check' and pg_get_constraintdef(oid) like '%deleting%') as source_deleting_status,
        (select count(*)::text from information_schema.tables where table_schema = 'public' and table_name = 'ai_retrieval_provider_calls') as provider_call_table,
        (select count(*)::text from ai_model_profiles where id = 'qwen-project-assistant-cn-v1' and provider = 'qwen' and purpose = 'project_assistant' and primary_model = 'qwen3.7-plus' and fallback_model = 'qwen3.6-flash' and region = 'cn-beijing' and enabled and gateway_version = '1') as project_assistant_profile,
        (select count(*)::text from ai_model_profiles where id = 'qwen-meeting-transcription-cn-v1' and provider = 'alibaba-model-studio' and purpose = 'audio_transcription' and primary_model = 'paraformer-v2' and fallback_model = 'paraformer-v2' and region = 'cn-beijing' and enabled and gateway_version = '1') as audio_profile,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'ai_executions' and column_name = 'cost_usd_micros') as assistant_execution_cost_column,
        (select project_id from ai_executions where id = 'v3-upgrade-assistant-execution') as historical_assistant_project,
        (select total_token_count::text from ai_executions where id = 'v3-upgrade-assistant-execution') as historical_assistant_total_tokens,
        (select case when cost_usd_micros is null then 'null' else cost_usd_micros::text end from ai_executions where id = 'v3-upgrade-assistant-execution') as historical_assistant_cost,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'workflow_executions' and column_name in ('skill_id', 'model_profile_id', 'total_tokens', 'cost_usd_micros')) as workflow_execution_audit_columns,
        (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'workflow_executions' and column_name in ('skill_id', 'model_profile_id') and is_nullable = 'NO') as workflow_execution_required_columns,
        (select skill_id from workflow_executions where id = 'v3-upgrade-workflow-execution') as historical_workflow_skill,
        (select model_profile_id from workflow_executions where id = 'v3-upgrade-workflow-execution') as historical_workflow_profile,
        (select total_tokens::text from workflow_executions where id = 'v3-upgrade-workflow-execution') as historical_workflow_total_tokens,
        (select count(*)::text from pg_constraint where conname in ('workflow_artifacts_published_document_project_fk', 'workflow_artifacts_published_version_document_project_fk', 'workflow_artifacts_published_link_check')) as publication_scope_constraints,
        (select count(*)::text from pg_constraint where conname = 'ai_executions_id_project_unique') as execution_project_unique,
        (select count(*)::text from pg_trigger where tgname = 'ai_retrieval_provider_calls_terminal_immutable' and not tgisinternal) as provider_terminal_trigger
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
      row.source_deleting_status !== "1" ||
      row.provider_call_table !== "1" ||
      row.project_assistant_profile !== "1" ||
      row.audio_profile !== "1" ||
      row.assistant_execution_cost_column !== "1" ||
      row.historical_assistant_project !== "v3-upgrade-fixture-project" ||
      row.historical_assistant_total_tokens !== "5" ||
      row.historical_assistant_cost !== "null" ||
      row.workflow_execution_audit_columns !== "4" ||
      row.workflow_execution_required_columns !== "2" ||
      row.historical_workflow_skill !== "workflow.requirement_framework.step_3" ||
      row.historical_workflow_profile !== "qwen-project-assistant-cn-v1" ||
      row.historical_workflow_total_tokens !== "18" ||
      row.publication_scope_constraints !== "3" ||
      row.execution_project_unique !== "1" ||
      row.provider_terminal_trigger !== "1"
    ) {
      throw new Error("V3_MIGRATION_UPGRADE_ASSERTION_FAILED");
    }
    await admin.query(`create database "${replayDatabaseName}"`);
    const replayUrl = new URL(base);
    replayUrl.pathname = `/${replayDatabaseName}`;
    replayTarget = new Client({ connectionString: replayUrl.toString() });
    await replayTarget.connect();
    const replayDb = drizzle(replayTarget);
    await migrate(replayDb, { migrationsFolder: "drizzle" });
    const firstReplay = await replayTarget.query<{
      migration_count: string;
      provider_table: string | null;
      cost_column: string;
    }>(`
      select
        (select count(*)::text from drizzle.__drizzle_migrations) as migration_count,
        to_regclass('public.ai_retrieval_provider_calls')::text as provider_table,
        (select count(*)::text from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_executions'
            and column_name = 'cost_usd_micros') as cost_column
    `);
    await migrate(replayDb, { migrationsFolder: "drizzle" });
    const secondReplay = await replayTarget.query<{ migration_count: string }>(
      `select count(*)::text as migration_count from drizzle.__drizzle_migrations`,
    );
    if (
      firstReplay.rows[0]?.migration_count !== String(files.length) ||
      secondReplay.rows[0]?.migration_count !== firstReplay.rows[0]?.migration_count ||
      firstReplay.rows[0]?.provider_table !== "ai_retrieval_provider_calls" ||
      firstReplay.rows[0]?.cost_column !== "1"
    ) {
      throw new Error("V3_MIGRATION_REPLAY_FAILED");
    }
    process.stdout.write(
      `V3 migration upgrade passed through ${files.at(-1)}; non-empty upgrade, invalid publication rollback, replay, legacy data, workflow AI audit, durable retrieval calls, structured chunks, privacy-safe retrieval metrics, publication recovery, fixture correction, and composite isolation guards preserved.\n`,
    );
  } finally {
    await target?.end().catch(() => undefined);
    await replayTarget?.end().catch(() => undefined);
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [databaseName],
    );
    await admin.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`,
      [replayDatabaseName],
    );
    await admin.query(`drop database if exists "${databaseName}"`);
    await admin.query(`drop database if exists "${replayDatabaseName}"`);
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
