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
  const databaseName = `projectai_retrieval_upgrade_${process.pid}_${Date.now()}`;
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
    for (const filename of [
      "0000_lovely_mongu.sql",
      "0001_wide_sunspot.sql",
      "0002_easy_scarlet_witch.sql",
      "0003_tricky_hannibal_king.sql",
      "0004_groovy_nightcrawler.sql",
      "0005_durable_embedding_calls.sql",
      "0006_closed_genesis.sql",
    ]) {
      await applyMigration(upgrade, filename);
    }
    await upgrade.query(`
      insert into users (id, email, display_name)
      values ('upgrade-user', 'upgrade@projectai.invalid', 'Upgrade User');
      insert into projects (id, name, client_name, created_by)
      values ('upgrade-project', 'Fictional Upgrade Project', 'Fictional Client', 'upgrade-user');
      insert into ai_model_profiles (
        id, provider, purpose, primary_model, fallback_model, region, gateway_version
      ) values (
        'qwen-project-assistant-cn-v1', 'qwen', 'project_assistant',
        'qwen3.7-plus', 'qwen3.6-flash', 'cn-beijing', '1'
      );
      insert into ai_threads (id, project_id, created_by, title)
      values ('upgrade-thread', 'upgrade-project', 'upgrade-user', 'Fictional upgrade');
      insert into ai_messages (
        id, project_id, thread_id, created_by, role, status, content
      ) values
        ('upgrade-user-message', 'upgrade-project', 'upgrade-thread', 'upgrade-user',
          'user', 'completed', 'Fictional upgrade question'),
        ('upgrade-assistant-message', 'upgrade-project', 'upgrade-thread', 'upgrade-user',
          'assistant', 'pending', '');
      insert into ai_executions (
        id, project_id, thread_id, user_message_id, assistant_message_id,
        actor_user_id, model_profile_id, provider, requested_model, status,
        prompt_version, retrieval_version, gateway_version, question_sha256,
        idempotency_key
      ) values (
        'upgrade-execution', 'upgrade-project', 'upgrade-thread',
        'upgrade-user-message', 'upgrade-assistant-message', 'upgrade-user',
        'qwen-project-assistant-cn-v1', 'qwen', 'qwen3.7-plus', 'reserved',
        '1', 'lexical-1', '1', repeat('a', 64), 'upgrade-idempotency-key'
      );
    `);
    await upgrade.query("begin");
    try {
      await applyMigration(upgrade, "0007_cynical_whizzer.sql");
      await upgrade.query("commit");
    } catch (error) {
      await upgrade.query("rollback");
      throw error;
    }
    const verified = await upgrade.query<{
      execution_count: string;
      lexical_default_count: string;
      profile_count: string;
      profile_trigger_count: string;
      call_trigger_count: string;
    }>(`
      select
        (select count(*)::text from ai_executions where id = 'upgrade-execution')
          as execution_count,
        (select count(*)::text from ai_executions
          where id = 'upgrade-execution'
            and requested_retrieval_mode = 'lexical'
            and retrieval_profile_id = 'hybrid-rrf-v1') as lexical_default_count,
        (select count(*)::text from ai_retrieval_profiles
          where id = 'hybrid-rrf-v1' and enabled = true
            and vector_max_distance = 0.55 and rrf_k = 60
            and min_embedding_coverage_bps = 9800) as profile_count,
        (select count(*)::text from pg_trigger
          where tgname = 'ai_retrieval_profiles_immutable')
          as profile_trigger_count,
        (select count(*)::text from pg_trigger
          where tgname = 'ai_retrieval_query_embedding_calls_terminal_immutable')
          as call_trigger_count
    `);
    const row = verified.rows[0];
    if (
      row?.execution_count !== "1" ||
      row.lexical_default_count !== "1" ||
      row.profile_count !== "1" ||
      row.profile_trigger_count !== "1" ||
      row.call_trigger_count !== "1"
    ) {
      throw new Error(
        `The non-empty 0004 to 0007 upgrade contract failed: ${JSON.stringify(row)}`,
      );
    }
    process.stdout.write(
      "Non-empty 0004 to 0005 to 0006 to 0007 retrieval migration upgrade verified.\n",
    );
  } finally {
    if (upgrade) await upgrade.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Retrieval migration upgrade verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
