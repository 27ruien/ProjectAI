import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: "focused-mvp.spec.ts",
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...baseConfig.use,
    trace: "off",
    video: "off",
  },
});
