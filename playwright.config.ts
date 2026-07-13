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
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
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
        command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
        url: `${localOrigin}${basePath}/dashboard`,
        env: {
          ...process.env,
          NEXT_PUBLIC_BASE_PATH: basePath,
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
