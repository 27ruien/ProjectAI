import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  assertSanitized,
  digestObject,
  writeArtifactPair,
} from "../scripts/release/contract.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(root, "scripts/release/cli.mjs");
const rehearsalReport = path.join(
  root,
  "scripts/release/rehearsal-report.mjs",
);
const productionFixture = path.join(
  root,
  "release/fixtures/production-like-inventory.json",
);
const stagingFixture = path.join(
  root,
  "release/fixtures/staging-like-inventory.json",
);
const manifestInput = path.join(
  root,
  "release/fixtures/release-manifest-input.json",
);
const preflightChecks = path.join(
  root,
  "release/fixtures/preflight-checks-passed.json",
);
const rehearsalFixture = path.join(
  root,
  "release/fixtures/rehearsal-passed.json",
);
const restoreFixture = path.join(
  root,
  "release/fixtures/restore-drill-passed.json",
);
const smokeFixture = path.join(root, "release/fixtures/smoke-passed.json");

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "projectai-release-test-"));
}

async function run(command, args, cwd = root) {
  return execFileAsync(process.execPath, [cli, command, ...args], {
    cwd,
    env: { ...process.env, CI: "false" },
  });
}

test("inventory writes canonical sanitized JSON and Markdown", async () => {
  const output = await temporaryRoot();
  try {
    await run("inventory", [
      "--environment=production",
      `--input=${productionFixture}`,
      `--output-dir=${output}`,
    ]);
    const inventory = JSON.parse(
      await readFile(path.join(output, "production-inventory.json"), "utf8"),
    );
    assert.match(inventory.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(inventory.environment, "production");
    assert.equal(inventory.database.present, false);
    assert.equal(
      inventory.digest,
      digestObject(
        Object.fromEntries(
          Object.entries(inventory).filter(([key]) => key !== "digest"),
        ),
      ),
    );
    assert.match(
      await readFile(path.join(output, "production-inventory.md"), "utf8"),
      /Database: absent/,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("diff classifies every release delta and fails closed on unknowns", async () => {
  const output = await temporaryRoot();
  const productionOutput = path.join(output, "production");
  const stagingOutput = path.join(output, "staging");
  const diffOutput = path.join(output, "diff");
  try {
    await run("inventory", [
      "--environment=production",
      `--input=${productionFixture}`,
      `--output-dir=${productionOutput}`,
    ]);
    await run("inventory", [
      "--environment=staging",
      `--input=${stagingFixture}`,
      `--output-dir=${stagingOutput}`,
    ]);
    await run("diff", [
      `--production-inventory=${path.join(productionOutput, "production-inventory.json")}`,
      `--staging-inventory=${path.join(stagingOutput, "staging-inventory.json")}`,
      `--output-dir=${diffOutput}`,
    ]);
    const report = JSON.parse(
      await readFile(path.join(diffOutput, "production-staging-diff.json"), "utf8"),
    );
    assert.ok(report.differenceCount >= 10);
    assert.equal(report.blockingDifferenceCount, 0);
    assert.ok(
      report.differences.some(
        (item) => item.field === "database.present" && item.category === "requires_new_service",
      ),
    );
    assert.ok(
      report.differences.some(
        (item) => item.field === "features.qwenSecretMount" && item.category === "requires_secret",
      ),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("manifest is immutable, digest pinned, and contains seven phases", async () => {
  const output = await temporaryRoot();
  try {
    await run("manifest", [
      `--input=${manifestInput}`,
      `--output-dir=${output}`,
    ]);
    const manifest = JSON.parse(
      await readFile(path.join(output, "release-manifest.json"), "utf8"),
    );
    assert.equal(manifest.createdByToolVersion, "b3-c1-v1");
    assert.equal(manifest.releasePhases.length, 7);
    assert.match(manifest.releaseImageDigest, /^sha256:/);
    assert.match(manifest.digest, /^sha256:/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("mutating commands default to dry-run and production apply is hard blocked", async () => {
  const output = await temporaryRoot();
  try {
    await run("rehearse", [
      "--environment=rehearsal",
      `--expected-sha=${"1".repeat(40)}`,
      `--expected-image=sha256:${"2".repeat(64)}`,
      `--output-dir=${output}`,
    ]);
    const dryRun = JSON.parse(
      await readFile(path.join(output, "release-rehearse.json"), "utf8"),
    );
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.result, "dry-run");

    await run("rehearse", [
      "--environment=rehearsal",
      `--expected-sha=${"1".repeat(40)}`,
      `--expected-image=sha256:${"2".repeat(64)}`,
      `--input=${rehearsalFixture}`,
      "--apply",
      `--output-dir=${path.join(output, "rehearse-apply")}`,
    ]);
    await run("restore-drill", [
      "--environment=rehearsal",
      `--expected-sha=${"1".repeat(40)}`,
      `--expected-image=sha256:${"2".repeat(64)}`,
      `--input=${restoreFixture}`,
      "--apply",
      `--output-dir=${path.join(output, "restore-apply")}`,
    ]);
    await run("smoke", [
      "--environment=rehearsal",
      `--expected-sha=${"1".repeat(40)}`,
      `--expected-image=sha256:${"2".repeat(64)}`,
      `--input=${smokeFixture}`,
      "--apply",
      `--output-dir=${path.join(output, "smoke-apply")}`,
    ]);

    await assert.rejects(
      run("smoke", [
        "--environment=production",
        `--expected-sha=${"1".repeat(40)}`,
        `--expected-image=sha256:${"2".repeat(64)}`,
        "--apply",
      ]),
      (error) => {
        assert.equal(error.code, 78);
        assert.match(error.stderr, /PRODUCTION_APPLY_NOT_AUTHORIZED/);
        return true;
      },
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("backup is a no-write dry-run and Production apply is also blocked", async () => {
  const output = await temporaryRoot();
  const inventoryRoot = path.join(output, "inventory");
  try {
    await run("inventory", [
      "--environment=production",
      `--input=${productionFixture}`,
      `--output-dir=${inventoryRoot}`,
    ]);
    const inventory = path.join(inventoryRoot, "production-inventory.json");
    await run("backup", [
      "--environment=production",
      `--expected-sha=${"1".repeat(40)}`,
      `--expected-image=sha256:${"a".repeat(64)}`,
      `--inventory=${inventory}`,
      `--output-dir=${output}`,
    ]);
    const plan = JSON.parse(
      await readFile(path.join(output, "release-backup-plan.json"), "utf8"),
    );
    assert.equal(plan.productionWritePerformed, false);
    assert.equal(plan.dataPlanePresent, false);
    await assert.rejects(
      run("backup", [
        "--environment=production",
        `--expected-sha=${"1".repeat(40)}`,
        `--expected-image=sha256:${"a".repeat(64)}`,
        `--inventory=${inventory}`,
        "--apply",
      ]),
      /PRODUCTION_APPLY_NOT_AUTHORIZED/,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("preflight passes known-safe input and rejects low disk or baseline drift", async () => {
  const output = await temporaryRoot();
  const inventoryRoot = path.join(output, "inventory");
  const manifestRoot = path.join(output, "manifest");
  try {
    await run("inventory", [
      "--environment=production",
      `--input=${productionFixture}`,
      `--output-dir=${inventoryRoot}`,
    ]);
    await run("manifest", [
      `--input=${manifestInput}`,
      `--output-dir=${manifestRoot}`,
    ]);
    const inventory = path.join(inventoryRoot, "production-inventory.json");
    const manifest = path.join(manifestRoot, "release-manifest.json");
    await run("preflight", [
      `--manifest=${manifest}`,
      `--production-inventory=${inventory}`,
      `--checks=${preflightChecks}`,
      `--output-dir=${path.join(output, "preflight-ok")}`,
    ]);

    const lowDisk = JSON.parse(await readFile(productionFixture, "utf8"));
    lowDisk.capacity.availableBytes = 1024;
    const lowDiskFile = path.join(output, "low-disk.json");
    await writeFile(lowDiskFile, JSON.stringify(lowDisk));
    await run("inventory", [
      "--environment=production",
      `--input=${lowDiskFile}`,
      `--output-dir=${path.join(output, "low-disk-inventory")}`,
    ]);
    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${path.join(output, "low-disk-inventory/production-inventory.json")}`,
        `--checks=${preflightChecks}`,
        `--output-dir=${path.join(output, "preflight-low-disk")}`,
      ]),
      (error) => error.code === 2,
    );

    const drifted = JSON.parse(await readFile(productionFixture, "utf8"));
    drifted.app.imageDigest = `sha256:${"e".repeat(64)}`;
    const driftFile = path.join(output, "drift.json");
    await writeFile(driftFile, JSON.stringify(drifted));
    await run("inventory", [
      "--environment=production",
      `--input=${driftFile}`,
      `--output-dir=${path.join(output, "drift-inventory")}`,
    ]);
    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${path.join(output, "drift-inventory/production-inventory.json")}`,
        `--checks=${preflightChecks}`,
        `--output-dir=${path.join(output, "preflight-drift")}`,
      ]),
      (error) => error.code === 2,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("rollback matrix and Go/No-Go fail closed", async () => {
  const output = await temporaryRoot();
  try {
    await run("rollback-check", [
      `--matrix=${path.join(root, "release/rollback-compatibility.json")}`,
      `--rehearsal=${rehearsalFixture}`,
      `--output-dir=${path.join(output, "rollback")}`,
    ]);
    await run("go-no-go", [
      `--checklist=${path.join(root, "release/fixtures/go-no-go-passed.json")}`,
      `--output-dir=${path.join(output, "go")}`,
    ]);
    await assert.rejects(
      run("go-no-go", [
        `--checklist=${path.join(root, "release/go-no-go.template.json")}`,
        `--output-dir=${path.join(output, "no-go")}`,
      ]),
      (error) => error.code === 2,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("disabled-image TSV becomes digest-pinned sanitized rehearsal evidence", async () => {
  const output = await temporaryRoot();
  const input = path.join(output, "disabled.tsv");
  const sha = "1".repeat(40);
  const image = `sha256:${"2".repeat(64)}`;
  try {
    await writeFile(
      input,
      [
        `appImageDigest\t${image}`,
        `dbToolsImageDigest\tsha256:${"3".repeat(64)}`,
        `expectedSha\t${sha}`,
        "health\thealthy",
        "assistantEnabled\tfalse",
        "embeddingEnabled\tfalse",
        "retrievalMode\tlexical",
        "qwenSecretMount\tfalse",
        "activeEmbeddingJobs\t0",
        "activeQueryEmbeddingCalls\t0",
        "activeAiExecutions\t0",
        "loginStatus\t200",
        "projectsStatus\t307",
        "publicPortPublished\tfalse",
        "productionConnected\tfalse",
        "cleanupComplete\ttrue",
        "passed\ttrue",
      ].join("\n"),
    );
    await execFileAsync(
      process.execPath,
      [
        rehearsalReport,
        "--kind=disabled-image",
        `--input=${input}`,
        `--expected-sha=${sha}`,
        `--expected-image=${image}`,
        `--output-dir=${output}`,
      ],
      { cwd: root },
    );
    const report = JSON.parse(
      await readFile(
        path.join(output, "release-disabled-image-rehearsal.json"),
        "utf8",
      ),
    );
    assert.equal(report.passed, true);
    assert.equal(report.checks.noProductionConnection, true);
    assert.match(report.digest, /^sha256:[0-9a-f]{64}$/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("release sanitizer rejects secrets and remote inventory avoids unsafe env dumps", async () => {
  assert.throws(
    () => assertSanitized({ authorization: "Bearer fictional" }),
    /forbidden field/,
  );
  assert.throws(
    () => assertSanitized({ note: "postgresql://user:password@example.invalid/db" }),
    /sensitive content/,
  );
  const unsafeOutput = await temporaryRoot();
  try {
    await assert.rejects(
      writeArtifactPair({
        outputDir: unsafeOutput,
        stem: "unsafe-markdown",
        payload: { passed: true },
        markdown: "Authorization: Bearer unsafe-release-value",
      }),
      /sensitive content/,
    );
  } finally {
    await rm(unsafeOutput, { recursive: true, force: true });
  }
  const remote = await readFile(
    path.join(root, "scripts/release/remote-inventory.sh"),
    "utf8",
  );
  assert.doesNotMatch(remote, /^\s*(?:sudo -n )?(?:env|printenv)\s*$/m);
  assert.doesNotMatch(remote, /docker inspect [^\n]*\.Config\.Env/);
  assert.doesNotMatch(remote, /cat [^\n]*(?:secret|qwen)/i);
  const databaseRehearsal = await readFile(
    path.join(root, "scripts/release/database-rehearsal.mjs"),
    "utf8",
  );
  assert.match(databaseRehearsal, /local CI\/test\/release database/);
  assert.match(databaseRehearsal, /Production database rehearsal is not authorized/);
  await execFileAsync("bash", ["-n", path.join(root, "scripts/release/remote-inventory.sh")]);
  await execFileAsync("bash", ["-n", path.join(root, "scripts/release/disabled-image-rehearsal.sh")]);
  await execFileAsync("bash", ["-n", path.join(root, "scripts/release/old-app-compatibility.sh")]);
});
