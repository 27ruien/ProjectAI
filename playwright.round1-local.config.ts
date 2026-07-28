import { defineConfig, devices } from "@playwright/test";

if (process.env.NODE_ENV !== "test") {
  throw new Error("ROUND1_LOCAL_UAT_REQUIRES_NODE_ENV_TEST");
}

const target = (
  process.env.ROUND1_LOCAL_BASE_URL ??
  "http://127.0.0.1:3300/tool/projectai-uat"
).replace(/\/+$/u, "");
const parsedTarget = new URL(target);
if (
  parsedTarget.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(parsedTarget.hostname)
) {
  throw new Error("ROUND1_LOCAL_UAT_TARGET_INVALID");
}

process.env.PLAYWRIGHT_BASE_URL = target;
process.env.NEXT_PUBLIC_BASE_PATH = parsedTarget.pathname;

export default defineConfig({
  testDir: "./tests/product-v2-staging-e2e",
  outputDir: "test-results/round1-local",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: parsedTarget.origin,
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
  },
});
