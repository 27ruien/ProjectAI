import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const executable = path.resolve("node_modules", ".bin", "tsx");

function invoke(command, overrides = {}) {
  return spawnSync(executable, ["scripts/uat/manage.ts", command], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_ENV: "test",
      PROJECTAI_UAT_ENVIRONMENT: "local",
      DATABASE_URL: "postgresql://127.0.0.1:1/projectai_uat",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("UAT seed requires an explicit opt-in before database access", () => {
  const result = invoke("seed");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ALLOW_UAT_SEED_REQUIRED/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});

test("UAT seed rejects Production before database access", () => {
  const result = invoke("seed", {
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_ENV: "production",
    PROJECTAI_UAT_ENVIRONMENT: "staging",
    ALLOW_UAT_SEED: "true",
    ALLOW_STAGING_UAT: "true",
    DATABASE_URL: "postgresql://127.0.0.1:1/must_not_be_contacted",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UAT_PRODUCTION_FORBIDDEN/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});

test("UAT cleanup requires a separate explicit opt-in", () => {
  const result = invoke("cleanup");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ALLOW_UAT_CLEANUP_REQUIRED/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});

test("local UAT refuses a non-UAT database name", () => {
  const result = invoke("seed", {
    ALLOW_UAT_SEED: "true",
    DATABASE_URL: "postgresql://127.0.0.1:1/projectai",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UAT_LOCAL_DATABASE_TARGET_INVALID/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});

test("Staging refuses the retired legacy credential UAT before database access", () => {
  const result = invoke("seed", {
    PROJECTAI_UAT_ENVIRONMENT: "staging",
    ALLOW_UAT_SEED: "true",
    ALLOW_STAGING_UAT: "true",
    DATABASE_URL: "postgresql://127.0.0.1:1/projectai_uat",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LEGACY_CREDENTIAL_UAT_RETIRED_USE_PRODUCT_V2_MOCK_WECOM/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});

test("Staging UAT data uses the reviewed synthetic marker and names", async () => {
  const source = await readFile("scripts/uat/manage.ts", "utf8");
  assert.match(source, /\[ProjectAI-STAGING-UAT\]/);
  assert.match(source, /ProjectAI Staging UAT/);
  assert.match(source, /ProjectAI WeCom Staging UAT/);
  assert.match(source, /Staging UAT Project Manager/);
  assert.match(source, /Staging UAT Restricted User/);
});
