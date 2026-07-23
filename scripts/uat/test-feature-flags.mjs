#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${executable} failed (${signal || code || "unknown"}).`)));
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/tool/projectai-uat/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("UAT flag test server did not become ready.");
}

async function runCase(name, port, dailyReportEnabled, wecomEnabled, baseEnvironment) {
  const env = {
    ...baseEnvironment,
    PORT: String(port),
    HOST: "127.0.0.1",
    AUTH_LOCAL_ORIGIN: `http://127.0.0.1:${port}`,
    AUTH_COOKIE_PREFIX: `projectai_uat_${name.replaceAll("-", "_")}`,
    PM_DAILY_REPORT_ENABLED: String(dailyReportEnabled),
    WECOM_TIMESHEET_SYNC_ENABLED: String(wecomEnabled),
    UAT_FLAG_CASE: name,
    UAT_FLAG_TEST_PORT: String(port),
  };
  const server = spawn(process.execPath, ["scripts/start-e2e-server.mjs"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  try {
    await waitForServer(port);
    await run(path.join(root, "node_modules", ".bin", "playwright"), ["test", "--config=playwright.uat-flags.config.ts"], env);
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

const runtime = parseEnvironment(await readFile(path.join(root, ".local", "uat-runtime.env"), "utf8"));
const baseEnvironment = {
  ...process.env,
  ...runtime,
  NODE_ENV: "test",
  NEXT_PUBLIC_APP_ENV: "test",
  NEXT_PUBLIC_BASE_PATH: "/tool/projectai-uat",
  START_DOCUMENT_WORKER: "false",
  AUTH_TEST_LOGIN_RATE_LIMIT_MAX: "100",
  AI_PROVIDER: "fake",
  AI_ASSISTANT_ENABLED: "true",
  AI_REGION: "cn-beijing",
  AI_PROJECT_ASSISTANT_PROFILE_ID: "qwen-project-assistant-cn-v1",
};
await runCase("daily-off", 3310, false, true, baseEnvironment);
await runCase("wecom-off", 3320, true, false, baseEnvironment);
await runCase("ai-real-unconfigured", 3330, true, true, {
  ...baseEnvironment,
  UAT_AI_PROVIDER: "real",
  AI_PROVIDER: "qwen",
  QWEN_API_KEY: "",
  QWEN_API_KEY_FILE: "",
});
process.stdout.write("Local UAT feature flags and unconfigured Real AI boundary passed.\n");
