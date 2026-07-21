import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  acquireDeploymentLock,
  appendJournal,
  assertAuthorizationBindings,
  assertApplyReportBinding,
  assertComposeContract,
  assertDeploymentLockClearable,
  assertDeploymentLifecycleGuardClearable,
  assertPhaseCommandResults,
  assertImageContract,
  assertNoCallerImageOverride,
  assertFinalizeReady,
  assertPhasePrerequisite,
  assertPhaseTransition,
  assertProductionAuthorization,
  assertProductionBaselineStable,
  assertProductionEgressMembership,
  assertRollbackOrder,
  assertRuntimeImageBinding,
  assertStopConditions,
  assertTrustedBaselineManifest,
  assertVerificationEvidence,
  costGate,
  createAuthorizationPayload,
  createLockMetadata,
  clearStaleDeploymentLifecycleGuard,
  currentPhaseState,
  inspectSecretMetadata,
  journalPathFor,
  observationGate,
  phaseActionPlan,
  productionEgressExpectation,
  readDeploymentLock,
  readDeploymentLifecycleGuard,
  readJournal,
  releaseDeploymentLock,
  releaseIdleDeploymentLock,
  rollbackActionPlan,
  rolloutReportContract,
  signTestAuthorization,
  updateDeploymentLock,
  writePhaseReport,
  writeRolloutReport,
  AUTHORIZATION_ACTIONS,
  PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS,
  PRODUCTION_ROLLOUT_VERSION,
  PRODUCTION_PHASE_VERIFIER,
} from "../scripts/release/production-rollout-contract.mjs";
import {
  digestObject,
  RELEASE_REPORT_PRODUCER,
  withDigest,
} from "../scripts/release/contract.mjs";
import {
  assertAuthorizationMarker,
  consumeAuthorization,
  createTestAuthorizationMarker,
  loadAuthorizationTrust,
  publicKeyFingerprint,
  usedAuthorizationsPath,
} from "../scripts/release/production-rollout-trust.mjs";
import {
  executeAuthorizedImageTransfer,
} from "../scripts/release/production-image-transfer-sequence.mjs";
import {
  assertFreshLiveInventory,
  inventoryStateDigest,
} from "../scripts/release/production-live-inventory.mjs";

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

async function appendIndependentJournalEvent(journalPath, entry, options) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await appendJournal(journalPath, entry, options);
    } catch (error) {
      if (error?.code !== "PRODUCTION_ROLLOUT_STATE_CHANGED") throw error;
    }
  }
  throw new Error("Independent Journal test event did not commit after explicit refresh.");
}

function finalizeFixtures() {
  const { session, manifest } = fixtures();
  const finalStateDigest = `sha256:${"f".repeat(64)}`;
  const inventory = withDigest({
    schemaVersion: 1,
    reportType: "production-inventory",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    sourceMode: "synthetic-test",
    environment: "rehearsal",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: manifest.releaseImageDigest,
    capturedAt: new Date().toISOString(),
    app: {
      containerId: "a".repeat(64),
      imageDigest: manifest.releaseImageDigest,
      commitSha: session.releaseCandidateSha,
      startedAt: "2026-01-01T00:00:00Z",
      restartCount: 0,
      health: "healthy",
      publicHttpStatus: 200,
    },
    services: {
      documentWorker: true,
      documentWorkerHealth: "healthy",
      documentWorkerRestartCount: 0,
      documentWorkerImageDigest: manifest.releaseImageDigest,
      embeddingWorker: true,
      embeddingWorkerHealth: "healthy",
      embeddingWorkerRestartCount: 0,
      embeddingWorkerImageDigest: manifest.releaseImageDigest,
    },
    active: {
      documentJobs: 0,
      embeddingJobs: 0,
      embeddingBatches: 0,
      embeddingProviderCalls: 0,
      retrievalRuns: 0,
      queryEmbeddingCalls: 0,
      aiExecutions: 0,
    },
  });
  const reports = Array.from({ length: 7 }, (_, phase) =>
    withDigest({
      schemaVersion: 1,
      reportType: "production-rollout-phase-verification",
      producer: RELEASE_REPORT_PRODUCER,
      producerVersion: PRODUCTION_ROLLOUT_VERSION,
      sourceMode: "rehearsal-command",
      releaseSessionId: session.releaseSessionId,
      releaseCandidateSha: session.releaseCandidateSha,
      releaseImageDigest: manifest.releaseImageDigest,
      databaseToolsImageDigest: manifest.databaseToolsImageDigest,
      candidateSha: session.releaseCandidateSha,
      appImageDigest: manifest.releaseImageDigest,
      dbToolsImageDigest: manifest.databaseToolsImageDigest,
      phase,
      phaseState: "succeeded",
      result: "passed",
      postInventoryDigest: inventory.digest,
      postStateDigest: finalStateDigest,
    }),
  );
  const entries = reports.map((report) => ({
    releaseSessionId: session.releaseSessionId,
    phase: report.phase,
    event: "verified",
    phaseState: "succeeded",
    reportDigest: report.digest,
    postInventoryDigest: report.postInventoryDigest,
    postStateDigest: report.postStateDigest,
  }));
  const lock = createLockMetadata({
    session,
    phase: 6,
    authorizationId: `pa-${"f".repeat(32)}`,
  });
  return { entries, finalStateDigest, inventory, lock, manifest, reports, session };
}

function signedAuthorization({
  phases = [2],
  action = "apply",
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
    action,
    authorizedAt,
    expiresAt,
  });
  return {
    ...values,
    ...keys,
    authorization: signTestAuthorization(payload, keys.privateKey),
  };
}

function liveSignedAuthorization(options = {}) {
  return signedAuthorization({
    ...options,
    authorizedAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
}

function nextAuthorization(values, { phase, action }) {
  const payload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session: values.session,
    manifest: values.manifest,
    goNoGo: values.goNoGo,
    authorizedPhases: [phase],
    action,
    authorizedAt: new Date(Date.now() - 30_000).toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  return {
    ...values,
    authorization: signTestAuthorization(payload, values.privateKey),
  };
}

async function writeAuthorizationMarker(directory, values, { phase, action, name = "marker" }) {
  const markerPath = path.join(directory, `${name}.json`);
  await writeFile(
    markerPath,
    JSON.stringify(createTestAuthorizationMarker({
      authorization: values.authorization,
      phase,
      action,
      expiresAt: values.authorization.expiresAt,
    })),
    { mode: 0o600 },
  );
  return markerPath;
}

async function writeClaimFixture(
  directory,
  {
    action = "apply",
    phase = 0,
    name = action,
    stateName = `${action}-state`,
  } = {},
) {
  const authorizedAt = new Date(Date.now() - 30_000).toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const values = signedAuthorization({
    phases: [phase],
    action,
    authorizedAt,
    expiresAt,
  });
  const authorizationPath = path.join(directory, `${name}-authorization.json`);
  const publicKeyPath = path.join(directory, `${name}-public.pem`);
  const trustPath = path.join(directory, `${name}-trust.json`);
  const markerPath = path.join(directory, `${name}-marker.json`);
  const stateDir = path.join(directory, stateName);
  await Promise.all([
    writeFile(authorizationPath, JSON.stringify(values.authorization), { mode: 0o600 }),
    writeFile(
      publicKeyPath,
      values.publicKey.export({ type: "spki", format: "pem" }),
      { mode: 0o600 },
    ),
    writeFile(
      trustPath,
      JSON.stringify({
        schemaVersion: 1,
        algorithm: "ed25519",
        fingerprintEncoding: "spki-der-sha256",
        publicKeySha256: publicKeyFingerprint(values.publicKey),
        productionKeyPath: "/srv/projectai/authorization/production-rollout-public-key.pem",
        productionMarkerPath: "/srv/projectai/authorization/rollout-enabled.json",
        productionClaimHelperPath:
          "/srv/projectai/scripts/release/production-authorization-claim.mjs",
        productionClaimHelperSha256: `sha256:${"0".repeat(64)}`,
        productionClaimBundlePath:
          "/srv/projectai/release/production-authorization-claim-bundle.json",
        productionClaimBundleSha256: `sha256:${"0".repeat(64)}`,
      }),
      { mode: 0o600 },
    ),
    writeFile(
      markerPath,
      JSON.stringify(createTestAuthorizationMarker({
        authorization: values.authorization,
        phase,
        action,
        expiresAt,
      })),
      { mode: 0o600 },
    ),
  ]);
  const claimArgs = [
    path.join(root, "scripts/release/production-authorization-claim.mjs"),
    "--environment=rehearsal",
    `--state-dir=${stateDir}`,
    `--authorization=${authorizationPath}`,
    `--authorization-public-key=${publicKeyPath}`,
    `--authorization-trust=${trustPath}`,
    `--authorization-marker=${markerPath}`,
    `--phase=${phase}`,
    `--action=${action}`,
  ];
  return { ...values, claimArgs, stateDir };
}

function claimCommandOptions() {
  return {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test" },
  };
}

async function writeSecureJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

async function createFinalizeCliFixture(
  directory,
  { preparedRecovery = false, name = "finalize" } = {},
) {
  const baseValues = fixtures();
  const baselineFixture = JSON.parse(
    await readFile(
      path.join(root, "release/fixtures/production-like-inventory.json"),
      "utf8",
    ),
  );
  const baseline = withDigest({
    ...baselineFixture,
    capturedAt: new Date().toISOString(),
  });
  const session = withDigest({
    ...baseValues.session,
    productionBaselineDigest: baseline.digest,
  });
  const manifest = withDigest({
    ...baseValues.manifest,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    productionBaselineDigest: baseline.digest,
    releaseVersion: "b3-c2a-finalize-test",
    sourceMainSha: "1".repeat(40),
    releaseCandidateBranch: "agent/production-rollout-executor",
    nodeVersion: "22.17.0",
    buildTime: "2026-01-01T00:00:00Z",
    baseImageDigests: [`sha256:${"5".repeat(64)}`],
    currentProductionImage: baseline.app.imageDigest,
    databaseMigrationFrom: "none",
    databaseMigrationTo: 7,
    postgresCurrentImage: null,
    postgresTargetImage: `sha256:${"6".repeat(64)}`,
    pgvectorTargetVersion: "0.8.1",
    minioImage: `sha256:${"7".repeat(64)}`,
    featureFlags: { assistant: false, embedding: false, retrievalMode: "lexical" },
    releasePhases: Array.from({ length: 7 }, (_, phase) => `phase-${phase}`),
    backupIds: [],
    backupDigests: [],
    rollbackImage: baseline.app.imageDigest,
    rollbackCompatibility: "schema-forward-app-rollback",
    evidenceDigest: `sha256:${"8".repeat(64)}`,
    createdAt: "2026-01-01T00:00:00Z",
    createdByToolVersion: "b3-c1-v3",
  });
  const goNoGo = withDigest({
    ...baseValues.goNoGo,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const authorization = signTestAuthorization(
    createAuthorizationPayload({
      sourceMode: "synthetic-test",
      session,
      manifest,
      goNoGo,
      authorizedPhases: [6],
      action: "finalize",
      authorizedAt: new Date(Date.now() - 30_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
    privateKey,
  );
  const values = {
    baseline,
    session,
    manifest,
    goNoGo,
    privateKey,
    publicKey,
    authorization,
  };
  const { digest: ignoredBaselineDigest, ...baselinePayload } = baseline;
  void ignoredBaselineDigest;
  const inventory = withDigest({
    ...baselinePayload,
    environment: "rehearsal",
    capturedAt: new Date().toISOString(),
    reportType: "rehearsal-inventory",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    app: {
      ...baseline.app,
      containerId: "a".repeat(64),
      imageDigest: manifest.releaseImageDigest,
      commitSha: session.releaseCandidateSha,
      startedAt: "2026-01-01T00:00:00Z",
      restartCount: 0,
      status: "running",
      health: "healthy",
      publicHttpStatus: 200,
      localHttpStatus: 200,
    },
    features: {
      ...baseline.features,
      aiAssistantEnabled: true,
      aiEmbeddingEnabled: true,
      retrievalMode: "hybrid",
      queryEmbeddingConfigured: true,
      qwenSecretMount: true,
    },
    services: {
      documentWorker: true,
      documentWorkerHealth: "healthy",
      documentWorkerRestartCount: 0,
      documentWorkerImageDigest: manifest.releaseImageDigest,
      embeddingWorker: true,
      embeddingWorkerHealth: "healthy",
      embeddingWorkerRestartCount: 0,
      embeddingWorkerImageDigest: manifest.releaseImageDigest,
    },
    active: {
      documentJobs: 0,
      embeddingJobs: 0,
      embeddingBatches: 0,
      embeddingProviderCalls: 0,
      retrievalRuns: 0,
      queryEmbeddingCalls: 0,
      aiExecutions: 0,
    },
  });
  const finalStateDigest = inventoryStateDigest(inventory);
  const reports = Array.from({ length: 7 }, (_, phase) =>
    withDigest({
      schemaVersion: 1,
      reportType: "production-rollout-phase-verification",
      producer: RELEASE_REPORT_PRODUCER,
      producerVersion: PRODUCTION_ROLLOUT_VERSION,
      sourceMode: "rehearsal-command",
      releaseSessionId: session.releaseSessionId,
      releaseCandidateSha: session.releaseCandidateSha,
      releaseImageDigest: manifest.releaseImageDigest,
      databaseToolsImageDigest: manifest.databaseToolsImageDigest,
      candidateSha: session.releaseCandidateSha,
      appImageDigest: manifest.releaseImageDigest,
      dbToolsImageDigest: manifest.databaseToolsImageDigest,
      phase,
      phaseState: "succeeded",
      result: "passed",
      postInventoryDigest: inventory.digest,
      postStateDigest: finalStateDigest,
    }),
  );
  const stateDir = path.join(directory, `${name}-state`);
  const sessionPath = path.join(directory, `${name}-session.json`);
  const manifestPath = path.join(directory, `${name}-manifest.json`);
  const baselinePath = path.join(directory, `${name}-baseline.json`);
  const goNoGoPath = path.join(directory, `${name}-go-no-go.json`);
  const authorizationPath = path.join(directory, `${name}-authorization.json`);
  const publicKeyPath = path.join(directory, `${name}-public.pem`);
  const trustPath = path.join(directory, `${name}-trust.json`);
  const markerPath = path.join(directory, `${name}-marker.json`);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeSecureJson(sessionPath, values.session),
    writeSecureJson(manifestPath, values.manifest),
    writeSecureJson(baselinePath, values.baseline),
    writeSecureJson(goNoGoPath, values.goNoGo),
    writeSecureJson(authorizationPath, values.authorization),
    writeFile(
      publicKeyPath,
      values.publicKey.export({ type: "spki", format: "pem" }),
      { mode: 0o600 },
    ),
    writeSecureJson(trustPath, {
      schemaVersion: 1,
      algorithm: "ed25519",
      fingerprintEncoding: "spki-der-sha256",
      publicKeySha256: publicKeyFingerprint(values.publicKey),
      productionKeyPath: "/srv/projectai/authorization/production-rollout-public-key.pem",
      productionMarkerPath: "/srv/projectai/authorization/rollout-enabled.json",
      productionClaimHelperPath:
        "/srv/projectai/scripts/release/production-authorization-claim.mjs",
      productionClaimHelperSha256: `sha256:${"0".repeat(64)}`,
      productionClaimBundlePath:
        "/srv/projectai/release/production-authorization-claim-bundle.json",
      productionClaimBundleSha256: `sha256:${"0".repeat(64)}`,
    }),
    writeSecureJson(markerPath, createTestAuthorizationMarker({
      authorization: values.authorization,
      phase: 6,
      action: "finalize",
      expiresAt: values.authorization.expiresAt,
    })),
    ...reports.map((report) => writePhaseReport(stateDir, report)),
  ]);
  const journalPath = journalPathFor(stateDir);
  for (const report of reports) {
    await appendJournal(journalPath, {
      releaseSessionId: values.session.releaseSessionId,
      phase: report.phase,
      event: "verified",
      phaseState: "succeeded",
      reportDigest: report.digest,
      postInventoryDigest: report.postInventoryDigest,
      postStateDigest: report.postStateDigest,
      recordedAt: new Date().toISOString(),
    });
  }

  let preparedEntry = null;
  if (preparedRecovery) {
    const recoveryRecordedAt = new Date(
      Date.now() - PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS - 60_000,
    );
    const priorLock = createLockMetadata({
      session: values.session,
      phase: 6,
      authorizationId: `pa-${"c".repeat(32)}`,
      now: recoveryRecordedAt,
      ownerPid: 2_000_000_000,
    });
    const report = await writeRolloutReport({
      outputDir: stateDir,
      stem: "production-rollout-final",
      payload: rolloutReportContract({
        reportType: "production-rollout-final",
        sourceMode: "rehearsal-command",
        session: values.session,
        phase: 6,
        phaseState: "succeeded",
        result: "release-prepared",
        extra: {
          databaseToolsImageDigest: values.manifest.databaseToolsImageDigest,
          finalInventoryDigest: inventory.digest,
          finalStateDigest,
          phaseVerificationReportDigests: reports.map((candidate) => candidate.digest),
          deploymentLockId: priorLock.lockId,
          activeTotal: 0,
          productionHttpStatus: inventory.app.publicHttpStatus,
        },
      }),
      title: "Production rollout finalization",
    });
    await writeSecureJson(
      path.join(stateDir, "final-production-inventory.json"),
      inventory,
    );
    preparedEntry = await appendJournal(journalPath, {
      releaseSessionId: values.session.releaseSessionId,
      phase: 6,
      event: "finalization-prepared",
      phaseState: "succeeded",
      finalReportDigest: report.digest,
      finalInventoryDigest: inventory.digest,
      finalStateDigest,
      deploymentLockId: priorLock.lockId,
      authorizationId: priorLock.authorizationId,
      ownerPid: priorLock.ownerPid,
      ownerHostname: priorLock.ownerHostname,
      ownerUid: priorLock.ownerUid,
      recordedAt: recoveryRecordedAt.toISOString(),
    });
  } else {
    await acquireDeploymentLock({
      lockPath: path.join(stateDir, ".production-rollout-lock"),
      metadata: createLockMetadata({
        session: values.session,
        phase: 6,
        authorizationId: `pa-${"d".repeat(32)}`,
        ownerPid: 0,
      }),
    });
  }

  const cliArgs = [
    path.join(root, "scripts/release/production-rollout.mjs"),
    "finalize",
    "--environment=rehearsal",
    `--state-dir=${stateDir}`,
    `--session=${sessionPath}`,
    `--authorization=${authorizationPath}`,
    `--authorization-public-key=${publicKeyPath}`,
    `--authorization-trust=${trustPath}`,
    `--authorization-marker=${markerPath}`,
    `--manifest=${manifestPath}`,
    `--production-baseline=${baselinePath}`,
    `--go-no-go=${goNoGoPath}`,
  ];
  if (preparedEntry) {
    cliArgs.push(
      "--recover-finalization=true",
      `--ack-lock-id=${preparedEntry.deploymentLockId}`,
    );
  }
  return {
    authorizationId: values.authorization.authorizationId,
    cliArgs,
    inventory,
    journalPath,
    manifest: values.manifest,
    phaseReportDigests: reports.map((report) => report.digest),
    preparedEntry,
    session: values.session,
    stateDir,
  };
}

async function expectFinalizeCliStateUnknown(fixture, failurePoint) {
  await assert.rejects(
    execFileAsync(process.execPath, fixture.cliArgs, {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED: "0",
        PROJECTAI_ROLLOUT_TEST_FINALIZE_FAILURE_POINT: failurePoint,
        PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(fixture.inventory),
      },
      maxBuffer: 8 * 1024 * 1024,
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /PRODUCTION_ROLLOUT_STATE_UNKNOWN/);
      assert.match(
        error.stderr,
        new RegExp(`Injected isolated Finalize failure at ${failurePoint}`),
      );
      return true;
    },
  );
}

async function assertFinalizeRecoveryMetadata(fixture) {
  const entries = await readJournal(fixture.journalPath);
  const prepared = entries.filter((entry) => entry.event === "finalization-prepared");
  assert.equal(prepared.length, 1);
  const [anchor] = prepared;
  assert.equal(anchor.releaseSessionId, fixture.session.releaseSessionId);
  assert.equal(anchor.phase, 6);
  assert.match(anchor.finalReportDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(anchor.finalInventoryDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(anchor.finalStateDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(anchor.deploymentLockId, /^pl-[0-9a-f]{32}$/);
  assert.match(anchor.authorizationId, /^pa-[0-9a-f]{32}$/);
  assert.ok(Number.isSafeInteger(anchor.ownerPid) && anchor.ownerPid > 0);
  assert.equal(anchor.ownerHostname, os.hostname());
  assert.equal(anchor.ownerUid, process.getuid());
  assert.ok(Number.isFinite(Date.parse(anchor.recordedAt)));
  assert.equal(
    anchor.digest,
    digestObject(
      Object.fromEntries(Object.entries(anchor).filter(([key]) => key !== "digest")),
    ),
  );
  assert.equal(
    entries.some((entry) => entry.event === "release-completed"),
    false,
  );
  const [report, inventory, consumptionContents] = await Promise.all([
    readFile(path.join(fixture.stateDir, "production-rollout-final.json"), "utf8").then(JSON.parse),
    readFile(path.join(fixture.stateDir, "final-production-inventory.json"), "utf8").then(JSON.parse),
    readFile(usedAuthorizationsPath(fixture.stateDir), "utf8"),
  ]);
  assert.equal(
    report.digest,
    digestObject(
      Object.fromEntries(Object.entries(report).filter(([key]) => key !== "digest")),
    ),
  );
  assert.equal(
    inventory.digest,
    digestObject(
      Object.fromEntries(Object.entries(inventory).filter(([key]) => key !== "digest")),
    ),
  );
  assert.equal(report.digest, anchor.finalReportDigest);
  assert.equal(inventory.digest, anchor.finalInventoryDigest);
  assert.equal(report.finalInventoryDigest, anchor.finalInventoryDigest);
  assert.equal(report.finalStateDigest, anchor.finalStateDigest);
  assert.equal(inventoryStateDigest(inventory), anchor.finalStateDigest);
  assert.equal(report.deploymentLockId, anchor.deploymentLockId);
  assert.equal(report.releaseSessionId, anchor.releaseSessionId);
  assert.equal(inventory.releaseSessionId, anchor.releaseSessionId);
  assert.equal(report.releaseCandidateSha, fixture.session.releaseCandidateSha);
  assert.equal(inventory.releaseCandidateSha, fixture.session.releaseCandidateSha);
  assert.equal(report.releaseImageDigest, fixture.manifest.releaseImageDigest);
  assert.equal(inventory.releaseImageDigest, fixture.manifest.releaseImageDigest);
  assert.equal(
    report.databaseToolsImageDigest,
    fixture.manifest.databaseToolsImageDigest,
  );
  assert.equal(report.phase, anchor.phase);
  assert.equal(report.phaseState, anchor.phaseState);
  assert.equal(report.reportType, "production-rollout-final");
  assert.equal(report.result, "release-prepared");
  assert.equal(report.sourceMode, "rehearsal-command");
  assert.equal(report.producer, RELEASE_REPORT_PRODUCER);
  assert.equal(report.producerVersion, PRODUCTION_ROLLOUT_VERSION);
  assert.deepEqual(
    report.phaseVerificationReportDigests,
    fixture.phaseReportDigests,
  );
  assert.equal(report.activeTotal, 0);
  assert.equal(report.productionHttpStatus, inventory.app.publicHttpStatus);
  assert.equal(inventory.environment, "rehearsal");
  assert.equal(inventory.sourceMode, "synthetic-test");
  const consumptions = consumptionContents.trim().split("\n").map(JSON.parse);
  assert.equal(consumptions.length, 1);
  const [consumption] = consumptions;
  assert.equal(consumption.authorizationId, fixture.authorizationId);
  assert.equal(consumption.releaseSessionId, fixture.session.releaseSessionId);
  assert.equal(consumption.phase, 6);
  assert.equal(consumption.action, "finalize");
  assert.equal(consumption.recordType, "production-authorization-consumption");
  assert.equal(consumption.previousDigest, null);
  assert.equal(
    consumption.digest,
    digestObject(
      Object.fromEntries(
        Object.entries(consumption).filter(([key]) => key !== "digest"),
      ),
    ),
  );
  return { anchor, entries };
}

test("Production Authorization is signed, time-bounded, single-phase, and binding-safe", () => {
  const values = signedAuthorization({ phases: [2] });
  assert.equal(PRODUCTION_ROLLOUT_VERSION, "b3-c2-v2");
  assertProductionAuthorization(values.authorization, {
    now: new Date("2026-01-01T00:10:00Z"),
    environment: "rehearsal",
    phase: 2,
    action: "apply",
    publicKey: values.publicKey,
  });
  assertAuthorizationBindings({
    authorization: values.authorization,
    session: values.session,
    manifest: values.manifest,
    productionBaseline: values.baseline,
    goNoGo: values.goNoGo,
    phase: 2,
    action: "apply",
  });
  assert.throws(
    () =>
      assertProductionAuthorization(values.authorization, {
        now: new Date("2026-01-01T00:31:00Z"),
        environment: "rehearsal",
        phase: 2,
        action: "apply",
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
        action: "apply",
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
        action: "apply",
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
        action: "apply",
        publicKey: values.publicKey,
      }),
    (error) => error.code === "PRODUCTION_AUTHORIZATION_INVALID",
  );
});

test("Authorization schema and executor metadata publish the same action allowlist", async () => {
  const [schema, phases] = await Promise.all([
    readFile(path.join(root, "release/production-rollout-authorization.schema.json"), "utf8")
      .then(JSON.parse),
    readFile(path.join(root, "release/production-rollout-phases.json"), "utf8")
      .then(JSON.parse),
  ]);
  assert.deepEqual(schema.properties.action.enum, AUTHORIZATION_ACTIONS);
  assert.deepEqual(phases.authorizationActions, AUTHORIZATION_ACTIONS);
  assert.ok(schema.required.includes("action"));
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
        action: "apply",
        authorizedAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-01T00:30:00Z",
      }),
    (error) => error.code === "PRODUCTION_APPLY_NOT_AUTHORIZED",
  );
});

test("pinned Trust Anchor rejects caller keys, symlinks, and broad permissions", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-trust-"));
  try {
    const trusted = generateKeyPairSync("ed25519");
    const caller = generateKeyPairSync("ed25519");
    const trustedPath = path.join(directory, "trusted.pem");
    const callerPath = path.join(directory, "caller.pem");
    const trustPath = path.join(directory, "trust.json");
    await Promise.all([
      writeFile(trustedPath, trusted.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 }),
      writeFile(callerPath, caller.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 }),
      writeFile(trustPath, JSON.stringify({
        schemaVersion: 1,
        algorithm: "ed25519",
        fingerprintEncoding: "spki-der-sha256",
        publicKeySha256: publicKeyFingerprint(trusted.publicKey),
        productionKeyPath: "/srv/projectai/authorization/production-rollout-public-key.pem",
        productionMarkerPath: "/srv/projectai/authorization/rollout-enabled.json",
        productionClaimHelperPath: "/srv/projectai/scripts/release/production-authorization-claim.mjs",
        productionClaimHelperSha256: `sha256:${"0".repeat(64)}`,
        productionClaimBundlePath:
          "/srv/projectai/release/production-authorization-claim-bundle.json",
        productionClaimBundleSha256: `sha256:${"0".repeat(64)}`,
      })),
    ]);
    assert.equal((await loadAuthorizationTrust({
      environment: "rehearsal",
      rehearsalPublicKeyPath: trustedPath,
      rehearsalTrustPath: trustPath,
    })).fingerprint, publicKeyFingerprint(trusted.publicKey));
    await assert.rejects(
      loadAuthorizationTrust({
        environment: "rehearsal",
        rehearsalPublicKeyPath: callerPath,
        rehearsalTrustPath: trustPath,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    );
    const linked = path.join(directory, "linked.pem");
    await symlink(trustedPath, linked);
    await assert.rejects(
      loadAuthorizationTrust({
        environment: "rehearsal",
        rehearsalPublicKeyPath: linked,
        rehearsalTrustPath: trustPath,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    );
    await chmod(trustedPath, 0o666);
    await assert.rejects(
      loadAuthorizationTrust({
        environment: "rehearsal",
        rehearsalPublicKeyPath: trustedPath,
        rehearsalTrustPath: trustPath,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Authorization Marker is phase-bound and Authorization IDs are append-only non-replayable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-replay-"));
  try {
    const values = liveSignedAuthorization({ phases: [4] });
    const markerNow = new Date();
    const markerExpiresAt = new Date(markerNow.getTime() + 30 * 60_000).toISOString();
    const markerPath = path.join(directory, "marker.json");
    await writeFile(
      markerPath,
      JSON.stringify(createTestAuthorizationMarker({
        authorization: values.authorization,
        phase: 4,
        action: "apply",
        expiresAt: markerExpiresAt,
      })),
      { mode: 0o600 },
    );
    await assertAuthorizationMarker({
      environment: "rehearsal",
      authorization: values.authorization,
      phase: 4,
      action: "apply",
      markerPath,
      now: markerNow,
    });
    await assert.rejects(
      assertAuthorizationMarker({
        environment: "rehearsal",
        authorization: values.authorization,
        phase: 3,
        action: "apply",
        markerPath,
        now: markerNow,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
    );
    await consumeAuthorization({
      stateDir: directory,
      authorization: values.authorization,
      phase: 4,
      action: "apply",
      environment: "rehearsal",
      publicKey: values.publicKey,
      markerPath,
    });
    await assert.rejects(
      consumeAuthorization({
        stateDir: directory,
        authorization: values.authorization,
        phase: 4,
        action: "apply",
        environment: "rehearsal",
        publicKey: values.publicKey,
        markerPath,
      }),
      (error) =>
        error.code === "PRODUCTION_AUTHORIZATION_REPLAYED" &&
        /already_consumed/.test(error.message),
    );
    const journalPath = usedAuthorizationsPath(directory);
    const records = (await readFile(journalPath, "utf8")).trim().split("\n");
    assert.equal(records.length, 1);
    const record = JSON.parse(records[0]);
    assert.equal(
      record.digest,
      digestObject(
        Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest")),
      ),
    );
    const metadata = await stat(journalPath);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.uid, process.getuid());
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal((await lstat(journalPath)).isSymbolicLink(), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Authorization action binding rejects cross-action use before claim", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-action-"));
  try {
    const values = liveSignedAuthorization({ phases: [2], action: "apply" });
    assert.throws(
      () => assertProductionAuthorization(values.authorization, {
        now: new Date(),
        environment: "rehearsal",
        phase: 2,
        action: "rollback",
        publicKey: values.publicKey,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
    );
    assert.throws(
      () => assertProductionAuthorization(values.authorization, {
        now: new Date(),
        environment: "rehearsal",
        phase: 2,
        publicKey: values.publicKey,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
    );
    assert.throws(
      () => assertAuthorizationBindings({
        authorization: values.authorization,
        session: values.session,
        manifest: values.manifest,
        productionBaseline: values.baseline,
        goNoGo: values.goNoGo,
        phase: 2,
        action: "rollback",
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
    );
    const markerPath = path.join(directory, "wrong-action-marker.json");
    await writeFile(
      markerPath,
      JSON.stringify(createTestAuthorizationMarker({
        authorization: values.authorization,
        phase: 2,
        action: "apply",
        expiresAt: values.authorization.expiresAt,
      })),
      { mode: 0o600 },
    );
    await assert.rejects(
      assertAuthorizationMarker({
        environment: "rehearsal",
        authorization: values.authorization,
        phase: 2,
        action: "rollback",
        markerPath,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
    );
    await assert.rejects(
      consumeAuthorization({
        stateDir: directory,
        authorization: values.authorization,
        phase: 2,
        action: "rollback",
        environment: "rehearsal",
        publicKey: values.publicKey,
      }),
      (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
    );
    await assert.rejects(
      lstat(path.join(directory, ".used-authorization-claims")),
      (error) => error.code === "ENOENT",
    );
    await consumeAuthorization({
      stateDir: directory,
      authorization: values.authorization,
      phase: 2,
      action: "apply",
      environment: "rehearsal",
      publicKey: values.publicKey,
      markerPath,
    });
    const records = (await readFile(usedAuthorizationsPath(directory), "utf8"))
      .trim()
      .split("\n");
    assert.equal(records.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("required Authorization actions are mutually bound through atomic consumption", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-action-matrix-"));
  const requiredActions = [
    ["apply", 0],
    ["rollback", 1],
    ["finalize", 6],
    ["lock-clear", 2],
    ["image-transfer", 0],
  ];
  try {
    for (const [index, [action, phase]] of requiredActions.entries()) {
      const values = liveSignedAuthorization({ phases: [phase], action });
      const markerPath = await writeAuthorizationMarker(directory, values, {
        phase,
        action,
        name: `matrix-${action}`,
      });
      const stateDir = path.join(directory, `state-${action}`);
      const wrongAction = requiredActions[(index + 1) % requiredActions.length][0];
      assert.doesNotThrow(() =>
        assertProductionAuthorization(values.authorization, {
          now: new Date(),
          environment: "rehearsal",
          phase,
          action,
          publicKey: values.publicKey,
        }),
      );
      assert.throws(
        () =>
          assertProductionAuthorization(values.authorization, {
            now: new Date(),
            environment: "rehearsal",
            phase,
            action: wrongAction,
            publicKey: values.publicKey,
          }),
        (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      );
      await assert.rejects(
        consumeAuthorization({
          stateDir,
          authorization: values.authorization,
          phase,
          action: wrongAction,
          environment: "rehearsal",
          publicKey: values.publicKey,
          markerPath,
        }),
        (error) => error.code === "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      );
      await assert.rejects(
        lstat(stateDir),
        (error) => error.code === "ENOENT",
      );
      const consumed = await consumeAuthorization({
        stateDir,
        authorization: values.authorization,
        phase,
        action,
        environment: "rehearsal",
        publicKey: values.publicKey,
        markerPath,
      });
      assert.equal(consumed.action, action);
      assert.equal(consumed.authorizationId, values.authorization.authorizationId);
      assert.equal(consumed.phase, phase);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent processes atomically claim one Authorization exactly once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-concurrent-"));
  try {
    const fixture = await writeClaimFixture(directory, { action: "apply", phase: 0 });
    const notBefore = Date.now() + 1_000;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        execFileAsync(
          process.execPath,
          [...fixture.claimArgs, `--test-not-before-ms=${notBefore}`],
          claimCommandOptions(),
        )),
    );
    const claimed = results.filter((result) => result.status === "fulfilled");
    const replayed = results.filter((result) => result.status === "rejected");
    assert.equal(claimed.length, 1);
    assert.equal(replayed.length, 7);
    for (const result of replayed) {
      assert.equal(result.reason.code, 79);
      assert.match(result.reason.stderr, /PRODUCTION_AUTHORIZATION_REPLAYED: already_consumed/);
    }
    const journalPath = usedAuthorizationsPath(fixture.stateDir);
    const records = (await readFile(journalPath, "utf8")).trim().split("\n");
    assert.equal(records.length, 1);
    const record = JSON.parse(records[0]);
    assert.equal(record.authorizationId, fixture.authorization.authorizationId);
    assert.equal(record.action, "apply");
    assert.equal(record.previousDigest, null);
    assert.equal(
      record.digest,
      digestObject(
        Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest")),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent distinct Authorizations preserve one complete Digest chain", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-chain-race-"));
  try {
    const fixtures = await Promise.all(
      Array.from({ length: 8 }, (_, index) => writeClaimFixture(directory, {
        action: "apply",
        phase: 0,
        name: `distinct-${index}`,
        stateName: "shared-state",
      })),
    );
    const notBefore = Date.now() + 1_000;
    const results = await Promise.all(
      fixtures.map((fixture) => execFileAsync(
        process.execPath,
        [...fixture.claimArgs, `--test-not-before-ms=${notBefore}`],
        claimCommandOptions(),
      )),
    );
    assert.equal(results.length, fixtures.length);
    const records = (await readFile(
      usedAuthorizationsPath(fixtures[0].stateDir),
      "utf8",
    )).trim().split("\n").map(JSON.parse);
    assert.equal(records.length, fixtures.length);
    assert.deepEqual(
      new Set(records.map((record) => record.authorizationId)),
      new Set(fixtures.map((fixture) => fixture.authorization.authorizationId)),
    );
    let previousDigest = null;
    for (const record of records) {
      assert.equal(record.previousDigest, previousDigest);
      assert.equal(
        record.digest,
        digestObject(
          Object.fromEntries(Object.entries(record).filter(([key]) => key !== "digest")),
        ),
      );
      previousDigest = record.digest;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Used Authorization journal fails closed, then reconciles a reviewed claim", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-link-"));
  try {
    const values = liveSignedAuthorization({ phases: [1], action: "apply" });
    const markerPath = await writeAuthorizationMarker(directory, values, {
      phase: 1,
      action: "apply",
      name: "symlink-marker",
    });
    const target = path.join(directory, "journal-target");
    const journalPath = usedAuthorizationsPath(directory);
    await writeFile(target, "sentinel\n", { mode: 0o600 });
    await symlink(target, journalPath);
    await assert.rejects(
      consumeAuthorization({
        stateDir: directory,
        authorization: values.authorization,
        phase: 1,
        action: "apply",
        environment: "rehearsal",
        publicKey: values.publicKey,
        markerPath,
      }),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    assert.equal(await readFile(target, "utf8"), "sentinel\n");
    assert.equal((await lstat(journalPath)).isSymbolicLink(), true);
    await rm(journalPath);
    const orphanMutexPath = `${journalPath}.lock`;
    await writeFile(
      orphanMutexPath,
      `${JSON.stringify(withDigest({
        schemaVersion: 1,
        ownerId: `um-${"f".repeat(32)}`,
        pid: 2_147_483_647,
        acquiredAt: new Date().toISOString(),
      }))}\n`,
      { mode: 0o600 },
    );
    const orphanMutexContents = await readFile(orphanMutexPath, "utf8");
    await assert.rejects(
      consumeAuthorization({
        stateDir: directory,
        authorization: values.authorization,
        phase: 1,
        action: "apply",
        environment: "rehearsal",
        publicKey: values.publicKey,
        markerPath,
      }),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    assert.equal(await readFile(orphanMutexPath, "utf8"), orphanMutexContents);
    await rm(orphanMutexPath);
    await assert.rejects(
      consumeAuthorization({
        stateDir: directory,
        authorization: values.authorization,
        phase: 1,
        action: "apply",
        environment: "rehearsal",
        publicKey: values.publicKey,
        markerPath,
      }),
      (error) =>
        error.code === "PRODUCTION_AUTHORIZATION_REPLAYED" &&
        /already_consumed/.test(error.message),
    );
    const recovered = (await readFile(journalPath, "utf8")).trim().split("\n");
    assert.equal(recovered.length, 1);
    assert.equal(JSON.parse(recovered[0]).authorizationId, values.authorization.authorizationId);
    assert.equal(await readFile(target, "utf8"), "sentinel\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Used Authorization journal rejects broad mode and a broken Digest chain", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-chain-"));
  try {
    const values = liveSignedAuthorization({ phases: [1], action: "apply" });
    const markerPath = await writeAuthorizationMarker(directory, values, {
      phase: 1,
      action: "apply",
      name: "chain-marker",
    });
    const consumeValues = (candidate, candidateMarkerPath) => consumeAuthorization({
      stateDir: directory,
      authorization: candidate.authorization,
      phase: 1,
      action: "apply",
      environment: "rehearsal",
      publicKey: candidate.publicKey,
      markerPath: candidateMarkerPath,
    });
    await consumeValues(values, markerPath);
    const journalPath = usedAuthorizationsPath(directory);
    const modeValues = nextAuthorization(values, { phase: 1, action: "apply" });
    const modeMarkerPath = await writeAuthorizationMarker(directory, modeValues, {
      phase: 1,
      action: "apply",
      name: "mode-marker",
    });
    await chmod(journalPath, 0o644);
    await assert.rejects(
      consumeValues(modeValues, modeMarkerPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    await chmod(journalPath, 0o600);
    const record = JSON.parse((await readFile(journalPath, "utf8")).trim());
    await writeFile(
      journalPath,
      `${JSON.stringify({ ...record, action: "rollback" })}\n`,
      { mode: 0o600 },
    );
    const chainValues = nextAuthorization(values, { phase: 1, action: "apply" });
    const chainMarkerPath = await writeAuthorizationMarker(directory, chainValues, {
      phase: 1,
      action: "apply",
      name: "broken-chain-marker",
    });
    await assert.rejects(
      consumeValues(chainValues, chainMarkerPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Image Transfer claim rejects replay before any transfer side-effect command", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-image-transfer-replay-"));
  try {
    const fixture = await writeClaimFixture(directory, {
      action: "image-transfer",
      phase: 0,
    });
    const order = [];
    const claimAuthorization = async (candidate = fixture, args = candidate.claimArgs) => {
      order.push("claim");
      const result = await execFileAsync(process.execPath, args, claimCommandOptions());
      return result.stdout;
    };
    const receipt = await executeAuthorizedImageTransfer({
      authorization: fixture.authorization,
      claimAuthorization,
      createRemoteDirectory: async () => order.push("mkdir"),
      transferArchives: async () => order.push("scp"),
      loadAndVerifyImages: async () => order.push("load"),
    });
    assert.equal(receipt.status, "claimed");
    assert.equal(receipt.authorizationId, fixture.authorization.authorizationId);
    assert.deepEqual(order, ["claim", "mkdir", "scp", "load"]);

    order.length = 0;
    await assert.rejects(
      executeAuthorizedImageTransfer({
        authorization: fixture.authorization,
        claimAuthorization,
        createRemoteDirectory: async () => order.push("mkdir"),
        transferArchives: async () => order.push("scp"),
        loadAndVerifyImages: async () => order.push("load"),
      }),
      (error) => {
        assert.equal(error.code, 79);
        assert.match(error.stderr, /PRODUCTION_AUTHORIZATION_REPLAYED: already_consumed/);
        return true;
      },
    );
    assert.deepEqual(order, ["claim"]);

    const wrongAction = await writeClaimFixture(directory, {
      action: "apply",
      phase: 0,
    });
    const wrongActionOrder = [];
    await assert.rejects(
      executeAuthorizedImageTransfer({
        authorization: wrongAction.authorization,
        claimAuthorization: async () => {
          wrongActionOrder.push("claim");
          const args = wrongAction.claimArgs.map((argument) =>
            argument === "--action=apply" ? "--action=image-transfer" : argument);
          return execFileAsync(process.execPath, args, claimCommandOptions());
        },
        createRemoteDirectory: async () => wrongActionOrder.push("mkdir"),
        transferArchives: async () => wrongActionOrder.push("scp"),
        loadAndVerifyImages: async () => wrongActionOrder.push("load"),
      }),
      (error) => {
        assert.match(error.stderr, /PRODUCTION_AUTHORIZATION_ACTION_INVALID/);
        return true;
      },
    );
    assert.deepEqual(wrongActionOrder, ["claim"]);

    const malformedReceiptOrder = [];
    await assert.rejects(
      executeAuthorizedImageTransfer({
        authorization: fixture.authorization,
        claimAuthorization: async () => {
          malformedReceiptOrder.push("claim");
          return JSON.stringify({ status: "claimed" });
        },
        createRemoteDirectory: async () => malformedReceiptOrder.push("mkdir"),
        transferArchives: async () => malformedReceiptOrder.push("scp"),
        loadAndVerifyImages: async () => malformedReceiptOrder.push("load"),
      }),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    assert.deepEqual(malformedReceiptOrder, ["claim"]);

    const interrupted = await writeClaimFixture(directory, {
      action: "image-transfer",
      phase: 0,
    });
    const interruptedOrder = [];
    const interruptedClaim = async () => {
      interruptedOrder.push("claim");
      const result = await execFileAsync(
        process.execPath,
        interrupted.claimArgs,
        claimCommandOptions(),
      );
      return result.stdout;
    };
    await assert.rejects(
      executeAuthorizedImageTransfer({
        authorization: interrupted.authorization,
        claimAuthorization: interruptedClaim,
        createRemoteDirectory: async () => interruptedOrder.push("mkdir"),
        transferArchives: async () => {
          interruptedOrder.push("scp");
          throw new Error("synthetic transfer interruption");
        },
        loadAndVerifyImages: async () => interruptedOrder.push("load"),
      }),
      /synthetic transfer interruption/,
    );
    assert.deepEqual(interruptedOrder, ["claim", "mkdir", "scp"]);
    interruptedOrder.length = 0;
    await assert.rejects(
      executeAuthorizedImageTransfer({
        authorization: interrupted.authorization,
        claimAuthorization: interruptedClaim,
        createRemoteDirectory: async () => interruptedOrder.push("mkdir"),
        transferArchives: async () => interruptedOrder.push("scp"),
        loadAndVerifyImages: async () => interruptedOrder.push("load"),
      }),
      (error) => error.code === 79,
    );
    assert.deepEqual(interruptedOrder, ["claim"]);

    const source = await readFile(
      path.join(root, "scripts/release/production-image-transfer.mjs"),
      "utf8",
    );
    const helper = await readFile(
      path.join(root, "scripts/release/production-authorization-claim.mjs"),
    );
    const bundleContents = await readFile(
      path.join(root, "release/production-authorization-claim-bundle.json"),
    );
    const bundle = JSON.parse(bundleContents);
    const trustContract = JSON.parse(await readFile(
      path.join(root, "release/production-rollout-trust.json"),
      "utf8",
    ));
    assert.equal(
      trustContract.productionClaimHelperSha256,
      `sha256:${createHash("sha256").update(helper).digest("hex")}`,
    );
    assert.equal(
      trustContract.productionClaimBundleSha256,
      `sha256:${createHash("sha256").update(bundleContents).digest("hex")}`,
    );
    for (const dependency of bundle.dependencies) {
      const relative = dependency.path.replace("/srv/projectai/", "");
      const contents = await readFile(path.join(root, relative));
      assert.equal(
        dependency.sha256,
        `sha256:${createHash("sha256").update(contents).digest("hex")}`,
      );
    }
    assert.match(source, /executeAuthorizedImageTransfer/);
    assert.doesNotMatch(source, /grep -Fq|python3 - .*used-authorizations/);
    const records = (await readFile(
      usedAuthorizationsPath(fixture.stateDir),
      "utf8",
    )).trim().split("\n").map(JSON.parse);
    assert.equal(records.length, 2);
    assert.deepEqual(
      new Set(records.map((record) => record.authorizationId)),
      new Set([
        fixture.authorization.authorizationId,
        interrupted.authorization.authorizationId,
      ]),
    );
    assert.equal(records.every((record) => record.action === "image-transfer"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  assert.doesNotThrow(() => assertPhaseTransition("running", "awaiting_verification"));
  assert.doesNotThrow(() => assertPhaseTransition("awaiting_verification", "succeeded"));
  assert.doesNotThrow(() => assertPhaseTransition("succeeded", "awaiting_rollback_verification"));
  assert.doesNotThrow(() => assertPhaseTransition("awaiting_rollback_verification", "rolled_back"));
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
      authorizationId: `pa-${"1".repeat(32)}`,
    });
    let lock = await acquireDeploymentLock({ lockPath, metadata });
    assert.equal(lock.releaseSessionId, session.releaseSessionId);
    lock = await updateDeploymentLock({
      lockPath,
      expectedLock: lock,
      phase: 1,
      authorizationId: `pa-${"2".repeat(32)}`,
    });
    assert.equal(lock.currentPhase, 1);
    assert.notEqual(lock.leaseToken, metadata.leaseToken);
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
    await releaseDeploymentLock({ lockPath, expectedLock: lock });
    assert.equal(await readDeploymentLock(lockPath), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent rollout Journal appends preserve one complete Digest chain", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-race-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        appendIndependentJournalEvent(journalPath, {
          releaseSessionId: session.releaseSessionId,
          phase: index % 7,
          event: `concurrent-${index}`,
          phaseState: "running",
          recordedAt: new Date(Date.now() + index).toISOString(),
        }),
      ),
    );
    const entries = await readJournal(journalPath);
    assert.equal(entries.length, 12);
    assert.equal(new Set(entries.map((entry) => entry.event)).size, 12);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cross-process rollout Journal append claims prevent Digest forks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-process-"));
  try {
    const journalPath = journalPathFor(directory);
    const barrierPath = path.join(directory, "barrier");
    const contractUrl = pathToFileURL(
      path.join(root, "scripts/release/production-rollout-contract.mjs"),
    ).href;
    const childSource = `
      import { access } from "node:fs/promises";
      import { appendJournal } from ${JSON.stringify(contractUrl)};
      while (true) {
        try { await access(process.env.P2_JOURNAL_BARRIER); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
      }
      const entry = {
        releaseSessionId: "rs-" + "1".repeat(32),
        phase: Number(process.env.P2_JOURNAL_INDEX),
        event: "process-" + process.env.P2_JOURNAL_INDEX,
        phaseState: "running",
        recordedAt: new Date().toISOString(),
      };
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { await appendJournal(process.env.P2_JOURNAL_PATH, entry); break; }
        catch (error) {
          if (error?.code !== "PRODUCTION_ROLLOUT_STATE_CHANGED" || attempt === 49) throw error;
        }
      }
      process.stdout.write("appended");
    `;
    const children = Array.from({ length: 4 }, (_, index) =>
      execFileAsync(process.execPath, ["--input-type=module", "--eval", childSource], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          P2_JOURNAL_BARRIER: barrierPath,
          P2_JOURNAL_INDEX: String(index),
          P2_JOURNAL_PATH: journalPath,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeFile(barrierPath, "ready\n", { mode: 0o600 });
    const results = await Promise.all(children);
    assert.deepEqual(results.map((result) => result.stdout), Array(4).fill("appended"));
    const entries = await readJournal(journalPath);
    assert.equal(entries.length, 4);
    assert.equal(new Set(entries.map((entry) => entry.event)).size, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dead timed-out Journal append claim is recovered once before later appends", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-recovery-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    const claimDirectory = `${journalPath}.append-claims`;
    const claimPath = path.join(claimDirectory, "genesis.json");
    const orphanPid = 2_000_000_000;
    const claimedAt = new Date("2026-01-01T00:00:00Z");
    const reviewedAt = new Date("2026-01-01T00:05:00Z");
    const orphanEntry = withDigest({
      schemaVersion: 1,
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "release-completed",
      phaseState: "succeeded",
      recordedAt: claimedAt.toISOString(),
      previousDigest: null,
    });
    const orphanClaim = withDigest({
      schemaVersion: 1,
      recordType: "production-rollout-journal-append-claim",
      claimId: `jc-${"1".repeat(32)}`,
      previousDigest: null,
      entry: orphanEntry,
      ownerPid: orphanPid,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      claimedAt: claimedAt.toISOString(),
    });
    await mkdir(claimDirectory, { recursive: true, mode: 0o700 });
    await writeFile(claimPath, `${JSON.stringify(orphanClaim)}\n`, { mode: 0o600 });
    const orphanRecoveryGuard = withDigest({
      schemaVersion: 1,
      recordType: "production-rollout-journal-recovery-guard",
      guardId: `jg-${"2".repeat(32)}`,
      claimId: orphanClaim.claimId,
      claimDigest: orphanClaim.digest,
      entryDigest: orphanEntry.digest,
      ownerPid: orphanPid,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      acquiredAt: claimedAt.toISOString(),
    });
    const recoveryGuardPath = `${claimPath}.recovery`;
    await mkdir(recoveryGuardPath, { mode: 0o700 });
    await writeFile(
      path.join(recoveryGuardPath, "metadata.json"),
      `${JSON.stringify(orphanRecoveryGuard)}\n`,
      { mode: 0o600 },
    );

    const recoveryResults = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        appendIndependentJournalEvent(
          journalPath,
          {
            releaseSessionId: session.releaseSessionId,
            phase: 6,
            event: `post-recovery-${index}`,
            phaseState: "succeeded",
            recordedAt: new Date(reviewedAt.getTime() + index).toISOString(),
          },
          {
            now: reviewedAt,
            isPidAlive: (pid) => pid !== orphanPid,
          },
        ),
      ),
    );
    const recoveryFailure = recoveryResults.find((result) => result.status === "rejected");
    if (recoveryFailure) throw recoveryFailure.reason;

    const entries = await readJournal(journalPath);
    assert.equal(entries.length, 5);
    assert.equal(entries[0].digest, orphanEntry.digest);
    assert.equal(
      entries.filter((entry) => entry.digest === orphanEntry.digest).length,
      1,
    );
    assert.equal(
      new Set(entries.slice(1).map((entry) => entry.event)).size,
      4,
    );
    assert.equal((await stat(claimPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Journal recovery re-samples time while a dead claim crosses the timeout", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-clock-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    const claimDirectory = `${journalPath}.append-claims`;
    const claimPath = path.join(claimDirectory, "genesis.json");
    const orphanPid = 2_000_000_000;
    const claimedAt = new Date(
      Date.now() - PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS + 250,
    );
    const orphanPayload = {
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "release-completed",
      phaseState: "succeeded",
      recordedAt: claimedAt.toISOString(),
    };
    const orphanEntry = withDigest({
      schemaVersion: 1,
      ...orphanPayload,
      previousDigest: null,
    });
    const orphanClaim = withDigest({
      schemaVersion: 1,
      recordType: "production-rollout-journal-append-claim",
      claimId: `jc-${"6".repeat(32)}`,
      previousDigest: null,
      entry: orphanEntry,
      ownerPid: orphanPid,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      claimedAt: claimedAt.toISOString(),
    });
    await mkdir(claimDirectory, { recursive: true, mode: 0o700 });
    await writeFile(claimPath, `${JSON.stringify(orphanClaim)}\n`, { mode: 0o600 });

    const recovered = await appendJournal(journalPath, orphanPayload, {
      isPidAlive: (pid) => pid !== orphanPid,
    });
    assert.equal(recovered.digest, orphanEntry.digest);
    assert.deepEqual(await readJournal(journalPath), [orphanEntry]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovering another Journal claim aborts stale phase-state append", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-state-change-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    const verified = await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "verified",
      phaseState: "succeeded",
      recordedAt: "2026-01-01T00:00:00Z",
    });
    const orphanPid = 2_000_000_000;
    const orphanEntry = withDigest({
      schemaVersion: 1,
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "rollback-mutation-completed",
      phaseState: "awaiting_rollback_verification",
      recordedAt: "2026-01-01T00:01:00Z",
      previousDigest: verified.digest,
    });
    const orphanClaim = withDigest({
      schemaVersion: 1,
      recordType: "production-rollout-journal-append-claim",
      claimId: `jc-${"3".repeat(32)}`,
      previousDigest: verified.digest,
      entry: orphanEntry,
      ownerPid: orphanPid,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      claimedAt: "2026-01-01T00:01:00Z",
    });
    const claimDirectory = `${journalPath}.append-claims`;
    const claimPath = path.join(
      claimDirectory,
      `${verified.digest.slice("sha256:".length)}.json`,
    );
    await writeFile(claimPath, `${JSON.stringify(orphanClaim)}\n`, { mode: 0o600 });

    await assert.rejects(
      appendJournal(
        journalPath,
        {
          releaseSessionId: session.releaseSessionId,
          phase: 6,
          event: "lock-clear-approved",
          phaseState: "succeeded",
          recordedAt: "2026-01-01T00:05:00Z",
        },
        {
          now: new Date("2026-01-01T00:05:00Z"),
          isPidAlive: (pid) => pid !== orphanPid,
          expectedPreviousDigest: verified.digest,
        },
      ),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_CHANGED",
    );
    const entries = await readJournal(journalPath);
    assert.equal(entries.length, 2);
    assert.equal(entries.at(-1).digest, orphanEntry.digest);
    assert.equal(currentPhaseState(entries, 6), "awaiting_rollback_verification");
    assert.equal(entries.some((entry) => entry.event === "lock-clear-approved"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Finalize recovery cannot pass a stale snapshot after release-completed reconciliation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-finalize-state-change-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "verified",
      phaseState: "succeeded",
      recordedAt: "2026-01-01T00:00:00Z",
    });
    const prepared = await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "finalization-prepared",
      phaseState: "succeeded",
      recordedAt: "2026-01-01T00:01:00Z",
    });
    const orphanPid = 2_000_000_000;
    const completedEntry = withDigest({
      schemaVersion: 1,
      releaseSessionId: session.releaseSessionId,
      phase: 6,
      event: "release-completed",
      phaseState: "succeeded",
      recordedAt: "2026-01-01T00:02:00Z",
      previousDigest: prepared.digest,
    });
    const completedClaim = withDigest({
      schemaVersion: 1,
      recordType: "production-rollout-journal-append-claim",
      claimId: `jc-${"4".repeat(32)}`,
      previousDigest: prepared.digest,
      entry: completedEntry,
      ownerPid: orphanPid,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      claimedAt: "2026-01-01T00:02:00Z",
    });
    const claimPath = path.join(
      `${journalPath}.append-claims`,
      `${prepared.digest.slice("sha256:".length)}.json`,
    );
    await writeFile(claimPath, `${JSON.stringify(completedClaim)}\n`, { mode: 0o600 });

    await assert.rejects(
      appendJournal(
        journalPath,
        {
          releaseSessionId: session.releaseSessionId,
          phase: 6,
          event: "finalization-reacquired",
          phaseState: "succeeded",
          recordedAt: "2026-01-01T00:05:00Z",
        },
        {
          now: new Date("2026-01-01T00:05:00Z"),
          isPidAlive: (pid) => pid !== orphanPid,
          expectedPreviousDigest: prepared.digest,
        },
      ),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_CHANGED",
    );
    const entries = await readJournal(journalPath);
    assert.equal(entries.at(-1).digest, completedEntry.digest);
    assert.equal(entries.some((entry) => entry.event === "finalization-reacquired"), false);
    await assert.rejects(
      appendJournal(
        journalPath,
        {
          releaseSessionId: session.releaseSessionId,
          phase: 6,
          event: "finalization-reacquired",
          phaseState: "succeeded",
          recordedAt: "2026-01-01T00:06:00Z",
        },
        { expectedPreviousDigest: prepared.digest },
      ),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_CHANGED",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rollout Journal rejects broad mode and symlink paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-journal-mode-"));
  try {
    const { session } = fixtures();
    const journalPath = journalPathFor(directory);
    await appendJournal(journalPath, {
      releaseSessionId: session.releaseSessionId,
      phase: 0,
      event: "started",
      phaseState: "running",
      recordedAt: new Date().toISOString(),
    });
    await chmod(journalPath, 0o644);
    await assert.rejects(
      readJournal(journalPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    await chmod(journalPath, 0o600);
    const symlinkPath = path.join(directory, "journal-link.jsonl");
    await symlink(journalPath, symlinkPath);
    await assert.rejects(
      readJournal(symlinkPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent Deployment Lock acquire permits exactly one cross-process claimant", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-concurrent-"));
  try {
    const lockPath = path.join(directory, "lock");
    const barrierPath = path.join(directory, "barrier");
    const contractUrl = pathToFileURL(
      path.join(root, "scripts/release/production-rollout-contract.mjs"),
    ).href;
    const childSource = `
      import { access } from "node:fs/promises";
      import { acquireDeploymentLock, createLockMetadata } from ${JSON.stringify(contractUrl)};
      while (true) {
        try { await access(process.env.P2_LOCK_BARRIER); break; }
        catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
      }
      const session = {
        releaseSessionId: "rs-" + "1".repeat(32),
        releaseCandidateSha: "2".repeat(40),
      };
      try {
        const lock = await acquireDeploymentLock({
          lockPath: process.env.P2_LOCK_PATH,
          metadata: createLockMetadata({
            session,
            phase: 0,
            authorizationId: "pa-" + process.env.P2_LOCK_CHARACTER.repeat(32),
          }),
        });
        process.stdout.write("acquired:" + lock.lockId);
      } catch (error) {
        if (error?.code !== "PRODUCTION_DEPLOYMENT_LOCK_HELD") throw error;
        process.stdout.write("held");
      }
    `;
    const attempts = ["a", "b", "c", "d"].map((value) =>
      execFileAsync(process.execPath, ["--input-type=module", "--eval", childSource], {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          P2_LOCK_BARRIER: barrierPath,
          P2_LOCK_CHARACTER: value,
          P2_LOCK_PATH: lockPath,
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await writeFile(barrierPath, "ready\n", { mode: 0o600 });
    const results = await Promise.all(attempts);
    const successful = results.filter((result) => result.stdout.startsWith("acquired:"));
    const rejected = results.filter((result) => result.stdout === "held");
    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 3);
    const lock = await readDeploymentLock(lockPath);
    assert.equal(successful[0].stdout, `acquired:${lock.lockId}`);
    await releaseDeploymentLock({
      lockPath,
      expectedLock: lock,
      allowStale: true,
      isPidAlive: () => false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("wrong session, Lock ID, lease, or owner cannot release a live Deployment Lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-wrong-lease-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId: `pa-${"e".repeat(32)}`,
      }),
    });
    const forgedRecords = [
      withDigest({ ...lock, releaseSessionId: `rs-${"9".repeat(32)}` }),
      withDigest({ ...lock, lockId: `pl-${"9".repeat(32)}` }),
      withDigest({ ...lock, leaseToken: "0".repeat(64) }),
      withDigest({ ...lock, ownerPid: lock.ownerPid + 1 }),
      withDigest({ ...lock, ownerHostname: `${lock.ownerHostname}-forged` }),
      withDigest({ ...lock, ownerUid: lock.ownerUid + 1 }),
    ];
    for (const forged of forgedRecords) {
      await assert.rejects(
        releaseDeploymentLock({ lockPath, expectedLock: forged }),
        (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      );
      assert.deepEqual(await readDeploymentLock(lockPath), lock);
    }
    await releaseDeploymentLock({ lockPath, expectedLock: lock });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Finalize state-change cleanup releases only the exact newly acquired idle Lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-idle-cleanup-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 6,
        authorizationId: `pa-${"7".repeat(32)}`,
        ownerPid: 0,
      }),
    });
    const wrongLease = withDigest({ ...lock, leaseToken: "8".repeat(64) });
    await assert.rejects(
      releaseIdleDeploymentLock({
        lockPath,
        expectedLock: wrongLease,
        phase: 6,
        authorizationId: lock.authorizationId,
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    );
    assert.deepEqual(await readDeploymentLock(lockPath), lock);
    await releaseIdleDeploymentLock({
      lockPath,
      expectedLock: lock,
      phase: 6,
      authorizationId: lock.authorizationId,
    });
    assert.equal(await readDeploymentLock(lockPath), null);
    const activeLock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 6,
        authorizationId: `pa-${"9".repeat(32)}`,
      }),
    });
    await assert.rejects(
      releaseIdleDeploymentLock({
        lockPath,
        expectedLock: activeLock,
        phase: 6,
        authorizationId: activeLock.authorizationId,
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    );
    assert.deepEqual(await readDeploymentLock(lockPath), activeLock);
    await releaseDeploymentLock({ lockPath, expectedLock: activeLock });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent Lock heartbeat and release cannot delete a rotated Lease", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-release-race-"));
  try {
    const { session } = fixtures();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const lockPath = path.join(directory, `lock-${attempt}`);
      const lock = await acquireDeploymentLock({
        lockPath,
        metadata: createLockMetadata({
          session,
          phase: 0,
          authorizationId: `pa-${"a".repeat(32)}`,
        }),
      });
      const [heartbeat, release] = await Promise.allSettled([
        updateDeploymentLock({
          lockPath,
          expectedLock: lock,
          phase: 0,
          authorizationId: lock.authorizationId,
        }),
        releaseDeploymentLock({ lockPath, expectedLock: lock }),
      ]);
      assert.equal(
        [heartbeat, release].filter((result) => result.status === "fulfilled").length,
        1,
      );
      const current = await readDeploymentLock(lockPath);
      if (heartbeat.status === "fulfilled") {
        assert.deepEqual(current, heartbeat.value);
        assert.notEqual(current.leaseToken, lock.leaseToken);
        await releaseDeploymentLock({ lockPath, expectedLock: current });
      } else {
        assert.equal(current, null);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("interrupted no-replace publication remains readable and explicitly releasable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-link-crash-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const incompleteTemporary = `${lockPath}.tmp-crashed-publisher`;
    const lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId: `pa-${"b".repeat(32)}`,
      }),
    });
    await link(lockPath, incompleteTemporary);
    assert.equal((await stat(lockPath)).nlink, 2);
    assert.deepEqual(await readDeploymentLock(lockPath), lock);
    await releaseDeploymentLock({ lockPath, expectedLock: lock });
    assert.equal(await readDeploymentLock(lockPath), null);
    assert.equal((await stat(incompleteTemporary)).nlink, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Deployment Lock rejects foreign, expired, and dead-PID ownership without auto-deletion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-lease-"));
  try {
    const { session } = fixtures();
    const authorizationId = `pa-${"5".repeat(32)}`;
    const activePath = path.join(directory, "active");
    await acquireDeploymentLock({
      lockPath: activePath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId,
        ownerHostname: "another-host",
      }),
    });
    await assert.rejects(
      readDeploymentLock(activePath, { validateLease: true }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    );

    const expiredPath = path.join(directory, "expired");
    const expired = await acquireDeploymentLock({
      lockPath: expiredPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId,
        now: new Date("2026-01-01T00:00:00Z"),
        ttlMs: 1000,
        ownerPid: 0,
      }),
    });
    await assert.rejects(
      readDeploymentLock(expiredPath, {
        validateLease: true,
        now: new Date("2026-01-01T00:00:02Z"),
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_STALE",
    );
    assert.deepEqual(await readDeploymentLock(expiredPath), expired);

    const deadPath = path.join(directory, "dead");
    const dead = await acquireDeploymentLock({
      lockPath: deadPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId,
        ownerPid: 2_000_000_000,
        ownerHostname: os.hostname(),
      }),
    });
    await assert.rejects(
      readDeploymentLock(deadPath, { validateLease: true }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_STALE",
    );
    assert.deepEqual(await readDeploymentLock(deadPath), dead);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Deployment Lock heartbeat timeout fails closed before lease expiry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-heartbeat-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const started = new Date("2026-01-01T00:00:00Z");
    const lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId: `pa-${"6".repeat(32)}`,
        now: started,
        ttlMs: 60 * 60 * 1000,
      }),
    });
    await assert.rejects(
      readDeploymentLock(lockPath, {
        validateLease: true,
        now: new Date(started.getTime() + 2 * 60 * 1000),
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_STALE",
    );
    assert.deepEqual(await readDeploymentLock(lockPath), lock);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("crashed owner requires stale review and explicit clear before reacquire", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-crash-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const crashedAt = new Date("2026-01-01T00:00:00Z");
    const reviewAt = new Date("2026-01-01T00:05:00Z");
    const crashed = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 3,
        authorizationId: `pa-${"7".repeat(32)}`,
        now: crashedAt,
        ttlMs: 1000,
        ownerPid: 2_000_000_000,
        ownerHostname: os.hostname(),
      }),
    });
    await assert.rejects(
      readDeploymentLock(lockPath, {
        validateLease: true,
        now: reviewAt,
        isPidAlive: () => false,
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_STALE",
    );
    assert.deepEqual(await readDeploymentLock(lockPath), crashed);
    assert.equal(
      assertDeploymentLockClearable(crashed, {
        now: reviewAt,
        isPidAlive: () => false,
      }),
      crashed,
    );
    await releaseDeploymentLock({
      lockPath,
      expectedLock: crashed,
      allowStale: true,
      now: reviewAt,
      isPidAlive: () => false,
    });
    assert.equal(await readDeploymentLock(lockPath), null);
    const replacement = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 3,
        authorizationId: `pa-${"8".repeat(32)}`,
      }),
    });
    assert.notEqual(replacement.lockId, crashed.lockId);
    assert.equal((await readDeploymentLock(lockPath, { validateLease: true })).lockId, replacement.lockId);
    await releaseDeploymentLock({ lockPath, expectedLock: replacement });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent stale-guard takeover has one release winner and cannot delete a replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-stale-guard-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const staleAt = new Date("2026-01-01T00:00:00Z");
    const reviewAt = new Date("2026-01-01T00:05:00Z");
    const lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 3,
        authorizationId: `pa-${"c".repeat(32)}`,
        now: staleAt,
        ttlMs: 1000,
        ownerPid: 2_000_000_000,
        ownerHostname: os.hostname(),
      }),
    });
    const guard = withDigest({
      schemaVersion: 2,
      guardId: `pg-${"d".repeat(32)}`,
      operation: "update",
      releaseSessionId: session.releaseSessionId,
      releaseCandidateSha: session.releaseCandidateSha,
      currentPhase: 3,
      authorizationId: lock.authorizationId,
      targetLockId: lock.lockId,
      targetLockDigest: lock.digest,
      ownerPid: 2_000_000_000,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      acquiredAt: staleAt.toISOString(),
    });
    const guardPath = `${lockPath}.lifecycle`;
    await mkdir(guardPath, { mode: 0o700 });
    await writeFile(path.join(guardPath, "metadata.json"), `${JSON.stringify(guard)}\n`, {
      mode: 0o600,
    });
    const attempts = await Promise.allSettled([
      releaseDeploymentLock({
        lockPath,
        expectedLock: lock,
        allowStale: true,
        now: reviewAt,
        isPidAlive: () => false,
      }),
      releaseDeploymentLock({
        lockPath,
        expectedLock: lock,
        allowStale: true,
        now: reviewAt,
        isPidAlive: () => false,
      }),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await readDeploymentLock(lockPath), null);
    const replacement = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 3,
        authorizationId: `pa-${"e".repeat(32)}`,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await readDeploymentLock(lockPath)).lockId, replacement.lockId);
    await releaseDeploymentLock({ lockPath, expectedLock: replacement });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("crash after Lock removal requires reviewed lifecycle-guard clear before reacquire", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-guard-only-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const staleAt = new Date("2026-01-01T00:00:00Z");
    const reviewAt = new Date("2026-01-01T00:05:00Z");
    const guard = withDigest({
      schemaVersion: 2,
      guardId: `pg-${"f".repeat(32)}`,
      operation: "release",
      releaseSessionId: session.releaseSessionId,
      releaseCandidateSha: session.releaseCandidateSha,
      currentPhase: 6,
      authorizationId: `pa-${"1".repeat(32)}`,
      targetLockId: `pl-${"2".repeat(32)}`,
      targetLockDigest: `sha256:${"3".repeat(64)}`,
      ownerPid: 2_000_000_000,
      ownerHostname: os.hostname(),
      ownerUid: process.getuid(),
      acquiredAt: staleAt.toISOString(),
    });
    const guardPath = `${lockPath}.lifecycle`;
    await mkdir(guardPath, { mode: 0o700 });
    await writeFile(path.join(guardPath, "metadata.json"), `${JSON.stringify(guard)}\n`, {
      mode: 0o600,
    });
    const observed = await readDeploymentLifecycleGuard(lockPath);
    assert.deepEqual(observed, guard);
    assert.deepEqual(
      assertDeploymentLifecycleGuardClearable(observed, {
        now: reviewAt,
        isPidAlive: () => false,
      }),
      guard,
    );
    await clearStaleDeploymentLifecycleGuard({
      lockPath,
      expectedGuard: observed,
      now: reviewAt,
      isPidAlive: () => false,
    });
    assert.equal(await readDeploymentLifecycleGuard(lockPath), null);
    const replacement = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 6,
        authorizationId: `pa-${"4".repeat(32)}`,
      }),
    });
    await releaseDeploymentLock({ lockPath, expectedLock: replacement });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("only an empty lifecycle directory is recoverable; corrupt or unknown contents fail closed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-guard-incomplete-"));
  try {
    const { session } = fixtures();
    const lockPath = path.join(directory, "lock");
    const guardPath = `${lockPath}.lifecycle`;
    await mkdir(guardPath, { mode: 0o700 });
    assert.equal(await readDeploymentLifecycleGuard(lockPath), null);
    const recovered = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session,
        phase: 0,
        authorizationId: `pa-${"5".repeat(32)}`,
      }),
    });
    assert.equal((await readDeploymentLock(lockPath)).lockId, recovered.lockId);
    await releaseDeploymentLock({ lockPath, expectedLock: recovered });

    const corruptLockPath = path.join(directory, "corrupt-lock");
    const corruptGuardPath = `${corruptLockPath}.lifecycle`;
    const corruptMetadataPath = path.join(corruptGuardPath, "metadata.json");
    await mkdir(corruptGuardPath, { mode: 0o700 });
    await writeFile(corruptMetadataPath, "{\n", { mode: 0o600 });
    await assert.rejects(
      readDeploymentLifecycleGuard(corruptLockPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    await assert.rejects(
      acquireDeploymentLock({
        lockPath: corruptLockPath,
        metadata: createLockMetadata({
          session,
          phase: 0,
          authorizationId: `pa-${"6".repeat(32)}`,
        }),
      }),
      (error) => error.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    );
    assert.equal(await readDeploymentLock(corruptLockPath), null);
    assert.equal(await readFile(corruptMetadataPath, "utf8"), "{\n");

    const junkLockPath = path.join(directory, "junk-lock");
    const junkGuardPath = `${junkLockPath}.lifecycle`;
    const junkPath = path.join(junkGuardPath, "unexpected");
    await mkdir(junkGuardPath, { mode: 0o700 });
    await writeFile(junkPath, "unknown\n", { mode: 0o600 });
    await assert.rejects(
      readDeploymentLifecycleGuard(junkLockPath),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    await assert.rejects(
      acquireDeploymentLock({
        lockPath: junkLockPath,
        metadata: createLockMetadata({
          session,
          phase: 0,
          authorizationId: `pa-${"a".repeat(32)}`,
        }),
      }),
      (error) => error.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    );
    assert.equal(await readDeploymentLock(junkLockPath), null);
    assert.equal(await readFile(junkPath, "utf8"), "unknown\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("phase prerequisites require the exact previous successful generated report", () => {
  const { session } = fixtures();
  const previous = withDigest({
    schemaVersion: 1,
    reportType: "production-rollout-phase-verification",
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

test("live Inventory must be producer-bound and no older than five minutes", async () => {
  const { session } = fixtures();
  const baseline = JSON.parse(
    await readFile(path.join(root, "release/fixtures/production-like-inventory.json"), "utf8"),
  );
  const fresh = withDigest({
    ...baseline,
    capturedAt: "2026-01-01T00:08:00Z",
    reportType: "production-inventory",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "live-readonly",
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    releaseSessionId: session.releaseSessionId,
  });
  assert.doesNotThrow(() =>
    assertFreshLiveInventory(fresh, {
      session,
      environment: "production",
      now: new Date("2026-01-01T00:10:00Z"),
    }),
  );
  assert.throws(
    () =>
      assertFreshLiveInventory(fresh, {
        session,
        environment: "production",
        now: new Date("2026-01-01T00:14:00Z"),
      }),
    (error) => error.code === "PRODUCTION_INVENTORY_STALE",
  );
});

test("Production live Inventory uses only the current Compose, runtime, Worker, and Lock names", async () => {
  const source = await readFile(
    path.join(root, "scripts/release/remote-inventory.sh"),
    "utf8",
  );
  assert.match(source, /\/srv\/projectai\/docker-compose\.production-rollout\.yml/);
  assert.match(source, /project-ai-os-document-worker/);
  assert.match(source, /project-ai-os-embedding-worker/);
  assert.match(source, /\/srv\/projectai\/\.production-rollout-lock/);
  assert.doesNotMatch(source, /docker-compose\.prod\.yml/);
  assert.doesNotMatch(source, /project-ai-os-worker(?:\s|$)/m);
  assert.doesNotMatch(source, /\.production-deploy-lock/);
});

test("Production Compose, image metadata, and Qwen Secret metadata enforce least privilege", async () => {
  const [compose, aiCompose] = await Promise.all([
    readFile(path.join(root, "docker-compose.production-rollout.yml"), "utf8"),
    readFile(path.join(root, "docker-compose.production-ai.yml"), "utf8"),
  ]);
  assert.doesNotThrow(() => assertComposeContract(compose, aiCompose));
  const appBlock = compose.slice(compose.indexOf("  projectai-app:"), compose.indexOf("  projectai-document-worker:"));
  const documentBlock = compose.slice(compose.indexOf("  projectai-document-worker:"), compose.indexOf("  projectai-embedding-worker:"));
  const embeddingStart = compose.indexOf("  projectai-embedding-worker:");
  const postgresStart = compose.indexOf("\n  projectai-postgres:", embeddingStart);
  const minioStart = compose.indexOf("\n  projectai-minio:", postgresStart);
  const minioInitStart = compose.indexOf("\n  projectai-minio-init:", minioStart);
  const embeddingBlock = compose.slice(embeddingStart, postgresStart);
  const postgresBlock = compose.slice(postgresStart, minioStart);
  const minioBlock = compose.slice(minioStart, minioInitStart);
  assert.match(appBlock, /projectai-production-egress/);
  assert.match(embeddingBlock, /projectai-production-egress/);
  assert.doesNotMatch(documentBlock, /projectai-production-egress/);
  assert.doesNotMatch(postgresBlock, /projectai-production-egress/);
  assert.doesNotMatch(minioBlock, /projectai-production-egress/);
  assert.match(documentBlock, /\.env\.embedding-production/);
  assert.doesNotMatch(documentBlock, /qwen_api_key/);
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

test("Apply and independent Verification reports are digest-, producer-, and Journal-bound", () => {
  const { session, manifest } = fixtures();
  const mutationStartedAt = new Date(Date.now() - 2_500).toISOString();
  const mutationCompletedAt = new Date(Date.now() - 2_000).toISOString();
  const observationStartedAt = new Date(Date.now() - 1_500).toISOString();
  const commandResults = [
    {
      command: "projectai-internal backup-config-metadata",
      status: 0,
      stdoutDigest: `sha256:${"1".repeat(64)}`,
      stderrDigest: `sha256:${"2".repeat(64)}`,
    },
  ];
  const applyReport = withDigest(
    rolloutReportContract({
      reportType: "production-rollout-phase-apply",
      sourceMode: "rehearsal-command",
      session,
      phase: 0,
      phaseState: "awaiting_verification",
      result: "mutation-completed",
      extra: {
        databaseToolsImageDigest: manifest.databaseToolsImageDigest,
        releaseManifestDigest: manifest.digest,
        commandResults,
        commandResultDigest: digestObject(commandResults),
        mutationStartedAt,
        mutationCompletedAt,
        observationStartedAt,
      },
    }),
  );
  const mutationEntry = {
    releaseSessionId: session.releaseSessionId,
    phase: 0,
    event: "mutation-completed",
    phaseState: "awaiting_verification",
    applyReportDigest: applyReport.digest,
    commandResultDigest: applyReport.commandResultDigest,
    mutationStartedAt,
  };
  assert.doesNotThrow(() =>
    assertApplyReportBinding({
      report: applyReport,
      session,
      manifest,
      phase: 0,
      journalEntry: mutationEntry,
    }),
  );
  const evidence = withDigest({
    schemaVersion: 1,
    reportType: "production-rollout-phase-observation",
    producer: PRODUCTION_PHASE_VERIFIER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: manifest.releaseImageDigest,
    databaseToolsImageDigest: manifest.databaseToolsImageDigest,
    releaseManifestDigest: manifest.digest,
    phase: 0,
    direction: "forward",
    applyReportDigest: applyReport.digest,
    commandResultDigest: applyReport.commandResultDigest,
    mutationStartedAt,
    result: "passed",
    syntheticResult: false,
    observation: {
      releaseSessionId: session.releaseSessionId,
      phase: 0,
      startedAt: observationStartedAt,
      endedAt: new Date().toISOString(),
    },
    metrics: { elapsedSeconds: 1 },
  });
  assert.deepEqual(
    assertVerificationEvidence({
      report: evidence,
      session,
      manifest,
      phase: 0,
      applyReport,
      environment: "rehearsal",
    }),
    evidence.metrics,
  );

  for (const forged of [
    withDigest({ ...evidence, digest: undefined, producer: "caller" }),
    { ...evidence, commandResultDigest: `sha256:${"9".repeat(64)}` },
    withDigest({ ...evidence, digest: undefined, syntheticResult: true }),
  ]) {
    assert.throws(
      () =>
        assertVerificationEvidence({
          report: forged,
          session,
          manifest,
          phase: 0,
          applyReport,
          environment: "rehearsal",
        }),
      (error) => error.code === "PRODUCTION_PHASE_VERIFICATION_FAILED",
    );
  }

  const staleStart = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const staleApply = withDigest({
    ...applyReport,
    digest: undefined,
    mutationCompletedAt: staleStart,
    mutationStartedAt: staleStart,
    observationStartedAt: staleStart,
  });
  const stale = withDigest({
    ...evidence,
    digest: undefined,
    applyReportDigest: staleApply.digest,
    observation: {
      ...evidence.observation,
      startedAt: staleStart,
      endedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    },
  });
  assert.throws(
    () =>
      assertVerificationEvidence({
        report: stale,
        session,
        manifest,
        phase: 0,
        applyReport: staleApply,
        environment: "rehearsal",
      }),
    (error) => error.code === "PRODUCTION_PHASE_VERIFICATION_FAILED",
  );
});

test("Apply plans contain mutations only and cannot declare success without Verify", () => {
  for (let phase = 0; phase <= 6; phase += 1) {
    const commands = phaseActionPlan(phase).map((command) => command.join(" "));
    assert.equal(commands.some((command) => /\b(?:verify|smoke)\b/.test(command)), false);
  }
  const { session } = fixtures();
  const applyOnly = withDigest({
    ...rolloutReportContract({
      reportType: "production-rollout-phase-apply",
      sourceMode: "rehearsal-command",
      session,
      phase: 0,
      phaseState: "awaiting_verification",
      result: "mutation-completed",
    }),
  });
  assert.throws(
    () => assertPhasePrerequisite({ phase: 1, previousReport: applyOnly, sessionId: session.releaseSessionId }),
    (error) => error.code === "PRODUCTION_PHASE_PREREQUISITE_MISSING",
  );
});

test("Manifest images, caller overrides, and Production Egress fail closed", () => {
  const { baseline, session, manifest } = fixtures();
  const boundManifest = withDigest({
    ...manifest,
    digest: undefined,
    currentProductionImage: baseline.app.imageDigest,
    rollbackImage: baseline.app.imageDigest,
  });
  assert.doesNotThrow(() =>
    assertTrustedBaselineManifest({ manifest: boundManifest, baseline, session }),
  );
  assert.throws(
    () =>
      assertTrustedBaselineManifest({
        manifest: { ...boundManifest, rollbackImage: `sha256:${"0".repeat(64)}` },
        baseline,
        session,
      }),
    (error) => error.code === "PRODUCTION_IMAGE_CONTRACT_INVALID",
  );
  assert.throws(
    () => assertNoCallerImageOverride("production", { PRODUCTION_APP_IMAGE: manifest.releaseImageDigest }),
    (error) => error.code === "PRODUCTION_IMAGE_CONTRACT_INVALID",
  );
  assert.doesNotThrow(() => assertNoCallerImageOverride("rehearsal", { PRODUCTION_APP_IMAGE: "test" }));
  assert.doesNotThrow(() =>
    assertRuntimeImageBinding(
      {
        id: manifest.releaseImageDigest,
        os: "linux",
        architecture: "amd64",
        revision: session.releaseCandidateSha,
        environment: "production",
      },
      { digest: manifest.releaseImageDigest, sha: session.releaseCandidateSha },
      "App",
    ),
  );
  assert.throws(
    () =>
      assertRuntimeImageBinding(
        {
          id: `sha256:${"0".repeat(64)}`,
          os: "linux",
          architecture: "amd64",
          revision: session.releaseCandidateSha,
          environment: "production",
        },
        { digest: manifest.releaseImageDigest, sha: session.releaseCandidateSha },
      ),
    (error) => error.code === "PRODUCTION_IMAGE_CONTRACT_INVALID",
  );
  assert.deepEqual(
    assertProductionEgressMembership(
      ["project-ai-os-embedding-worker", "project-ai-os"],
      { embeddingRequired: true },
    ),
    ["project-ai-os", "project-ai-os-embedding-worker"],
  );
  assert.throws(
    () =>
      assertProductionEgressMembership([
        "project-ai-os",
        "project-ai-os-postgres",
      ]),
    (error) => error.code === "PRODUCTION_COMPOSE_CONTRACT_INVALID",
  );
  assert.equal(productionEgressExpectation(0), null);
  assert.equal(productionEgressExpectation(1), null);
  assert.deepEqual(productionEgressExpectation(2), { embeddingRequired: false });
  assert.deepEqual(productionEgressExpectation(4), { embeddingRequired: true });
  assert.deepEqual(productionEgressExpectation(4, { rollback: true }), {
    embeddingRequired: false,
  });
  assert.deepEqual(productionEgressExpectation(5, { rollback: true }), {
    embeddingRequired: true,
  });
});

test("Docker Lock rehearsal is isolated and verifies one winner without orphan state", async () => {
  const [compose, probe, orchestrator, rehearsal] = await Promise.all([
    readFile(path.join(root, "docker-compose.production-rehearsal.yml"), "utf8"),
    readFile(
      path.join(root, "scripts/release/production-lock-container-rehearsal.mjs"),
      "utf8",
    ),
    readFile(
      path.join(root, "scripts/release/production-lock-docker-rehearsal.mjs"),
      "utf8",
    ),
    readFile(path.join(root, "scripts/release/production-rollout-rehearsal.mjs"), "utf8"),
  ]);
  const probeStart = compose.indexOf("  lock-race-probe:");
  const probeBlock = compose.slice(probeStart, compose.indexOf("\nnetworks:", probeStart));
  assert.ok(probeStart >= 0);
  assert.match(probeBlock, /network_mode: none/);
  assert.match(probeBlock, /read_only: true/);
  assert.match(probeBlock, /cap_drop: \[ALL\]/);
  assert.match(probeBlock, /no-new-privileges:true/);
  assert.match(probeBlock, /rollout-rehearsal-state:\/state/);
  assert.doesNotMatch(probeBlock, /docker\.sock|\/srv\/projectai|qwen|secret/i);
  assert.match(probe, /await acquireDeploymentLock/);
  assert.match(probe, /PRODUCTION_DEPLOYMENT_LOCK_HELD/);
  assert.match(probe, /host-controlled go gate/);
  assert.match(probe, /host-controlled attempt gate/);
  assert.match(probe, /outcomesBeforeAttempt: 0/);
  assert.match(probe, /await releaseDeploymentLock/);
  assert.match(probe, /readDeploymentLifecycleGuard/);
  assert.match(probe, /activeLock !== null/);
  assert.match(probe, /activeGuard !== null/);
  assert.match(orchestrator, /Promise\.all\(/);
  assert.match(orchestrator, /LOCK_REHEARSAL_MODE=gate/);
  assert.match(orchestrator, /LOCK_GATE_PHASE=/);
  assert.match(orchestrator, /\["go", "attempt"\]/);
  assert.match(orchestrator, /containerLockAcquireSuccesses !== 1/);
  assert.match(orchestrator, /containerLockAcquireRejections !== 1/);
  assert.match(orchestrator, /hostControlledBarrierVerified !== true/);
  assert.match(orchestrator, /LOCK_REHEARSAL_MODE=inspect/);
  assert.match(orchestrator, /down/);
  assert.match(orchestrator, /--volumes/);
  assert.match(orchestrator, /label=com\.docker\.compose\.project=/);
  assert.match(orchestrator, /cleanupComplete: true/);
  assert.match(rehearsal, /await runDockerLockRehearsal/);
  assert.match(rehearsal, /await cleanupCompose\(\)/);
  assert.ok(
    rehearsal.indexOf("const dockerCleanup = await cleanupCompose()") <
      rehearsal.indexOf("const reports = ["),
  );
});

test("Rehearsal CLI rejects a caller-controlled TMPDIR parent symlink escape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-rehearsal-state-guard-"));
  const outsideDirectory = await mkdtemp(
    path.join("/var/tmp", "projectai-rehearsal-state-outside-"),
  );
  try {
    const fixture = await createFinalizeCliFixture(directory, {
      name: "unsafe-state-dir",
    });
    const outsideStateDir = path.join(outsideDirectory, "state");
    const linkedTemporaryRoot = path.join(directory, "caller-tmp");
    await mkdir(outsideStateDir, { mode: 0o700 });
    await symlink(outsideDirectory, linkedTemporaryRoot);
    const linkedStateDir = path.join(linkedTemporaryRoot, "state");
    const unsafeArgs = fixture.cliArgs.map((argument) =>
      argument.startsWith("--state-dir=")
        ? `--state-dir=${linkedStateDir}`
        : argument,
    );
    await assert.rejects(
      execFileAsync(process.execPath, unsafeArgs, {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED: "0",
          PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(fixture.inventory),
          TMPDIR: linkedTemporaryRoot,
        },
        maxBuffer: 8 * 1024 * 1024,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /PRODUCTION_ROLLOUT_STATE_UNKNOWN/);
        assert.match(error.stderr, /owner-only non-symlink directory/);
        return true;
      },
    );
    await assert.rejects(
      readFile(usedAuthorizationsPath(fixture.stateDir), "utf8"),
      (error) => error?.code === "ENOENT",
    );
    assert.notEqual(
      await readDeploymentLock(path.join(fixture.stateDir, ".production-rollout-lock")),
      null,
    );
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
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
  assert.ok(plan.some((command) => command.includes("restore-baseline-runtime")));
  assert.equal(plan.some((command) => /\b(?:down|rm|volume prune)\b/.test(command)), false);
});

test("Rollback is allowed only in strict reverse Phase order", () => {
  const entries = [
    { phase: 1, phaseState: "succeeded" },
    { phase: 4, phaseState: "succeeded" },
  ];
  assert.throws(
    () => assertRollbackOrder(entries, 1),
    (error) => error.code === "PRODUCTION_ROLLBACK_ORDER_INVALID",
  );
  assert.doesNotThrow(() => assertRollbackOrder(entries, 4));
  entries.push({ phase: 4, phaseState: "rolled_back" });
  assert.doesNotThrow(() => assertRollbackOrder(entries, 1));
  assert.doesNotThrow(() =>
    assertPhaseTransition("rollback_failed", "awaiting_rollback_verification"),
  );
  assert.equal(
    rollbackActionPlan(6).map((command) => command.join(" ")).at(-1),
    "projectai-internal set-retrieval-mode shadow",
  );
  assert.equal(
    rollbackActionPlan(5).map((command) => command.join(" ")).at(-1),
    "projectai-internal set-retrieval-mode lexical",
  );
  const phaseFour = rollbackActionPlan(4).map((command) => command.join(" "));
  assert.match(phaseFour[0], /stop projectai-embedding-worker$/);
  assert.match(phaseFour[1], /set-embedding-disabled$/);
});

test("Rollback Apply and Verify use fixed stateDir reports and trusted baseline images", async () => {
  const [executor, operations, verifier] = await Promise.all([
    readFile(path.join(root, "scripts/release/production-rollout.mjs"), "utf8"),
    readFile(path.join(root, "scripts/release/production-rollout-operations.sh"), "utf8"),
    readFile(path.join(root, "scripts/release/production-phase-verifier.mjs"), "utf8"),
  ]);
  const rollbackSection = executor.slice(
    executor.indexOf("async function rollbackCommand"),
    executor.indexOf("async function finalizeCommand"),
  );
  const verifySection = executor.slice(
    executor.indexOf("async function verifyCommand"),
    executor.indexOf("async function rollbackCommand"),
  );
  assert.match(rollbackSection, /outputDir: inputs\.stateDir/);
  assert.match(rollbackSection, /PROJECTAI_TRUSTED_ROLLBACK_IMAGE: inputs\.manifest\.rollbackImage/);
  assert.match(rollbackSection, /rollbackTargetReportDigest/);
  assert.match(rollbackSection, /rollbackTargetStateDigest/);
  assert.doesNotMatch(rollbackSection, /PROJECTAI_ROLLBACK_IMAGE/);
  assert.doesNotMatch(
    rollbackSection,
    /"awaiting_verification",\s*"rollback_failed"/,
  );
  assert.match(verifySection, /event: "rollback-verification-retried"/);
  assert.match(verifySection, /retryingRollbackVerification/);
  assert.match(verifySection, /PRODUCTION_ROLLBACK_VERIFICATION_FAILED/);
  const restore = operations.match(/restore-baseline-runtime\)([\s\S]*?);;/)?.[1] ?? "";
  assert.match(restore, /PROJECTAI_TRUSTED_ROLLBACK_IMAGE/);
  assert.match(restore, /projectai-document-worker/);
  assert.match(restore, /projectai-embedding-worker/);
  assert.doesNotMatch(restore, /curl|http_status/);
  assert.match(verifier, /Production data counts are invalid/);
  assert.match(verifier, /project-ai-os-document-worker/);
  assert.match(verifier, /project-ai-os-embedding-worker/);
});

test("Finalize CLI keeps the prepared recovery anchor when reacquire fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-finalize-cli-reacquire-"));
  try {
    const fixture = await createFinalizeCliFixture(directory, {
      preparedRecovery: true,
      name: "reacquire-failure",
    });
    await expectFinalizeCliStateUnknown(
      fixture,
      "before-finalization-reacquire",
    );
    const { anchor, entries } = await assertFinalizeRecoveryMetadata(fixture);
    assert.deepEqual(anchor, fixture.preparedEntry);
    assert.equal(
      entries.some((entry) => entry.event === "finalization-reacquired"),
      false,
    );
    assert.equal(
      await readDeploymentLock(path.join(fixture.stateDir, ".production-rollout-lock")),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Finalize CLI preserves recovery metadata when completed persistence fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "projectai-finalize-cli-persist-"));
  try {
    const fixture = await createFinalizeCliFixture(directory, {
      name: "completed-persistence-failure",
    });
    await expectFinalizeCliStateUnknown(
      fixture,
      "before-release-completed-append",
    );
    const { anchor, entries } = await assertFinalizeRecoveryMetadata(fixture);
    assert.equal(entries.at(-1).digest, anchor.digest);
    assert.equal(
      entries.some((entry) => entry.event === "release-completed"),
      false,
    );
    assert.equal(
      await readDeploymentLock(path.join(fixture.stateDir, ".production-rollout-lock")),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Finalize is rejected without all seven verification reports", () => {
  const values = finalizeFixtures();
  assert.throws(
    () => assertFinalizeReady({ ...values, reports: values.reports.slice(0, 6) }),
    (error) => error.code === "PRODUCTION_FINALIZE_NOT_READY",
  );
});

test("Finalize rejects a verification report with an invalid digest", () => {
  const values = finalizeFixtures();
  const reports = values.reports.slice();
  reports[3] = { ...reports[3], postStateDigest: `sha256:${"0".repeat(64)}` };
  assert.throws(
    () => assertFinalizeReady({ ...values, reports }),
    (error) => error.code === "PRODUCTION_FINALIZE_NOT_READY",
  );
});

test("Finalize accepts only state-preserving Lock recovery after bound verification", () => {
  const values = finalizeFixtures();
  const phaseSix = values.reports[6];
  const recovered = {
    ...values,
    entries: [
      ...values.entries,
      {
        releaseSessionId: values.session.releaseSessionId,
        phase: 6,
        event: "lock-clear-approved",
        phaseState: "succeeded",
      },
      {
        releaseSessionId: values.session.releaseSessionId,
        phase: 6,
        event: "lock-reacquired",
        phaseState: "succeeded",
      },
    ],
  };
  assert.doesNotThrow(() => assertFinalizeReady(recovered));
  assert.throws(
    () =>
      assertFinalizeReady({
        ...recovered,
        entries: [
          ...recovered.entries,
          {
            releaseSessionId: values.session.releaseSessionId,
            phase: 6,
            event: "started",
            phaseState: "succeeded",
            reportDigest: phaseSix.digest,
          },
        ],
      }),
    (error) => error.code === "PRODUCTION_FINALIZE_NOT_READY",
  );
});

test("Finalize records prepared before exact release and completed only afterward", async () => {
  const source = await readFile(
    path.join(root, "scripts/release/production-rollout.mjs"),
    "utf8",
  );
  const prepared = source.indexOf('event: "finalization-prepared"');
  const release = source.indexOf(
    "await releaseDeploymentLock({ lockPath, expectedLock: lock });",
    prepared,
  );
  const completed = source.indexOf('event: "release-completed"', release);
  assert.ok(prepared >= 0 && release > prepared && completed > release);
  assert.equal(
    /if \(command === "verify"[\s\S]*verification-failed/.test(source),
    false,
  );
  assert.match(source, /recover-finalization/);
  assert.match(source, /ack-lock-id/);
});

test("Finalize requires zero active work and exact healthy Manifest images", () => {
  const values = finalizeFixtures();
  const busyInventory = withDigest({
    ...values.inventory,
    active: { ...values.inventory.active, documentJobs: 1 },
    digest: undefined,
  });
  assert.throws(
    () => assertFinalizeReady({ ...values, inventory: busyInventory }),
    (error) => error.code === "PRODUCTION_FINALIZE_NOT_READY",
  );
  const wrongImageInventory = withDigest({
    ...values.inventory,
    services: {
      ...values.inventory.services,
      embeddingWorkerImageDigest: `sha256:${"0".repeat(64)}`,
    },
    digest: undefined,
  });
  assert.throws(
    () => assertFinalizeReady({ ...values, inventory: wrongImageInventory }),
    (error) => error.code === "PRODUCTION_FINALIZE_NOT_READY",
  );
  const result = assertFinalizeReady(values);
  assert.equal(result.activeTotal, 0);
  assert.deepEqual(result.reportDigests, values.reports.map((report) => report.digest));
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

test("Phase 4 propagates configuration, caps Chunks, and verifies rollback preservation", async () => {
  const plan = phaseActionPlan(4);
  assert.ok(plan[0].includes("set-embedding-enabled"));
  assert.ok(plan.some((command) => command.join(" ").endsWith("bounded-backfill --limit=100")));
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
  const [operations, verifier] = await Promise.all([
    readFile(path.join(root, "scripts/release/production-rollout-operations.sh"), "utf8"),
    readFile(path.join(root, "scripts/release/production-phase-verifier.mjs"), "utf8"),
  ]);
  const enable = operations.match(/set-embedding-enabled\)([\s\S]*?);;/)?.[1] ?? "";
  const disable = operations.match(/set-embedding-disabled\)([\s\S]*?);;/)?.[1] ?? "";
  assert.match(enable, /AI_EMBEDDING_ENABLED true/);
  assert.match(enable, /projectai-app/);
  assert.match(enable, /projectai-document-worker/);
  assert.match(enable, /projectai-embedding-worker/);
  assert.match(disable, /AI_EMBEDDING_ENABLED false/);
  assert.match(disable, /projectai-app/);
  assert.match(disable, /projectai-document-worker/);
  assert.doesNotMatch(disable, /delete|truncate|document_chunk_embeddings/i);
  assert.match(verifier, /AI_EMBEDDING_ENABLED/);
  assert.match(verifier, /qwen_api_key/);
  assert.match(verifier, /--live/);
  assert.match(verifier, /backfillChunkCount/);
  assert.match(verifier, /unknownProviderCalls/);
  assert.match(verifier, /Embedding Worker is still running after rollback/);
  assert.match(verifier, /dataCounts/);
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

test("Phase 6 Hybrid leakage gate fails closed and rollback restores Shadow", () => {
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
      .some((command) => command.endsWith("set-retrieval-mode shadow")),
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

test("formal executor pins CWD, Trust paths, images, Verify, and Finalize contracts", async () => {
  const [rollout, transfer, operations, verifier] = await Promise.all([
    readFile(path.join(root, "scripts/release/production-rollout.mjs"), "utf8"),
    readFile(path.join(root, "scripts/release/production-image-transfer.mjs"), "utf8"),
    readFile(path.join(root, "scripts/release/production-rollout-operations.sh"), "utf8"),
    readFile(path.join(root, "scripts/release/production-phase-verifier.mjs"), "utf8"),
  ]);
  assert.match(rollout, /process\.cwd\(\) !== "\/srv\/projectai"/);
  assert.match(rollout, /PRODUCTION_APP_IMAGE: inputs\.manifest\.releaseImageDigest/);
  assert.match(rollout, /PRODUCTION_DB_TOOLS_IMAGE: inputs\.manifest\.databaseToolsImageDigest/);
  assert.match(rollout, /PRODUCTION_VERIFICATION_INPUT_REJECTED/);
  assert.match(rollout, /awaiting_verification/);
  assert.match(rollout, /awaiting_rollback_verification/);
  assert.match(rollout, /async function finalizeCommand/);
  assert.match(
    rollout,
    /process\.env\.NODE_ENV !== "test" \|\| environment !== "rehearsal"/,
  );
  assert.match(rollout, /latestJournalDigest\(entries\) !== expectedJournalDigest/);
  assert.match(rollout, /releaseIdleDeploymentLock/);
  const finalizeSource = rollout.slice(
    rollout.indexOf("async function finalizeCommand"),
    rollout.indexOf("async function lockReviewCommand"),
  );
  const staleClearReacquire = finalizeSource.indexOf("if (recoveryEntry)");
  const preparedReacquire = finalizeSource.indexOf('event: "finalization-reacquired"');
  const definitiveStateChange = finalizeSource.indexOf(
    'error?.code === "PRODUCTION_ROLLOUT_STATE_CHANGED"',
  );
  const exactIdleCleanup = finalizeSource.indexOf("await releaseIdleDeploymentLock", definitiveStateChange);
  assert.ok(staleClearReacquire >= 0);
  assert.ok(preparedReacquire > staleClearReacquire);
  assert.ok(definitiveStateChange > preparedReacquire);
  assert.ok(exactIdleCleanup > definitiveStateChange);
  assert.match(transfer, /PRODUCTION_AUTHORIZATION_KEY_PATH/);
  assert.doesNotMatch(transfer, /requiredOption\(options, "authorization-public-key"\)/);
  assert.match(operations, /compose_ai up --detach --no-deps projectai-app/);
  assert.match(operations, /nginx_file="\/etc\/nginx\/sites-enabled\/projectai\.conf"/);
  assert.doesNotMatch(operations, /PROJECTAI_PRODUCTION_NGINX_FILE/);
  assert.match(verifier, /egressExpectation \? egressMembers\(\) : \[\]/);
  assert.match(verifier, /phase >= 3 \? databaseMetrics\(\) : null/);
  assert.match(operations, /compose up --detach --no-deps projectai-document-worker/);
});
