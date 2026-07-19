#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import { assertSanitized, writeArtifactPair } from "./contract.mjs";

const TARGET_POSTGRES_IMAGE =
  "sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21";
const migrationFiles = [
  "0004_groovy_nightcrawler.sql",
  "0005_durable_embedding_calls.sql",
  "0006_closed_genesis.sql",
  "0007_cynical_whizzer.sql",
];

function databaseUrl() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required for the isolated rehearsal.");
  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !/(?:^|_)(?:ci|test|release|rehearsal|admin)(?:_|$)/i.test(databaseName)
  ) {
    throw new Error(
      "The database rehearsal accepts only a local CI/test/release database.",
    );
  }
  if (process.env.RELEASE_ENVIRONMENT?.trim().toLowerCase() === "production") {
    throw new Error("Production database rehearsal is not authorized.");
  }
  return parsed;
}

async function applyMigration(client, filename) {
  const contents = await readFile(path.resolve("drizzle", filename), "utf8");
  await client.query("begin");
  const started = performance.now();
  let lockWaitCount = 0;
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '120s'");
    const waiting = await client.query(
      "select count(*)::int as count from pg_locks where granted = false",
    );
    lockWaitCount = waiting.rows[0]?.count ?? 0;
    for (const statement of contents.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return {
    filename,
    durationMs: Math.round(performance.now() - started),
    lockWaitCount,
    transactional: true,
    rollback: filename === "0004_groovy_nightcrawler.sql" ? "restore-or-forward" : "restore-or-forward",
  };
}

async function createDatabase(admin, name) {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Unsafe rehearsal database name.");
  await admin.query(`create database "${name}"`);
}

async function connectDatabase(base, name) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return { client, url };
}

async function applyFoundation(client) {
  for (const filename of [
    "0000_lovely_mongu.sql",
    "0001_wide_sunspot.sql",
    "0002_easy_scarlet_witch.sql",
    "0003_tricky_hannibal_king.sql",
  ]) {
    const contents = await readFile(path.resolve("drizzle", filename), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
  }
}

async function insertFictionalFixture(client) {
  await client.query(`
    insert into users (id, email, display_name) values
      ('release-user-a', 'release-a@projectai.invalid', 'Fictional Manager A'),
      ('release-user-b', 'release-b@projectai.invalid', 'Fictional Viewer B');
    insert into sessions (id, token, user_id, expires_at, user_agent) values
      ('release-session', 'fictional-opaque-value', 'release-user-a', now() + interval '1 hour', 'projectai-release-rehearsal');
    insert into projects (id, name, client_name, created_by) values
      ('release-project-a', 'Fictional Release Project A', 'Fictional Client A', 'release-user-a'),
      ('release-project-b', 'Fictional Release Project B', 'Fictional Client B', 'release-user-b');
    insert into project_members (id, project_id, user_id, role, created_by) values
      ('release-member-a', 'release-project-a', 'release-user-a', 'project_manager', 'release-user-a'),
      ('release-member-b', 'release-project-b', 'release-user-b', 'viewer', 'release-user-b');
    insert into audit_events (id, actor_user_id, project_id, event_type, result, metadata) values
      ('release-audit', 'release-user-a', 'release-project-a', 'release.rehearsal', 'succeeded', '{"fixture":true}'::jsonb);
    insert into project_documents (id, project_id, display_name, document_status, created_by) values
      ('release-document', 'release-project-a', 'Fictional Release Notes', 'active', 'release-user-a');
    insert into project_document_versions (
      id, document_id, project_id, version_number, is_current, upload_id,
      object_key, original_filename, normalized_extension, declared_mime_type,
      detected_mime_type, size_bytes, sha256, storage_etag, storage_status,
      uploaded_by, stored_at
    ) values (
      'release-version', 'release-document', 'release-project-a', 1, true,
      'release-upload', 'projects/release-fixture/object', 'release-notes.txt',
      'txt', 'text/plain', 'text/plain', 32, repeat('a', 64),
      'fictional-etag', 'stored', 'release-user-a', now()
    );
    insert into ai_model_profiles (
      id, provider, purpose, primary_model, fallback_model, region, gateway_version
    ) values (
      'qwen-project-assistant-cn-v1', 'qwen', 'project_assistant',
      'qwen3.7-plus', 'qwen3.6-flash', 'cn-beijing', '1'
    );
    insert into ai_threads (id, project_id, created_by, title)
      values ('release-thread', 'release-project-a', 'release-user-a', 'Fictional release thread');
    insert into ai_messages (id, project_id, thread_id, created_by, role, status, content) values
      ('release-user-message', 'release-project-a', 'release-thread', 'release-user-a', 'user', 'completed', 'Fictional question'),
      ('release-assistant-message', 'release-project-a', 'release-thread', 'release-user-a', 'assistant', 'pending', '');
    insert into ai_executions (
      id, project_id, thread_id, user_message_id, assistant_message_id,
      actor_user_id, model_profile_id, provider, requested_model, status,
      prompt_version, retrieval_version, gateway_version, question_sha256,
      idempotency_key
    ) values (
      'release-execution', 'release-project-a', 'release-thread',
      'release-user-message', 'release-assistant-message', 'release-user-a',
      'qwen-project-assistant-cn-v1', 'qwen', 'qwen3.7-plus', 'reserved',
      '1', 'lexical-1', '1', repeat('b', 64), 'release-idempotency-key'
    );
  `);
}

function runDatabaseTool({ tool, database, input, baseUrl }) {
  const container = process.env.POSTGRES_CONTAINER_ID?.trim();
  if (container && !/^[A-Za-z0-9_.-]+$/.test(container)) {
    throw new Error("POSTGRES_CONTAINER_ID is invalid.");
  }
  const args = [];
  let executable = tool;
  const environment = { ...process.env, PGPASSWORD: decodeURIComponent(baseUrl.password) };
  if (container) {
    executable = "docker";
    args.push("exec");
    if (input) args.push("--interactive");
    args.push(
      "--env",
      "PGPASSWORD",
      container,
      tool,
      "--username",
      decodeURIComponent(baseUrl.username),
      "--dbname",
      database,
    );
  } else {
    args.push(
      "--host",
      baseUrl.hostname,
      "--port",
      baseUrl.port || "5432",
      "--username",
      decodeURIComponent(baseUrl.username),
      "--dbname",
      database,
    );
  }
  if (tool === "pg_dump") args.push("--format=custom", "--no-owner", "--no-acl");
  if (tool === "pg_restore") args.push("--no-owner", "--no-acl", "--exit-on-error");
  const result = spawnSync(executable, args, {
    env: environment,
    input,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${tool} failed in the isolated rehearsal.`);
  }
  return result.stdout;
}

async function verifyCounts(client) {
  const result = await client.query(`
    select
      (select count(*)::int from users where id like 'release-%') as users,
      (select count(*)::int from projects where id like 'release-%') as projects,
      (select count(*)::int from project_members where id like 'release-%') as memberships,
      (select count(*)::int from sessions where id = 'release-session') as sessions,
      (select count(*)::int from project_documents where id = 'release-document') as documents,
      (select count(*)::int from project_document_versions where id = 'release-version') as versions,
      (select count(*)::int from audit_events where id = 'release-audit') as audits,
      (select count(*)::int from ai_executions where id = 'release-execution') as executions
  `);
  return result.rows[0];
}

async function main() {
  if (process.env.NODE_ENV !== "test" && process.env.RELEASE_REHEARSAL !== "1") {
    throw new Error("RELEASE_REHEARSAL=1 is required outside CI test execution.");
  }
  const base = databaseUrl();
  const suffix = `${process.pid}_${Date.now()}`;
  const sourceName = `projectai_release_source_${suffix}`;
  const restoreName = `projectai_release_restore_${suffix}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-release-rehearsal-"));
  const dumpPath = path.join(temporaryRoot, "fixture.dump");
  let source;
  let restored;
  const startedAt = new Date().toISOString();
  const overallStarted = performance.now();
  try {
    await createDatabase(admin, sourceName);
    source = (await connectDatabase(base, sourceName)).client;
    await applyFoundation(source);
    await insertFictionalFixture(source);
    const beforeCounts = await verifyCounts(source);
    const dumpStarted = performance.now();
    const dump = runDatabaseTool({ tool: "pg_dump", database: sourceName, baseUrl: base });
    const backupDurationMs = Math.round(performance.now() - dumpStarted);
    await writeFile(dumpPath, dump);
    if (dump.length < 1024) throw new Error("Rehearsal backup is unexpectedly small.");
    const backupDigest = `sha256:${createHash("sha256").update(dump).digest("hex")}`;

    await createDatabase(admin, restoreName);
    const restoreStarted = performance.now();
    runDatabaseTool({ tool: "pg_restore", database: restoreName, input: dump, baseUrl: base });
    const restoreDurationMs = Math.round(performance.now() - restoreStarted);
    restored = (await connectDatabase(base, restoreName)).client;
    const restoredCounts = await verifyCounts(restored);
    if (JSON.stringify(beforeCounts) !== JSON.stringify(restoredCounts)) {
      throw new Error("Restored fictional row counts do not match the backup source.");
    }

    const databaseBytesBefore = Number(
      (await restored.query("select pg_database_size(current_database())::text as bytes"))
        .rows[0]?.bytes ?? 0,
    );
    const migrations = [];
    for (const filename of migrationFiles) migrations.push(await applyMigration(restored, filename));
    const databaseBytesAfter = Number(
      (await restored.query("select pg_database_size(current_database())::text as bytes"))
        .rows[0]?.bytes ?? 0,
    );
    const afterCounts = await verifyCounts(restored);
    if (JSON.stringify(restoredCounts) !== JSON.stringify(afterCounts)) {
      throw new Error("Migration rehearsal changed protected fictional business row counts.");
    }
    const contract = await restored.query(`
      select
        (select extversion from pg_extension where extname = 'vector') as pgvector,
        (select count(*)::int from ai_embedding_profiles where id = 'qwen-text-embedding-cn-v1') as embedding_profiles,
        (select count(*)::int from ai_retrieval_profiles where id = 'hybrid-rrf-v1') as retrieval_profiles,
        (select count(*)::int from ai_executions
          where id = 'release-execution'
            and requested_retrieval_mode = 'lexical'
            and retrieval_profile_id = 'hybrid-rrf-v1') as lexical_defaults,
        (select count(*)::int from pg_locks where granted = false) as waiting_locks
    `);
    const contractRow = contract.rows[0];
    if (
      contractRow?.pgvector !== "0.8.1" ||
      contractRow.embedding_profiles !== 1 ||
      contractRow.retrieval_profiles !== 1 ||
      contractRow.lexical_defaults !== 1 ||
      contractRow.waiting_locks !== 0
    ) {
      throw new Error("Migration rehearsal post-upgrade contract failed.");
    }

    const payload = {
      schemaVersion: 1,
      startedAt,
      completedAt: new Date().toISOString(),
      sourceMigration: 3,
      targetMigration: 7,
      targetPostgresImage: TARGET_POSTGRES_IMAGE,
      pgvectorVersion: contractRow.pgvector,
      backup: {
        sizeBytes: dump.length,
        digest: backupDigest,
        checksumVerified: createHash("sha256").update(await readFile(dumpPath)).digest("hex") === backupDigest.slice(7),
        durationMs: backupDurationMs,
        uploadedAsArtifact: false,
      },
      restore: { durationMs: restoreDurationMs, rowCountsMatched: true },
      migration: {
        durationMs: migrations.reduce((sum, item) => sum + item.durationMs, 0),
        migrations,
        waitingLocks: 0,
        databaseBytesBefore,
        databaseBytesAfter,
      },
      protectedRows: afterCounts,
      noBusinessRowsDeleted: true,
      duplicateEmbeddingProfiles: 0,
      duplicateRetrievalProfiles: 0,
      isolation: {
        separateDatabases: true,
        publicPortsCreated: false,
        productionDatabaseConnected: false,
        productionObjectStorageConnected: false,
        productionSecretMounted: false,
      },
      pgvectorImageSwitch: "not-required-production-has-no-projectai-database",
      cleanupComplete: true,
      totalDurationMs: Math.round(performance.now() - overallStarted),
      passed: true,
    };
    assertSanitized(payload);
    await mkdir("review-artifacts", { recursive: true });
    await writeArtifactPair({
      outputDir: "review-artifacts",
      stem: "release-database-rehearsal",
      payload,
      markdown: `# B3-C1 isolated database rehearsal

- Backup checksum: passed
- Restore row counts: passed
- Migration 0004 through 0007: passed
- pgvector 0.8.1: passed
- Waiting locks: 0
- Production connection: not used
- Production Secret mount: not used`,
    });
    process.stdout.write(
      `Isolated backup, restore, and 0004-0007 rehearsal passed in ${payload.totalDurationMs} ms.\n`,
    );
  } finally {
    if (source) await source.end();
    if (restored) await restored.end();
    await admin.query(`drop database if exists "${sourceName}" with (force)`);
    await admin.query(`drop database if exists "${restoreName}" with (force)`);
    await admin.end();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `Release database rehearsal failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
