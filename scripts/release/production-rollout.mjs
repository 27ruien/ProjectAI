#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  appendJournal,
  assertApplyReportBinding,
  assertAuthorizationBindings,
  assertComposeContract,
  assertDeploymentLockBinding,
  assertDeploymentLockClearable,
  assertDeploymentLifecycleGuardBinding,
  assertDeploymentLifecycleGuardClearable,
  assertImageContract,
  assertNoCallerImageOverride,
  assertFinalizeReady,
  assertPhaseCommandResults,
  assertMigrationLockClear,
  assertPhasePrerequisite,
  assertPhaseTransition,
  assertProductionAuthorization,
  assertProductionBaselineStable,
  assertRollbackOrder,
  assertRuntimeImageBinding,
  assertProductionEgressMembership,
  assertStopConditions,
  assertTrustedBaselineManifest,
  assertVerificationEvidence,
  costGate,
  createAuthorizationPayload,
  createLockMetadata,
  clearStaleDeploymentLifecycleGuard,
  currentPhaseState,
  exitCodeForRolloutError,
  inspectSecretMetadata,
  journalPathFor,
  observationGate,
  phaseActionPlan,
  productionEgressExpectation,
  phaseDefinition,
  readDeploymentLock,
  readDeploymentLifecycleGuard,
  readJournal,
  readPhaseReport,
  releaseDeploymentLock,
  releaseIdleDeploymentLock,
  rollbackActionPlan,
  rolloutReportContract,
  signTestAuthorization,
  writePhaseReport,
  writeRolloutReport,
  acquireDeploymentLock,
  updateDeploymentLock,
  ProductionRolloutError,
  PRODUCTION_AI_COMPOSE_FILE,
  PRODUCTION_COMPOSE_FILE,
  PRODUCTION_LOCK_HEARTBEAT_INTERVAL_MS,
  PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS,
  PRODUCTION_LOCK_PATH,
  PRODUCTION_PHASE_VERIFIER,
  PRODUCTION_ROLLOUT_VERSION,
} from "./production-rollout-contract.mjs";
import {
  assertDigest,
  assertInventory,
  assertReleaseManifest,
  assertReleaseSession,
  assertSanitized,
  digestObject,
  parseArguments,
  readJson,
  requiredOption,
  writeJson,
  withDigest,
} from "./contract.mjs";
import {
  assertAuthorizationMarker,
  consumeAuthorization,
  createTestAuthorizationMarker,
  loadAuthorizationTrust,
} from "./production-rollout-trust.mjs";
import {
  assertFreshLiveInventory,
  collectLiveInventory,
  deploymentStateDigest,
  inventoryStateDigest,
} from "./production-live-inventory.mjs";

const command = process.argv[2];
const { options } = parseArguments(process.argv.slice(3));
const FINALIZE_TEST_FAILURE_POINTS = new Set([
  "before-finalization-reacquire",
  "before-release-completed-append",
]);

function optionBoolean(name) {
  const value = options[name];
  if (value === true || value === "true") return true;
  if (value === undefined || value === false || value === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function environmentOption() {
  const value = requiredOption(options, "environment");
  if (!['production', 'rehearsal'].includes(value)) {
    throw new Error("--environment must be production or rehearsal.");
  }
  return value;
}

function finalizeTestFailurePoint(environment) {
  const point = process.env.PROJECTAI_ROLLOUT_TEST_FINALIZE_FAILURE_POINT;
  if (!point) return null;
  if (process.env.NODE_ENV !== "test" || environment !== "rehearsal") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Finalize failure injection is restricted to isolated rehearsal tests.",
    );
  }
  if (!FINALIZE_TEST_FAILURE_POINTS.has(point)) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Finalize failure injection point is not recognized.",
    );
  }
  return point;
}

function injectFinalizeTestFailure(configuredPoint, currentPoint) {
  if (configuredPoint !== currentPoint) return;
  throw new ProductionRolloutError(
    "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
    `Injected isolated Finalize failure at ${currentPoint}.`,
  );
}

function assertProductionWorkingDirectory(environment) {
  if (environment === "production" && process.cwd() !== "/srv/projectai") {
    throw new ProductionRolloutError(
      "PRODUCTION_WORKING_DIRECTORY_INVALID",
      "Production Apply must run from /srv/projectai.",
    );
  }
}

function inspectDockerImage(reference) {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "--format", "{{json .}}", reference],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      "Required immutable Production image is not loaded.",
    );
  }
  const value = JSON.parse(result.stdout);
  return {
    id: value.Id,
    os: value.Os,
    architecture: value.Architecture,
    revision: value.Config?.Labels?.["org.opencontainers.image.revision"] ?? null,
    environment: value.Config?.Labels?.["com.projectai.release.environment"] ?? null,
  };
}

function assertActualReleaseImages(inputs, { includeRollback = false } = {}) {
  if (inputs.environment !== "production") return;
  const app = inspectDockerImage(inputs.manifest.releaseImageDigest);
  const databaseTools = inspectDockerImage(inputs.manifest.databaseToolsImageDigest);
  assertImageContract(app, {
    digest: inputs.manifest.releaseImageDigest,
    sha: inputs.session.releaseCandidateSha,
  });
  assertImageContract(databaseTools, {
    digest: inputs.manifest.databaseToolsImageDigest,
    sha: inputs.session.releaseCandidateSha,
  });
  if (includeRollback) {
    const rollback = inspectDockerImage(inputs.manifest.rollbackImage);
    assertImageContract(rollback, {
      digest: inputs.manifest.rollbackImage,
      sha: inputs.productionBaseline.app.imageRevision,
    });
  }
}

function collectProductionDataCounts(inputs, phase) {
  if (Number(phase) < 2) return null;
  if (inputs.environment === "rehearsal") {
    if (process.env.NODE_ENV !== "test") return null;
    return JSON.parse(
      process.env.PROJECTAI_ROLLOUT_TEST_DATA_COUNTS ??
        '{"documents":0,"versions":0,"chunks":0,"embedding_jobs":0,"vectors":0,"ai_executions":0,"retrieval_runs":0}',
    );
  }
  const result = spawnSync(
    "docker",
    ["exec", "project-ai-os", "node", "scripts/release/production-data-counts.mjs"],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Pre-rollback aggregate data counts could not be collected.",
    );
  }
  const counts = JSON.parse(result.stdout);
  assertSanitized(counts);
  return counts;
}

function isStrictDescendant(parentDirectory, candidateDirectory) {
  const relative = path.relative(parentDirectory, candidateDirectory);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isSameOrDescendant(parentDirectory, candidateDirectory) {
  return (
    candidateDirectory === parentDirectory ||
    isStrictDescendant(parentDirectory, candidateDirectory)
  );
}

async function trustedRehearsalTemporaryRoots() {
  const candidates = process.platform === "darwin"
    ? ["/tmp", "/private/var/folders"]
    : ["/tmp"];
  const roots = [];
  for (const candidate of candidates) {
    try {
      const canonical = await realpath(candidate);
      const metadata = await lstat(canonical);
      if (!metadata.isSymbolicLink() && metadata.isDirectory()) roots.push(canonical);
    } catch {
      // A platform-specific candidate that does not exist is not trusted.
    }
  }
  return [...new Set(roots)];
}

async function stateDirectory(session, environment) {
  const value = requiredOption(options, "state-dir");
  const resolved = path.resolve(value);
  if (environment === "production") {
    if (resolved !== `/srv/projectai/releases/${session.releaseSessionId}`) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Production state-dir must use the fixed Release Session journal path.",
      );
    }
    return resolved;
  }

  if (process.env.NODE_ENV !== "test") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Rehearsal state is restricted to isolated test execution.",
    );
  }
  if (resolved === "/srv/projectai" || resolved.startsWith(`/srv/projectai${path.sep}`)) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Rehearsal state-dir must not use the Production filesystem.",
    );
  }

  const ownerUid = process.getuid?.();
  if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Rehearsal state-dir ownership cannot be established on this platform.",
    );
  }

  let before;
  let after;
  let canonicalStateDirectory;
  let canonicalStateMetadata;
  let trustedTemporaryRoots;
  try {
    before = await lstat(resolved);
    canonicalStateDirectory = await realpath(resolved);
    after = await lstat(resolved);
    canonicalStateMetadata = await lstat(canonicalStateDirectory);
    trustedTemporaryRoots = await trustedRehearsalTemporaryRoots();
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Rehearsal state-dir must already exist and resolve safely.",
    );
  }

  const secureDirectory = (metadata) =>
    !metadata.isSymbolicLink() &&
    metadata.isDirectory() &&
    metadata.uid === ownerUid &&
    (metadata.mode & 0o777) === 0o700;
  if (
    !secureDirectory(before) ||
    !secureDirectory(after) ||
    !secureDirectory(canonicalStateMetadata) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.dev !== canonicalStateMetadata.dev ||
    after.ino !== canonicalStateMetadata.ino ||
    isSameOrDescendant("/srv/projectai", canonicalStateDirectory) ||
    !trustedTemporaryRoots.some((trustedRoot) =>
      isStrictDescendant(trustedRoot, canonicalStateDirectory),
    )
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Rehearsal state-dir must be an owner-only non-symlink directory inside the system temporary directory.",
    );
  }
  return canonicalStateDirectory;
}

async function releaseInputs({ requireAuthorization = true } = {}) {
  const environment = environmentOption();
  const session = await readJson(requiredOption(options, "session"));
  const manifest = await readJson(requiredOption(options, "manifest"));
  const productionBaseline = await readJson(
    requiredOption(options, "production-baseline"),
  );
  const goNoGo = await readJson(requiredOption(options, "go-no-go"));
  assertReleaseSession(session);
  assertReleaseManifest(manifest);
  assertInventory(productionBaseline, { requireProducer: false });
  assertSanitized(goNoGo);
  assertDigest(goNoGo.digest, "goNoGo.digest");
  const stateDir = await stateDirectory(session, environment);
  let authorization = null;
  let publicKey = null;
  let trust = null;
  if (requireAuthorization) {
    const authorizationPath = options.authorization;
    if (typeof authorizationPath !== "string") {
      throw new ProductionRolloutError(
        "PRODUCTION_APPLY_NOT_AUTHORIZED",
        "Production apply requires an independently signed Authorization.",
      );
    }
    authorization = await readJson(authorizationPath);
    trust = await loadAuthorizationTrust({
      environment,
      rehearsalPublicKeyPath:
        environment === "rehearsal"
          ? requiredOption(options, "authorization-public-key")
          : undefined,
      rehearsalTrustPath:
        environment === "rehearsal"
          ? requiredOption(options, "authorization-trust")
          : undefined,
    });
    publicKey = trust.publicKey;
  }
  return {
    environment,
    session,
    manifest,
    productionBaseline,
    goNoGo,
    stateDir,
    authorization,
    publicKey,
    trust,
  };
}

function expectedTargetBindings(
  inputs,
  phase,
  currentInventory,
  { enforceBaseline = true } = {},
) {
  const expectedSha = inputs.session.releaseCandidateSha;
  const expectedImage = inputs.manifest.releaseImageDigest;
  const expectedCurrentContainer = inputs.productionBaseline.app.containerId;
  const expectedCurrentImage = inputs.manifest.currentProductionImage;
  if (
    inputs.manifest.releaseCandidateSha !== expectedSha ||
    inputs.session.releaseImageDigest !== expectedImage
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      "Release Manifest is not bound to the Release Session candidate.",
    );
  }
  assertTrustedBaselineManifest({
    manifest: inputs.manifest,
    baseline: inputs.productionBaseline,
    session: inputs.session,
  });
  const callerBindings = {
    "expected-sha": expectedSha,
    "expected-image": expectedImage,
    "expected-current-container": expectedCurrentContainer,
    "expected-current-image": expectedCurrentImage,
  };
  for (const [name, trusted] of Object.entries(callerBindings)) {
    if (options[name] !== undefined && options[name] !== trusted) {
      throw new ProductionRolloutError(
        "PRODUCTION_IMAGE_CONTRACT_INVALID",
        `--${name} cannot override the trusted Release Manifest binding.`,
      );
    }
  }
  if (enforceBaseline) {
    assertProductionBaselineStable({
      baseline: inputs.productionBaseline,
      current: currentInventory,
      expectedContainer: expectedCurrentContainer,
      expectedImage: expectedCurrentImage,
      phase,
    });
  }
  return {
    expectedSha,
    expectedImage,
    expectedCurrentContainer,
    expectedCurrentImage,
    releaseManifestDigest: inputs.manifest.digest,
  };
}

function commandResultFromAdapter(program, args, environment) {
  const serialized = process.env.PROJECTAI_ROLLOUT_TEST_COMMANDS;
  if (!serialized) return null;
  if (process.env.NODE_ENV !== "test" || environment !== "rehearsal") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Rollout command adapters are restricted to isolated rehearsal execution.",
    );
  }
  const adapter = JSON.parse(serialized);
  return adapter[JSON.stringify([program, ...args])] ?? { status: 0, stdout: "", stderr: "" };
}

async function runOne(
  program,
  args,
  environment,
  releaseEnvironment = {},
  { signal } = {},
) {
  const adapted = commandResultFromAdapter(program, args, environment);
  if (adapted) return adapted;
  if (environment !== "production") {
    return { status: 0, stdout: "rehearsal", stderr: "" };
  }
  if (process.env.PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED !== "1") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Production execution kill switch is disabled.",
    );
  }
  let executable = program;
  let executableArguments = args;
  if (program === "projectai-internal") {
    const operations = new URL("./production-rollout-operations.sh", import.meta.url);
    executable = "bash";
    executableArguments = [operations.pathname, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, executableArguments, {
      env: { ...process.env, ...releaseEnvironment },
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maximumBytes = 8 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const capture = (field) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumBytes) {
        child.kill("SIGTERM");
        if (!settled) {
          settled = true;
          reject(new ProductionRolloutError(
            "PRODUCTION_PHASE_EXECUTION_FAILED",
            "Production command output exceeded the bounded capture limit.",
          ));
        }
        return;
      }
      if (field === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve({ status: Number.isInteger(code) ? code : 1, stdout, stderr });
      }
    });
  });
}

async function executePlan(plan, environment, phase, releaseEnvironment = {}, onProgress) {
  const results = [];
  for (const [program, ...args] of plan) {
    const result = await runOneWithHeartbeat({
      program,
      args,
      environment,
      releaseEnvironment,
      onProgress,
    });
    const command = [program, ...args].join(" ");
    const record = {
      command,
      status: Number(result.status ?? 1),
      stdoutDigest: digestObject({ stdout: String(result.stdout ?? "") }),
      stderrDigest: digestObject({ stderr: String(result.stderr ?? "") }),
    };
    if (command === "projectai-internal bounded-backfill --limit=100") {
      try {
        const value = JSON.parse(String(result.stdout ?? ""));
        if (
          !Number.isSafeInteger(value.backfillChunkCount) ||
          value.backfillChunkCount < 0 ||
          value.backfillChunkCount > 100 ||
          !Number.isSafeInteger(value.enqueuedJobs) ||
          value.enqueuedJobs < 0
        ) {
          throw new Error("invalid bounded Backfill result");
        }
        record.evidence = value;
      } catch (error) {
        if (environment === "production") {
          throw new ProductionRolloutError(
            "PRODUCTION_PHASE_EXECUTION_FAILED",
            "Bounded Backfill did not return a trusted Chunk count.",
            { cause: error },
          );
        }
      }
    }
    results.push(record);
    if (result.status !== 0) {
      assertPhaseCommandResults(phase, results);
    }
  }
  assertPhaseCommandResults(phase, results);
  return results;
}

async function runOneWithHeartbeat({
  program,
  args,
  environment,
  releaseEnvironment = {},
  onProgress,
}) {
  await onProgress?.();
  const controller = new AbortController();
  let heartbeatError = null;
  let heartbeatChain = Promise.resolve();
  const heartbeat = () => {
    heartbeatChain = heartbeatChain
      .then(() => onProgress?.())
      .catch((error) => {
        heartbeatError ??= error;
        controller.abort();
      });
  };
  const heartbeatTimer = onProgress
    ? setInterval(heartbeat, PRODUCTION_LOCK_HEARTBEAT_INTERVAL_MS)
    : null;
  let result;
  try {
    result = await runOne(program, args, environment, releaseEnvironment, {
      signal: controller.signal,
    });
  } catch (error) {
    if (heartbeatError) throw heartbeatError;
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await heartbeatChain;
  }
  if (heartbeatError) throw heartbeatError;
  await onProgress?.();
  return result;
}

function validatePhaseGates({ phase, environment, verification, inventory }) {
  if (
    Number(phase) >= 3 &&
    (!Number.isSafeInteger(verification.providerUnknownCount) ||
      verification.providerUnknownCount < 0 ||
      !Number.isSafeInteger(verification.dailyTokenLimit) ||
      verification.dailyTokenLimit < 1)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_COST_GATE_FAILED",
      "Provider counters and token limits must come from fresh Verification evidence.",
    );
  }
  assertStopConditions({ inventory, verification, allowDeploymentLock: true });
  const observation = observationGate({
    phase,
    elapsedSeconds: verification.elapsedSeconds,
    controlledRequests: verification.controlledRequests,
    rehearsal: environment === "rehearsal",
  });
  const cost = costGate({ phase, ...verification });
  if (!observation.passed) {
    throw new ProductionRolloutError(
      "PRODUCTION_OBSERVATION_GATE_FAILED",
      "Phase observation window or request count is incomplete.",
    );
  }
  if (Number(phase) >= 3 && !cost.passed) {
    throw new ProductionRolloutError(
      "PRODUCTION_COST_GATE_FAILED",
      "Phase cost gate failed.",
    );
  }
  if (Number(phase) === 4) {
    if (
      !Number.isSafeInteger(verification.backfillChunkCount) ||
      verification.backfillChunkCount < 0 ||
      verification.backfillChunkCount > 100 ||
      verification.newDocumentAutoEnqueue !== true
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_COST_GATE_FAILED",
        "Phase 4 requires a verified new-document flow and a Backfill of at most 100 Chunks.",
      );
    }
  }
  return { observation, cost };
}

function phaseApplyReportPath(stateDir, phase) {
  return path.join(path.resolve(stateDir), `production-phase-${Number(phase)}-apply.json`);
}

function inventoryImageMetadata(inventory, runtime) {
  if (runtime === "app") {
    return {
      id: inventory.app?.imageDigest,
      os: inventory.app?.imageOs,
      architecture: inventory.app?.imageArchitecture,
      revision: inventory.app?.imageRevision,
      environment: inventory.app?.imageEnvironment,
    };
  }
  const prefix = runtime === "document" ? "documentWorker" : "embeddingWorker";
  return {
    id: inventory.services?.[`${prefix}ImageDigest`],
    os: inventory.services?.[`${prefix}ImageOs`],
    architecture: inventory.services?.[`${prefix}ImageArchitecture`],
    revision: inventory.services?.[`${prefix}ImageRevision`],
    environment: inventory.services?.[`${prefix}ImageEnvironment`],
  };
}

function assertVerifiedRuntimeState({ inputs, phase, rollback, inventory, verification }) {
  if (inputs.environment !== "production") return;
  const candidate = {
    digest: inputs.manifest.releaseImageDigest,
    sha: inputs.session.releaseCandidateSha,
  };
  const baseline = {
    digest: inputs.manifest.rollbackImage,
    sha: inputs.productionBaseline.app?.imageRevision,
  };
  const appExpected =
    (rollback && phase <= 2) || (!rollback && phase < 2) ? baseline : candidate;
  assertRuntimeImageBinding(inventoryImageMetadata(inventory, "app"), appExpected, "App");
  if (!rollback && phase >= 2) {
    assertRuntimeImageBinding(
      inventoryImageMetadata(inventory, "document"),
      candidate,
      "Document Worker",
    );
  }
  if (!rollback && phase >= 4) {
    assertRuntimeImageBinding(
      inventoryImageMetadata(inventory, "embedding"),
      candidate,
      "Embedding Worker",
    );
  }
  if (rollback && phase >= 3) {
    assertRuntimeImageBinding(
      inventoryImageMetadata(inventory, "document"),
      candidate,
      "Document Worker rollback runtime",
    );
  }
  if (rollback && phase >= 5) {
    assertRuntimeImageBinding(
      inventoryImageMetadata(inventory, "embedding"),
      candidate,
      "Embedding Worker rollback runtime",
    );
  }
  if (rollback && [3, 4].includes(phase)) {
    if (inventory.services?.embeddingWorker !== false) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLBACK_VERIFICATION_FAILED",
        "Embedding Worker must remain stopped after the Phase 4 rollback boundary.",
      );
    }
  }
  if (
    rollback &&
    phase === 2 &&
    (inventory.services?.documentWorker !== false || inventory.services?.embeddingWorker !== false)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLBACK_VERIFICATION_FAILED",
      "Phase 2 rollback must stop both Production Workers.",
    );
  }
  assertRuntimeImageBinding(
    verification.imageMetadata?.databaseTools,
    candidate,
    "DB tools",
  );
  const egressExpectation = productionEgressExpectation(phase, { rollback });
  if (egressExpectation) {
    assertProductionEgressMembership(verification.egressMembers, egressExpectation);
  }
}

function latestUnconsumedLockClear(entries, { sessionId, phase }) {
  let candidate = null;
  for (const entry of entries) {
    if (entry.releaseSessionId !== sessionId || entry.phase !== Number(phase)) continue;
    if (["lock-clear-approved", "lock-cleared"].includes(entry.event)) {
      candidate = entry;
    } else if (
      entry.event === "lock-reacquired" &&
      candidate &&
      entry.clearReportDigest === candidate.reportDigest
    ) {
      candidate = null;
    } else if (
      candidate &&
      !["lock-clear-approved", "lock-cleared"].includes(entry.event)
    ) {
      candidate = null;
    }
  }
  return candidate;
}

function latestIncompleteFinalization(entries, { sessionId }) {
  let candidate = null;
  for (const entry of entries) {
    if (entry.releaseSessionId !== sessionId || entry.phase !== 6) continue;
    if (entry.event === "finalization-prepared") {
      candidate = entry;
    } else if (
      entry.event === "release-completed" &&
      candidate &&
      entry.finalReportDigest === candidate.finalReportDigest
    ) {
      candidate = null;
    }
  }
  if (
    candidate &&
    candidate.phaseState === "succeeded" &&
    typeof candidate.finalReportDigest === "string" &&
    typeof candidate.finalInventoryDigest === "string" &&
    typeof candidate.finalStateDigest === "string" &&
    typeof candidate.deploymentLockId === "string" &&
    Number.isSafeInteger(candidate.ownerPid) &&
    candidate.ownerPid > 0 &&
    Number.isSafeInteger(candidate.ownerUid) &&
    candidate.ownerUid >= 0 &&
    typeof candidate.ownerHostname === "string"
  ) {
    return candidate;
  }
  return null;
}

function processState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return error?.code === "ESRCH" ? "dead" : "unknown";
  }
}

function assertExplicitFinalizationRecovery(entry) {
  const currentUid = process.getuid?.();
  const recordedAt = Date.parse(entry.recordedAt);
  if (
    !optionBoolean("recover-finalization") ||
    requiredOption(options, "ack-lock-id") !== entry.deploymentLockId ||
    entry.ownerHostname !== os.hostname() ||
    entry.ownerUid !== currentUid ||
    processState(entry.ownerPid) !== "dead" ||
    !Number.isFinite(recordedAt) ||
    Date.now() - recordedAt < PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Incomplete Finalize requires an explicitly acknowledged stale-owner recovery.",
    );
  }
}

function latestJournalDigest(entries) {
  return entries.at(-1)?.digest ?? null;
}

async function recordLockReacquired({
  journalPath,
  sessionId,
  recoveryEntry,
  replacementLock,
  expectedPreviousDigest,
}) {
  return appendJournal(journalPath, {
    releaseSessionId: sessionId,
    phase: recoveryEntry.phase,
    event: "lock-reacquired",
    phaseState: recoveryEntry.phaseState,
    clearedLockId: recoveryEntry.lockId,
    clearReportDigest: recoveryEntry.reportDigest,
    newLockId: replacementLock.lockId,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest,
  });
}

async function reconcileExistingReplacementLock({
  entries,
  journalPath,
  lock,
  sessionId,
  phase,
}) {
  const recoveryEntry = latestUnconsumedLockClear(entries, { sessionId, phase });
  if (!recoveryEntry || recoveryEntry.lockId === lock.lockId) return entries;
  if (
    !/^pl-[0-9a-f]{32}$/.test(recoveryEntry.lockId ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(recoveryEntry.reportDigest ?? "") ||
    ![Number(phase), Number(phase) + 1].includes(lock.currentPhase) ||
    recoveryEntry.phaseState !== currentPhaseState(entries, phase)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "A stale-Lock clear approval cannot be reconciled to the current Lock.",
    );
  }
  await recordLockReacquired({
    journalPath,
    sessionId,
    recoveryEntry,
    replacementLock: lock,
    expectedPreviousDigest: latestJournalDigest(entries),
  });
  return readJournal(journalPath);
}

async function collectPhaseVerification({
  inputs,
  phase,
  applyReport,
  rollback = false,
  onProgress,
}) {
  if (typeof options.verification === "string") {
    throw new ProductionRolloutError(
      "PRODUCTION_VERIFICATION_INPUT_REJECTED",
      "Caller-provided Verification JSON is not accepted.",
    );
  }
  if (inputs.environment === "rehearsal") {
    if (process.env.NODE_ENV !== "test" || !process.env.PROJECTAI_ROLLOUT_TEST_VERIFICATION) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Rehearsal Verification adapter is restricted to NODE_ENV=test.",
      );
    }
    const all = JSON.parse(process.env.PROJECTAI_ROLLOUT_TEST_VERIFICATION);
    const value = all[String(phase)] ?? all;
    assertSanitized(value);
    if (value?.reportType) return value;
    const observationEndedAt = new Date().toISOString();
    return withDigest({
      schemaVersion: 1,
      reportType: rollback
        ? "production-rollout-rollback-observation"
        : "production-rollout-phase-observation",
      producer: PRODUCTION_PHASE_VERIFIER,
      producerVersion: PRODUCTION_ROLLOUT_VERSION,
      sourceMode: "synthetic-test",
      releaseSessionId: inputs.session.releaseSessionId,
      releaseCandidateSha: inputs.session.releaseCandidateSha,
      releaseImageDigest: inputs.manifest.releaseImageDigest,
      databaseToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
      releaseManifestDigest: inputs.manifest.digest,
      phase,
      direction: rollback ? "rollback" : "forward",
      applyReportDigest: applyReport.digest,
      commandResultDigest: applyReport.commandResultDigest,
      mutationStartedAt: applyReport.mutationStartedAt,
      result: "passed",
      syntheticResult: false,
      observation: {
        releaseSessionId: inputs.session.releaseSessionId,
        phase,
        startedAt: applyReport.observationStartedAt,
        endedAt: observationEndedAt,
      },
      metrics: value,
    });
  }
  const verifier = new URL("./production-phase-verifier.mjs", import.meta.url);
  const result = await runOneWithHeartbeat({
    program: process.execPath,
    args: [
      verifier.pathname,
      `--phase=${phase}`,
      `--mutation-started-at=${applyReport.mutationStartedAt}`,
      `--observation-started-at=${applyReport.observationStartedAt}`,
      `--direction=${rollback ? "rollback" : "forward"}`,
      `--release-session-id=${inputs.session.releaseSessionId}`,
      `--release-candidate-sha=${inputs.session.releaseCandidateSha}`,
      `--release-image-digest=${inputs.manifest.releaseImageDigest}`,
      `--database-tools-image-digest=${inputs.manifest.databaseToolsImageDigest}`,
      `--release-manifest-digest=${inputs.manifest.digest}`,
      `--apply-report-digest=${applyReport.digest}`,
      `--command-result-digest=${applyReport.commandResultDigest}`,
      `--rollback-image-digest=${inputs.manifest.rollbackImage}`,
    ],
    environment: inputs.environment,
    onProgress,
  });
  if (result.status !== 0) {
    throw new ProductionRolloutError(
      rollback
        ? "PRODUCTION_ROLLBACK_VERIFICATION_FAILED"
        : "PRODUCTION_PHASE_VERIFICATION_FAILED",
      "Production phase verifier failed.",
    );
  }
  const value = JSON.parse(result.stdout);
  assertSanitized(value);
  return value;
}

async function phaseCommand({ resume = false } = {}) {
  const phase = phaseDefinition(requiredOption(options, "phase")).phase;
  const authorizationAction = resume ? "resume" : "apply";
  const apply = optionBoolean("apply");
  const dryRun = !apply;
  if (
    apply &&
    options.environment === "production" &&
    typeof options.authorization !== "string"
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Production apply requires an independently signed Authorization.",
    );
  }
  const inputs = await releaseInputs({ requireAuthorization: apply });
  if (apply) assertProductionWorkingDirectory(inputs.environment);
  if (apply) assertNoCallerImageOverride(inputs.environment);
  if (typeof options.verification === "string") {
    throw new ProductionRolloutError(
      "PRODUCTION_VERIFICATION_INPUT_REJECTED",
      "Apply never accepts caller-provided Verification JSON.",
    );
  }
  const preInventory = apply
    ? await collectLiveInventory({ session: inputs.session, environment: inputs.environment })
    : inputs.productionBaseline;
  const preDataCounts = apply ? collectProductionDataCounts(inputs, phase) : null;
  const targets = expectedTargetBindings(inputs, phase, preInventory);
  if (typeof options["previous-report"] === "string") {
    throw new ProductionRolloutError(
      "PRODUCTION_VERIFICATION_INPUT_REJECTED",
      "Caller-provided prerequisite reports are not accepted.",
    );
  }
  const previousReport =
    phase === 0 ? null : await readPhaseReport(inputs.stateDir, phase - 1);
  assertPhasePrerequisite({
    phase,
    previousReport,
    sessionId: inputs.session.releaseSessionId,
    session: inputs.session,
    manifest: inputs.manifest,
  });
  if (
    previousReport?.postStateDigest &&
    previousReport.postStateDigest !== inventoryStateDigest(preInventory)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_BASELINE_DRIFT",
      "Live pre-Phase state does not match the previous verified post-state.",
    );
  }
  const plan = phaseActionPlan(phase);
  if (dryRun) {
    const report = rolloutReportContract({
      reportType: "production-rollout-phase",
      sourceMode: inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
      session: inputs.session,
      phase,
      phaseState: "not_started",
      result: "dry-run",
      extra: {
        environment: inputs.environment,
        apply: false,
        resume,
        authorizationPresent: false,
        targets,
        actionPlan: plan.map(([program, ...args]) => [program, ...args].join(" ")),
        productionWritePerformed: false,
        preInventoryDigest: preInventory.digest,
      },
    });
    const outputDir =
      typeof options["output-dir"] === "string"
        ? options["output-dir"]
        : path.join("release-artifacts", "production-rollout-dry-run");
    const written = await writeRolloutReport({
      outputDir,
      stem: `production-phase-${phase}`,
      payload: report,
      title: `Production rollout phase ${phase} dry-run`,
    });
    process.stdout.write(`${written.digest}\n`);
    return;
  }

  assertProductionAuthorization(inputs.authorization, {
    now: new Date(),
    environment: inputs.environment,
    phase,
    action: authorizationAction,
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase,
    action: authorizationAction,
  });
  await assertAuthorizationMarker({
    environment: inputs.environment,
    authorization: inputs.authorization,
    phase,
    action: authorizationAction,
    markerPath:
      inputs.environment === "rehearsal"
        ? requiredOption(options, "authorization-marker")
        : undefined,
  });
  assertActualReleaseImages(inputs);
  assertMigrationLockClear(preInventory);
  if (phase >= 3) {
    await inspectSecretMetadata(
      inputs.environment === "production"
        ? "/srv/projectai/secrets/qwen_api_key"
        : requiredOption(options, "qwen-secret"),
    );
  }
  const composePath = inputs.environment === "production"
    ? PRODUCTION_COMPOSE_FILE
    : path.resolve("docker-compose.production-rollout.yml");
  const aiComposePath = inputs.environment === "production"
    ? PRODUCTION_AI_COMPOSE_FILE
    : path.resolve("docker-compose.production-ai.yml");
  const compose = await readFile(composePath, "utf8");
  const aiCompose = await readFile(aiComposePath, "utf8");
  assertComposeContract(compose, aiCompose);
  const lockPath =
    inputs.environment === "production"
      ? PRODUCTION_LOCK_PATH
      : path.join(inputs.stateDir, ".production-rollout-lock");
  let lock = await readDeploymentLock(lockPath, { validateLease: true });
  if (lock) {
    assertDeploymentLockBinding(lock, {
      session: inputs.session,
      phase: resume || phase === 0 ? phase : phase - 1,
    });
  }
  const journalPath = journalPathFor(inputs.stateDir);
  let entries = await readJournal(journalPath);
  const recoveryPhase = resume || phase === 0 ? phase : phase - 1;
  if (lock) {
    entries = await reconcileExistingReplacementLock({
      entries,
      journalPath,
      lock,
      sessionId: inputs.session.releaseSessionId,
      phase: recoveryPhase,
    });
  }
  const currentState = currentPhaseState(entries, phase);
  const lockRecoveryEntry = latestUnconsumedLockClear(entries, {
    sessionId: inputs.session.releaseSessionId,
    phase: recoveryPhase,
  });
  let expectedJournalDigest = latestJournalDigest(entries);
  if (!lock && (phase !== 0 || resume || currentState !== "not_started")) {
    if (
      !lockRecoveryEntry?.reportDigest ||
      (!resume && lockRecoveryEntry.phaseState !== "succeeded")
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Lock reacquire requires the latest unconsumed manual stale-Lock clear.",
      );
    }
  }
  if (resume) {
    if (!['failed', 'running', 'blocked'].includes(currentState)) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Resume is allowed only for failed, interrupted, or blocked phases.",
      );
    }
    assertPhaseTransition(currentState, currentState === "blocked" ? "authorized" : "running");
  } else {
    assertPhaseTransition(currentState, "authorized");
  }
  await consumeAuthorization({
    stateDir: inputs.stateDir,
    authorization: inputs.authorization,
    phase,
    action: authorizationAction,
    environment: inputs.environment,
    publicKey: inputs.publicKey,
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  if (!lock) {
    lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session: inputs.session,
        phase,
        authorizationId: inputs.authorization.authorizationId,
      }),
    });
    if (lockRecoveryEntry) {
      const reacquiredEntry = await recordLockReacquired({
        journalPath,
        sessionId: inputs.session.releaseSessionId,
        recoveryEntry: lockRecoveryEntry,
        replacementLock: lock,
        expectedPreviousDigest: expectedJournalDigest,
      });
      expectedJournalDigest = reacquiredEntry.digest;
    }
  }
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: inputs.authorization.authorizationId,
  });
  if (!resume) {
    const authorizedEntry = await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "authorized",
      phaseState: "authorized",
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    expectedJournalDigest = authorizedEntry.digest;
    assertPhaseTransition("authorized", "running");
  }
  const startedEntry = await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase,
    event: resume ? "resumed" : "started",
    phaseState: "running",
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  expectedJournalDigest = startedEntry.digest;

  try {
    const mutationStartedAt = new Date().toISOString();
    const commandResults = await executePlan(
      plan,
      inputs.environment,
      phase,
      {
        PRODUCTION_APP_IMAGE: inputs.manifest.releaseImageDigest,
        PRODUCTION_DB_TOOLS_IMAGE: inputs.manifest.databaseToolsImageDigest,
      },
      async () => {
        lock = await updateDeploymentLock({
          lockPath,
          expectedLock: lock,
          phase,
          authorizationId: inputs.authorization.authorizationId,
        });
      },
    );
    const commandResultDigest = digestObject(commandResults);
    assertPhaseTransition("running", "awaiting_verification");
    const mutationCompletedAt = new Date().toISOString();
    const observationStartedAt = new Date().toISOString();
    const report = await writeRolloutReport({
      outputDir: inputs.stateDir,
      stem: `production-phase-${phase}-apply`,
      payload: rolloutReportContract({
        reportType: "production-rollout-phase-apply",
        sourceMode:
          inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
        session: inputs.session,
        phase,
        phaseState: "awaiting_verification",
        result: "mutation-completed",
        extra: {
          environment: inputs.environment,
          apply: true,
          resume,
          authorizationId: inputs.authorization.authorizationId,
          productionWritePerformed: inputs.environment === "production",
          commandResults,
          commandResultDigest,
          releaseManifestDigest: inputs.manifest.digest,
          preInventoryDigest: preInventory.digest,
          preDataCounts,
          preObjectCount: preInventory.objectStorage?.objectCount ?? 0,
          preObjectBytes: preInventory.objectStorage?.totalBytes ?? 0,
          preDatabaseSizeBytes: preInventory.database?.sizeBytes ?? 0,
          databaseToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
          mutationStartedAt,
          mutationCompletedAt,
          observationStartedAt,
          previousPhaseDigest: previousReport?.digest ?? null,
        },
      }),
      title: `Production rollout phase ${phase} apply`,
    });
    const mutationEntry = await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "mutation-completed",
      phaseState: "awaiting_verification",
      applyReportDigest: report.digest,
      commandResultDigest,
      mutationStartedAt,
      recordedAt: mutationCompletedAt,
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    expectedJournalDigest = mutationEntry.digest;
    lock = await updateDeploymentLock({
      lockPath,
      expectedLock: lock,
      phase,
      authorizationId: inputs.authorization.authorizationId,
      idle: true,
    });
    process.stdout.write(`${report.digest}\n`);
  } catch (error) {
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "failed",
      phaseState: "failed",
      failureCode: error?.code ?? "PRODUCTION_PHASE_EXECUTION_FAILED",
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    if (lock?.ownerPid === process.pid) {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: inputs.authorization.authorizationId,
        idle: true,
      }).catch(() => lock);
    }
    throw error;
  }
}

async function verifyCommand({ rollback = false } = {}) {
  const phase = phaseDefinition(requiredOption(options, "phase")).phase;
  const inputs = await releaseInputs({ requireAuthorization: false });
  assertProductionWorkingDirectory(inputs.environment);
  const journalPath = journalPathFor(inputs.stateDir);
  let entries = await readJournal(journalPath);
  const expectedState = rollback ? "awaiting_rollback_verification" : "awaiting_verification";
  const observedState = currentPhaseState(entries, phase);
  const retryingRollbackVerification = rollback && observedState === "rollback_failed";
  if (observedState !== expectedState && !retryingRollbackVerification) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_TRANSITION_INVALID",
      `Phase ${phase} is not ${expectedState}.`,
    );
  }
  const lockPath = inputs.environment === "production"
    ? PRODUCTION_LOCK_PATH
    : path.join(inputs.stateDir, ".production-rollout-lock");
  let lock = await readDeploymentLock(lockPath, { validateLease: true });
  if (lock) {
    entries = await reconcileExistingReplacementLock({
      entries,
      journalPath,
      lock,
      sessionId: inputs.session.releaseSessionId,
      phase,
    });
  }
  let expectedJournalDigest = latestJournalDigest(entries);
  if (!lock) {
    const recoveryEntry = latestUnconsumedLockClear(entries, {
      sessionId: inputs.session.releaseSessionId,
      phase,
    });
    if (!recoveryEntry || recoveryEntry.phaseState !== observedState) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Verification requires the matching Deployment Lock or an unconsumed clear approval.",
      );
    }
    lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session: inputs.session,
        phase,
        authorizationId: recoveryEntry.authorizationId,
        ownerPid: 0,
      }),
    });
    const reacquiredEntry = await recordLockReacquired({
      journalPath,
      sessionId: inputs.session.releaseSessionId,
      recoveryEntry,
      replacementLock: lock,
      expectedPreviousDigest: expectedJournalDigest,
    });
    entries = [...entries, reacquiredEntry];
    expectedJournalDigest = reacquiredEntry.digest;
  }
  assertDeploymentLockBinding(lock, { session: inputs.session, phase });
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: lock.authorizationId,
  });
  if (retryingRollbackVerification) {
    assertPhaseTransition(observedState, expectedState);
    const retryEntry = await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "rollback-verification-retried",
      phaseState: expectedState,
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    entries = [...entries, retryEntry];
    expectedJournalDigest = retryEntry.digest;
  }
  let verificationCommitted = false;
  try {
    const applyReport = await readJson(
    rollback
      ? path.join(inputs.stateDir, `production-rollback-${phase}-apply.json`)
      : phaseApplyReportPath(inputs.stateDir, phase),
    );
    const mutationEvent = rollback
      ? "rollback-mutation-completed"
      : "mutation-completed";
    const mutationEntry = entries
      .filter(
        (entry) =>
          entry.releaseSessionId === inputs.session.releaseSessionId &&
          entry.phase === phase &&
          entry.event === mutationEvent,
      )
      .at(-1);
    assertApplyReportBinding({
      report: applyReport,
      session: inputs.session,
      manifest: inputs.manifest,
      phase,
      rollback,
      journalEntry: mutationEntry,
    });
  const postInventory = await collectLiveInventory({
    session: inputs.session,
    environment: inputs.environment,
    onProgress: async () => {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: lock.authorizationId,
      });
    },
  });
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: lock.authorizationId,
  });
  assertFreshLiveInventory(postInventory, {
    session: inputs.session,
    environment: inputs.environment,
  });
  const verificationEvidence = await collectPhaseVerification({
    inputs,
    phase,
    applyReport,
    rollback,
    onProgress: async () => {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: lock.authorizationId,
      });
    },
  });
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: lock.authorizationId,
  });
  const verification = assertVerificationEvidence({
    report: verificationEvidence,
    session: inputs.session,
    manifest: inputs.manifest,
    phase,
    applyReport,
    rollback,
    environment: inputs.environment,
  });
  if (!rollback && phase === 4) {
    const backfillResult = applyReport.commandResults.find(
      (result) => result.command === "projectai-internal bounded-embedding-backfill",
    );
    const appliedChunkCount = backfillResult?.evidence?.backfillChunkCount;
    if (
      !Number.isSafeInteger(appliedChunkCount) ||
      appliedChunkCount < 0 ||
      verification.backfillChunkCount !== appliedChunkCount
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_PHASE_VERIFICATION_FAILED",
        "Phase 4 independently observed Backfill Chunk count does not match the mutation result.",
      );
    }
  }
  if (rollback && phase >= 2) {
    if (
      JSON.stringify(verification.dataCounts ?? null) !==
        JSON.stringify(applyReport.preDataCounts ?? null) ||
      Number(postInventory.objectStorage?.objectCount ?? 0) < Number(applyReport.preObjectCount ?? 0) ||
      Number(postInventory.objectStorage?.totalBytes ?? 0) < Number(applyReport.preObjectBytes ?? 0)
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLBACK_VERIFICATION_FAILED",
        "Rollback aggregate rows, objects, or vectors were not preserved.",
      );
    }
    if (
      deploymentStateDigest(postInventory) !==
      applyReport.rollbackTargetDeploymentStateDigest
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLBACK_VERIFICATION_FAILED",
        "Rollback runtime does not match the previous verified Phase state.",
      );
    }
  }
  assertVerifiedRuntimeState({
    inputs,
    phase,
    rollback,
    inventory: postInventory,
    verification,
  });
  const gates = rollback
    ? (() => {
        assertStopConditions({ inventory: postInventory, verification, allowDeploymentLock: true });
        return {
          observation: { passed: true, rollback: true },
          cost: { passed: true, rollback: true },
        };
      })()
    : validatePhaseGates({
        phase,
        environment: inputs.environment,
        verification,
        inventory: postInventory,
      });
  const finalState = rollback ? "rolled_back" : "succeeded";
  assertPhaseTransition(expectedState, finalState);
  const payload = rolloutReportContract({
    reportType: rollback
      ? "production-rollout-rollback-verification"
      : "production-rollout-phase-verification",
    sourceMode: inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
    session: inputs.session,
    phase,
    phaseState: finalState,
    result: "passed",
    extra: {
      databaseToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
      releaseManifestDigest: inputs.manifest.digest,
      candidateSha: inputs.session.releaseCandidateSha,
      appImageDigest: inputs.manifest.releaseImageDigest,
      dbToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
      preInventoryDigest: applyReport.preInventoryDigest,
      postInventoryDigest: postInventory.digest,
      postStateDigest: inventoryStateDigest(postInventory),
      postDeploymentStateDigest: deploymentStateDigest(postInventory),
      capturedAt: postInventory.capturedAt,
      observationStartedAt: applyReport.observationStartedAt,
      observationEndedAt: new Date().toISOString(),
      commandResultDigest: applyReport.commandResultDigest,
      applyReportDigest: applyReport.digest,
      mutationJournalDigest: mutationEntry.digest,
      verificationEvidenceDigest: verificationEvidence.digest,
      ...(rollback
        ? {
            rollbackState: "verified",
            rollbackInventoryDigest: postInventory.digest,
            rollbackTargetReportDigest: applyReport.rollbackTargetReportDigest,
            rollbackTargetStateDigest: applyReport.rollbackTargetStateDigest,
            rollbackTargetDeploymentStateDigest:
              applyReport.rollbackTargetDeploymentStateDigest,
            rollbackImageDigest: applyReport.rollbackImageDigest,
          }
        : {}),
      verification,
      observationGate: gates.observation,
      costGate: gates.cost,
    },
  });
  const report = rollback
    ? await writeRolloutReport({
        outputDir: inputs.stateDir,
        stem: `production-rollback-${phase}-verification`,
        payload,
        title: `Production rollback phase ${phase} verification`,
      })
    : await writePhaseReport(inputs.stateDir, payload);
    const verifiedEntry = await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: rollback ? "rollback-verified" : "verified",
      phaseState: finalState,
      reportDigest: report.digest,
      applyReportDigest: applyReport.digest,
      commandResultDigest: applyReport.commandResultDigest,
      verificationEvidenceDigest: verificationEvidence.digest,
      postInventoryDigest: postInventory.digest,
      postStateDigest: payload.postStateDigest,
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    expectedJournalDigest = verifiedEntry.digest;
    verificationCommitted = true;
    if (rollback && phase === 0) {
      await releaseDeploymentLock({ lockPath, expectedLock: lock });
    } else {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: lock.authorizationId,
        idle: true,
      });
    }
    process.stdout.write(`${report.digest}\n`);
  } catch (error) {
    if (!verificationCommitted) {
      await appendJournal(journalPath, {
        releaseSessionId: inputs.session.releaseSessionId,
        phase,
        event: rollback ? "rollback-verification-failed" : "verification-failed",
        phaseState: rollback ? "rollback_failed" : "failed",
        failureCode: error?.code ?? "PRODUCTION_PHASE_VERIFICATION_FAILED",
        recordedAt: new Date().toISOString(),
      }, {
        expectedPreviousDigest: expectedJournalDigest,
      }).catch(() => {});
    }
    if (lock?.ownerPid === process.pid) {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: lock.authorizationId,
        idle: true,
      }).catch(() => lock);
    }
    throw error;
  }
}

async function rollbackCommand() {
  const phase = phaseDefinition(requiredOption(options, "phase")).phase;
  const apply = optionBoolean("apply");
  const inputs = await releaseInputs({ requireAuthorization: apply });
  if (apply) assertProductionWorkingDirectory(inputs.environment);
  if (apply) assertNoCallerImageOverride(inputs.environment);
  const preInventory = apply
    ? await collectLiveInventory({ session: inputs.session, environment: inputs.environment })
    : inputs.productionBaseline;
  const preDataCounts = apply ? collectProductionDataCounts(inputs, phase) : null;
  expectedTargetBindings(inputs, phase, preInventory, { enforceBaseline: false });
  const plan = rollbackActionPlan(phase);
  if (!apply) {
    const report = rolloutReportContract({
      reportType: "production-rollout-rollback",
      sourceMode: inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
      session: inputs.session,
      phase,
      phaseState: "not_started",
      result: "dry-run",
      extra: {
        actionPlan: plan.map(([program, ...args]) => [program, ...args].join(" ")),
        productionWritePerformed: false,
      },
    });
    const written = await writeRolloutReport({
      outputDir: options["output-dir"] ?? "release-artifacts/production-rollback-dry-run",
      stem: `production-rollback-${phase}`,
      payload: report,
      title: `Production rollback phase ${phase}`,
    });
    process.stdout.write(`${written.digest}\n`);
    return;
  }
  const rollbackTargetReport =
    phase === 0 ? null : await readPhaseReport(inputs.stateDir, phase - 1);
  assertPhasePrerequisite({
    phase,
    previousReport: rollbackTargetReport,
    sessionId: inputs.session.releaseSessionId,
    session: inputs.session,
    manifest: inputs.manifest,
  });
  const rollbackTargetStateDigest =
    rollbackTargetReport?.postStateDigest ?? inventoryStateDigest(inputs.productionBaseline);
  const rollbackTargetDeploymentStateDigest =
    phase >= 2 ? rollbackTargetReport?.postDeploymentStateDigest : null;
  if (
    phase >= 2 &&
    !/^sha256:[0-9a-f]{64}$/.test(rollbackTargetDeploymentStateDigest ?? "")
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLBACK_VERIFICATION_FAILED",
      "Rollback target Phase is missing its verified deployment-state Digest.",
    );
  }
  assertProductionAuthorization(inputs.authorization, {
    environment: inputs.environment,
    phase,
    action: "rollback",
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase,
    action: "rollback",
  });
  await assertAuthorizationMarker({
    environment: inputs.environment,
    authorization: inputs.authorization,
    phase,
    action: "rollback",
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  assertActualReleaseImages(inputs, { includeRollback: true });
  const journalPath = journalPathFor(inputs.stateDir);
  let entries = await readJournal(journalPath);
  const lockPath = inputs.environment === "production"
    ? PRODUCTION_LOCK_PATH
    : path.join(inputs.stateDir, ".production-rollout-lock");
  let lock = await readDeploymentLock(lockPath, { validateLease: true });
  if (lock) {
    assertDeploymentLockBinding(lock, { session: inputs.session, phase });
    entries = await reconcileExistingReplacementLock({
      entries,
      journalPath,
      lock,
      sessionId: inputs.session.releaseSessionId,
      phase,
    });
  }
  const currentState = currentPhaseState(entries, phase);
  const recoveryEntry = lock
    ? null
    : latestUnconsumedLockClear(entries, {
        sessionId: inputs.session.releaseSessionId,
        phase,
      });
  let expectedJournalDigest = latestJournalDigest(entries);
  if (!lock && (!recoveryEntry || recoveryEntry.phaseState !== currentState)) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Rollback requires the matching Lock or latest unconsumed stale-Lock clear.",
    );
  }
  assertRollbackOrder(entries, phase);
  if (
    ![
      "failed",
      "succeeded",
      "awaiting_verification",
      "blocked",
    ].includes(currentState)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_TRANSITION_INVALID",
      "Rollback Apply requires a failed, blocked, awaiting-verification, or succeeded phase; rollback verification failures must retry Verify without repeating mutation.",
    );
  }
  await consumeAuthorization({
    stateDir: inputs.stateDir,
    authorization: inputs.authorization,
    phase,
    action: "rollback",
    environment: inputs.environment,
    publicKey: inputs.publicKey,
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  if (!lock) {
    lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session: inputs.session,
        phase,
        authorizationId: inputs.authorization.authorizationId,
      }),
    });
    const reacquiredEntry = await recordLockReacquired({
      journalPath,
      sessionId: inputs.session.releaseSessionId,
      recoveryEntry,
      replacementLock: lock,
      expectedPreviousDigest: expectedJournalDigest,
    });
    entries = [...entries, reacquiredEntry];
    expectedJournalDigest = reacquiredEntry.digest;
  }
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: inputs.authorization.authorizationId,
  });
  try {
    const mutationStartedAt = new Date().toISOString();
    const commandResults = await executePlan(
      plan,
      inputs.environment,
      phase,
      {
        PRODUCTION_APP_IMAGE: inputs.manifest.releaseImageDigest,
        PRODUCTION_DB_TOOLS_IMAGE: inputs.manifest.databaseToolsImageDigest,
        PROJECTAI_TRUSTED_ROLLBACK_IMAGE: inputs.manifest.rollbackImage,
      },
      async () => {
        lock = await updateDeploymentLock({
          lockPath,
          expectedLock: lock,
          phase,
          authorizationId: inputs.authorization.authorizationId,
        });
      },
    );
    const commandResultDigest = digestObject(commandResults);
    assertPhaseTransition(currentState, "awaiting_rollback_verification");
    const mutationCompletedAt = new Date().toISOString();
    const observationStartedAt = new Date().toISOString();
    const report = await writeRolloutReport({
      outputDir: inputs.stateDir,
      stem: `production-rollback-${phase}-apply`,
      payload: rolloutReportContract({
        reportType: "production-rollout-rollback-apply",
        sourceMode:
          inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
        session: inputs.session,
        phase,
        phaseState: "awaiting_rollback_verification",
        result: "mutation-completed",
        extra: {
          authorizationId: inputs.authorization.authorizationId,
          commandResults,
          commandResultDigest,
          releaseManifestDigest: inputs.manifest.digest,
          preInventoryDigest: preInventory.digest,
          rollbackInventoryDigest: preInventory.digest,
          preDataCounts,
          preObjectCount: preInventory.objectStorage?.objectCount ?? 0,
          preObjectBytes: preInventory.objectStorage?.totalBytes ?? 0,
          preDatabaseSizeBytes: preInventory.database?.sizeBytes ?? 0,
          databaseToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
          rollbackImageDigest: inputs.manifest.rollbackImage,
          rollbackTargetReportDigest: rollbackTargetReport?.digest ?? null,
          rollbackTargetStateDigest,
          rollbackTargetDeploymentStateDigest,
          mutationStartedAt,
          mutationCompletedAt,
          observationStartedAt,
        },
      }),
      title: `Production rollback phase ${phase} apply`,
    });
    const rollbackMutationEntry = await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "rollback-mutation-completed",
      phaseState: "awaiting_rollback_verification",
      applyReportDigest: report.digest,
      commandResultDigest,
      rollbackTargetStateDigest,
      rollbackTargetDeploymentStateDigest,
      mutationStartedAt,
      recordedAt: mutationCompletedAt,
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    expectedJournalDigest = rollbackMutationEntry.digest;
    lock = await updateDeploymentLock({
      lockPath,
      expectedLock: lock,
      phase,
      authorizationId: inputs.authorization.authorizationId,
      idle: true,
    });
    process.stdout.write(`${report.digest}\n`);
  } catch (error) {
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "rollback-failed",
      phaseState: "rollback_failed",
      failureCode: error?.code ?? "PRODUCTION_ROLLBACK_FAILED",
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    });
    if (lock?.ownerPid === process.pid) {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: inputs.authorization.authorizationId,
        idle: true,
      }).catch(() => lock);
    }
    throw error;
  }
}

async function finalizeCommand() {
  const inputs = await releaseInputs({ requireAuthorization: true });
  assertProductionWorkingDirectory(inputs.environment);
  const failurePoint = finalizeTestFailurePoint(inputs.environment);
  const phase = 6;
  assertProductionAuthorization(inputs.authorization, {
    environment: inputs.environment,
    phase,
    action: "finalize",
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase,
    action: "finalize",
  });
  await assertAuthorizationMarker({
    environment: inputs.environment,
    authorization: inputs.authorization,
    phase,
    action: "finalize",
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  assertActualReleaseImages(inputs);
  const lockPath = inputs.environment === "production"
    ? PRODUCTION_LOCK_PATH
    : path.join(inputs.stateDir, ".production-rollout-lock");
  const journalPath = journalPathFor(inputs.stateDir);
  let entries = await readJournal(journalPath);
  let lock = await readDeploymentLock(lockPath, {
    validateLease: true,
    requireOwnership: false,
  });
  if (lock) {
    assertDeploymentLockBinding(lock, { session: inputs.session, phase });
    entries = await reconcileExistingReplacementLock({
      entries,
      journalPath,
      lock,
      sessionId: inputs.session.releaseSessionId,
      phase,
    });
  }
  const recoveryEntry = lock
    ? null
    : latestUnconsumedLockClear(entries, {
        sessionId: inputs.session.releaseSessionId,
        phase,
      });
  const finalizationRecovery = lock
    ? null
    : latestIncompleteFinalization(entries, {
        sessionId: inputs.session.releaseSessionId,
      });
  if (finalizationRecovery) assertExplicitFinalizationRecovery(finalizationRecovery);
  if (failurePoint === "before-finalization-reacquire" && !finalizationRecovery) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Finalize reacquire failure injection requires an incomplete Finalize recovery anchor.",
    );
  }
  let expectedJournalDigest = latestJournalDigest(entries);
  if (
    (lock && lock.ownerPid !== 0 && lock.ownerPid !== process.pid) ||
    (!lock &&
      (!recoveryEntry || recoveryEntry.phaseState !== "succeeded") &&
      !finalizationRecovery)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Finalize requires the idle Deployment Lock or its latest unconsumed clear approval.",
    );
  }
  const reports = await Promise.all(
    Array.from({ length: 7 }, (_, reportPhase) =>
      readPhaseReport(inputs.stateDir, reportPhase),
    ),
  );
  let inventory = await collectLiveInventory({
    session: inputs.session,
    environment: inputs.environment,
  });
  let finalStateDigest = inventoryStateDigest(inventory);
  if (lock) {
    assertFinalizeReady({
      entries,
      inventory,
      lock,
      reports,
      session: inputs.session,
      manifest: inputs.manifest,
      finalStateDigest,
    });
  }
  await consumeAuthorization({
    stateDir: inputs.stateDir,
    authorization: inputs.authorization,
    phase,
    action: "finalize",
    environment: inputs.environment,
    publicKey: inputs.publicKey,
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  if (!lock) {
    injectFinalizeTestFailure(failurePoint, "before-finalization-reacquire");
    lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({
        session: inputs.session,
        phase,
        authorizationId: inputs.authorization.authorizationId,
        ownerPid: 0,
      }),
    });
    try {
      if (recoveryEntry) {
        const reacquiredEntry = await recordLockReacquired({
          journalPath,
          sessionId: inputs.session.releaseSessionId,
          recoveryEntry,
          replacementLock: lock,
          expectedPreviousDigest: expectedJournalDigest,
        });
        entries = [...entries, reacquiredEntry];
        expectedJournalDigest = reacquiredEntry.digest;
      } else {
        const finalizationReacquiredEntry = await appendJournal(journalPath, {
          releaseSessionId: inputs.session.releaseSessionId,
          phase,
          event: "finalization-reacquired",
          phaseState: "succeeded",
          priorFinalReportDigest: finalizationRecovery.finalReportDigest,
          priorDeploymentLockId: finalizationRecovery.deploymentLockId,
          newLockId: lock.lockId,
          authorizationId: inputs.authorization.authorizationId,
          recordedAt: new Date().toISOString(),
        }, {
          expectedPreviousDigest: expectedJournalDigest,
        });
        entries = [...entries, finalizationReacquiredEntry];
        expectedJournalDigest = finalizationReacquiredEntry.digest;
      }
    } catch (error) {
      if (error?.code === "PRODUCTION_ROLLOUT_STATE_CHANGED") {
        await releaseIdleDeploymentLock({
          lockPath,
          expectedLock: lock,
          phase,
          authorizationId: inputs.authorization.authorizationId,
        });
      }
      throw error;
    }
  }
  lock = await updateDeploymentLock({
    lockPath,
    expectedLock: lock,
    phase,
    authorizationId: inputs.authorization.authorizationId,
  });
  inventory = await collectLiveInventory({
    session: inputs.session,
    environment: inputs.environment,
    onProgress: async () => {
      lock = await updateDeploymentLock({
        lockPath,
        expectedLock: lock,
        phase,
        authorizationId: inputs.authorization.authorizationId,
      });
    },
  });
  finalStateDigest = inventoryStateDigest(inventory);
  entries = await readJournal(journalPath);
  if (latestJournalDigest(entries) !== expectedJournalDigest) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_CHANGED",
      "Production Journal changed during Finalize; live state and gates must be re-evaluated.",
    );
  }
  const { activeTotal, reportDigests } = assertFinalizeReady({
    entries,
    inventory,
    lock,
    reports,
    session: inputs.session,
    manifest: inputs.manifest,
    finalStateDigest,
  });
  await writeJson(path.join(inputs.stateDir, "final-production-inventory.json"), inventory);
  const report = await writeRolloutReport({
    outputDir: inputs.stateDir,
    stem: "production-rollout-final",
    payload: rolloutReportContract({
      reportType: "production-rollout-final",
      sourceMode: inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
      session: inputs.session,
      phase,
      phaseState: "succeeded",
      result: "release-prepared",
      extra: {
        databaseToolsImageDigest: inputs.manifest.databaseToolsImageDigest,
        finalInventoryDigest: inventory.digest,
        finalStateDigest,
        phaseVerificationReportDigests: reportDigests,
        deploymentLockId: lock.lockId,
        activeTotal,
        productionHttpStatus: inventory.app.publicHttpStatus,
      },
    }),
    title: "Production rollout finalization",
  });
  const preparedEntry = await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase,
    event: "finalization-prepared",
    phaseState: "succeeded",
    finalReportDigest: report.digest,
    finalInventoryDigest: inventory.digest,
    finalStateDigest,
    deploymentLockId: lock.lockId,
    authorizationId: inputs.authorization.authorizationId,
    ownerPid: lock.ownerPid,
    ownerHostname: lock.ownerHostname,
    ownerUid: lock.ownerUid,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  expectedJournalDigest = preparedEntry.digest;
  try {
    await releaseDeploymentLock({ lockPath, expectedLock: lock });
  } catch (error) {
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "finalization-release-failed",
      phaseState: "succeeded",
      finalReportDigest: report.digest,
      deploymentLockId: lock.lockId,
      failureCode: error?.code ?? "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      recordedAt: new Date().toISOString(),
    }, {
      expectedPreviousDigest: expectedJournalDigest,
    }).catch(() => {});
    throw error;
  }
  injectFinalizeTestFailure(failurePoint, "before-release-completed-append");
  await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase,
    event: "release-completed",
    phaseState: "succeeded",
    finalReportDigest: report.digest,
    finalInventoryDigest: inventory.digest,
    finalStateDigest,
    deploymentLockId: lock.lockId,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  process.stdout.write(`${report.digest}\n`);
}

async function lockReviewCommand() {
  const environment = environmentOption();
  const session = await readJson(requiredOption(options, "session"));
  assertReleaseSession(session);
  const stateDir = await stateDirectory(session, environment);
  const lockPath = environment === "production"
    ? PRODUCTION_LOCK_PATH
    : path.join(stateDir, ".production-rollout-lock");
  const lock = await readDeploymentLock(lockPath);
  const guard = await readDeploymentLifecycleGuard(lockPath);
  let leaseState = "clear";
  if (lock) {
    try {
      await readDeploymentLock(lockPath, { validateLease: true });
      leaseState = lock.ownerPid === 0 ? "idle" : "active";
    } catch (error) {
      leaseState = error?.code === "PRODUCTION_DEPLOYMENT_LOCK_STALE" ? "stale" : "held";
    }
  }
  let guardState = "clear";
  if (guard) {
    try {
      assertDeploymentLifecycleGuardClearable(guard);
      guardState = "stale";
    } catch {
      guardState = "held";
    }
  }
  const report = await writeRolloutReport({
    outputDir: options["output-dir"] ?? "release-artifacts/production-lock-review",
    stem: "production-lock-review",
    payload: rolloutReportContract({
      reportType: "production-lock-review",
      sourceMode: "live-readonly",
      session,
      phase: lock?.currentPhase ?? guard?.currentPhase ?? null,
      phaseState: null,
      result: lock ? leaseState : guard ? `guard-${guardState}` : "clear",
      extra: {
        lockPresent: Boolean(lock),
        lockId: lock?.lockId ?? null,
        lockDigest: lock?.digest ?? null,
        leaseState,
        ownerPid: lock?.ownerPid ?? null,
        ownerHostname: lock?.ownerHostname ?? null,
        ownerUid: lock?.ownerUid ?? null,
        expiresAt: lock?.expiresAt ?? null,
        heartbeatAt: lock?.heartbeatAt ?? null,
        lifecycleGuardPresent: Boolean(guard),
        lifecycleGuardId: guard?.guardId ?? null,
        lifecycleGuardState: guardState,
        lifecycleGuardOperation: guard?.operation ?? null,
        lifecycleGuardOwnerPid: guard?.ownerPid ?? null,
        lifecycleGuardOwnerHostname: guard?.ownerHostname ?? null,
        lifecycleGuardOwnerUid: guard?.ownerUid ?? null,
        lifecycleGuardAcquiredAt: guard?.acquiredAt ?? null,
      },
    }),
    title: "Production rollout lock review",
  });
  process.stdout.write(`${report.digest}\n`);
}

async function lockClearCommand() {
  const apply = optionBoolean("apply");
  if (!apply) return lockReviewCommand();
  const inputs = await releaseInputs({ requireAuthorization: true });
  assertProductionWorkingDirectory(inputs.environment);
  const lockPath = inputs.environment === "production"
    ? PRODUCTION_LOCK_PATH
    : path.join(inputs.stateDir, ".production-rollout-lock");
  const lock = await readDeploymentLock(lockPath);
  const guard = await readDeploymentLifecycleGuard(lockPath);
  const reviewedLockId = lock?.lockId ?? guard?.targetLockId ?? null;
  const reviewedLockDigest = lock?.digest ?? guard?.targetLockDigest ?? null;
  const reviewedPhase = lock?.currentPhase ?? guard?.currentPhase ?? null;
  if (!reviewedLockId || reviewedLockId !== requiredOption(options, "ack-lock-id")) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Explicit stale Lock ID acknowledgement is required.",
    );
  }
  try {
    if (lock) {
      assertDeploymentLockBinding(lock, {
        session: inputs.session,
        phase: reviewedPhase,
      });
      assertDeploymentLockClearable(lock);
    } else if (guard) {
      assertDeploymentLifecycleGuardBinding(guard, {
        session: inputs.session,
        phase: reviewedPhase,
      });
      assertDeploymentLifecycleGuardClearable(guard);
    } else {
      throw new Error("missing Lock and lifecycle guard");
    }
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Only a reviewed stale Lock or lifecycle guard with a non-live owner may be cleared.",
    );
  }
  assertProductionAuthorization(inputs.authorization, {
    environment: inputs.environment,
    phase: reviewedPhase,
    action: "lock-clear",
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase: reviewedPhase,
    action: "lock-clear",
  });
  await assertAuthorizationMarker({
    environment: inputs.environment,
    authorization: inputs.authorization,
    phase: reviewedPhase,
    action: "lock-clear",
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  await consumeAuthorization({
    stateDir: inputs.stateDir,
    authorization: inputs.authorization,
    phase: reviewedPhase,
    action: "lock-clear",
    environment: inputs.environment,
    publicKey: inputs.publicKey,
    markerPath: inputs.environment === "rehearsal"
      ? requiredOption(options, "authorization-marker")
      : undefined,
  });
  const journalPath = journalPathFor(inputs.stateDir);
  const reviewedEntries = await readJournal(journalPath);
  const preservedPhaseState = currentPhaseState(reviewedEntries, reviewedPhase);
  let expectedJournalDigest = latestJournalDigest(reviewedEntries);
  const report = await writeRolloutReport({
    outputDir: inputs.stateDir,
    stem: "production-lock-clear",
    payload: rolloutReportContract({
      reportType: "production-lock-clear",
      sourceMode: inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
      session: inputs.session,
      phase: reviewedPhase,
      phaseState: preservedPhaseState,
      result: "clear-approved-after-review",
      extra: {
        lockId: reviewedLockId,
        lockDigest: reviewedLockDigest,
        lifecycleGuardId: guard?.guardId ?? null,
        authorizationId: inputs.authorization.authorizationId,
      },
    }),
    title: "Production rollout stale lock clear",
  });
  const clearApprovedEntry = await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase: reviewedPhase,
    event: "lock-clear-approved",
    phaseState: preservedPhaseState,
    lockId: reviewedLockId,
    lockDigest: reviewedLockDigest,
    reportDigest: report.digest,
    authorizationId: inputs.authorization.authorizationId,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  expectedJournalDigest = clearApprovedEntry.digest;
  if (lock) {
    await releaseDeploymentLock({
      lockPath,
      expectedLock: lock,
      allowStale: true,
    });
  } else {
    await clearStaleDeploymentLifecycleGuard({
      lockPath,
      expectedGuard: guard,
    });
  }
  const replacementLock = await acquireDeploymentLock({
    lockPath,
    metadata: createLockMetadata({
      session: inputs.session,
      phase: reviewedPhase,
      authorizationId: inputs.authorization.authorizationId,
      ownerPid: 0,
    }),
  });
  const lockClearedEntry = await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase: reviewedPhase,
    event: "lock-cleared",
    phaseState: preservedPhaseState,
    lockId: reviewedLockId,
    lockDigest: reviewedLockDigest,
    reportDigest: report.digest,
    authorizationId: inputs.authorization.authorizationId,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  expectedJournalDigest = lockClearedEntry.digest;
  await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase: reviewedPhase,
    event: "lock-reacquired",
    phaseState: preservedPhaseState,
    clearedLockId: reviewedLockId,
    clearReportDigest: report.digest,
    newLockId: replacementLock.lockId,
    recordedAt: new Date().toISOString(),
  }, {
    expectedPreviousDigest: expectedJournalDigest,
  });
  process.stdout.write(`${report.digest}\n`);
}

async function statusCommand() {
  const environment = environmentOption();
  const session = await readJson(requiredOption(options, "session"));
  assertReleaseSession(session);
  const stateDir = await stateDirectory(session, environment);
  const lockPath =
    environment === "production"
      ? PRODUCTION_LOCK_PATH
      : path.join(stateDir, ".production-rollout-lock");
  const lock = await readDeploymentLock(lockPath);
  const entries = await readJournal(journalPathFor(stateDir));
  const phases = [];
  for (let phase = 0; phase <= 6; phase += 1) {
    const report = await readPhaseReport(stateDir, phase);
    phases.push({
      phase,
      name: phaseDefinition(phase).name,
      state: currentPhaseState(entries, phase),
      latestReportDigest: report?.digest ?? null,
      rollbackAvailable: [
        "failed",
        "succeeded",
        "awaiting_verification",
        "blocked",
      ].includes(
        currentPhaseState(entries, phase),
      ),
      rollbackVerificationRetryAvailable:
        currentPhaseState(entries, phase) === "rollback_failed",
    });
  }
  const inventory = await collectLiveInventory({ session, environment });
  const report = await writeRolloutReport({
    outputDir: options["output-dir"] ?? "release-artifacts/production-status",
    stem: "production-rollout-status",
    payload: rolloutReportContract({
      reportType: "production-rollout-status",
      sourceMode: "live-readonly",
      session,
      phase: lock?.currentPhase ?? null,
      phaseState:
        lock?.currentPhase === undefined
          ? null
          : currentPhaseState(entries, lock.currentPhase),
      result: "read-only",
      extra: {
        environment,
        lock: lock
          ? {
              present: true,
              releaseSessionId: lock.releaseSessionId,
              currentPhase: lock.currentPhase,
              startedAt: lock.startedAt,
              expiresAt: lock.expiresAt,
            }
          : { present: false },
        phases,
        runtime: inventory
          ? {
              appContainerId: inventory.app?.containerId ?? null,
              appImageDigest: inventory.app?.imageDigest ?? null,
              postgres: inventory.database?.present ?? null,
              minio: inventory.objectStorage?.present ?? null,
              documentWorker: inventory.services?.documentWorker ?? null,
              embeddingWorker: inventory.services?.embeddingWorker ?? null,
              migration: inventory.database?.migrationCount ?? null,
              assistantEnabled: inventory.features?.aiAssistantEnabled ?? null,
              embeddingEnabled: inventory.features?.aiEmbeddingEnabled ?? null,
              retrievalMode: inventory.features?.retrievalMode ?? null,
              activeJobs: inventory.active ?? null,
            }
          : null,
      },
    }),
    title: "Production rollout status",
  });
  process.stdout.write(`${report.digest}\n`);
}

async function authorizeTestCommand() {
  if (process.env.NODE_ENV !== "test") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "B3-C2A cannot generate formal Production Authorization.",
    );
  }
  const session = await readJson(requiredOption(options, "session"));
  const manifest = await readJson(requiredOption(options, "manifest"));
  const goNoGo = await readJson(requiredOption(options, "go-no-go"));
  const privateKey = await readFile(path.resolve(requiredOption(options, "private-key")), "utf8");
  assertReleaseSession(session);
  assertReleaseManifest(manifest);
  const authorizedAt = requiredOption(options, "authorized-at");
  const expiresAt = requiredOption(options, "expires-at");
  const action = requiredOption(options, "action");
  const phases = requiredOption(options, "phases")
    .split(",")
    .map(Number);
  const payload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session,
    manifest,
    goNoGo,
    authorizedPhases: phases,
    action,
    authorizedAt,
    expiresAt,
  });
  const authorization = signTestAuthorization(payload, privateKey);
  await writeJson(requiredOption(options, "output"), authorization);
  if (typeof options["marker-output"] === "string") {
    await writeJson(
      options["marker-output"],
      createTestAuthorizationMarker({
        authorization,
        phase: phases[0],
        action,
        expiresAt,
      }),
    );
  }
  process.stdout.write(`${authorization.digest}\n`);
}

const commands = {
  phase: () => phaseCommand(),
  resume: () => phaseCommand({ resume: true }),
  rollback: rollbackCommand,
  verify: () => verifyCommand({ rollback: optionBoolean("rollback") }),
  finalize: finalizeCommand,
  "lock-review": lockReviewCommand,
  "lock-clear": lockClearCommand,
  status: statusCommand,
  "authorize-test": authorizeTestCommand,
};

try {
  const handler = commands[command];
  if (!handler) throw new Error("Unsupported production rollout command.");
  await handler();
} catch (error) {
  process.stderr.write(`${error?.code ?? "PRODUCTION_ROLLOUT_ERROR"}: ${error?.message ?? String(error)}\n`);
  process.exitCode = exitCodeForRolloutError(error);
}
