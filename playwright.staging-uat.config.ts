import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const expectedTarget = "https://gridworks.cn/tool/projectai-staging";
if (process.env.ALLOW_STAGING_UAT !== "true") {
  throw new Error("ALLOW_STAGING_UAT_REQUIRED");
}
const target = (process.env.STAGING_UAT_BASE_URL ?? expectedTarget).replace(/\/+$/u, "");
if (target !== expectedTarget) throw new Error("STAGING_UAT_TARGET_INVALID");

const credentialPath = path.resolve(
  process.env.STAGING_UAT_CREDENTIAL_PATH ?? ".local/staging-uat-credentials.json",
);
const credentials = JSON.parse(readFileSync(credentialPath, "utf8")) as {
  accounts: Record<"admin" | "manager" | "restricted", { email: string; password: string }>;
};

process.env.PLAYWRIGHT_BASE_URL = target;
process.env.NEXT_PUBLIC_BASE_PATH = "/tool/projectai-staging";
process.env.UAT_ADMIN_EMAIL = credentials.accounts.admin.email;
process.env.UAT_ADMIN_PASSWORD = credentials.accounts.admin.password;
process.env.UAT_MANAGER_EMAIL = credentials.accounts.manager.email;
process.env.UAT_MANAGER_PASSWORD = credentials.accounts.manager.password;
process.env.UAT_RESTRICTED_EMAIL = credentials.accounts.restricted.email;
process.env.UAT_RESTRICTED_PASSWORD = credentials.accounts.restricted.password;

export default defineConfig({
  testDir: "./tests/staging-uat-e2e",
  outputDir: "test-results/staging-uat/raw",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "https://gridworks.cn",
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
