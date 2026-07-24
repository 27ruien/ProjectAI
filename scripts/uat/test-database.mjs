#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const root = process.cwd();

function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("UAT runtime file is invalid.");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function run(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", script], { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${script} failed (${signal || code || "unknown"}).`)));
  });
}

const runtime = parseEnvironment(await readFile(path.join(root, ".local", "uat-runtime.env"), "utf8"));
const base = new URL(runtime.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1"].includes(base.hostname) || base.pathname !== "/projectai_uat") {
  throw new Error("UAT_DATABASE_TEST_LOCAL_TARGET_REQUIRED");
}
const databaseName = `projectai_uat_test_${process.pid}_${Date.now()}`;
if (!/^projectai_uat_test_[0-9]+_[0-9]+$/u.test(databaseName)) throw new Error("UAT_DATABASE_TEST_NAME_INVALID");
const admin = new Client({ connectionString: base.toString() });
await admin.connect();
let created = false;
try {
  await admin.query(`create database "${databaseName}"`);
  created = true;
  const target = new URL(base);
  target.pathname = `/${databaseName}`;
  const password = randomBytes(24).toString("base64url");
  const env = {
    ...process.env,
    ...runtime,
    DATABASE_URL: target.toString(),
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_BASE_PATH: "/tool/projectai",
    BETTER_AUTH_URL: "http://127.0.0.1:3200/tool/projectai/api/auth",
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    AUTH_PROVIDER: "legacy-credential-test",
    ALLOW_LEGACY_CREDENTIAL_TEST_AUTH: "true",
    PROJECTAI_SEED_ENVIRONMENT: "test",
    PM_DAILY_REPORT_ENABLED: "true",
    WECOM_TIMESHEET_SYNC_ENABLED: "true",
    AI_ASSISTANT_ENABLED: "false",
    AI_REGION: "cn-beijing",
    AI_PROJECT_ASSISTANT_PROFILE_ID: "qwen-project-assistant-cn-v1",
    AI_EMBEDDING_ENABLED: "false",
    AI_EMBEDDING_PROFILE_ID: "qwen-text-embedding-cn-v1",
    AI_EMBEDDING_DIMENSIONS: "1024",
    AI_ASSISTANT_RETRIEVAL_MODE: "lexical",
  };
  for (const key of ["ADMIN", "ORG_ADMIN", "DEPT_ADMIN", "MANAGER_A", "MANAGER_B", "MEMBER_A", "VIEWER_A", "OTHER_DEPT", "OUTSIDER"]) {
    env[`SEED_${key}_EMAIL`] = `${key.toLowerCase().replaceAll("_", "-")}@uat-db.projectai.invalid`;
    env[`SEED_${key}_PASSWORD`] = password;
  }
  for (const script of [
    "db:migrate",
    "db:seed",
    "test:integration",
    "test:phase1-integration",
    "test:phase1-round2-integration",
    "test:phase1-round3-integration",
    "test:assistant-integration",
    "test:embedding-integration",
    "test:retrieval-integration",
    "test:timesheets-integration",
  ]) {
    await run(script, env);
  }
  await run("db:seed:product-v2", {
    ...env,
    AUTH_PROVIDER: "mock-wecom",
    ALLOW_MOCK_WECOM_AUTH: "true",
  });
  await run("test:product-v2-integration", {
    ...env,
    AUTH_PROVIDER: "mock-wecom",
    ALLOW_MOCK_WECOM_AUTH: "true",
  });
  process.stdout.write("Isolated UAT database integration suite passed; the temporary database will be removed.\n");
} finally {
  if (created) await admin.query(`drop database if exists "${databaseName}" with (force)`);
  await admin.end();
}
