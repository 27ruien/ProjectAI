import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { normalizeApplicationCookieName } from "../scripts/lib/cookie-name.mjs";

const execFileAsync = promisify(execFile);
const deployScript = new URL("../scripts/deploy-staging.sh", import.meta.url);
const stagingCompose = new URL("../docker-compose.staging.yml", import.meta.url);
const stagingNginx = new URL(
  "../deploy/nginx-projectai-staging.conf",
  import.meta.url,
);
const authBoundaryVerifier = new URL(
  "../scripts/verify-auth-boundaries.mjs",
  import.meta.url,
);
const requestProxy = new URL("../proxy.ts", import.meta.url);

test("Staging PostgreSQL readiness checks the final TCP listener", async () => {
  const [script, compose] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
  ]);

  const readinessLine = compose
    .split("\n")
    .find((line) => line.includes("pg_isready"));
  assert.ok(readinessLine, "Staging Compose must define PostgreSQL readiness");
  assert.match(readinessLine, /pg_isready -h 127\.0\.0\.1/);
  assert.match(readinessLine, /\$\$\{POSTGRES_USER\}/);
  assert.match(readinessLine, /\$\$\{POSTGRES_DB\}/);
  assert.match(
    script,
    /PGPASSWORD="\$POSTGRES_PASSWORD" psql \\\n+\s+--host=127\.0\.0\.1/,
  );
});

test("pre-migration backup streams a non-empty custom archive", async () => {
  const script = await readFile(deployScript, "utf8");
  const dumpBlock = script.match(
    /PGPASSWORD="\$POSTGRES_PASSWORD" pg_dump[\s\S]+?' \| sudo tee "\$partial_backup"/,
  )?.[0];

  assert.ok(dumpBlock, "deployment script must contain the protected pg_dump pipeline");
  assert.match(dumpBlock, /--format=custom/);
  assert.match(dumpBlock, /--host=127\.0\.0\.1/);
  assert.doesNotMatch(dumpBlock, /--file(?:=|\s)/);
  assert.match(
    script,
    /if ! sudo test -s "\$partial_backup"; then[\s\S]+?sudo rm -f "\$partial_backup"/,
  );
});

test("database operations use the preloaded immutable image without Compose builds", async () => {
  const script = await readFile(deployScript, "utf8");
  const operationBlocks = [...script.matchAll(/operations=\([\s\S]+?\n\)/g)].map(
    ([block]) => block,
  );

  assert.equal(operationBlocks.length, 2);
  for (const block of operationBlocks) {
    assert.match(block, /sudo docker run/);
    assert.match(block, /--network projectai-staging-internal/);
    assert.match(block, /--env-file "\$env_file"/);
    assert.doesNotMatch(block, /--build/);
  }
  assert.doesNotMatch(script, /--profile operations run/);
  assert.match(script, /"\$db_tools_image_id" npm run db:migrate/);
  assert.match(script, /"\$db_tools_image_id" npm run db:seed/);
  assert.match(
    script,
    /Verifying every Staging project retains a project manager/,
  );
  assert.match(
    script,
    /not exists \([\s\S]+?pm\.role = \$1[\s\S]+?"project_manager"/,
  );
});

test("rollback preserves the previous image health contract", async () => {
  const script = await readFile(deployScript, "utf8");
  const captureBlock = script.match(
    /PREVIOUS_STAGING_STATE=[\s\S]+?REMOTE_IMAGE\n\)/,
  )?.[0];

  assert.ok(captureBlock, "deployment script must capture the rollback target");
  assert.match(captureBlock, /STAGING_HEALTHCHECK_PATH=/);
  assert.match(captureBlock, /running.*healthy/);
  assert.doesNotMatch(captureBlock, /grep -q '\^DATABASE_URL='/);
  assert.doesNotMatch(
    captureBlock,
    /\bcase\b/,
    "Bash 3.2 misparses case blocks inside this heredoc command substitution",
  );
  assert.match(script, /rollback_health_path="\$previous_health_path"/);
});

test("Staging verification preserves the environment name inside secure cookie prefixes", () => {
  assert.equal(
    normalizeApplicationCookieName(
      "__Secure-projectai_staging.session_token=opaque; Path=/tool/projectai-staging",
    ),
    "projectai_staging.session_token",
  );
  assert.equal(
    normalizeApplicationCookieName(
      "projectai_local.session_token=opaque; Path=/tool/projectai",
    ),
    "projectai_local.session_token",
  );
});

test("public Staging redirects are required to stay on the canonical HTTPS URL", async () => {
  const [script, compose, nginx, proxy] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(stagingNginx, "utf8"),
    readFile(requestProxy, "utf8"),
  ]);
  assert.match(compose, /VINEXT_TRUSTED_HOSTS: gridworks\.cn/);
  assert.match(
    nginx,
    /return 308 https:\/\/gridworks\.cn\/tool\/projectai-staging\/;/,
  );
  assert.doesNotMatch(nginx, /return 30[18] \/tool\/projectai-staging\//);
  assert.match(proxy, /host !== expectedHost/);
  assert.match(proxy, /forwardedHost !== expectedHost/);
  assert.match(proxy, /forwardedProto !== "https"/);
  assert.match(proxy, /status: 404/);
  assert.match(
    script,
    /app_root_location" == "\$\{PUBLIC_STAGING_URL\}\/dashboard"/,
  );
  assert.match(
    script,
    /location" == "\$\{PUBLIC_STAGING_URL\}\/login"/,
  );
  assert.match(script, /--header 'Host: attacker\.invalid'/);
  assert.match(script, /hostile_base_location/);
  assert.match(script, /hostile_app_code" == "404"/);
});

test("authentication boundary verification revokes sessions on failure paths", async () => {
  const verifier = await readFile(authBoundaryVerifier, "utf8");
  assert.match(verifier, /projectai-staging-boundary-verifier\/0\.3/);
  assert.match(verifier, /randomUUID\(\)/);
  assert.match(verifier, /async function withSession/);
  assert.match(verifier, /function errorSummary/);
  assert.match(verifier, /error\.errors\.map\(errorSummary\)/);
  assert.match(verifier, /delete from sessions where user_agent = \$1/);
  assert.match(verifier, /leakedSessionCount > 0/);
  assert.doesNotMatch(verifier, /signOut\([^\n]+\.catch/);
});

test("Staging deployment shell is syntactically valid", async () => {
  await execFileAsync("bash", ["-n", deployScript.pathname]);
});
