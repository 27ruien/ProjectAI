import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const credentials = JSON.parse(readFileSync(path.resolve(".local/uat-credentials.json"), "utf8")) as {
  accounts: { manager: { email: string; password: string } };
};
const port = Number(process.env.UAT_FLAG_TEST_PORT);
if (!Number.isInteger(port) || port < 1024) throw new Error("UAT_FLAG_TEST_PORT is required.");
if (!new Set(["daily-off", "wecom-off"]).has(process.env.UAT_FLAG_CASE ?? "")) throw new Error("UAT_FLAG_CASE is invalid.");
process.env.PLAYWRIGHT_BASE_URL = `http://127.0.0.1:${port}/tool/projectai-uat`;
process.env.NEXT_PUBLIC_BASE_PATH = "/tool/projectai-uat";
process.env.UAT_MANAGER_EMAIL = credentials.accounts.manager.email;
process.env.UAT_MANAGER_PASSWORD = credentials.accounts.manager.password;

export default defineConfig({
  testDir: "./tests/uat-flag-e2e",
  outputDir: "test-results/uat-flags",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
