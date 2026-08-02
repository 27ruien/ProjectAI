import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ordinary Staging deploy defaults to app-only and does not require seed credentials", async () => {
  const deploy = await read("scripts/deploy-staging.sh");
  assert.match(deploy, /DEPLOY_MODE="\$\{PROJECTAI_STAGING_DEPLOY_MODE:-app\}"/);
  assert.match(deploy, /if \[\[ "\$deploy_mode" == "full" \]\]; then[\s\S]+?SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD/);
  assert.match(deploy, /if \[\[ "\$DEPLOY_MODE" == "app" \]\]; then[\s\S]+?staging-app-only-deploy\.sh/);
  assert.match(deploy, /Replacing only the Staging App and required Workers without Migration, Seed, or credential E2E/);
  assert.match(deploy, /"app" \|\| "\$DEPLOY_MODE" == "app-migrate"/);
  assert.match(deploy, /staging-app-migrate-deploy\.sh/);
});

test("app-migrate backs up then migrates without seed or credential reset", async () => {
  const helper = await read("scripts/release/staging-app-migrate-deploy.sh");
  assert.match(helper, /pg_dump --format=custom/);
  assert.match(helper, /pg_restore --list/);
  assert.match(helper, /required_backup_bytes/);
  assert.match(helper, /projectai-migrate npm run db:migrate/);
  assert.doesNotMatch(helper, /db:seed|reset-test-account|SEED_[A-Z_]*PASSWORD/);
});

test("app-only helper cannot migrate, seed, reset credentials, or mutate business rows", async () => {
  const helper = await read("scripts/release/staging-app-only-deploy.sh");
  assert.doesNotMatch(helper, /db:migrate|db:seed|reset-test-account|SEED_[A-Z_]*PASSWORD/);
  assert.doesNotMatch(helper, /\b(?:insert|update|delete|drop|truncate|alter|create)\b/i);
  assert.match(helper, /before_counts="\$\(database_counts\)"/);
  assert.match(helper, /after_counts="\$\(database_counts\)"/);
  assert.match(helper, /\[\[ "\$after_counts" == "\$before_counts" \]\]/);
  assert.match(helper, /--header "Host: gridworks\.cn"/);
  assert.match(helper, /STAGING_APP_HEALTHCHECK_FAILED/);
  assert.match(helper, /STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_INSPECT_FAILED/);
  assert.match(helper, /STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_MISSING/);
  assert.doesNotMatch(helper, /eq \.Destination \\\"\/run\/secrets\/provider_credentials_key\\\"/);
  assert.match(helper, /projectai-document-worker projectai-embedding-worker projectai-staging/);
});

test("credential mount template is valid Docker Go template and rejects the historical escaping", async (t) => {
  execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "pipe" });
  const directory = await mkdtemp(join(tmpdir(), "projectai-inspect-template-"));
  const source = join(directory, "provider_credentials_key");
  const container = `projectai-inspect-template-${process.pid}-${Date.now()}`;
  await writeFile(source, "test-only-provider-credential\n", { mode: 0o600 });
  t.after(async () => {
    spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
    await rm(directory, { recursive: true, force: true });
  });

  execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      container,
      "--mount",
      `type=bind,src=${source},dst=/run/secrets/provider_credentials_key,readonly`,
      "alpine:3.21",
      "sleep",
      "30",
    ],
    { stdio: "pipe" },
  );

  const validTemplate = '{{range .Mounts}}{{if eq .Destination "/run/secrets/provider_credentials_key"}}{{println .Destination}}{{end}}{{end}}';
  const mount = execFileSync("docker", ["inspect", "--format", validTemplate, container], {
    encoding: "utf8",
  }).trim();
  assert.equal(mount, "/run/secrets/provider_credentials_key");

  const invalidTemplate = String.raw`{{range .Mounts}}{{if eq .Destination \"/run/secrets/provider_credentials_key\"}}{{println .Destination}}{{end}}{{end}}`;
  const invalid = spawnSync("docker", ["inspect", "--format", invalidTemplate, container], {
    encoding: "utf8",
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /template parsing error/);
});

test("explicit seed and password reset still fail closed without credentials", async () => {
  const seed = await read("scripts/db/seed.ts");
  const reset = await read("scripts/db/reset-test-account-password.ts");
  assert.match(seed, /requiredEnvironment\(`SEED_\$\{spec\.key\}_PASSWORD`\)/);
  assert.match(reset, /required\("TEST_ACCOUNT_NEW_PASSWORD"\)/);
  assert.match(reset, /TEST_ACCOUNT_RESET_PRODUCTION_FORBIDDEN/);
});

test("application runtime does not receive seed passwords", async () => {
  const compose = await read("docker-compose.staging.yml");
  const appStart = compose.indexOf("  projectai-staging:\n    image:");
  const workerStart = compose.indexOf("  projectai-document-worker:\n", appStart);
  assert.ok(appStart >= 0 && workerStart > appStart);
  const app = compose.slice(appStart, workerStart);
  assert.doesNotMatch(app, /SEED_[A-Z_]*PASSWORD|PROJECTAI_SEED_ENVIRONMENT/);
  assert.match(app, /DATABASE_URL:/);
  assert.match(app, /BETTER_AUTH_SECRET:/);
});
