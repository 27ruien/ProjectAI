import { defineConfig, devices } from "@playwright/test";

const defaultBasePath = "/tool/projectai";
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || defaultBasePath;
const basePath = `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
const configuredTarget = process.env.PLAYWRIGHT_BASE_URL?.trim();
const localOrigin = `http://127.0.0.1:${port}`;
const target = new URL(configuredTarget || localOrigin);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: target.origin,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: process.env.CI ? "off" : "retain-on-failure",
    video: process.env.CI ? "off" : "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: configuredTarget
    ? undefined
    : {
        // Authentication uses Node PostgreSQL connections and the deployed
        // application runs the vinext standalone Node server. E2E therefore
        // exercises the exact production runtime built by the preceding
        // `npm test` step instead of the Cloudflare-flavoured dev worker.
        command: "node scripts/start-e2e-server.mjs",
        url: `${localOrigin}${basePath}/login`,
        env: {
          ...process.env,
          PORT: String(port),
          HOST: "127.0.0.1",
          NEXT_PUBLIC_BASE_PATH: basePath,
          NODE_ENV: "test",
          NEXT_PUBLIC_APP_ENV: "test",
          AI_PROVIDER: "fake",
          AI_ASSISTANT_ENABLED: "true",
          AI_REGION: "cn-beijing",
          AI_PROJECT_ASSISTANT_PROFILE_ID:
            "qwen-project-assistant-cn-v1",
          PM_DAILY_REPORT_ENABLED: "true",
          WECOM_TIMESHEET_SYNC_ENABLED: "true",
          // The complete serial suite intentionally exercises several actors
          // through the real credential endpoint. Production keeps the strict
          // limit; only this guarded test runtime raises the allowance.
          AUTH_TEST_LOGIN_RATE_LIMIT_MAX: "100",
        },
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
