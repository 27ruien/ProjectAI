import { defineConfig, devices } from "@playwright/test";

const expectedTarget = "https://gridworks.cn/tool/projectai-staging";
if (process.env.ALLOW_STAGING_PRODUCT_V2_UAT !== "true") {
  throw new Error("ALLOW_STAGING_PRODUCT_V2_UAT_REQUIRED");
}
const target = (process.env.STAGING_PRODUCT_V2_BASE_URL ?? expectedTarget).replace(/\/+$/u, "");
if (target !== expectedTarget) throw new Error("STAGING_PRODUCT_V2_TARGET_INVALID");

process.env.PLAYWRIGHT_BASE_URL = target;
process.env.NEXT_PUBLIC_BASE_PATH = "/tool/projectai-staging";

export default defineConfig({
  testDir: "./tests/product-v2-staging-e2e",
  outputDir: "test-results/product-v2-staging/raw",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: new URL(target).origin,
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
  },
});
