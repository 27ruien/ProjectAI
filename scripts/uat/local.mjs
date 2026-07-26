#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const LOCAL_DIR = path.join(ROOT, ".local");
const RUNTIME_FILE = path.join(LOCAL_DIR, "uat-runtime.env");
const COMPOSE_FILE = path.join(ROOT, "docker-compose.uat.yml");
const command = process.argv[2] || "database";

function randomValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

async function runtimeEnvironment() {
  await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
  let source;
  try {
    source = await readFile(RUNTIME_FILE, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const databasePassword = randomValue(24);
    source = [
      `PROJECTAI_UAT_DB_PASSWORD=${databasePassword}`,
      "PROJECTAI_UAT_DB_PORT=55432",
      `DATABASE_URL=postgresql://projectai_uat:${databasePassword}@127.0.0.1:55432/projectai_uat`,
      `BETTER_AUTH_SECRET=${randomValue(48)}`,
      "",
    ].join("\n");
    const file = await open(RUNTIME_FILE, "wx", 0o600);
    try {
      await file.writeFile(source, "utf8");
    } finally {
      await file.close();
    }
  }
  await chmod(RUNTIME_FILE, 0o600);
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("UAT_RUNTIME_FILE_INVALID");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  for (const key of ["PROJECTAI_UAT_DB_PASSWORD", "PROJECTAI_UAT_DB_PORT", "DATABASE_URL", "BETTER_AUTH_SECRET"]) {
    if (!values[key]) throw new Error("UAT_RUNTIME_FILE_INVALID");
  }
  return values;
}

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} failed (${signal || code || "unknown"})`));
    });
  });
}

async function main() {
  if (!["database", "start", "stop", "reseed"].includes(command)) throw new Error("Expected database, start, stop, or reseed.");
  const runtime = await runtimeEnvironment();
  const uatAiProvider = process.env.UAT_AI_PROVIDER?.trim() || "mock";
  if (uatAiProvider !== "mock" && uatAiProvider !== "real") {
    throw new Error("UAT_AI_PROVIDER must be mock or real.");
  }
  const env = {
    ...process.env,
    ...runtime,
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_BASE_PATH: "/tool/projectai-uat",
    PROJECTAI_UAT_ENVIRONMENT: "local",
    ALLOW_UAT_SEED: "true",
    AUTH_LOCAL_ORIGIN: "http://127.0.0.1:3300",
    AUTH_COOKIE_PREFIX: "projectai_uat_local",
    // A complete Local UAT run logs the same synthetic actors in repeatedly
    // across independent suites. Keep rate limiting enabled while allowing the
    // documented gate sequence to finish inside one minute.
    AUTH_TEST_LOGIN_RATE_LIMIT_MAX: "100",
    UAT_AI_PROVIDER: uatAiProvider,
    AI_PROVIDER: uatAiProvider === "real" ? "qwen" : "fake",
    AI_ASSISTANT_ENABLED: "true",
    AI_REGION: "cn-beijing",
    AI_PROJECT_ASSISTANT_PROFILE_ID: "qwen-project-assistant-cn-v1",
    PM_DAILY_REPORT_ENABLED: "true",
    WECOM_TIMESHEET_SYNC_ENABLED: "true",
    WECOM_TIMESHEET_SYNC_PROVIDER:
      process.env.WECOM_TIMESHEET_SYNC_PROVIDER?.trim() || "mock_smartsheet",
    START_DOCUMENT_WORKER: "false",
  };
  const composeArgs = ["compose", "--env-file", RUNTIME_FILE, "-f", COMPOSE_FILE];
  if (command === "stop") {
    await run("docker", [...composeArgs, "stop"], env);
    return;
  }
  await run("docker", [...composeArgs, "up", "-d", "--wait"], env);
  await run(path.join(ROOT, "node_modules", ".bin", "tsx"), ["scripts/db/migrate.ts"], env);
  if (command === "reseed") {
    await run(path.join(ROOT, "node_modules", ".bin", "tsx"), ["scripts/uat/manage.ts", "cleanup"], { ...env, ALLOW_UAT_CLEANUP: "true" });
  }
  await run(path.join(ROOT, "node_modules", ".bin", "tsx"), ["scripts/uat/manage.ts", "seed"], env);
  await run(path.join(ROOT, "node_modules", ".bin", "tsx"), ["scripts/uat/manage.ts", "verify"], env);
  if (command === "database" || command === "reseed") {
    process.stdout.write("Local UAT database is ready; secrets remain in ignored .local files.\n");
    return;
  }
  await run("npm", ["run", "build"], env);
  await run(process.execPath, ["scripts/start-e2e-server.mjs"], { ...env, PORT: "3300", HOST: "127.0.0.1" });
}

main().catch((error) => {
  process.stderr.write(`Local UAT failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
