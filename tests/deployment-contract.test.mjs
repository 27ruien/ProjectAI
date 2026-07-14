import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const deployScript = new URL("../scripts/deploy-staging.sh", import.meta.url);
const stagingCompose = new URL("../docker-compose.staging.yml", import.meta.url);

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

test("Staging deployment shell is syntactically valid", async () => {
  await execFileAsync("bash", ["-n", deployScript.pathname]);
});
