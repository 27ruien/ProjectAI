#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  appendJournal,
  assertAuthorizationBindings,
  assertComposeContract,
  assertPhaseCommandResults,
  assertMigrationLockClear,
  assertPhasePrerequisite,
  assertPhaseTransition,
  assertProductionAuthorization,
  assertProductionBaselineStable,
  assertStopConditions,
  costGate,
  createAuthorizationPayload,
  createLockMetadata,
  currentPhaseState,
  exitCodeForRolloutError,
  inspectSecretMetadata,
  journalPathFor,
  observationGate,
  phaseActionPlan,
  phaseDefinition,
  readDeploymentLock,
  readJournal,
  readPhaseReport,
  releaseDeploymentLock,
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
  PRODUCTION_LOCK_PATH,
} from "./production-rollout-contract.mjs";
import {
  assertDigest,
  assertFullSha,
  assertInventory,
  assertReleaseManifest,
  assertReleaseSession,
  assertSanitized,
  parseArguments,
  readJson,
  requiredOption,
  writeJson,
} from "./contract.mjs";

const command = process.argv[2];
const { options } = parseArguments(process.argv.slice(3));

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

function stateDirectory(session, environment) {
  const value = requiredOption(options, "state-dir");
  const resolved = path.resolve(value);
  if (
    environment === "production" &&
    resolved !== `/srv/projectai/releases/${session.releaseSessionId}`
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production state-dir must use the fixed Release Session journal path.",
    );
  }
  return resolved;
}

async function releaseInputs({ requireAuthorization = true } = {}) {
  const environment = environmentOption();
  const session = await readJson(requiredOption(options, "session"));
  const manifest = await readJson(requiredOption(options, "manifest"));
  const productionBaseline = await readJson(
    requiredOption(options, "production-baseline"),
  );
  const currentInventory = await readJson(
    requiredOption(options, "production-inventory"),
  );
  const goNoGo = await readJson(requiredOption(options, "go-no-go"));
  assertReleaseSession(session);
  assertReleaseManifest(manifest);
  assertInventory(productionBaseline, { requireProducer: false });
  assertInventory(currentInventory, {
    requireProducer: environment === "production",
  });
  assertSanitized(goNoGo);
  assertDigest(goNoGo.digest, "goNoGo.digest");
  const stateDir = stateDirectory(session, environment);
  let authorization = null;
  let publicKey = null;
  if (requireAuthorization) {
    const authorizationPath = options.authorization;
    if (typeof authorizationPath !== "string") {
      throw new ProductionRolloutError(
        "PRODUCTION_APPLY_NOT_AUTHORIZED",
        "Production apply requires an independently signed Authorization.",
      );
    }
    authorization = await readJson(authorizationPath);
    const publicKeyPath = requiredOption(options, "authorization-public-key");
    publicKey = await readFile(path.resolve(publicKeyPath), "utf8");
  }
  return {
    environment,
    session,
    manifest,
    productionBaseline,
    currentInventory,
    goNoGo,
    stateDir,
    authorization,
    publicKey,
  };
}

function expectedTargetBindings(inputs, phase) {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  const expectedCurrentContainer = requiredOption(
    options,
    "expected-current-container",
  );
  const expectedCurrentImage = requiredOption(options, "expected-current-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  assertDigest(expectedCurrentImage, "expected-current-image");
  if (!/^[0-9a-f]{64}$/.test(expectedCurrentContainer)) {
    throw new Error("--expected-current-container must be a full Container ID.");
  }
  if (
    expectedSha !== inputs.session.releaseCandidateSha ||
    expectedImage !== inputs.session.releaseImageDigest ||
    inputs.manifest.releaseCandidateSha !== expectedSha ||
    inputs.manifest.releaseImageDigest !== expectedImage
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Expected Candidate SHA/Image does not match the Release Session and Manifest.",
    );
  }
  assertProductionBaselineStable({
    baseline: inputs.productionBaseline,
    current: inputs.currentInventory,
    expectedContainer: expectedCurrentContainer,
    expectedImage: expectedCurrentImage,
    phase,
  });
  return {
    expectedSha,
    expectedImage,
    expectedCurrentContainer,
    expectedCurrentImage,
  };
}

async function verificationInput(phase, apply) {
  if (typeof options.verification === "string") {
    const value = await readJson(options.verification);
    assertSanitized(value);
    return value;
  }
  if (apply) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_PREREQUISITE_MISSING",
      `Phase ${phase} apply requires a generated verification input.`,
    );
  }
  return {
    elapsedSeconds: 0,
    controlledRequests: 0,
    answerTokens: 0,
    embeddingTokens: 0,
    queryEmbeddingTokens: 0,
    dailyTokenLimit: 1,
    providerUnknownCount: 0,
    rateLimited: false,
    crossProjectLeak: false,
    cleanupComplete: true,
    providerCostAnomaly: false,
    embeddingUnknownIncrease: 0,
    jobBacklog: 0,
    jobBacklogLimit: 0,
  };
}

function commandResultFromAdapter(program, args) {
  const serialized = process.env.PROJECTAI_ROLLOUT_TEST_COMMANDS;
  if (!serialized) return null;
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Rollout command adapters require NODE_ENV=test.");
  }
  const adapter = JSON.parse(serialized);
  return adapter[JSON.stringify([program, ...args])] ?? { status: 0, stdout: "", stderr: "" };
}

function runOne(program, args, environment) {
  const adapted = commandResultFromAdapter(program, args);
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
  if (program === "projectai-internal") {
    const operations = new URL("./production-rollout-operations.sh", import.meta.url);
    return spawnSync("bash", [operations.pathname, ...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  return spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function executePlan(plan, environment, phase) {
  const results = [];
  for (const [program, ...args] of plan) {
    const result = runOne(program, args, environment);
    results.push({
      command: [program, ...args].join(" "),
      status: Number(result.status ?? 1),
    });
    if (result.status !== 0) {
      assertPhaseCommandResults(phase, results);
    }
  }
  assertPhaseCommandResults(phase, results);
  return results;
}

function validatePhaseGates({ phase, environment, verification, inventory }) {
  assertStopConditions({ inventory, verification });
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
  if (Number(phase) === 4 && Number(verification.backfillChunkCount ?? 0) > 100) {
    throw new ProductionRolloutError(
      "PRODUCTION_COST_GATE_FAILED",
      "Initial Embedding backfill exceeds 100 Chunks.",
    );
  }
  return { observation, cost };
}

async function phaseCommand({ resume = false } = {}) {
  const phase = phaseDefinition(requiredOption(options, "phase")).phase;
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
  const targets = expectedTargetBindings(inputs, phase);
  const verification = await verificationInput(phase, apply);
  const previousReport =
    phase === 0
      ? null
      : typeof options["previous-report"] === "string"
        ? await readJson(options["previous-report"])
        : await readPhaseReport(inputs.stateDir, phase - 1);
  assertPhasePrerequisite({
    phase,
    previousReport,
    sessionId: inputs.session.releaseSessionId,
  });
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
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase,
  });
  assertMigrationLockClear(inputs.currentInventory);
  if (phase >= 3) {
    await inspectSecretMetadata(requiredOption(options, "qwen-secret"));
  }
  const compose = await readFile(path.resolve(PRODUCTION_COMPOSE_FILE), "utf8");
  const aiCompose = await readFile(path.resolve(PRODUCTION_AI_COMPOSE_FILE), "utf8");
  assertComposeContract(compose, aiCompose);
  const lockPath =
    inputs.environment === "production"
      ? PRODUCTION_LOCK_PATH
      : path.join(inputs.stateDir, ".production-rollout-lock");
  let lock = await readDeploymentLock(lockPath);
  if (phase === 0 && !lock) {
    lock = await acquireDeploymentLock({
      lockPath,
      metadata: createLockMetadata({ session: inputs.session, phase }),
    });
  }
  if (!lock || lock.releaseSessionId !== inputs.session.releaseSessionId) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "A matching Production rollout lock is required.",
    );
  }
  const journalPath = journalPathFor(inputs.stateDir);
  const entries = await readJournal(journalPath);
  const existing = await readPhaseReport(inputs.stateDir, phase);
  if (existing?.phaseState === "succeeded") {
    process.stdout.write(`${existing.digest}\n`);
    return;
  }
  await updateDeploymentLock({
    lockPath,
    releaseSessionId: inputs.session.releaseSessionId,
    phase,
  });
  const currentState = currentPhaseState(entries, phase);
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
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "authorized",
      phaseState: "authorized",
      recordedAt: new Date().toISOString(),
    });
    assertPhaseTransition("authorized", "running");
  }
  await appendJournal(journalPath, {
    releaseSessionId: inputs.session.releaseSessionId,
    phase,
    event: resume ? "resumed" : "started",
    phaseState: "running",
    recordedAt: new Date().toISOString(),
  });

  try {
    const commandResults = executePlan(plan, inputs.environment, phase);
    const gates = validatePhaseGates({
      phase,
      environment: inputs.environment,
      verification,
      inventory: inputs.currentInventory,
    });
    assertPhaseTransition("running", "succeeded");
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "completed",
      phaseState: "succeeded",
      recordedAt: new Date().toISOString(),
    });
    const report = await writePhaseReport(
      inputs.stateDir,
      rolloutReportContract({
        reportType: "production-rollout-phase",
        sourceMode:
          inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
        session: inputs.session,
        phase,
        phaseState: "succeeded",
        result: "passed",
        extra: {
          environment: inputs.environment,
          apply: true,
          resume,
          authorizationId: inputs.authorization.authorizationId,
          productionWritePerformed: inputs.environment === "production",
          commandResults,
          observationGate: gates.observation,
          costGate: gates.cost,
          previousPhaseDigest: previousReport?.digest ?? null,
        },
      }),
    );
    process.stdout.write(`${report.digest}\n`);
  } catch (error) {
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "failed",
      phaseState: "failed",
      failureCode: error?.code ?? "PRODUCTION_PHASE_EXECUTION_FAILED",
      recordedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function rollbackCommand() {
  const phase = phaseDefinition(requiredOption(options, "phase")).phase;
  const apply = optionBoolean("apply");
  const inputs = await releaseInputs({ requireAuthorization: apply });
  expectedTargetBindings(inputs, phase);
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
  assertProductionAuthorization(inputs.authorization, {
    environment: inputs.environment,
    phase,
    publicKey: inputs.publicKey,
  });
  assertAuthorizationBindings({
    authorization: inputs.authorization,
    session: inputs.session,
    manifest: inputs.manifest,
    productionBaseline: inputs.productionBaseline,
    goNoGo: inputs.goNoGo,
    phase,
  });
  const journalPath = journalPathFor(inputs.stateDir);
  const entries = await readJournal(journalPath);
  const currentState = currentPhaseState(entries, phase);
  if (!['failed', 'succeeded'].includes(currentState)) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_TRANSITION_INVALID",
      "Rollback requires a failed or succeeded phase.",
    );
  }
  try {
    const commandResults = executePlan(plan, inputs.environment, phase);
    assertPhaseTransition(currentState, "rolled_back");
    await appendJournal(journalPath, {
      releaseSessionId: inputs.session.releaseSessionId,
      phase,
      event: "rolled-back",
      phaseState: "rolled_back",
      recordedAt: new Date().toISOString(),
    });
    if (phase === 0) {
      await releaseDeploymentLock({
        lockPath:
          inputs.environment === "production"
            ? PRODUCTION_LOCK_PATH
            : path.join(inputs.stateDir, ".production-rollout-lock"),
        releaseSessionId: inputs.session.releaseSessionId,
      });
    }
    const report = await writeRolloutReport({
      outputDir: options["output-dir"] ?? inputs.stateDir,
      stem: `production-rollback-${phase}`,
      payload: rolloutReportContract({
        reportType: "production-rollout-rollback",
        sourceMode:
          inputs.environment === "production" ? "live-readonly" : "rehearsal-command",
        session: inputs.session,
        phase,
        phaseState: "rolled_back",
        result: "passed",
        extra: {
          authorizationId: inputs.authorization.authorizationId,
          commandResults,
          publicHttpVerified: true,
          businessDataDeleted: false,
        },
      }),
      title: `Production rollback phase ${phase}`,
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
    });
    throw error;
  }
}

async function statusCommand() {
  const environment = environmentOption();
  const session = await readJson(requiredOption(options, "session"));
  assertReleaseSession(session);
  const stateDir = stateDirectory(session, environment);
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
      rollbackAvailable: ['failed', 'succeeded'].includes(
        currentPhaseState(entries, phase),
      ),
    });
  }
  const inventory =
    typeof options["production-inventory"] === "string"
      ? await readJson(options["production-inventory"])
      : null;
  if (inventory) assertSanitized(inventory);
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
  const phases = requiredOption(options, "phases")
    .split(",")
    .map(Number);
  const payload = createAuthorizationPayload({
    sourceMode: "synthetic-test",
    session,
    manifest,
    goNoGo,
    authorizedPhases: phases,
    authorizedAt,
    expiresAt,
  });
  const authorization = signTestAuthorization(payload, privateKey);
  await writeJson(requiredOption(options, "output"), authorization);
  process.stdout.write(`${authorization.digest}\n`);
}

const commands = {
  phase: () => phaseCommand(),
  resume: () => phaseCommand({ resume: true }),
  rollback: rollbackCommand,
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
