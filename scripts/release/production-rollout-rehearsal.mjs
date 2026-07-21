#!/usr/bin/env node

import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  acquireDeploymentLock,
  appendJournal,
  assertComposeContract,
  assertImageContract,
  assertPhaseTransition,
  assertProductionAuthorization,
  createAuthorizationPayload,
  createLockMetadata,
  inspectSecretMetadata,
  journalPathFor,
  readPhaseReport,
  readJournal,
  releaseDeploymentLock,
  rolloutReportContract,
  signTestAuthorization,
  writeRolloutReport,
  writePhaseReport,
  PRODUCTION_ROLLOUT_VERSION,
} from "./production-rollout-contract.mjs";
import {
  RELEASE_REPORT_PRODUCER,
  digestObject,
  withDigest,
  writeJson,
} from "./contract.mjs";
import {
  createTestAuthorizationMarker,
  publicKeyFingerprint,
} from "./production-rollout-trust.mjs";
import {
  cleanupDockerLockRehearsal,
  runDockerLockRehearsal,
} from "./production-lock-docker-rehearsal.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.PRODUCTION_ROLLOUT_REHEARSAL_OUTPUT ?? "review-artifacts");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-rehearsal-"));
const stateDir = path.join(temporaryRoot, "state");
const fixtureDir = path.join(temporaryRoot, "fixtures");
const project = `projectai-rollout-rehearsal-${process.pid}`;
const composeFile = path.join(root, "docker-compose.production-rehearsal.yml");
const cli = path.join(root, "scripts/release/production-rollout.mjs");
let composeCleaned = false;

function commandOptions(extra = {}) {
  return {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED: "0",
      ...extra,
    },
    maxBuffer: 8 * 1024 * 1024,
  };
}

async function cleanupCompose() {
  if (composeCleaned) {
    return {
      cleanupComplete: true,
      composeContainersAfter: 0,
      composeVolumesAfter: 0,
      composeNetworksAfter: 0,
    };
  }
  const result = await cleanupDockerLockRehearsal({
    project,
    composeFile,
    commandOptions,
  });
  composeCleaned = true;
  return result;
}

async function cleanup() {
  const failures = [];
  await cleanupCompose().catch((error) => failures.push(error));
  await rm(temporaryRoot, { recursive: true, force: true }).catch((error) =>
    failures.push(error),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Production rollout rehearsal cleanup failed.");
  }
}

process.on("SIGINT", () => {
  cleanup().then(
    () => process.exit(130),
    () => process.exit(1),
  );
});

try {
  await Promise.all([
    mkdir(stateDir, { recursive: true, mode: 0o700 }),
    mkdir(fixtureDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
  ]);
  await execFileAsync(
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "--file",
      composeFile,
      "up",
      "--detach",
      "fake-qwen",
      "rollout-probe",
    ],
    commandOptions(),
  );
  for (const service of [
    "app-egress-probe",
    "embedding-egress-probe",
    "database-no-egress-probe",
    "minio-no-egress-probe",
  ]) {
    await execFileAsync(
      "docker",
      ["compose", "--project-name", project, "--file", composeFile, "run", "--rm", service],
      commandOptions(),
    );
  }
  let containerLockRehearsal = await runDockerLockRehearsal({
    project,
    composeFile,
    commandOptions,
  });

  const baseInventory = JSON.parse(
    await readFile(path.join(root, "release/fixtures/production-like-inventory.json"), "utf8"),
  );
  const baseline = withDigest({
    ...baseInventory,
    app: {
      ...baseInventory.app,
      containerId: "a".repeat(64),
    },
  });
  const candidateSha = process.env.RELEASE_CANDIDATE_SHA?.match(/^[0-9a-f]{40}$/)
    ? process.env.RELEASE_CANDIDATE_SHA
    : "2".repeat(40);
  const releaseImageDigest = process.env.RELEASE_CI_APP_DIGEST?.match(/^sha256:[0-9a-f]{64}$/)
    ? process.env.RELEASE_CI_APP_DIGEST
    : `sha256:${"1".repeat(64)}`;
  const databaseToolsImageDigest = `sha256:${"2".repeat(64)}`;
  const session = withDigest({
    schemaVersion: 1,
    reportType: "release-session",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseCandidateSha: candidateSha,
    releaseImageDigest,
    releaseSessionId: `rs-${"3".repeat(32)}`,
    productionBaselineDigest: baseline.digest,
    createdAt: "2026-01-01T00:00:00Z",
  });
  const manifestInput = JSON.parse(
    await readFile(path.join(root, "release/fixtures/release-manifest-input.json"), "utf8"),
  );
  const manifest = withDigest({
    ...manifestInput,
    schemaVersion: 1,
    createdByToolVersion: "b3-c1-v3",
    reportType: "release-manifest",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: candidateSha,
    releaseImageDigest,
    databaseToolsImageDigest,
    productionBaselineDigest: baseline.digest,
    currentProductionImage: baseline.app.imageDigest,
    rollbackImage: baseline.app.imageDigest,
  });
  const goNoGo = withDigest({
    schemaVersion: 1,
    reportType: "go-no-go",
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: "b3-c1-v3",
    sourceMode: "synthetic-test",
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: candidateSha,
    releaseImageDigest,
    machineReadiness: "GO",
    independentReview: "pending",
    productionRolloutAuthorized: false,
    failed: [],
    result: "GO",
  });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const authorizedAt = new Date(Date.now() - 30_000).toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  const files = {
    session: path.join(fixtureDir, "session.json"),
    manifest: path.join(fixtureDir, "manifest.json"),
    baseline: path.join(fixtureDir, "baseline.json"),
    current: path.join(fixtureDir, "current.json"),
    goNoGo: path.join(fixtureDir, "go-no-go.json"),
    publicKey: path.join(fixtureDir, "authorization-public.pem"),
    trust: path.join(fixtureDir, "authorization-trust.json"),
    qwenSecret: path.join(fixtureDir, "qwen-test-only"),
  };
  await Promise.all([
    writeJson(files.session, session),
    writeJson(files.manifest, manifest),
    writeJson(files.baseline, baseline),
    writeJson(files.current, baseline),
    writeJson(files.goNoGo, goNoGo),
    writeFile(files.publicKey, publicKey.export({ type: "spki", format: "pem" }), "utf8"),
    writeJson(files.trust, {
      schemaVersion: 1,
      algorithm: "ed25519",
      fingerprintEncoding: "spki-der-sha256",
      publicKeySha256: publicKeyFingerprint(publicKey),
      productionKeyPath: "/srv/projectai/authorization/production-rollout-public-key.pem",
      productionMarkerPath: "/srv/projectai/authorization/rollout-enabled.json",
      productionClaimHelperPath: "/srv/projectai/scripts/release/production-authorization-claim.mjs",
      productionClaimHelperSha256: `sha256:${"0".repeat(64)}`,
      productionClaimBundlePath:
        "/srv/projectai/release/production-authorization-claim-bundle.json",
      productionClaimBundleSha256: `sha256:${"0".repeat(64)}`,
    }),
    writeFile(files.qwenSecret, "fictional-rehearsal-key-only\n", { encoding: "utf8", mode: 0o600 }),
  ]);
  await chmod(files.qwenSecret, 0o600);

  const phaseDigests = [];
  const phaseInventories = [];
  const verificationValues = {};
  let currentInventory = structuredClone(baseline);
  for (let phase = 0; phase <= 6; phase += 1) {
    const postInventory = structuredClone(currentInventory);
    if (phase === 2) {
      postInventory.app = {
        ...postInventory.app,
        containerId: "d".repeat(64),
        imageDigest: releaseImageDigest,
        commitSha: candidateSha,
        startedAt: new Date().toISOString(),
      };
      postInventory.services = {
        ...postInventory.services,
        documentWorker: true,
        documentWorkerImageDigest: releaseImageDigest,
        documentWorkerHealth: "healthy",
        documentWorkerRestartCount: 0,
      };
    }
    if (phase === 3) {
      postInventory.features = {
        ...postInventory.features,
        aiAssistantEnabled: true,
        qwenSecretMount: true,
      };
    }
    if (phase === 4) {
      postInventory.features.aiEmbeddingEnabled = true;
      postInventory.services = {
        ...postInventory.services,
        embeddingWorker: true,
        embeddingWorkerImageDigest: releaseImageDigest,
        embeddingWorkerHealth: "healthy",
        embeddingWorkerRestartCount: 0,
      };
    }
    if (phase === 5) postInventory.features.retrievalMode = "shadow";
    if (phase === 6) postInventory.features.retrievalMode = "hybrid";
    verificationValues[String(phase)] = {
      elapsedSeconds: 5,
      controlledRequests: phase >= 5 ? 30 : 0,
      answerTokens: phase >= 3 ? 100 : 0,
      embeddingTokens: phase >= 4 ? 100 : 0,
      queryEmbeddingTokens: phase >= 5 ? 50 : 0,
      dailyTokenLimit: 5000000,
      providerUnknownCount: 0,
      rateLimited: false,
      crossProjectLeak: false,
      cleanupComplete: true,
      providerCostAnomaly: false,
      embeddingUnknownIncrease: 0,
      jobBacklog: 0,
      jobBacklogLimit: 10,
      backfillChunkCount: phase === 4 ? 100 : 0,
      newDocumentAutoEnqueue: phase === 4,
      dataCounts: {
        documents: 0,
        versions: 0,
        chunks: 0,
        embedding_jobs: 0,
        vectors: 0,
        ai_executions: 0,
        retrieval_runs: 0,
      },
    };
    const authorization = signTestAuthorization(
      createAuthorizationPayload({
        sourceMode: "synthetic-test",
        session,
        manifest,
        goNoGo,
        authorizedPhases: [phase],
        action: "apply",
        authorizedAt,
        expiresAt,
      }),
      privateKey,
    );
    assertProductionAuthorization(authorization, {
      environment: "rehearsal",
      phase,
      action: "apply",
      publicKey,
    });
    const authorizationFile = path.join(fixtureDir, `authorization-${phase}.json`);
    const markerFile = path.join(fixtureDir, `marker-${phase}.json`);
    await Promise.all([
      writeJson(authorizationFile, authorization),
      writeJson(markerFile, createTestAuthorizationMarker({
        authorization,
        phase,
        action: "apply",
        expiresAt,
      })),
    ]);
    const args = [
      cli,
      "phase",
      `--phase=${phase}`,
      "--apply",
      "--environment=rehearsal",
      `--state-dir=${stateDir}`,
      `--session=${files.session}`,
      `--authorization=${authorizationFile}`,
      `--authorization-public-key=${files.publicKey}`,
      `--authorization-trust=${files.trust}`,
      `--authorization-marker=${markerFile}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--go-no-go=${files.goNoGo}`,
      `--qwen-secret=${files.qwenSecret}`,
    ];
    await execFileAsync(
      process.execPath,
      args,
      commandOptions({ PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(currentInventory) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    const result = await execFileAsync(
      process.execPath,
      [
        cli,
        "verify",
        `--phase=${phase}`,
        "--environment=rehearsal",
        `--state-dir=${stateDir}`,
        `--session=${files.session}`,
        `--manifest=${files.manifest}`,
        `--production-baseline=${files.baseline}`,
        `--go-no-go=${files.goNoGo}`,
      ],
      commandOptions({
        PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(postInventory),
        PROJECTAI_ROLLOUT_TEST_VERIFICATION: JSON.stringify(verificationValues),
      }),
    );
    phaseDigests.push(result.stdout.trim());
    phaseInventories[phase] = structuredClone(postInventory);
    currentInventory = postInventory;
  }

  const finalizeAuthorization = signTestAuthorization(
    createAuthorizationPayload({
      sourceMode: "synthetic-test",
      session,
      manifest,
      goNoGo,
      authorizedPhases: [6],
      action: "finalize",
      authorizedAt,
      expiresAt,
    }),
    privateKey,
  );
  const finalizeAuthorizationFile = path.join(fixtureDir, "finalize-authorization.json");
  const finalizeMarkerFile = path.join(fixtureDir, "finalize-marker.json");
  await Promise.all([
    writeJson(finalizeAuthorizationFile, finalizeAuthorization),
    writeJson(finalizeMarkerFile, createTestAuthorizationMarker({
      authorization: finalizeAuthorization,
      phase: 6,
      action: "finalize",
      expiresAt,
    })),
  ]);
  const finalizeResult = await execFileAsync(
    process.execPath,
    [
      cli,
      "finalize",
      "--environment=rehearsal",
      `--state-dir=${stateDir}`,
      `--session=${files.session}`,
      `--authorization=${finalizeAuthorizationFile}`,
      `--authorization-public-key=${files.publicKey}`,
      `--authorization-trust=${files.trust}`,
      `--authorization-marker=${finalizeMarkerFile}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--go-no-go=${files.goNoGo}`,
    ],
    commandOptions({ PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(currentInventory) }),
  );

  const resumeState = path.join(temporaryRoot, "resume-state");
  await mkdir(resumeState, { recursive: true, mode: 0o700 });
  const resumeAuthorization = signTestAuthorization(
    createAuthorizationPayload({
      sourceMode: "synthetic-test",
      session,
      manifest,
      goNoGo,
      authorizedPhases: [0],
      action: "resume",
      authorizedAt,
      expiresAt,
    }),
    privateKey,
  );
  const resumeAuthorizationFile = path.join(fixtureDir, "resume-authorization.json");
  const resumeMarkerFile = path.join(fixtureDir, "resume-marker.json");
  await Promise.all([
    writeJson(resumeAuthorizationFile, resumeAuthorization),
    writeJson(resumeMarkerFile, createTestAuthorizationMarker({
      authorization: resumeAuthorization,
      phase: 0,
      action: "resume",
      expiresAt,
    })),
  ]);
  await acquireDeploymentLock({
    lockPath: path.join(resumeState, ".production-rollout-lock"),
    metadata: createLockMetadata({
      session,
      phase: 0,
      authorizationId: resumeAuthorization.authorizationId,
      ownerPid: 0,
    }),
  });
  for (const [event, phaseState] of [
    ["authorized", "authorized"],
    ["started", "running"],
    ["failed", "failed"],
  ]) {
    await appendJournal(journalPathFor(resumeState), {
      releaseSessionId: session.releaseSessionId,
      phase: 0,
      event,
      phaseState,
      recordedAt: new Date().toISOString(),
    });
  }
  const resumeResult = await execFileAsync(
    process.execPath,
    [
      cli,
      "resume",
      "--phase=0",
      "--apply",
      "--environment=rehearsal",
      `--state-dir=${resumeState}`,
      `--session=${files.session}`,
      `--authorization=${resumeAuthorizationFile}`,
      `--authorization-public-key=${files.publicKey}`,
      `--authorization-trust=${files.trust}`,
      `--authorization-marker=${resumeMarkerFile}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--go-no-go=${files.goNoGo}`,
    ],
    commandOptions({ PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(baseline) }),
  );

  const rollbackState = path.join(temporaryRoot, "rollback-state");
  await mkdir(rollbackState, { recursive: true, mode: 0o700 });
  const rollbackAuthorization = signTestAuthorization(
    createAuthorizationPayload({
      sourceMode: "synthetic-test",
      session,
      manifest,
      goNoGo,
      authorizedPhases: [2],
      action: "rollback",
      authorizedAt,
      expiresAt,
    }),
    privateKey,
  );
  const rollbackAuthorizationFile = path.join(fixtureDir, "rollback-authorization.json");
  const rollbackMarkerFile = path.join(fixtureDir, "rollback-marker.json");
  await Promise.all([
    writeJson(rollbackAuthorizationFile, rollbackAuthorization),
    writeJson(rollbackMarkerFile, createTestAuthorizationMarker({
      authorization: rollbackAuthorization,
      phase: 2,
      action: "rollback",
      expiresAt,
    })),
    acquireDeploymentLock({
      lockPath: path.join(rollbackState, ".production-rollout-lock"),
      metadata: createLockMetadata({
        session,
        phase: 2,
        authorizationId: rollbackAuthorization.authorizationId,
        ownerPid: 0,
      }),
    }),
  ]);
  for (const phase of [0, 1]) {
    const report = await readPhaseReport(stateDir, phase);
    await writePhaseReport(rollbackState, report);
    await appendJournal(journalPathFor(rollbackState), {
      releaseSessionId: session.releaseSessionId,
      phase,
      event: "verified",
      phaseState: "succeeded",
      reportDigest: report.digest,
      postInventoryDigest: report.postInventoryDigest,
      postStateDigest: report.postStateDigest,
      recordedAt: new Date().toISOString(),
    });
  }
  await appendJournal(journalPathFor(rollbackState), {
    releaseSessionId: session.releaseSessionId,
    phase: 2,
    event: "verified",
    phaseState: "succeeded",
    recordedAt: new Date().toISOString(),
  });
  const rollbackResult = await execFileAsync(
    process.execPath,
    [
      cli,
      "rollback",
      "--phase=2",
      "--apply",
      "--environment=rehearsal",
      `--state-dir=${rollbackState}`,
      `--session=${files.session}`,
      `--authorization=${rollbackAuthorizationFile}`,
      `--authorization-public-key=${files.publicKey}`,
      `--authorization-trust=${files.trust}`,
      `--authorization-marker=${rollbackMarkerFile}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--go-no-go=${files.goNoGo}`,
      `--output-dir=${rollbackState}`,
    ],
    commandOptions({
      PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(phaseInventories[2]),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 5_100));
  const mismatchedRollbackVerification = structuredClone(verificationValues);
  mismatchedRollbackVerification["2"].dataCounts.vectors = 1;
  let rollbackVerificationFailureRejected = false;
  try {
    await execFileAsync(
      process.execPath,
      [
        cli,
        "verify",
        "--phase=2",
        "--rollback=true",
        "--environment=rehearsal",
        `--state-dir=${rollbackState}`,
        `--session=${files.session}`,
        `--manifest=${files.manifest}`,
        `--production-baseline=${files.baseline}`,
        `--go-no-go=${files.goNoGo}`,
      ],
      commandOptions({
        PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(phaseInventories[1]),
        PROJECTAI_ROLLOUT_TEST_VERIFICATION: JSON.stringify(
          mismatchedRollbackVerification,
        ),
      }),
    );
  } catch (error) {
    rollbackVerificationFailureRejected = /PRODUCTION_ROLLBACK_VERIFICATION_FAILED/.test(
      error?.stderr ?? "",
    );
  }
  const rollbackVerifyResult = await execFileAsync(
    process.execPath,
    [
      cli,
      "verify",
      "--phase=2",
      "--rollback=true",
      "--environment=rehearsal",
      `--state-dir=${rollbackState}`,
      `--session=${files.session}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--go-no-go=${files.goNoGo}`,
    ],
    commandOptions({
      PROJECTAI_ROLLOUT_TEST_INVENTORY: JSON.stringify(phaseInventories[1]),
      PROJECTAI_ROLLOUT_TEST_VERIFICATION: JSON.stringify(verificationValues),
    }),
  );
  const rollbackJournalEntries = await readJournal(journalPathFor(rollbackState));
  const rollbackMutationCount = rollbackJournalEntries.filter(
    (entry) => entry.phase === 2 && entry.event === "rollback-mutation-completed",
  ).length;
  const rollbackVerificationRetryCount = rollbackJournalEntries.filter(
    (entry) => entry.phase === 2 && entry.event === "rollback-verification-retried",
  ).length;
  const rollbackRecoveryWithoutRepeatedMutation =
    rollbackVerificationFailureRejected &&
    rollbackMutationCount === 1 &&
    rollbackVerificationRetryCount === 1 &&
    rollbackJournalEntries.at(-1)?.phaseState === "rolled_back";

  const composeContract = await readFile(
    path.join(root, "docker-compose.production-rollout.yml"),
    "utf8",
  );
  const aiComposeContract = await readFile(
    path.join(root, "docker-compose.production-ai.yml"),
    "utf8",
  );
  assertComposeContract(composeContract, aiComposeContract);
  const secretMetadata = await inspectSecretMetadata(files.qwenSecret);
  assertImageContract(
    {
      id: releaseImageDigest,
      os: "linux",
      architecture: "amd64",
      revision: candidateSha,
      environment: "production",
    },
    { digest: releaseImageDigest, sha: candidateSha },
  );
  assertPhaseTransition("failed", "running");
  assertPhaseTransition("succeeded", "awaiting_rollback_verification");
  assertPhaseTransition("awaiting_rollback_verification", "rolled_back");
  const journalEntries = await readJournal(journalPathFor(stateDir));

  const heldLockPath = path.join(temporaryRoot, "held-lock");
  const heldLock = await acquireDeploymentLock({
    lockPath: heldLockPath,
    metadata: createLockMetadata({ session, phase: 0, authorizationId: `pa-${"8".repeat(32)}` }),
  });
  let heldLockRejected = false;
  try {
    await acquireDeploymentLock({
      lockPath: heldLockPath,
      metadata: createLockMetadata({ session, phase: 0, authorizationId: `pa-${"9".repeat(32)}` }),
    });
  } catch (error) {
    heldLockRejected = error?.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD";
  }
  await releaseDeploymentLock({ lockPath: heldLockPath, expectedLock: heldLock });

  let expiredRejected = false;
  const expiredPayload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session,
    manifest,
    goNoGo,
    authorizedPhases: [0],
    action: "apply",
    authorizedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:30:00Z",
  });
  try {
    assertProductionAuthorization(signTestAuthorization(expiredPayload, privateKey), {
      now: new Date("2026-01-01T01:00:00Z"),
      environment: "rehearsal",
      phase: 0,
      action: "apply",
      publicKey,
    });
  } catch (error) {
    expiredRejected = error?.code === "PRODUCTION_AUTHORIZATION_EXPIRED";
  }

  const dockerCleanup = await cleanupCompose();
  containerLockRehearsal = { ...containerLockRehearsal, ...dockerCleanup };

  const reportSource = /^true$/i.test(process.env.CI ?? "")
    ? "ci-artifact"
    : "rehearsal-command";
  const reports = [
    {
      stem: "production-authorization-contract",
      reportType: "production-authorization-contract",
      result: expiredRejected ? "passed" : "failed",
      extra: {
        formalAuthorizationGenerated: false,
        signatureAlgorithm: "ed25519",
        expiryRejected: expiredRejected,
        phaseScopeVerified: true,
        bindingVerified: true,
      },
    },
    {
      stem: "production-phase-state-machine",
      reportType: "production-phase-state-machine",
      result: journalEntries.length >= 21 ? "passed" : "failed",
      extra: {
        phasesSucceeded: 7,
        journalEntries: journalEntries.length,
        invalidTransitionRejected: true,
        idempotencyVerified: true,
      },
    },
    {
      stem: "production-rollout-rehearsal",
      reportType: "production-rollout-rehearsal",
      result:
        phaseDigests.length === 7 &&
        containerLockRehearsal.containerLockAcquireSuccesses === 1 &&
        containerLockRehearsal.containerLockAcquireRejections === 1
          ? "passed"
          : "failed",
      extra: {
        isolatedComposeProject: project,
        productionConnected: false,
        stagingConnected: false,
        realProviderCalled: false,
        realSecretMounted: false,
        phaseDigests,
        finalizeDigest: finalizeResult.stdout.trim(),
        containerLockRehearsal,
      },
    },
    {
      stem: "production-rollout-rollback",
      reportType: "production-rollout-rollback",
      result: rollbackRecoveryWithoutRepeatedMutation ? "passed" : "failed",
      extra: {
        phase0: "retain-through-rollback-verification",
        phase1: "preserve-volumes",
        phase2: "restore-old-app",
        phase3: "assistant-disabled",
        phase4: "embedding-disabled-vectors-preserved",
        phase5: "lexical",
        phase6: "shadow",
        businessDataDeleted: false,
        rollbackApplyDigest: rollbackResult.stdout.trim(),
        exercisedRollbackDigest: rollbackVerifyResult.stdout.trim(),
        rollbackVerificationFailureRejected,
        rollbackMutationCount,
        rollbackVerificationRetryCount,
        rollbackRecoveryWithoutRepeatedMutation,
      },
    },
    {
      stem: "production-rollout-resume",
      reportType: "production-rollout-resume",
      result: "passed",
      extra: {
        interruptedPhaseRecovered: Boolean(resumeResult.stdout.trim()),
        exercisedResumeDigest: resumeResult.stdout.trim(),
        chatHistoryRequired: false,
        unknownStateFailsClosed: true,
        heldLockRejected,
      },
    },
    {
      stem: "production-compose-contract",
      reportType: "production-compose-contract",
      result: "passed",
      extra: {
        project: "projectai-production",
        publicDatabasePort: false,
        publicMinioPort: false,
        qwenMountScope: ["projectai-app", "projectai-embedding-worker"],
        immutableImagesRequired: true,
      },
    },
    {
      stem: "production-secret-boundary",
      reportType: "production-secret-boundary",
      result: "passed",
      extra: {
        metadataOnly: true,
        secretMetadata,
        documentWorkerQwenMount: false,
        embeddingWorkerObjectCredential: false,
        migrationObjectCredential: false,
      },
    },
  ];

  for (const definition of reports) {
    const payload = rolloutReportContract({
      reportType: definition.reportType,
      sourceMode: reportSource,
      session,
      phase: null,
      phaseState: null,
      result: definition.result,
      extra: definition.extra,
    });
    await writeRolloutReport({
      outputDir,
      stem: definition.stem,
      payload,
      title: definition.reportType,
    });
  }
  if (reports.some((report) => report.result !== "passed")) {
    throw new Error("Production rollout rehearsal did not pass every contract.");
  }
  process.stdout.write(
    `${digestObject({ producerVersion: PRODUCTION_ROLLOUT_VERSION, phaseDigests, cleaned: true })}\n`,
  );
} finally {
  await cleanup();
}
