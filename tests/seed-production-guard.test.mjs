import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the seed command rejects Production before database access", () => {
  const executable = path.resolve("node_modules", ".bin", "tsx");
  const result = spawnSync(executable, ["scripts/db/seed.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_ENV: "production",
      PROJECTAI_SEED_ENVIRONMENT: "production",
      DATABASE_URL: "postgresql://127.0.0.1:1/must_not_be_contacted",
    },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SEED_PRODUCTION_FORBIDDEN/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|password|session|cookie/i);
});
