import { readFile } from "node:fs/promises";
import { Client } from "pg";

function databaseUrl(): URL {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  return new URL(raw);
}

async function main(): Promise<void> {
  const baseUrl = databaseUrl();
  const databaseName = `projectai_embedding_upgrade_${process.pid}_${Date.now()}`;
  if (!/^[a-z0-9_]+$/.test(databaseName)) throw new Error("Unsafe database name.");
  const admin = new Client({ connectionString: baseUrl.toString() });
  await admin.connect();
  let upgrade: Client | undefined;
  try {
    await admin.query(`create database "${databaseName}"`);
    const upgradeUrl = new URL(baseUrl);
    upgradeUrl.pathname = `/${databaseName}`;
    upgrade = new Client({ connectionString: upgradeUrl.toString() });
    await upgrade.connect();
    await upgrade.query(`
      create type document_embedding_batch_status as enum ('succeeded', 'failed');
      create table ai_embedding_profiles (id text primary key);
      create table document_embedding_batches (
        id text primary key,
        job_id text not null,
        project_id text not null,
        document_id text not null,
        version_id text not null,
        embedding_profile_id text not null,
        request_sha256 varchar(64) not null,
        batch_index integer not null,
        attempt_count integer not null,
        status document_embedding_batch_status not null,
        model varchar(120) not null,
        dimensions integer not null,
        chunk_count integer not null,
        input_token_count integer,
        total_token_count integer,
        cost_micro_cny integer,
        latency_ms integer not null,
        provider_request_id varchar(240),
        failure_code varchar(80),
        created_at timestamptz not null default now(),
        constraint document_embedding_batches_values_check check (
          request_sha256 ~ '^[0-9a-f]{64}$'
          and batch_index >= 0 and attempt_count > 0
          and dimensions = 1024 and chunk_count between 1 and 10
          and (input_token_count is null or input_token_count >= 0)
          and (total_token_count is null or total_token_count >= 0)
          and (cost_micro_cny is null or cost_micro_cny >= 0)
          and latency_ms >= 0
        ),
        constraint document_embedding_batches_status_check check (
          (status = 'succeeded' and failure_code is null)
          or (status = 'failed' and failure_code is not null and length(btrim(failure_code)) > 0)
        )
      );
      create unique index document_embedding_batches_request_uidx
        on document_embedding_batches (job_id, request_sha256, attempt_count);
      insert into ai_embedding_profiles (id) values ('qwen-text-embedding-cn-v1');
      insert into document_embedding_batches (
        id, job_id, project_id, document_id, version_id, embedding_profile_id,
        request_sha256, batch_index, attempt_count, status, model, dimensions,
        chunk_count, input_token_count, total_token_count, cost_micro_cny,
        latency_ms, provider_request_id, failure_code, created_at
      ) values
        ('legacy-failed', 'legacy-job', 'project-a', 'document-a', 'version-a',
          'qwen-text-embedding-cn-v1', repeat('a', 64), 0, 1, 'failed',
          'text-embedding-v4', 1024, 1, null, null, null, 5, null,
          'RATE_LIMITED', now() - interval '2 minutes'),
        ('legacy-succeeded', 'legacy-job', 'project-a', 'document-a', 'version-a',
          'qwen-text-embedding-cn-v1', repeat('a', 64), 0, 2, 'succeeded',
          'text-embedding-v4', 1024, 1, 7, 7, null, 8, 'legacy-request',
          null, now() - interval '1 minute'),
        ('legacy-null-usage', 'legacy-job-2', 'project-a', 'document-a', 'version-a',
          'qwen-text-embedding-cn-v1', repeat('b', 64), 0, 1, 'succeeded',
          'text-embedding-v4', 1024, 1, null, null, null, 3, null,
          null, now());
    `);
    const migration = await readFile(
      new URL("../drizzle/0005_durable_embedding_calls.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await upgrade.query(statement);
    }
    const result = await upgrade.query<{
      row_count: string;
      distinct_requests: string;
      terminal_timestamps: string;
      preserved_statuses: string;
      null_usage_reservation: string;
    }>(`
      select
        count(*)::text as row_count,
        count(distinct (job_id, request_sha256))::text as distinct_requests,
        count(*) filter (
          where started_at is not null and completed_at is not null
        )::text as terminal_timestamps,
        count(*) filter (where status in ('succeeded', 'failed'))::text
          as preserved_statuses,
        max(reserved_input_tokens) filter (where id = 'legacy-null-usage')::text
          as null_usage_reservation
      from document_embedding_batches
    `);
    const row = result.rows[0];
    if (
      row?.row_count !== "3" ||
      row.distinct_requests !== "3" ||
      row.terminal_timestamps !== "3" ||
      row.preserved_statuses !== "3" ||
      row.null_usage_reservation !== "2"
    ) {
      throw new Error("The non-empty 0004 to 0005 upgrade contract failed.");
    }
    process.stdout.write("Non-empty 0004 to 0005 Embedding migration upgrade verified.\n");
  } finally {
    if (upgrade) await upgrade.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Embedding migration upgrade verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
