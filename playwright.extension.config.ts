import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension-e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 3_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
});
