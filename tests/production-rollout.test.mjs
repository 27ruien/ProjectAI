import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  acquireDeploymentLock,
  appendJournal,
  assertAuthorizationBindings,
  assertComposeContract,
  assertPhaseCommandResults,
  assertImageContract,
  assertPhasePrerequisite,
  assertPhaseTransition,
  assertProductionAuthorization,
  assertProductionBaselineStable,
  assertStopConditions,
  costGate,
  createAuthorizationPayload,
  createLockMetadata,
  currentPhaseState,
  inspectSecretMetadata,
  journalPathFor,
  observationGate,
  phaseActionPlan,
  readDeploymentLock,
  readJournal,
  releaseDeploymentLock,
  rollbackActionPlan,
  signTestAuthorization,
  updateDeploymentLock,
  PRODUCTION_ROLLOUT_VERSION,
} from "../scripts/release/production-rollout-contract.mjs";
import {
  RELEASE_REPORT_PRODUCER,
  withDigest,
} from "../scripts/release/contract.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(new URL("..", import.meta.url).pathname);

function fixtures() {
  const baseline = withDigest({
    schemaVersion: 1,
    environment: "production",
    app: {
      containerId: "a".repeat(64),
      imageDigest: `sha256:${"a".repeat(64)}`,
      startedAt: "2026-01-01T00:00:00Z",
      restartCount: 0,
      health: "healthy",
      publicHttpStatus: 200,
    },
    configuration: {
      composeHash: `sha256:${"b".repeat(64)}`,
      nginxHash: `sha256:${"c".repeat(64)}`,
    },
    database: { present: false },
    objectStorage: { present: false },
    services: { documentWorker: false, embeddingWorker: false },
    features: {
      qwenSecretMount: false,
      aiAssistantEnabled: false,
      aiEmbeddingEnabled: false,
      retrievalMode: "lexical",
    },
    locks: {
      deployment: false,
      migrationApplicable: false,
      migrationFile: false,
      migrationAdvisory: "not-applicable",
      migration: false,
    },
    capacity: { filesystemUsagePercent: 10, inodeUsagePercent: 10 },
  });
  const session = withDigest({
    schemaVersion: 1,
    reportType: "release-session",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: `rs-${"1".repeat(32)}`,
    releaseCandidateSha: "2".repeat(40),
    releaseImageDigest: `sha256:${"3".repeat(64)}`,
    productionBaselineDigest: baseline.digest,
    createdAt: "2026-01-01T00:00:00Z",
  });
  const manifest = withDigest({
    schemaVersion: 1,
    reportType: "release-manifest",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    databaseToolsImageDigest: `sha256:${"4".repeat(64)}`,
    productionBaselineDigest: baseline.digest,
  });
  const goNoGo = withDigest({
    schemaVersion: 1,
    reportType: "go-no-go",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    machineReadiness: "GO",
    productionRolloutAuthorized: false,
    failed: [],
  });
  return { baseline, session, manifest, goNoGo };
}

function signedAuthorization({
  phases = [0, 1, 2, 3, 4, 5, 6],
  authorizedAt = "2026-01-01T00:00:00Z",
  expiresAt = "2026-01-01T00:30:00Z",
} = {}) {
  const values = fixtures();
  const keys = generateKeyPairSync("ed25519");
  const payload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session: values.session,
    manifest: values.manifest,
    goNoGo: values.goNoGo,
    authorizedPhases: phases,
    authorizedAt,
    expiresAt,
  });
  return {
    ...values,
    ...keys,
    authorization: signTestAuthorization(payload, keys.privateKey),
  };
}

test("Production Authorization is signed, time-bounded, phase-scoped, and binding-safe", () => {
  const values = signedAuthorization({ phases: [0, 1, 2] });
  assert.equal(PRODUCTION_ROLLOUT_VERSION, "b3-c2-v1");
  assertProductionAuthorization(values.authorization, {
    now: new Date("2026-01-01T00:10:00Z"),
    environment: "rehearsal",
    phase: 2,
    publicKey: values.publicKey,
  });
  assertAuthorizationBindings({
    authorization: values.authorization,
    session: values.session,
    manifest: values.manifest,
    productionBaseline: values.baseline,
    goNoGo: values.goNoGo,
    phase: 2,
  });
  assert.throws(
    () =>
      assertProductionAuthorization(values.authorization, {
        now: new Date("2026-01-01T00:31:00Z"),
        environment: "rehearsal",
        phase: 2,
        publicKey: values.publicKey,
      }),
    (error) => error.code === "PRODUCTION_AUTHORIZATION_EXPIRED",
  );
  assert.throws(
    () =>
      assertProductionAuthorization(values.authorization, {
        now: new Date("2026-01-01T00:10:00Z"),
        environment: "rehearsal",
        phase: 3,
        publicKey: values.publicKey,
      }),
    (error) => error.code === "PRODUCTION_PHASE_NOT_AUTHORIZED",
  );
  assert.throws(
    () =>
      assertProductionAuthorization(values.authorization, {
        now: new Date("2026-01-01T00:10:00Z"),
        environment: "production",
        phase: 2,
        publicKey: values.publicKey,
      }),
    (error) => error.code === "PRODUCTION_AUTHORIZATION_INVALID",
  );
  const tampered = { ...values.authorization, releaseCandidateSha: "9".repeat(40) };
  assert.throws(
    () =>
      assertProductionAuthorization(tampered, {
        now: new Date("2026-01-01T00:10:00Z"),
        environment: "rehearsal",
        phase: 1,
        publicKey: values.publicKey,
      }),
    (error) => error.code === "PRODUCTION_AUTHORIZATION_INVALID",
  );
});

test("formal Authorization generation remains disabled in B3-C2A", () => {
  const values = fixtures();
  assert.throws(
    () =>
      createAuthorizationPayload({
        sourceMode: "production-approval",
        session: values.session,
        manifest: values.manifest,
        goNoGo: values.goNoGo,
        authorizedPhases: [0],
        authorizedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:30:00Z",
      }),
    (error) => error.code === "PRODUCTION_APPLY_NOT_AUTHORIZED",
  );
});

test("production apply without Authorization exits 78 before any mutation", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(root, "scripts/release/production-rollout.mjs"),
        "phase",
        "--phase=0",
        "--apply",
        "--environment=production",
      ],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" } },
    ),
    (error) => {
      assert.equal(error.code, 78);
      assert.match(error.stderr, /PRODUCTION_APPLY_NOT_AUTHORIZED/);
      return true;
    },
  );
});

test("Production image transfer apply is also hard-blocked without Authorization", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(root, "scripts/release/production-image-transfer.mjs"),
        "transfer",
        "--apply",
      ],
      { cwd: root, env: { ...process.env, NODE_ENV: "production" } },
    ),
    (error) => {
      assert.equal(error.code, 78);
      assert.match(error.stderr, /PRODUCTION_APPLY_NOT_AUTHORIZED/);
      return true;
    },
  );
});

test("phase state machine rejects skips and accepts resume/rollback transitions", () => {
  assert.doesNotThrow(() => assertPhaseTransition("not_started", "authorized"));
  assert.doesNotThrow(() => assertPhaseTransition("authorized", "running"));
  assert.doesNotThrow(() => assertPhaseTransition("running", "failed"));
  assert.doesNotThrow(() => assertPhaseTransition("failed", "running"));
  assert.doesNotThrow(() => assertPhaseTransition("succeeded", "rolled_back"));
  assert.throws(
    () => assertPhaseTransition("not_started", "succeeded"),
    (error) => error.code === "PRODUCTION_PHASE_TRANSITION_INVALID",
  );
  assert.throws(
    () => assertPhaseTransition("rolled_back", "running"),
    (error) => error.code === "PRODUCTION_PHASE_TRANSITION_INVALID",
  );
});

test("Deployment Lock is atomic, does not auto-clear stale locks, and Journal is append-only", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-lock-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const metadata = createLockMetadata({
      session,
      phase: 0,
      now: new Date("2026-01-01T00:00:00Z"),
      ttlMs: 1000,
    });
    await acquireDeploymentLock({ lockPath, metadata });
    assert.equal((await readDeploymentLock(lockPath)).releaseSessionId, session.releaseSessionId);
    await updateDeploymentLock({
      lockPath,
      releaseSessionId: session.releaseSessionId,
      phase: 1,
    });
    assert.equal((await readDeploymentLock(lockPath)).currentPhase, 1);
    await assert.rejects(
      acquireDeploymentLock({ lockPath, metadata }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    );
    const journalPath = journalPathFor(directory);
    await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 0,
      event: "started",
      phaseState: "running",
      recordedAt: "2026-01-01T00:00:00Z",
    });
    await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 0,
      event: "completed",
      phaseState: "succeeded",
      recordedAt: "2026-01-01T00:00:01Z",
    });
    const entries = await readJournal(journalPath);
    assert.equal(entries.length, 2);
    assert.equal(currentPhaseState(entries, 0), "succeeded");
    await writeFile(journalPath, `${JSON.stringify({ ...entries[0], phaseState: "failed" })}\n`, "utf8");
    await assert.rejects(
      readJournal(journalPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    await releaseDeploymentLock({ lockPath, releaseSessionId: session.releaseSessionId });
    assert.equal(await readDeploymentLock(lockPath), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("phase prerequisites require the exact previous successful generated report", () => {
  const { session } = fixtures();
  const previous = withDigest({
    schemaVersion: 1,
    reportType: "production-rollout-phase",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    phase: 0,
    phaseState: "succeeded",
    result: "passed",
  });
  assert.doesNotThrow(() =>
    assertPhasePrerequisite({ phase: 1, previousReport: previous, sessionId: session.releaseSessionId }),
  );
  assert.throws(
    () => assertPhasePrerequisite({ phase: 2, previousReport: previous, sessionId: session.releaseSessionId }),
    (error) => error.code === "PRODUCTION_PHASE_PREREQUISITE_MISSING",
  );
});

test("baseline, migration locks, stop conditions, observation, and cost gates fail closed", () => {
  const { baseline } = fixtures();
  assert.doesNotThrow(() =>
    assertProductionBaselineStable({
      baseline,
      current: baseline,
      expectedContainer: baseline.app.containerId,
      expectedImage: baseline.app.imageDigest,
    }),
  );
  assert.throws(
    () =>
      assertProductionBaselineStable({
        baseline,
        current: { ...baseline, app: { ...baseline.app, restartCount: 1 } },
        expectedContainer: baseline.app.containerId,
        expectedImage: baseline.app.imageDigest,
      }),
    (error) => error.code === "PRODUCTION_BASELINE_DRIFT",
  );
  assert.doesNotThrow(() =>
    assertStopConditions({
      inventory: baseline,
      verification: { cleanupComplete: true, jobBacklog: 0, jobBacklogLimit: 1 },
    }),
  );
  assert.throws(
    () =>
      assertStopConditions({
        inventory: { ...baseline, locks: { ...baseline.locks, migrationAdvisory: "held" } },
        verification: {},
      }),
    (error) => error.code === "PRODUCTION_MIGRATION_LOCK_HELD",
  );
  assert.equal(observationGate({ phase: 2, elapsedSeconds: 899 }).passed, false);
  assert.equal(observationGate({ phase: 2, elapsedSeconds: 900 }).passed, true);
  assert.equal(
    observationGate({ phase: 5, elapsedSeconds: 1800, controlledRequests: 29 }).passed,
    false,
  );
  assert.equal(
    observationGate({ phase: 5, elapsedSeconds: 1800, controlledRequests: 30 }).passed,
    true,
  );
  assert.equal(
    costGate({
      phase: 4,
      answerTokens: 100,
      embeddingTokens: 100,
      queryEmbeddingTokens: 0,
      dailyTokenLimit: 500,
      providerUnknownCount: 0,
    }).passed,
    true,
  );
  assert.equal(
    costGate({
      phase: 4,
      answerTokens: 100,
      embeddingTokens: 100,
      queryEmbeddingTokens: 0,
      dailyTokenLimit: 500,
      providerUnknownCount: 1,
    }).passed,
    false,
  );
});

test("Production Compose, image metadata, and Qwen Secret metadata enforce least privilege", async () => {
  const [compose, aiCompose] = await Promise.all([
    readFile(path.join(root, "docker-compose.production-rollout.yml"), "utf8"),
    readFile(path.join(root, "docker-compose.production-ai.yml"), "utf8"),
  ]);
  assert.doesNotThrow(() => assertComposeContract(compose, aiCompose));
  assert.doesNotThrow(() =>
    assertImageContract(
      {
        id: `sha256:${"1".repeat(64)}`,
        os: "linux",
        architecture: "amd64",
        revision: "2".repeat(40),
        environment: "production",
      },
      { digest: `sha256:${"1".repeat(64)}`, sha: "2".repeat(40) },
    ),
  );
  assert.throws(
    () =>
      assertImageContract(
        {
          id: `sha256:${"1".repeat(64)}`,
          os: "linux",
          architecture: "arm64",
          revision: "2".repeat(40),
          environment: "production",
        },
        { digest: `sha256:${"1".repeat(64)}`, sha: "2".repeat(40) },
      ),
    (error) => error.code === "PRODUCTION_IMAGE_CONTRACT_INVALID",
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-secret-metadata-"));
  try {
    const secret = path.join(directory, "qwen");
    await writeFile(secret, "fictional-only\n", { encoding: "utf8", mode: 0o600 });
    await chmod(secret, 0o600);
    assert.equal((await inspectSecretMetadata(secret)).mode, "600");
    const linked = path.join(directory, "linked");
    await symlink(secret, linked);
    await assert.rejects(
      inspectSecretMetadata(linked),
      (error) => error.code === "PRODUCTION_QWEN_SECRET_REQUIRED",
    );
    await chmod(secret, 0o644);
    await assert.rejects(
      inspectSecretMetadata(secret),
      (error) => error.code === "PRODUCTION_QWEN_SECRET_REQUIRED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Phase 1 database failure fails closed without touching the public application", () => {
  const plan = phaseActionPlan(1);
  assert.ok(plan.some((command) => command.includes("projectai-postgres")));
  assert.ok(plan.some((command) => command.includes("projectai-migrate")));
  assert.throws(
    () =>
      assertPhaseCommandResults(1, [
        { command: plan[0].join(" "), status: 1 },
        { command: plan[1].join(" "), status: 0 },
      ]),
    (error) => error.code === "PRODUCTION_PHASE_EXECUTION_FAILED",
  );
  assert.equal(plan.some((command) => command.includes("down")), false);
});

test("baseline drift checks allow only phase-authorized rollout mutations", () => {
  const { baseline } = fixtures();
  const afterDataPlane = structuredClone(baseline);
  afterDataPlane.database.present = true;
  afterDataPlane.objectStorage.present = true;
  assert.doesNotThrow(() =>
    assertProductionBaselineStable({
      baseline,
      current: afterDataPlane,
      expectedContainer: baseline.app.containerId,
      expectedImage: baseline.app.imageDigest,
      phase: 2,
    }),
  );
  assert.throws(
    () =>
      assertProductionBaselineStable({
        baseline,
        current: afterDataPlane,
        expectedContainer: baseline.app.containerId,
        expectedImage: baseline.app.imageDigest,
        phase: 1,
      }),
    (error) => error.code === "PRODUCTION_BASELINE_DRIFT",
  );
});

test("Phase 2 rollback restores the old App and never deletes the data plane", () => {
  const plan = rollbackActionPlan(2).map((command) => command.join(" "));
  assert.ok(plan.some((command) => command.includes("restore-old-app-image")));
  assert.equal(plan.some((command) => /\b(?:down|rm|volume prune)\b/.test(command)), false);
});

test("Phase 3 missing Secret and Provider failure are mandatory stops", async () => {
  await assert.rejects(
    inspectSecretMetadata(path.join(os.tmpdir(), `missing-qwen-${process.pid}`)),
    (error) => error.code === "PRODUCTION_QWEN_SECRET_REQUIRED",
  );
  const { baseline } = fixtures();
  assert.throws(
    () =>
      assertStopConditions({
        inventory: baseline,
        verification: { providerCostAnomaly: true },
      }),
    (error) => error.code === "PRODUCTION_STOP_CONDITION",
  );
});

test("Phase 4 Worker failure and unknown Provider calls cannot advance", () => {
  const plan = phaseActionPlan(4);
  assert.ok(plan[0].includes("set-embedding-enabled"));
  assert.throws(
    () =>
      assertPhaseCommandResults(4, [
        { command: plan[0].join(" "), status: 1 },
      ]),
    (error) => error.code === "PRODUCTION_PHASE_EXECUTION_FAILED",
  );
  assert.equal(
    costGate({
      phase: 4,
      answerTokens: 0,
      embeddingTokens: 10,
      queryEmbeddingTokens: 0,
      dailyTokenLimit: 100,
      providerUnknownCount: 1,
    }).passed,
    false,
  );
});

test("Phase 5 Shadow gate requires both observation time and controlled requests", () => {
  assert.ok(phaseActionPlan(5)[0].includes("shadow"));
  assert.equal(
    observationGate({ phase: 5, elapsedSeconds: 1799, controlledRequests: 30 }).passed,
    false,
  );
  assert.equal(
    observationGate({ phase: 5, elapsedSeconds: 1800, controlledRequests: 29 }).passed,
    false,
  );
});

test("Phase 6 Hybrid leakage gate fails closed and rollback returns lexical", () => {
  assert.ok(phaseActionPlan(6)[0].includes("hybrid"));
  const { baseline } = fixtures();
  assert.throws(
    () =>
      assertStopConditions({
        inventory: baseline,
        verification: { crossProjectLeak: true },
      }),
    (error) => error.code === "PRODUCTION_STOP_CONDITION",
  );
  assert.ok(
    rollbackActionPlan(6)
      .map((command) => command.join(" "))
      .some((command) => command.endsWith("set-retrieval-mode lexical")),
  );
});

test("Production configuration templates validate key presence without requiring Qwen in Phase 0-2", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-production-config-"));
  try {
    const templates = [
      ["env.database-production.example", ".env.database-production"],
      ["env.auth-production.example", ".env.auth-production"],
      ["env.storage-production.example", ".env.storage-production"],
      ["env.ai-production.example", ".env.ai-production"],
      ["env.embedding-production.example", ".env.embedding-production"],
      ["env.document-production.example", ".env.document-production"],
    ];
    for (const [source, destination] of templates) {
      const target = path.join(directory, destination);
      await copyFile(path.join(root, "deploy/production", source), target);
      await chmod(target, 0o600);
    }
    const validator = path.join(root, "scripts/release/production-config-validate.mjs");
    const valid = await execFileAsync(process.execPath, [validator, directory], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "test" },
    });
    assert.deepEqual(JSON.parse(valid.stdout), {
      valid: true,
      files: 6,
      qwenRequired: false,
    });
    await assert.rejects(
      execFileAsync(process.execPath, [validator, directory, "--require-qwen"], {
        cwd: root,
        env: { ...process.env, NODE_ENV: "test" },
      }),
      (error) => {
        assert.match(error.stderr, /PRODUCTION_QWEN_SECRET_REQUIRED/);
        return true;
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
