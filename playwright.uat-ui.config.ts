import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const credentials = JSON.parse(
  readFileSync(path.resolve(".local/uat-credentials.json"), "utf8"),
) as {
  accounts: Record<"manager", { email: string; password: string }>;
};

process.env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3300/tool/projectai-uat";
process.env.NEXT_PUBLIC_BASE_PATH = "/tool/projectai-uat";
process.env.UAT_MANAGER_EMAIL = credentials.accounts.manager.email;
process.env.UAT_MANAGER_PASSWORD = credentials.accounts.manager.password;

export default defineConfig({
  testDir: "./tests/uat-ui-e2e",
  outputDir: "test-results/uat-ui",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3300",
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 12_000,
    navigationTimeout: 25_000,
  },
  webServer: {
    command: "npm run uat:start",
    url: "http://127.0.0.1:3300/tool/projectai-uat/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
