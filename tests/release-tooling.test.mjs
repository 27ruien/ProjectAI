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
  booleanOrNotApplicable,
  digestObject,
  withDigest,
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

async function run(command, args, cwd = root, extraEnv = {}) {
  return execFileAsync(process.execPath, [cli, command, ...args], {
    cwd,
    env: { ...process.env, CI: "false", ...extraEnv },
  });
}

function commandAdapter({
  sha = "2222222222222222222222222222222222222222",
  sourceMainSha = "1111111111111111111111111111111111111111",
  image = `sha256:${"1".repeat(64)}`,
  inspectedImageId = image,
  ciStatus = "completed",
  ciConclusion = "success",
  ciHeadSha = sha,
  clock = "2026-01-01T00:00:00Z",
} = {}) {
  const entries = [
    [["git", "status", "--porcelain"], { stdout: "" }],
    [["git", "rev-parse", "HEAD"], { stdout: `${sha}\n` }],
    [["git", "rev-parse", "origin/main"], { stdout: `${sourceMainSha}\n` }],
    [["git", "cat-file", "-e", `${sha}^{commit}`], { stdout: "" }],
    [["gh", "auth", "status"], { stdout: "authenticated\n" }],
    [["gh", "run", "view", "123", "--repo", "27ruien/ProjectAI", "--json", "status,conclusion,headSha,headBranch,event"], {
      stdout: JSON.stringify({
        status: ciStatus,
        conclusion: ciConclusion,
        headSha: ciHeadSha,
        headBranch: "agent/production-release-readiness",
        event: "pull_request",
      }),
    }],
    [["docker", "image", "inspect", "--format", "{{.Id}}", image], { stdout: `${inspectedImageId}\n` }],
    [["docker", "image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", image], { stdout: `${sha}\n` }],
    [["docker", "image", "inspect", "--format", "{{index .Config.Labels \"com.projectai.release.environment\"}}", image], { stdout: "production\n" }],
    [["docker", "image", "inspect", "--format", "{{.Size}}", image], { stdout: "305000000\n" }],
  ];
  return {
    NODE_ENV: "test",
    PROJECTAI_RELEASE_TEST_NOW: clock,
    PROJECTAI_RELEASE_TEST_COMMANDS: JSON.stringify(
      Object.fromEntries(entries.map(([key, value]) => [JSON.stringify(key), value])),
    ),
  };
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

test("inventoryKnown parsing preserves booleans and explicit not-applicable", () => {
  assert.equal(booleanOrNotApplicable("true", "database.inventoryKnown"), true);
  assert.equal(booleanOrNotApplicable("false", "objectStorage.inventoryKnown"), false);
  assert.equal(
    booleanOrNotApplicable("not-applicable", "database.inventoryKnown"),
    "not-applicable",
  );
  assert.throws(
    () => booleanOrNotApplicable("unknown", "database.inventoryKnown"),
    /boolean or not-applicable/,
  );
});

test("inventory distinguishes absent storage, environment buckets, missing buckets, and unknown counts", async () => {
  const output = await temporaryRoot();
  try {
    await run("inventory", [
      "--environment=staging",
      `--input=${stagingFixture}`,
      `--output-dir=${path.join(output, "staging")}`,
    ]);
    const staging = JSON.parse(
      await readFile(path.join(output, "staging/staging-inventory.json"), "utf8"),
    );
    assert.equal(staging.objectStorage.inventoryKnown, true);
    assert.equal(staging.objectStorage.objectCount, 2);

    const production = JSON.parse(await readFile(productionFixture, "utf8"));
    assert.equal(production.objectStorage.present, false);
    assert.equal(production.objectStorage.inventoryKnown, "not-applicable");

    const productionBucket = JSON.parse(await readFile(stagingFixture, "utf8"));
    productionBucket.environment = "production";
    productionBucket.objectStorage.bucketNameHash = `sha256:${"7".repeat(64)}`;
    productionBucket.objectStorage.objectCount = 1;
    productionBucket.app = production.app;
    productionBucket.configuration = production.configuration;
    const productionBucketFile = path.join(output, "production-bucket.json");
    await writeFile(productionBucketFile, JSON.stringify(productionBucket));
    await run("inventory", [
      "--environment=production",
      `--input=${productionBucketFile}`,
      `--output-dir=${path.join(output, "production-bucket")}`,
    ]);
    const productionBucketReport = JSON.parse(
      await readFile(
        path.join(output, "production-bucket/production-inventory.json"),
        "utf8",
      ),
    );
    assert.notEqual(
      productionBucketReport.objectStorage.bucketNameHash,
      staging.objectStorage.bucketNameHash,
    );
    assert.equal(productionBucketReport.objectStorage.objectCount, 1);

    for (const reason of ["bucket-missing", "count-failed"]) {
      const unknown = JSON.parse(await readFile(stagingFixture, "utf8"));
      unknown.objectStorage.inventoryKnown = false;
      unknown.objectStorage.objectCount = null;
      unknown.objectStorage.totalBytes = null;
      unknown.objectStorage.bucketCount = null;
      const unknownFile = path.join(output, `${reason}.json`);
      await writeFile(unknownFile, JSON.stringify(unknown));
      await assert.rejects(
        run("inventory", [
          "--environment=staging",
          `--input=${unknownFile}`,
          `--output-dir=${path.join(output, reason)}`,
        ]),
        /object-storage inventory must be known/,
      );
    }

    const remote = await readFile(
      path.join(root, "scripts/release/remote-inventory.sh"),
      "utf8",
    );
    assert.doesNotMatch(remote, /\/data\/projectai-staging-files/);
    assert.doesNotMatch(remote, /find \/data/);
    assert.match(remote, /OBJECT_STORAGE_BUCKET/);
    assert.match(remote, /bucketNameHash/);
    assert.match(remote, /inventoryKnown false/);
    assert.match(remote, /quay\.io\/minio\/mc@sha256:[0-9a-f]{64}/);
    assert.match(remote, /mc --config-dir "\$config_dir" du --json --recursive/);
    const cliSource = await readFile(cli, "utf8");
    assert.match(cliSource, /"database\.inventoryKnown"/);
    assert.match(cliSource, /"objectStorage\.inventoryKnown"/);
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
    assert.equal(manifest.createdByToolVersion, "b3-c1-v2");
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

test("preflight collects Git, CI, Docker, clock, locks, and baseline facts", async () => {
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
      `--production-baseline=${inventory}`,
      "--ci-run-id=123",
      `--output-dir=${path.join(output, "preflight-ok")}`,
    ], root, commandAdapter());
    const passed = JSON.parse(
      await readFile(path.join(output, "preflight-ok/production-preflight.json"), "utf8"),
    );
    assert.equal(passed.gates.migrationLockFileClear, true);
    assert.equal(passed.gates.migrationAdvisoryClear, true);
    assert.equal(passed.backupApplicability, "not-applicable");

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
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-low-disk")}`,
      ], root, commandAdapter()),
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
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-drift")}`,
      ], root, commandAdapter()),
      (error) => error.code === 2,
    );

    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${inventory}`,
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-ci-failed")}`,
      ], root, commandAdapter({ ciConclusion: "failure" })),
      (error) => error.code === 2,
    );
    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${inventory}`,
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-image")}`,
      ], root, commandAdapter({ inspectedImageId: `sha256:${"9".repeat(64)}` })),
      (error) => error.code === 2,
    );
    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${inventory}`,
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-ci-sha")}`,
      ], root, commandAdapter({ ciHeadSha: "3".repeat(40) })),
      (error) => error.code === 2,
    );
    await assert.rejects(
      run("preflight", [
        `--manifest=${manifest}`,
        `--production-inventory=${inventory}`,
        `--production-baseline=${inventory}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "preflight-clock")}`,
      ], root, commandAdapter({ clock: "2026-01-01T00:06:00Z" })),
      (error) => error.code === 2,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("preflight fails closed for held and unknown PostgreSQL migration advisory locks", async () => {
  const output = await temporaryRoot();
  try {
    const productionFixtureValue = JSON.parse(await readFile(productionFixture, "utf8"));
    const stagingFixtureValue = JSON.parse(await readFile(stagingFixture, "utf8"));
    const fileLockedInventory = withDigest({
      ...productionFixtureValue,
      locks: {
        ...productionFixtureValue.locks,
        migrationFile: true,
        migration: true,
      },
    });
    const fileLockedInventoryFile = path.join(output, "file-held-inventory.json");
    await writeFile(fileLockedInventoryFile, JSON.stringify(fileLockedInventory));
    const fileLockedManifestInput = JSON.parse(await readFile(manifestInput, "utf8"));
    fileLockedManifestInput.productionBaselineDigest = fileLockedInventory.digest;
    const fileLockedManifestInputFile = path.join(output, "file-held-manifest-input.json");
    await writeFile(fileLockedManifestInputFile, JSON.stringify(fileLockedManifestInput));
    await run("manifest", [
      `--input=${fileLockedManifestInputFile}`,
      `--output-dir=${path.join(output, "file-held-manifest")}`,
    ]);
    await assert.rejects(
      run("preflight", [
        `--manifest=${path.join(output, "file-held-manifest/release-manifest.json")}`,
        `--production-inventory=${fileLockedInventoryFile}`,
        `--production-baseline=${fileLockedInventoryFile}`,
        "--ci-run-id=123",
        `--output-dir=${path.join(output, "file-held-preflight")}`,
      ], root, commandAdapter()),
      (error) => error.code === 2,
    );
    const fileHeld = JSON.parse(
      await readFile(
        path.join(output, "file-held-preflight/production-preflight.json"),
        "utf8",
      ),
    );
    assert.equal(fileHeld.gates.migrationLockFileClear, false);
    for (const advisory of ["held", "unknown"]) {
      const inventoryValue = {
        ...productionFixtureValue,
        database: stagingFixtureValue.database,
        backup: stagingFixtureValue.backup,
        locks: {
          deployment: false,
          migrationApplicable: true,
          migrationFile: false,
          migrationAdvisory: advisory,
          migration: advisory === "held",
        },
      };
      const inventory = withDigest(inventoryValue);
      const inventoryFile = path.join(output, `${advisory}-inventory.json`);
      await writeFile(inventoryFile, JSON.stringify(inventory));
      const manifestValue = JSON.parse(await readFile(manifestInput, "utf8"));
      manifestValue.productionBaselineDigest = inventory.digest;
      const manifestInputFile = path.join(output, `${advisory}-manifest-input.json`);
      await writeFile(manifestInputFile, JSON.stringify(manifestValue));
      const manifestRoot = path.join(output, `${advisory}-manifest`);
      await run("manifest", [
        `--input=${manifestInputFile}`,
        `--output-dir=${manifestRoot}`,
      ]);
      await assert.rejects(
        run("preflight", [
          `--manifest=${path.join(manifestRoot, "release-manifest.json")}`,
          `--production-inventory=${inventoryFile}`,
          `--production-baseline=${inventoryFile}`,
          "--ci-run-id=123",
          `--output-dir=${path.join(output, `${advisory}-preflight`)}`,
        ], root, commandAdapter()),
        (error) => error.code === 2,
      );
      const report = JSON.parse(
        await readFile(
          path.join(output, `${advisory}-preflight/production-preflight.json`),
          "utf8",
        ),
      );
      assert.equal(report.gates.migrationAdvisoryClear, false);
      assert.equal(report.result, "NO-GO");
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("rollback check consumes compatibility from a generated rehearsal report", async () => {
  const output = await temporaryRoot();
  try {
    const sha = "2".repeat(40);
    const image = `sha256:${"1".repeat(64)}`;
    const rehearsalInput = path.join(output, "rehearsal-input.json");
    await writeFile(
      rehearsalInput,
      JSON.stringify({
        ...JSON.parse(await readFile(rehearsalFixture, "utf8")),
        releaseCandidateSha: sha,
        releaseImageDigest: image,
      }),
    );
    const rehearsalRoot = path.join(output, "rehearsal");
    await run("rehearse", [
      "--environment=rehearsal",
      `--expected-sha=${sha}`,
      `--expected-image=${image}`,
      `--input=${rehearsalInput}`,
      "--apply",
      `--output-dir=${rehearsalRoot}`,
    ]);
    const rehearsalReport = path.join(
      rehearsalRoot,
      "release-rehearse.json",
    );
    await run("rollback-check", [
      `--matrix=${path.join(root, "release/rollback-compatibility.json")}`,
      `--rehearsal=${rehearsalReport}`,
      `--output-dir=${path.join(output, "rollback")}`,
    ]);
    const rehearsal = JSON.parse(await readFile(rehearsalReport, "utf8"));
    const rollback = JSON.parse(
      await readFile(
        path.join(output, "rollback/release-rollback-check.json"),
        "utf8",
      ),
    );
    assert.equal(rollback.result, "passed");
    assert.equal(rollback.rehearsalDigest, rehearsal.digest);
    assert.equal(rollback.combinations.every((item) => item.passed), true);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("Go/No-Go cross-binds reports and rejects checklist, tampering, SHA, image, and missing reports", async () => {
  const output = await temporaryRoot();
  try {
    const productionRoot = path.join(output, "production");
    const stagingRoot = path.join(output, "staging");
    const manifestRoot = path.join(output, "manifest");
    const diffRoot = path.join(output, "diff");
    const preflightRoot = path.join(output, "preflight");
    await run("inventory", [
      "--environment=production",
      `--input=${productionFixture}`,
      `--output-dir=${productionRoot}`,
    ]);
    await run("inventory", [
      "--environment=staging",
      `--input=${stagingFixture}`,
      `--output-dir=${stagingRoot}`,
    ]);
    await run("manifest", [
      `--input=${manifestInput}`,
      `--output-dir=${manifestRoot}`,
    ]);
    const production = path.join(productionRoot, "production-inventory.json");
    const staging = path.join(stagingRoot, "staging-inventory.json");
    const manifest = path.join(manifestRoot, "release-manifest.json");
    await run("diff", [
      `--production-inventory=${production}`,
      `--staging-inventory=${staging}`,
      `--output-dir=${diffRoot}`,
    ]);
    await run("preflight", [
      `--manifest=${manifest}`,
      `--production-inventory=${production}`,
      `--production-baseline=${production}`,
      "--ci-run-id=123",
      `--output-dir=${preflightRoot}`,
    ], root, commandAdapter());

    const sha = "2222222222222222222222222222222222222222";
    const image = `sha256:${"1".repeat(64)}`;
    const reportRoot = path.join(output, "reports");
    const rehearsal = await writeArtifactPair({
      outputDir: reportRoot,
      stem: "rehearsal",
      payload: {
        schemaVersion: 1,
        expectedSha: sha,
        expectedImage: image,
        input: { checks: { migration0004To0007: true } },
        result: "passed",
      },
      markdown: "synthetic rehearsal report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "restore",
      payload: {
        schemaVersion: 1,
        expectedSha: sha,
        expectedImage: image,
        input: { checks: { backupChecksum: true } },
        result: "passed",
      },
      markdown: "synthetic restore report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "smoke",
      payload: { schemaVersion: 1, expectedSha: sha, expectedImage: image, result: "passed" },
      markdown: "synthetic smoke report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "rollback",
      payload: {
        schemaVersion: 1,
        releaseCandidateSha: sha,
        releaseImageDigest: image,
        rehearsalDigest: rehearsal.digest,
        result: "passed",
      },
      markdown: "synthetic rollback report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "disabled",
      payload: { schemaVersion: 1, releaseCandidateSha: sha, releaseImageDigest: image, passed: true },
      markdown: "synthetic disabled-image report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "old-app",
      payload: {
        schemaVersion: 1,
        releaseCandidateSha: sha,
        rollbackImageDigest: `sha256:${"a".repeat(64)}`,
        oldAppOperationalWithParallel0007Database: true,
        oldAppDatabaseDependency: "absent",
        oldAppDatabaseConnectionObserved: false,
        schemaForwardRollbackScope: "legacy-application-shell",
        newDataPlaneFeaturesAvailableAfterRollback: false,
        passed: true,
      },
      markdown: "synthetic old-app report",
    });
    await writeArtifactPair({
      outputDir: reportRoot,
      stem: "ci-evidence",
      payload: {
        schemaVersion: 1,
        status: "success",
        headSha: sha,
        workflowRunId: "123",
        artifactDigest: `sha256:${"c".repeat(64)}`,
      },
      markdown: "synthetic CI evidence report",
    });
    await run("backup", [
      "--environment=production",
      `--expected-sha=${sha}`,
      `--expected-image=sha256:${"a".repeat(64)}`,
      `--inventory=${production}`,
      `--output-dir=${path.join(reportRoot, "backup")}`,
    ]);

    await run("rollback-check", [
      `--matrix=${path.join(root, "release/rollback-compatibility.json")}`,
      `--rehearsal=${rehearsalFixture}`,
      `--output-dir=${path.join(output, "rollback")}`,
    ]);
    const goArgs = [
      `--manifest=${manifest}`,
      `--production-baseline=${production}`,
      `--production-inventory=${production}`,
      `--staging-inventory=${staging}`,
      `--diff=${path.join(diffRoot, "production-staging-diff.json")}`,
      `--preflight=${path.join(preflightRoot, "production-preflight.json")}`,
      `--rehearsal=${path.join(reportRoot, "rehearsal.json")}`,
      `--restore-drill=${path.join(reportRoot, "restore.json")}`,
      `--smoke=${path.join(reportRoot, "smoke.json")}`,
      `--rollback-check=${path.join(reportRoot, "rollback.json")}`,
      `--disabled-image=${path.join(reportRoot, "disabled.json")}`,
      `--old-app=${path.join(reportRoot, "old-app.json")}`,
      `--backup=${path.join(reportRoot, "backup/release-backup-plan.json")}`,
      `--ci-evidence=${path.join(reportRoot, "ci-evidence.json")}`,
    ];
    await run("go-no-go", [...goArgs, `--output-dir=${path.join(output, "go")}`]);
    const go = JSON.parse(
      await readFile(path.join(output, "go/release-go-no-go.json"), "utf8"),
    );
    assert.equal(go.machineReadiness, "GO");
    assert.equal(go.independentReview, "pending");
    assert.equal(go.productionRolloutAuthorized, false);

    await assert.rejects(
      run("go-no-go", [
        `--checklist=${path.join(root, "release/fixtures/synthetic-go-no-go-input.json")}`,
      ]),
      /Checklist-only Go\/No-Go input is synthetic/,
    );

    const tampered = JSON.parse(await readFile(path.join(reportRoot, "smoke.json"), "utf8"));
    tampered.result = "failed";
    const tamperedFile = path.join(output, "tampered-smoke.json");
    await writeFile(tamperedFile, JSON.stringify(tampered));
    await assert.rejects(
      run("go-no-go", goArgs.map((arg) => arg.startsWith("--smoke=") ? `--smoke=${tamperedFile}` : arg)),
      /digest does not match/,
    );

    const wrongSha = withDigest({
      ...tampered,
      digest: undefined,
      result: "passed",
      expectedSha: "3".repeat(40),
    });
    const wrongShaFile = path.join(output, "wrong-sha-smoke.json");
    await writeFile(wrongShaFile, JSON.stringify(wrongSha));
    await assert.rejects(
      run("go-no-go", goArgs.map((arg) => arg.startsWith("--smoke=") ? `--smoke=${wrongShaFile}` : arg)),
      (error) => error.code === 2,
    );

    const disabled = JSON.parse(await readFile(path.join(reportRoot, "disabled.json"), "utf8"));
    const wrongImage = withDigest({
      ...disabled,
      digest: undefined,
      releaseImageDigest: `sha256:${"4".repeat(64)}`,
    });
    const wrongImageFile = path.join(output, "wrong-image-disabled.json");
    await writeFile(wrongImageFile, JSON.stringify(wrongImage));
    await assert.rejects(
      run("go-no-go", goArgs.map((arg) => arg.startsWith("--disabled-image=") ? `--disabled-image=${wrongImageFile}` : arg)),
      (error) => error.code === 2,
    );

    await assert.rejects(
      run("go-no-go", goArgs.filter((arg) => !arg.startsWith("--restore-drill="))),
      /--restore-drill is required/,
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

test("old-app evidence records shell-only rollback scope and observed database absence", async () => {
  const output = await temporaryRoot();
  const input = path.join(output, "old-app.tsv");
  const sha = "1".repeat(40);
  const image = `sha256:${"a".repeat(64)}`;
  try {
    await writeFile(
      input,
      [
        `productionImageDigest\t${image}`,
        `dbToolsImageDigest\tsha256:${"3".repeat(64)}`,
        "targetMigration\t7",
        "migrationCount\t8",
        "pgvectorVersion\t0.8.1",
        "oldAppLoginStatus\t200",
        "oldAppDashboardStatus\t200",
        "oldAppProjectsStatus\t307",
        "oldAppRestartCount\t0",
        "databaseUrlSuppliedToOldApp\ttrue",
        "oldAppOperationalWithParallel0007Database\ttrue",
        "oldAppDatabaseDependency\tabsent",
        "oldAppDatabaseConnectionObserved\tfalse",
        "schemaForwardRollbackScope\tlegacy-application-shell",
        "newDataPlaneFeaturesAvailableAfterRollback\tfalse",
        "publicPortPublished\tfalse",
        "productionContainerTouched\tfalse",
        "productionNetworkJoined\tfalse",
        "productionSecretMounted\tfalse",
        "cleanupComplete\ttrue",
        "passed\ttrue",
      ].join("\n"),
    );
    await execFileAsync(process.execPath, [
      rehearsalReport,
      "--kind=old-app",
      `--input=${input}`,
      `--expected-sha=${sha}`,
      `--expected-image=${image}`,
      `--output-dir=${output}`,
    ], { cwd: root });
    const report = JSON.parse(
      await readFile(path.join(output, "release-old-app-compatibility.json"), "utf8"),
    );
    assert.equal(report.oldAppOperationalWithParallel0007Database, true);
    assert.equal(report.oldAppDatabaseDependency, "absent");
    assert.equal(report.oldAppDatabaseConnectionObserved, false);
    assert.equal(report.schemaForwardRollbackScope, "legacy-application-shell");
    assert.equal(report.newDataPlaneFeaturesAvailableAfterRollback, false);
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
