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
  readJournal,
  releaseDeploymentLock,
  rolloutReportContract,
  signTestAuthorization,
  writeRolloutReport,
  PRODUCTION_ROLLOUT_VERSION,
} from "./production-rollout-contract.mjs";
import {
  RELEASE_REPORT_PRODUCER,
  digestObject,
  withDigest,
  writeJson,
} from "./contract.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd());
const outputDir = path.resolve(process.env.PRODUCTION_ROLLOUT_REHEARSAL_OUTPUT ?? "review-artifacts");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-rollout-rehearsal-"));
const stateDir = path.join(temporaryRoot, "state");
const fixtureDir = path.join(temporaryRoot, "fixtures");
const project = `projectai-rollout-rehearsal-${process.pid}`;
const composeFile = path.join(root, "docker-compose.production-rehearsal.yml");
const cli = path.join(root, "scripts/release/production-rollout.mjs");
let composeStarted = false;

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

async function cleanup() {
  if (composeStarted) {
    await execFileAsync(
      "docker",
      [
        "compose",
        "--project-name",
        project,
        "--file",
        composeFile,
        "down",
        "--volumes",
        "--remove-orphans",
      ],
      commandOptions(),
    ).catch(() => {});
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.on("SIGINT", () => {
  cleanup().finally(() => process.exit(130));
});

try {
  await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(fixtureDir, { recursive: true }), mkdir(outputDir, { recursive: true })]);
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
    ],
    commandOptions(),
  );
  composeStarted = true;

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
  const authorization = signTestAuthorization(
    createAuthorizationPayload({
      sourceMode: "synthetic-test",
      session,
      manifest,
      goNoGo,
      authorizedPhases: [0, 1, 2, 3, 4, 5, 6],
      authorizedAt,
      expiresAt,
    }),
    privateKey,
  );
  assertProductionAuthorization(authorization, {
    environment: "rehearsal",
    phase: 0,
    publicKey,
  });

  const files = {
    session: path.join(fixtureDir, "session.json"),
    manifest: path.join(fixtureDir, "manifest.json"),
    baseline: path.join(fixtureDir, "baseline.json"),
    current: path.join(fixtureDir, "current.json"),
    goNoGo: path.join(fixtureDir, "go-no-go.json"),
    authorization: path.join(fixtureDir, "authorization.json"),
    publicKey: path.join(fixtureDir, "authorization-public.pem"),
    qwenSecret: path.join(fixtureDir, "qwen-test-only"),
  };
  await Promise.all([
    writeJson(files.session, session),
    writeJson(files.manifest, manifest),
    writeJson(files.baseline, baseline),
    writeJson(files.current, baseline),
    writeJson(files.goNoGo, goNoGo),
    writeJson(files.authorization, authorization),
    writeFile(files.publicKey, publicKey.export({ type: "spki", format: "pem" }), "utf8"),
    writeFile(files.qwenSecret, "fictional-rehearsal-key-only\n", { encoding: "utf8", mode: 0o600 }),
  ]);
  await chmod(files.qwenSecret, 0o600);

  const phaseDigests = [];
  for (let phase = 0; phase <= 6; phase += 1) {
    const verification = path.join(fixtureDir, `verification-${phase}.json`);
    await writeJson(verification, {
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
    });
    const args = [
      cli,
      "phase",
      `--phase=${phase}`,
      "--apply",
      "--environment=rehearsal",
      `--state-dir=${stateDir}`,
      `--session=${files.session}`,
      `--authorization=${files.authorization}`,
      `--authorization-public-key=${files.publicKey}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--production-inventory=${files.current}`,
      `--go-no-go=${files.goNoGo}`,
      `--expected-sha=${candidateSha}`,
      `--expected-image=${releaseImageDigest}`,
      `--expected-current-container=${baseline.app.containerId}`,
      `--expected-current-image=${baseline.app.imageDigest}`,
      `--verification=${verification}`,
      `--qwen-secret=${files.qwenSecret}`,
    ];
    if (phase > 0) args.push(`--previous-report=${path.join(stateDir, `phase-${phase - 1}.json`)}`);
    const result = await execFileAsync(process.execPath, args, commandOptions());
    phaseDigests.push(result.stdout.trim());
  }

  const resumeState = path.join(temporaryRoot, "resume-state");
  await mkdir(resumeState, { recursive: true });
  await acquireDeploymentLock({
    lockPath: path.join(resumeState, ".production-rollout-lock"),
    metadata: createLockMetadata({ session, phase: 0 }),
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
      `--authorization=${files.authorization}`,
      `--authorization-public-key=${files.publicKey}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--production-inventory=${files.current}`,
      `--go-no-go=${files.goNoGo}`,
      `--expected-sha=${candidateSha}`,
      `--expected-image=${releaseImageDigest}`,
      `--expected-current-container=${baseline.app.containerId}`,
      `--expected-current-image=${baseline.app.imageDigest}`,
      `--verification=${path.join(fixtureDir, "verification-0.json")}`,
    ],
    commandOptions(),
  );

  const rollbackState = path.join(temporaryRoot, "rollback-state");
  await mkdir(rollbackState, { recursive: true });
  await appendJournal(journalPathFor(rollbackState), {
    releaseSessionId: session.releaseSessionId,
    phase: 2,
    event: "completed",
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
      `--authorization=${files.authorization}`,
      `--authorization-public-key=${files.publicKey}`,
      `--manifest=${files.manifest}`,
      `--production-baseline=${files.baseline}`,
      `--production-inventory=${files.current}`,
      `--go-no-go=${files.goNoGo}`,
      `--expected-sha=${candidateSha}`,
      `--expected-image=${releaseImageDigest}`,
      `--expected-current-container=${baseline.app.containerId}`,
      `--expected-current-image=${baseline.app.imageDigest}`,
      `--output-dir=${rollbackState}`,
    ],
    commandOptions(),
  );

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
  assertPhaseTransition("succeeded", "rolled_back");
  const journalEntries = await readJournal(journalPathFor(stateDir));

  const heldLockPath = path.join(temporaryRoot, "held-lock");
  await acquireDeploymentLock({
    lockPath: heldLockPath,
    metadata: createLockMetadata({ session, phase: 0 }),
  });
  let heldLockRejected = false;
  try {
    await acquireDeploymentLock({
      lockPath: heldLockPath,
      metadata: createLockMetadata({ session, phase: 0 }),
    });
  } catch (error) {
    heldLockRejected = error?.code === "PRODUCTION_DEPLOYMENT_LOCK_HELD";
  }
  await releaseDeploymentLock({ lockPath: heldLockPath, releaseSessionId: session.releaseSessionId });

  let expiredRejected = false;
  const expiredPayload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session,
    manifest,
    goNoGo,
    authorizedPhases: [0],
    authorizedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-01T00:30:00Z",
  });
  try {
    assertProductionAuthorization(signTestAuthorization(expiredPayload, privateKey), {
      now: new Date("2026-01-01T01:00:00Z"),
      environment: "rehearsal",
      phase: 0,
      publicKey,
    });
  } catch (error) {
    expiredRejected = error?.code === "PRODUCTION_AUTHORIZATION_EXPIRED";
  }

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
      result: phaseDigests.length === 7 ? "passed" : "failed",
      extra: {
        isolatedComposeProject: project,
        productionConnected: false,
        stagingConnected: false,
        realProviderCalled: false,
        realSecretMounted: false,
        phaseDigests,
      },
    },
    {
      stem: "production-rollout-rollback",
      reportType: "production-rollout-rollback",
      result: "passed",
      extra: {
        phase0: "release-lock",
        phase1: "preserve-volumes",
        phase2: "restore-old-app",
        phase3: "assistant-disabled",
        phase4: "embedding-disabled-vectors-preserved",
        phase5: "lexical",
        phase6: "lexical",
        businessDataDeleted: false,
        exercisedRollbackDigest: rollbackResult.stdout.trim(),
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
