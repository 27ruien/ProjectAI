#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DIFFERENCE_CATEGORIES,
  RELEASE_TOOL_VERSION,
  assertDigest,
  assertEnvironment,
  assertFullSha,
  assertInventory,
  assertProducerContract,
  assertReleaseManifest,
  assertReleaseSession,
  assertSanitized,
  booleanOrNotApplicable,
  digestObject,
  numberOrNull,
  parseArguments,
  producerContract,
  readJson,
  requiredOption,
  withDigest,
  writeArtifactPair,
  writeJson,
} from "./contract.mjs";
import {
  assertEvidenceIndex,
  assertPublishedArtifactIdentity,
} from "../review-evidence-contract.mjs";

const command = process.argv[2];
const { options } = parseArguments(process.argv.slice(3));
const defaultOutputRoot = path.resolve("release-artifacts");

function commandKey(program, args) {
  return JSON.stringify([program, ...args]);
}

function runFactCommand(program, args, spawnOptions = {}) {
  const serialized = process.env.PROJECTAI_RELEASE_TEST_COMMANDS;
  if (serialized) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Release command adapters are only available in NODE_ENV=test.");
    }
    const adapter = JSON.parse(serialized);
    const result = adapter[commandKey(program, args)];
    if (!result) {
      throw new Error(`Test command adapter is missing ${commandKey(program, args)}.`);
    }
    return {
      status: Number(result.status ?? 0),
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }
  return spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...spawnOptions,
  });
}

function requireCommandSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || "unknown error").trim()}`);
  }
  return String(result.stdout ?? "").trim();
}

function currentUtcMilliseconds() {
  const injected = process.env.PROJECTAI_RELEASE_TEST_NOW;
  if (injected) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Release clock injection is only available in NODE_ENV=test.");
    }
    const parsed = Date.parse(injected);
    if (!Number.isFinite(parsed)) throw new Error("Invalid test release clock.");
    return parsed;
  }
  return Date.now();
}

function outputDirectory(suffix) {
  return path.resolve(
    typeof options["output-dir"] === "string"
      ? options["output-dir"]
      : path.join(defaultOutputRoot, suffix),
  );
}

async function releaseSession() {
  const session = await readJson(requiredOption(options, "session"));
  assertReleaseSession(session);
  return session;
}

function formalSourceMode(fallback = "live-readonly") {
  if (process.env.NODE_ENV === "test" && typeof options.input === "string") {
    return "synthetic-test";
  }
  return /^true$/i.test(process.env.CI || "") ? "ci-artifact" : fallback;
}

function asBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`Expected a boolean value, received ${String(value)}.`);
}

function mutationContract(name) {
  const environment = assertEnvironment(requiredOption(options, "environment"));
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  const apply = options.apply === true || options.apply === "true";
  if (environment === "production" && apply) {
    const error = new Error("PRODUCTION_APPLY_NOT_AUTHORIZED");
    error.code = "PRODUCTION_APPLY_NOT_AUTHORIZED";
    throw error;
  }
  return { command: name, environment, expectedSha, expectedImage, apply, dryRun: !apply };
}

function setNested(target, dottedKey, value) {
  const numericKeys = new Set([
    "schemaVersion",
    "app.restartCount",
    "app.imageSizeBytes",
    "app.publicHttpStatus",
    "app.localHttpStatus",
    "capacity.totalBytes",
    "capacity.usedBytes",
    "capacity.availableBytes",
    "capacity.filesystemUsagePercent",
    "capacity.inodeTotal",
    "capacity.inodeUsed",
    "capacity.inodeAvailable",
    "capacity.inodeUsagePercent",
    "database.sizeBytes",
    "objectStorage.objectCount",
    "objectStorage.totalBytes",
    "objectStorage.bucketCount",
    "services.documentWorkerRestartCount",
    "services.embeddingWorkerRestartCount",
    "active.documentJobs",
    "active.embeddingJobs",
    "active.embeddingBatches",
    "active.embeddingProviderCalls",
    "active.retrievalRuns",
    "active.queryEmbeddingCalls",
    "active.aiExecutions",
    "backup.latestSizeBytes",
    "backup.availableBytes",
    "features.hybridQueryEmbeddingTimeoutMs",
    "features.hybridVectorSqlTimeoutMs",
    "features.hybridDailyQueryTokenLimit",
  ]);
  const booleanKeys = new Set([
    "checks.nginxConfigValid",
    "checks.composeConfigValid",
    "features.aiAssistantEnabled",
    "features.aiEmbeddingEnabled",
    "features.queryEmbeddingConfigured",
    "features.qwenSecretMount",
    "database.present",
    "objectStorage.present",
    "services.documentWorker",
    "services.embeddingWorker",
    "locks.deployment",
    "locks.migrationApplicable",
    "locks.migrationFile",
    "locks.migration",
    "backup.pgDumpAvailable",
    "backup.pgRestoreAvailable",
    "backup.directoryExists",
    "backup.directoryWritable",
  ]);
  let normalized = value;
  const inventoryKnownKeys = new Set([
    "database.inventoryKnown",
    "objectStorage.inventoryKnown",
  ]);
  if (value === "null") normalized = null;
  else if (inventoryKnownKeys.has(dottedKey)) {
    normalized = booleanOrNotApplicable(value, dottedKey);
  }
  else if (numericKeys.has(dottedKey)) normalized = numberOrNull(value);
  else if (booleanKeys.has(dottedKey)) normalized = asBoolean(value);
  const parts = dottedKey.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }
  current[parts.at(-1)] = normalized;
}

function parseRemoteInventory(stdout) {
  const inventory = {};
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 1) throw new Error(`Remote inventory emitted an invalid record: ${line}`);
    setNested(inventory, line.slice(0, tab), line.slice(tab + 1));
  }
  return inventory;
}

async function sessionCommand() {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  const baselineValue = await readJson(
    requiredOption(options, "production-baseline"),
  );
  const baseline = withDigest(baselineValue);
  assertInventory(baseline, { requireProducer: false });
  if (baseline.environment !== "production") {
    throw new Error("Release session requires a Production baseline.");
  }
  const releaseSessionId = `rs-${randomUUID().replaceAll("-", "")}`;
  const payload = {
    schemaVersion: 1,
    reportType: "release-session",
    producer: "projectai-release-tool",
    producerVersion: RELEASE_TOOL_VERSION,
    sourceMode: /^true$/i.test(process.env.CI || "")
      ? "ci-artifact"
      : "live-readonly",
    releaseCandidateSha: expectedSha,
    releaseImageDigest: expectedImage,
    releaseSessionId,
    productionBaselineDigest: baseline.digest,
    createdAt: new Date().toISOString(),
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("session"),
    stem: "release-session",
    payload,
    markdown: `# B3-C1 release session\n\nSession: ${releaseSessionId}`,
  });
  assertReleaseSession(written);
  process.stdout.write(`${written.digest}\n`);
}

async function inventoryCommand() {
  const session = await releaseSession();
  const environment = assertEnvironment(requiredOption(options, "environment"));
  let inventory;
  if (typeof options.input === "string") {
    inventory = await readJson(options.input);
  } else {
    if (!["production", "staging"].includes(environment)) {
      throw new Error("Live inventory only supports production or staging.");
    }
    const remoteHost =
      typeof options["remote-host"] === "string" ? options["remote-host"] : "gridworks.cn";
    if (!/^[A-Za-z0-9.-]+$/.test(remoteHost)) {
      throw new Error("--remote-host contains unsupported characters.");
    }
    const remoteScript = await readFile(
      new URL("./remote-inventory.sh", import.meta.url),
      "utf8",
    );
    const migrationLockContract = JSON.parse(
      await readFile(
        new URL("../../release/migration-lock-contract.json", import.meta.url),
        "utf8",
      ),
    );
    if (
      migrationLockContract.schemaVersion !== 1 ||
      migrationLockContract.productionFile !== "/srv/projectai/.production-migration-lock" ||
      migrationLockContract.stagingFile !== "/srv/projectai-staging/.staging-migration-lock" ||
      !Number.isSafeInteger(migrationLockContract.postgresAdvisoryKey) ||
      migrationLockContract.postgresAdvisoryKey <= 0
    ) {
      throw new Error("Migration lock contract is invalid or unsupported.");
    }
    const migrationLockFile =
      environment === "production"
        ? migrationLockContract.productionFile
        : migrationLockContract.stagingFile;
    const result = spawnSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        remoteHost,
        "bash",
        "-s",
        "--",
        environment,
        migrationLockFile,
        String(migrationLockContract.postgresAdvisoryKey),
      ],
      { encoding: "utf8", input: remoteScript, maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      throw new Error(
        `Remote inventory failed without applying changes: ${(result.stderr || "unknown error").trim()}`,
      );
    }
    inventory = parseRemoteInventory(result.stdout);
  }
  if (inventory.environment !== environment) {
    throw new Error("Inventory environment does not match --environment.");
  }
  inventory = {
    ...inventory,
    ...producerContract({
      reportType: `${environment}-inventory`,
      sourceMode: formalSourceMode("live-readonly"),
      session,
    }),
  };
  const finalized = withDigest(inventory);
  assertInventory(finalized);
  const markdown = `# ${environment} release inventory

- Captured: ${finalized.capturedAt}
- App image: ${finalized.app.imageDigest}
- App health: ${finalized.app.health}
- Database: ${finalized.database.present ? finalized.database.version : "absent"}
- Migration count: ${finalized.database.migrationCount}
- pgvector: ${finalized.database.pgvectorVersion}
- Object storage: ${finalized.objectStorage.present ? "present" : "absent"}
- Object inventory: ${String(finalized.objectStorage.inventoryKnown)}
- Assistant / Embedding / Retrieval: ${finalized.features.aiAssistantEnabled} / ${finalized.features.aiEmbeddingEnabled} / ${finalized.features.retrievalMode}
- Root available bytes: ${finalized.capacity.availableBytes}
- Root / inode usage: ${finalized.capacity.filesystemUsagePercent}% / ${finalized.capacity.inodeUsagePercent}%
- Deployment / migration lock: ${finalized.locks.deployment} / ${finalized.locks.migration}
- Migration file / advisory: ${finalized.locks.migrationFile} / ${finalized.locks.migrationAdvisory}`;
  const written = await writeArtifactPair({
    outputDir: outputDirectory(environment),
    stem: `${environment}-inventory`,
    payload: inventory,
    markdown,
  });
  process.stdout.write(`${written.digest}\n`);
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function differenceCategory(field, production, staging) {
  if (
    (field.endsWith("inventoryKnown") && (production === false || staging === false)) ||
    (field === "locks.migrationAdvisory" &&
      (production === "unknown" || staging === "unknown"))
  ) {
    return "blocking_unknown";
  }
  if (
    field.startsWith("locks.") &&
    field !== "locks.migrationApplicable" &&
    (production === true ||
      staging === true ||
      production === "held" ||
      staging === "held" ||
      production === "unknown" ||
      staging === "unknown")
  ) {
    return "blocking_unknown";
  }
  if (field === "app.imageDigest" || field === "app.commitSha") return "requires_image_change";
  if (field.startsWith("database.")) {
    if (field === "database.migrationCount" || field === "database.pgvectorVersion") {
      return "requires_migration";
    }
    return production.database.present ? "requires_image_change" : "requires_new_service";
  }
  if (field.startsWith("objectStorage.")) return "requires_new_service";
  if (field.startsWith("services.")) return "requires_new_service";
  if (field === "features.qwenSecretMount") return "requires_secret";
  if (field.startsWith("features.")) return "requires_configuration";
  if (field === "configuration.composeHash") return "requires_configuration";
  if (field === "configuration.nginxHash") return "expected";
  if (field.startsWith("capacity.") || field.startsWith("app.")) return "expected";
  if (staging === undefined || production === undefined) return "blocking_unknown";
  return "expected";
}

async function diffCommand() {
  const session = await releaseSession();
  const production = await readJson(requiredOption(options, "production-inventory"));
  const staging = await readJson(requiredOption(options, "staging-inventory"));
  assertInventory(production, { expectedSessionId: session.releaseSessionId });
  assertInventory(staging, { expectedSessionId: session.releaseSessionId });
  if (production.environment !== "production" || staging.environment !== "staging") {
    throw new Error("release:diff requires Production and Staging inventories.");
  }
  const fields = [
    "app.commitSha",
    "app.imageDigest",
    "app.health",
    "app.restartCount",
    "configuration.composeHash",
    "configuration.nginxHash",
    "checks.composeConfigValid",
    "checks.nginxConfigValid",
    "database.present",
    "database.inventoryKnown",
    "database.imageDigest",
    "database.version",
    "database.migrationCount",
    "database.pgvectorVersion",
    "database.sizeBytes",
    "objectStorage.present",
    "objectStorage.inventoryKnown",
    "objectStorage.bucketNameHash",
    "objectStorage.imageDigest",
    "objectStorage.objectCount",
    "objectStorage.totalBytes",
    "objectStorage.bucketCount",
    "services.documentWorker",
    "services.embeddingWorker",
    "features.qwenSecretMount",
    "features.aiAssistantEnabled",
    "features.aiEmbeddingEnabled",
    "features.retrievalMode",
    "features.queryEmbeddingConfigured",
    "features.retrievalProfileId",
    "features.embeddingProfileId",
    "features.hybridQueryEmbeddingTimeoutMs",
    "features.hybridVectorSqlTimeoutMs",
    "features.hybridDailyQueryTokenLimit",
    "capacity.availableBytes",
    "capacity.filesystemUsagePercent",
    "capacity.inodeUsagePercent",
    "locks.deployment",
    "locks.migrationApplicable",
    "locks.migrationFile",
    "locks.migrationAdvisory",
    "locks.migration",
  ];
  const differences = fields
    .map((field) => {
      const productionValue = valueAt(production, field);
      const stagingValue = valueAt(staging, field);
      if (JSON.stringify(productionValue) === JSON.stringify(stagingValue)) return null;
      const category = differenceCategory(field, production, staging);
      if (!DIFFERENCE_CATEGORIES.includes(category)) {
        throw new Error(`Unsupported difference category for ${field}.`);
      }
      return {
        field,
        production: productionValue,
        staging: stagingValue,
        category,
        blocking: category === "blocking_unknown",
      };
    })
    .filter(Boolean);
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "production-staging-diff",
      sourceMode: formalSourceMode("live-readonly"),
      session,
    }),
    createdAt: new Date().toISOString(),
    productionInventoryDigest: production.digest,
    stagingInventoryDigest: staging.digest,
    differenceCount: differences.length,
    blockingDifferenceCount: differences.filter((item) => item.blocking).length,
    differences,
  };
  const rows = differences
    .map(
      (item) =>
        `| ${item.field} | ${JSON.stringify(item.production)} | ${JSON.stringify(item.staging)} | ${item.category} |`,
    )
    .join("\n");
  const written = await writeArtifactPair({
    outputDir: outputDirectory("diff"),
    stem: "production-staging-diff",
    payload,
    markdown: `# Production / Staging release delta

Differences: ${payload.differenceCount}; blocking unknowns: ${payload.blockingDifferenceCount}.

| Field | Production | Staging | Classification |
| --- | --- | --- | --- |
${rows}`,
  });
  if (written.blockingDifferenceCount > 0) process.exitCode = 2;
  process.stdout.write(`${written.digest}\n`);
}

async function manifestCommand() {
  const session = await releaseSession();
  const input = await readJson(requiredOption(options, "input"));
  const candidate = {
    ...input,
    schemaVersion: 1,
    createdByToolVersion: RELEASE_TOOL_VERSION,
    ...producerContract({
      reportType: "release-manifest",
      sourceMode: formalSourceMode("live-readonly"),
      session,
    }),
  };
  if (candidate.productionBaselineDigest !== session.productionBaselineDigest) {
    throw new Error("Manifest Production baseline does not match the release session.");
  }
  const manifest = withDigest(candidate);
  assertReleaseManifest(manifest);
  await writeJson(
    path.join(outputDirectory("manifest"), "release-manifest.json"),
    manifest,
  );
  process.stdout.write(`${manifest.digest}\n`);
}

function diskRequiredBytes({ targetImageBytes, databaseBackupBytes, objectBackupDeltaBytes }) {
  const tenGiB = 10 * 1024 * 1024 * 1024;
  const calculated =
    2 * targetImageBytes + databaseBackupBytes + objectBackupDeltaBytes + 5 * 1024 * 1024 * 1024;
  return Math.max(tenGiB, calculated);
}

async function preflightCommand() {
  const session = await releaseSession();
  const manifest = await readJson(requiredOption(options, "manifest"));
  const production = await readJson(requiredOption(options, "production-inventory"));
  const baseline = withDigest(
    await readJson(requiredOption(options, "production-baseline")),
  );
  const ciRunId = requiredOption(options, "ci-run-id");
  const repository =
    typeof options.repo === "string" ? options.repo : "27ruien/ProjectAI";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("--repo is invalid.");
  }
  if (!/^[1-9][0-9]{0,19}$/.test(ciRunId)) {
    throw new Error("--ci-run-id must be a positive GitHub Actions run ID.");
  }
  assertReleaseManifest(manifest);
  assertProducerContract(manifest, "release-manifest", {
    expectedSessionId: session.releaseSessionId,
  });
  assertInventory(production, { expectedSessionId: session.releaseSessionId });
  assertInventory(baseline, { requireProducer: false });
  if (production.environment !== "production" || baseline.environment !== "production") {
    throw new Error("Preflight requires Production inventories.");
  }

  const gitStatus = runFactCommand("git", ["status", "--porcelain"]);
  const localHead = requireCommandSuccess(
    runFactCommand("git", ["rev-parse", "HEAD"]),
    "git rev-parse HEAD",
  );
  const originMain = requireCommandSuccess(
    runFactCommand("git", ["rev-parse", "origin/main"]),
    "git rev-parse origin/main",
  );
  const targetSha = runFactCommand("git", [
    "cat-file",
    "-e",
    `${manifest.releaseCandidateSha}^{commit}`,
  ]);

  const ghAuth = runFactCommand("gh", ["auth", "status"]);
  let ci = null;
  const ghRun = runFactCommand("gh", [
    "run",
    "view",
    ciRunId,
    "--repo",
    repository,
    "--json",
    "status,conclusion,headSha,headBranch,event",
  ]);
  if (ghRun.status === 0) {
    try {
      ci = JSON.parse(String(ghRun.stdout));
    } catch {
      ci = null;
    }
  }

  const inspectId = runFactCommand("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    manifest.releaseImageDigest,
  ]);
  const inspectRevision = runFactCommand("docker", [
    "image",
    "inspect",
    "--format",
    "{{index .Config.Labels \"org.opencontainers.image.revision\"}}",
    manifest.releaseImageDigest,
  ]);
  const inspectEnvironment = runFactCommand("docker", [
    "image",
    "inspect",
    "--format",
    "{{index .Config.Labels \"com.projectai.release.environment\"}}",
    manifest.releaseImageDigest,
  ]);
  const inspectSize = runFactCommand("docker", [
    "image",
    "inspect",
    "--format",
    "{{.Size}}",
    manifest.releaseImageDigest,
  ]);
  const targetImageBytes =
    inspectSize.status === 0 && /^[0-9]+$/.test(String(inspectSize.stdout).trim())
      ? Number(String(inspectSize.stdout).trim())
      : 0;
  const requiredBytes = diskRequiredBytes({
    targetImageBytes,
    databaseBackupBytes: production.database.present ? production.database.sizeBytes : 0,
    objectBackupDeltaBytes: production.objectStorage.present
      ? production.objectStorage.totalBytes
      : 0,
  });
  const baselineFields = [
    "app.containerId",
    "app.imageDigest",
    "app.startedAt",
    "app.restartCount",
    "configuration.composeHash",
    "configuration.nginxHash",
    "database.present",
    "database.inventoryKnown",
    "database.imageDigest",
    "database.migrationCount",
    "objectStorage.present",
    "objectStorage.inventoryKnown",
    "objectStorage.imageDigest",
    "objectStorage.objectCount",
    "objectStorage.totalBytes",
    "objectStorage.bucketCount",
    "services.documentWorker",
    "services.embeddingWorker",
    "features.qwenSecretMount",
    "features.aiAssistantEnabled",
    "features.aiEmbeddingEnabled",
    "features.retrievalMode",
    "locks.deployment",
    "locks.migrationApplicable",
    "locks.migrationFile",
    "locks.migrationAdvisory",
    "locks.migration",
  ];
  const baselineMatches = baselineFields.every(
    (field) => JSON.stringify(valueAt(production, field)) === JSON.stringify(valueAt(baseline, field)),
  );
  const migrationAdvisoryAcceptable =
    production.locks.migrationAdvisory === "clear" ||
    production.locks.migrationAdvisory === "not-applicable";
  const capturedAtMs = Date.parse(production.capturedAt);
  const clockSkewMs = Math.abs(currentUtcMilliseconds() - capturedAtMs);
  const dataPlanePresent = production.database.present || production.objectStorage.present;
  const backupCapabilitiesReady = !dataPlanePresent || (
    (!production.database.present ||
      (production.backup.pgDumpAvailable === true &&
        production.backup.pgRestoreAvailable === true)) &&
    production.backup.directoryExists === true &&
    production.backup.directoryWritable === true &&
    Number.isSafeInteger(production.backup.availableBytes) &&
    production.backup.availableBytes >= requiredBytes &&
    (!production.objectStorage.present || production.objectStorage.inventoryKnown === true)
  );
  const gates = {
    localWorktreeClean: gitStatus.status === 0 && String(gitStatus.stdout).trim() === "",
    localHeadMatchesCandidate: localHead === manifest.releaseCandidateSha,
    localMainMatchesManifest: originMain === manifest.sourceMainSha,
    targetShaExists: targetSha.status === 0,
    githubAuthenticated: ghAuth.status === 0,
    targetCiSucceeded:
      ghAuth.status === 0 &&
      ci?.status === "completed" &&
      ci?.conclusion === "success" &&
      ci?.headSha === manifest.releaseCandidateSha &&
      ci?.headBranch === manifest.releaseCandidateBranch &&
      ci?.event === "pull_request",
    targetImageExists: inspectId.status === 0,
    targetImageDigest:
      inspectId.status === 0 && String(inspectId.stdout).trim() === manifest.releaseImageDigest,
    targetImageCommit:
      inspectRevision.status === 0 &&
      String(inspectRevision.stdout).trim() === manifest.releaseCandidateSha,
    targetImageEnvironment:
      inspectEnvironment.status === 0 &&
      String(inspectEnvironment.stdout).trim() === "production",
    productionBaselineDigest: baseline.digest === manifest.productionBaselineDigest,
    productionBaselineStable: baselineMatches,
    productionImageMatches: production.app.imageDigest === manifest.currentProductionImage,
    productionHealthy: production.app.health === "healthy",
    diskHeadroom: production.capacity.availableBytes >= requiredBytes,
    filesystemUsage: production.capacity.filesystemUsagePercent < 85,
    inodeUsage: production.capacity.inodeUsagePercent < 85,
    databaseInventoryKnown:
      production.database.inventoryKnown === true ||
      production.database.inventoryKnown === "not-applicable",
    objectInventoryKnown:
      production.objectStorage.inventoryKnown === true ||
      production.objectStorage.inventoryKnown === "not-applicable",
    backupCapabilitiesReady,
    nginxConfigValid: production.checks.nginxConfigValid === true,
    composeConfigValid: production.checks.composeConfigValid === true,
    deploymentLockClear: production.locks.deployment === false,
    migrationLockFileClear: production.locks.migrationFile === false,
    migrationAdvisoryClear: migrationAdvisoryAcceptable,
    migrationLockClear:
      production.locks.migration === false && migrationAdvisoryAcceptable,
    activeWorkClear: Object.values(production.active).every((value) => value === 0),
    serverClockReasonable: Number.isFinite(capturedAtMs) && clockSkewMs <= 5 * 60 * 1000,
  };
  const failed = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "production-preflight",
      sourceMode: formalSourceMode("live-readonly"),
      session,
    }),
    checkedAt: new Date().toISOString(),
    releaseManifestDigest: manifest.digest,
    productionInventoryDigest: production.digest,
    productionBaselineDigest: baseline.digest,
    ciRunId,
    ci: ci
      ? {
          status: ci.status,
          conclusion: ci.conclusion,
          headSha: ci.headSha,
          headBranch: ci.headBranch,
          event: ci.event,
        }
      : null,
    targetImage: {
      digest: inspectId.status === 0 ? String(inspectId.stdout).trim() : null,
      commitSha:
        inspectRevision.status === 0 ? String(inspectRevision.stdout).trim() : null,
      environment:
        inspectEnvironment.status === 0
          ? String(inspectEnvironment.stdout).trim()
          : null,
      sizeBytes: targetImageBytes || null,
    },
    clockSkewMs,
    backupApplicability: dataPlanePresent ? "required" : "not-applicable",
    requiredAvailableBytes: requiredBytes,
    gates,
    failed,
    result: failed.length === 0 ? "GO" : "NO-GO",
    manualCleanupCandidates:
      failed.includes("diskHeadroom") || failed.includes("filesystemUsage")
        ? [
            "unreferenced non-current application images after manual identity review",
            "expired build cache after confirming no active build",
            "expired rehearsal resources only",
          ]
        : [],
    protectedFromCleanup: [
      "current Production image",
      "target release image",
      "current Staging image",
      "PostgreSQL and MinIO volumes",
      "latest valid backup",
    ],
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("preflight"),
    stem: "production-preflight",
    payload,
    markdown: `# Production preflight

Result: **${payload.result}**

Failed gates: ${failed.length ? failed.join(", ") : "none"}`,
  });
  if (written.result !== "GO") process.exitCode = 2;
  process.stdout.write(`${written.digest}\n`);
}

async function guardedReportCommand(name) {
  const session = await releaseSession();
  const contract = mutationContract(name);
  if (
    contract.expectedSha !== session.releaseCandidateSha ||
    contract.expectedImage !== session.releaseImageDigest
  ) {
    throw new Error(`${name} target does not match the release session.`);
  }
  if (typeof options.input === "string" && process.env.NODE_ENV !== "test") {
    throw new Error(
      `${name} JSON input is synthetic and allowed only in NODE_ENV=test; use the rehearsal report parser for formal evidence.`,
    );
  }
  const input =
    typeof options.input === "string"
      ? await readJson(options.input)
      : { passed: false, reason: "dry-run-only" };
  assertSanitized(input);
  if (input.environment && input.environment !== contract.environment) {
    throw new Error(`${name} input environment does not match --environment.`);
  }
  if (
    input.releaseCandidateSha &&
    input.releaseCandidateSha !== contract.expectedSha
  ) {
    throw new Error(`${name} input SHA does not match --expected-sha.`);
  }
  if (
    input.releaseImageDigest &&
    input.releaseImageDigest !== contract.expectedImage
  ) {
    throw new Error(`${name} input image does not match --expected-image.`);
  }
  const requiredChecks =
    {
      rehearse: [
        "databaseRestore",
        "migration0004To0007",
        "oldAppParallel0007Database",
        "newAppDisabled0007",
        "cleanup",
      ],
      "restore-drill": [
        "backupChecksum",
        "rowCounts",
        "relationships",
        "cleanup",
      ],
      smoke: [
        "login",
        "session",
        "projectList",
        "projectAuthorization",
        "crossProject404",
        "projectMembers",
        "fileList",
        "fileDownload",
        "uploadContract",
        "documentProcessing",
        "lexicalSearch",
        "assistantDisabled",
        "assistantLexical",
        "embeddingDisabled",
        "embeddingEnabled",
        "shadow",
        "hybrid",
        "citation",
        "viewer",
        "privateThread",
        "idempotency",
        "insufficientEvidence",
        "health",
        "storageReconciliation",
      ],
    }[name] ?? [];
  const failedChecks = requiredChecks.filter(
    (check) => input.checks?.[check] !== true,
  );
  if (contract.apply && failedChecks.length > 0) {
    throw new Error(
      `${name} apply is missing passed checks: ${failedChecks.join(", ")}.`,
    );
  }
  if (contract.apply && input.passed !== true) {
    throw new Error(`${name} apply requires a passed sanitized input report.`);
  }
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType:
        name === "rehearse" ? "rehearsal" : name,
      sourceMode:
        typeof options.input === "string"
          ? "synthetic-test"
          : "rehearsal-command",
      session,
    }),
    recordedAt: new Date().toISOString(),
    ...contract,
    input,
    requiredChecks,
    failedChecks,
    result: contract.apply ? "passed" : "dry-run",
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory(name),
    stem: `release-${name}`,
    payload,
    markdown: `# Release ${name}

Environment: ${contract.environment}

Mode: ${contract.dryRun ? "dry-run" : "apply"}

Result: ${payload.result}`,
  });
  process.stdout.write(`${written.digest}\n`);
}

async function backupCommand() {
  const session = await releaseSession();
  const contract = mutationContract("backup");
  const inventory = await readJson(requiredOption(options, "inventory"));
  assertInventory(inventory, { expectedSessionId: session.releaseSessionId });
  if (inventory.environment !== contract.environment) {
    throw new Error("Backup inventory environment mismatch.");
  }
  if (inventory.app.imageDigest !== contract.expectedImage) {
    throw new Error(
      "Backup expected image does not match the inventoried application image.",
    );
  }
  if (
    inventory.app.commitSha !== null &&
    inventory.app.commitSha !== contract.expectedSha
  ) {
    throw new Error(
      "Backup expected SHA does not match the inventoried application SHA.",
    );
  }
  const dataPlanePresent = inventory.database.present || inventory.objectStorage.present;
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "release-backup-plan",
      sourceMode: formalSourceMode("live-readonly"),
      session,
    }),
    createdAt: new Date().toISOString(),
    ...contract,
    inventoryDigest: inventory.digest,
    dataPlanePresent,
    plan: {
      database: inventory.database.present ? "custom-format-logical-backup" : "not-applicable",
      objectStorage: inventory.objectStorage.present ? "immutable-inventory-and-checksum" : "not-applicable",
      configuration: "compose-nginx-and-sanitized-key-inventory",
    },
    productionWritePerformed: false,
    result: contract.dryRun ? "dry-run" : "blocked",
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("backup"),
    stem: "release-backup-plan",
    payload,
    markdown: `# Protected release backup plan

Production apply is disabled in B3-C1. Data plane present: ${dataPlanePresent}. No running service was changed.`,
  });
  process.stdout.write(`${written.digest}\n`);
}

async function rollbackCheckCommand() {
  const session = await releaseSession();
  const matrix = await readJson(requiredOption(options, "matrix"));
  const rehearsal = await readJson(requiredOption(options, "rehearsal"));
  assertSanitized(matrix);
  assertSanitized(rehearsal);
  assertProducerContract(rehearsal, "rehearsal", {
    expectedSessionId: session.releaseSessionId,
  });
  if (rehearsal.digest) {
    const expectedDigest = digestObject(
      Object.fromEntries(Object.entries(rehearsal).filter(([key]) => key !== "digest")),
    );
    if (rehearsal.digest !== expectedDigest) {
      throw new Error("Rollback rehearsal digest does not match its payload.");
    }
  }
  const compatibility = rehearsal.compatibility ?? rehearsal.input?.compatibility;
  const combinations = matrix.combinations.map((combination) => ({
    ...combination,
    passed:
      combination.required !== true ||
      compatibility?.[combination.evidenceKey] === true,
  }));
  const failed = combinations.filter((combination) => !combination.passed);
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "rollback-check",
      sourceMode: "rehearsal-command",
      session,
    }),
    checkedAt: new Date().toISOString(),
    releaseCandidateSha:
      rehearsal.expectedSha ?? rehearsal.releaseCandidateSha ?? null,
    releaseImageDigest:
      rehearsal.expectedImage ?? rehearsal.releaseImageDigest ?? null,
    rehearsalDigest: rehearsal.digest ?? null,
    combinations,
    estimatedRpo: matrix.estimatedRpo,
    estimatedRto: matrix.estimatedRto,
    result: failed.length === 0 ? "passed" : "failed",
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("rollback"),
    stem: "release-rollback-check",
    payload,
    markdown: `# Release rollback compatibility

Result: **${payload.result}**

Required combinations: ${combinations.length}; failed: ${failed.length}.`,
  });
  if (written.result !== "passed") process.exitCode = 2;
  process.stdout.write(`${written.digest}\n`);
}

async function ciEvidenceCommand() {
  const session = await releaseSession();
  const provenance = await readJson(requiredOption(options, "provenance"));
  const evidenceIndex = await readJson(requiredOption(options, "evidence-index"));
  assertEvidenceIndex(evidenceIndex, { ci: true });
  const workflowRunId = requiredOption(options, "ci-run-id");
  assertPublishedArtifactIdentity({
    artifactId: String(provenance.artifactId ?? ""),
    artifactName: provenance.artifactName,
    workflowRunId: String(provenance.workflowRunId ?? ""),
    expectedWorkflowRunId: workflowRunId,
  });
  assertDigest(provenance.artifactDigest, "artifactDigest");
  if (
    provenance.headSha !== session.releaseCandidateSha ||
    evidenceIndex.headSha !== session.releaseCandidateSha ||
    provenance.headSha !== evidenceIndex.headSha ||
    provenance.branch !== evidenceIndex.branch ||
    String(provenance.workflowRunId) !== String(evidenceIndex.workflowRunId) ||
    provenance.status !== "success" ||
    evidenceIndex.status !== "success"
  ) {
    throw new Error("CI Evidence identity does not match the release session.");
  }
  if (
    !Array.isArray(provenance.releaseReportDigests) ||
    JSON.stringify(provenance.releaseReportDigests) !==
      JSON.stringify(evidenceIndex.releaseReportDigests)
  ) {
    throw new Error("CI Artifact report digest map is missing or inconsistent.");
  }
  const requiredJsonReports = new Set([
    "release-database-rehearsal.json",
    "release-disabled-image-rehearsal.json",
    "release-smoke.json",
  ]);
  for (const entry of provenance.releaseReportDigests) {
    assertDigest(entry.sha256, `releaseReportDigests.${entry.filename}`);
    assertDigest(entry.reportDigest, `releaseReportDigests.${entry.filename}.reportDigest`);
    if (entry.filename.endsWith(".json")) {
      requiredJsonReports.delete(entry.filename);
      assertFullSha(entry.releaseCandidateSha, `${entry.filename}.releaseCandidateSha`);
      assertDigest(entry.releaseImageDigest, `${entry.filename}.releaseImageDigest`);
      if (!/^[a-z0-9-]{1,64}$/.test(entry.reportType)) {
        throw new Error("CI Artifact report type is invalid.");
      }
    }
  }
  if (requiredJsonReports.size > 0) {
    throw new Error("CI Artifact report digest map is incomplete.");
  }
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "ci-evidence",
      sourceMode: "ci-artifact",
      session,
    }),
    status: "success",
    headSha: provenance.headSha,
    headBranch: provenance.branch,
    workflowRunId: String(provenance.workflowRunId),
    artifactId: String(provenance.artifactId),
    artifactName: provenance.artifactName,
    artifactDigest: provenance.artifactDigest,
    artifactReportDigestMap: provenance.releaseReportDigests,
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("ci-evidence"),
    stem: "release-ci-evidence",
    payload,
    markdown: "# CI release evidence identity\n\nArtifact and report digests are bound to the exact workflow run.",
  });
  process.stdout.write(`${written.digest}\n`);
}

async function goNoGoCommand() {
  const session = await releaseSession();
  if (typeof options.checklist === "string") {
    throw new Error(
      "Checklist-only Go/No-Go input is synthetic and cannot establish release readiness.",
    );
  }
  const inputOptions = {
    manifest: "manifest",
    productionBaseline: "production-baseline",
    productionInventory: "production-inventory",
    stagingInventory: "staging-inventory",
    diff: "diff",
    preflight: "preflight",
    rehearsal: "rehearsal",
    restoreDrill: "restore-drill",
    smoke: "smoke",
    rollbackCheck: "rollback-check",
    disabledImage: "disabled-image",
    oldApp: "old-app",
    backup: "backup",
    ciEvidence: "ci-evidence",
    ciDatabaseRehearsal: "ci-database-rehearsal",
    ciDisabledImage: "ci-disabled-image",
    ciSmoke: "ci-smoke",
  };
  const reportTypes = {
    manifest: "release-manifest",
    productionInventory: "production-inventory",
    stagingInventory: "staging-inventory",
    diff: "production-staging-diff",
    preflight: "production-preflight",
    rehearsal: "rehearsal",
    restoreDrill: "restore-drill",
    smoke: "smoke",
    rollbackCheck: "rollback-check",
    disabledImage: "disabled-image",
    oldApp: "old-app-compatibility",
    backup: "release-backup-plan",
    ciEvidence: "ci-evidence",
    ciDatabaseRehearsal: "database-rehearsal",
    ciDisabledImage: "disabled-image",
    ciSmoke: "smoke",
  };
  const reports = {};
  for (const [name, option] of Object.entries(inputOptions)) {
    reports[name] = await readJson(requiredOption(options, option));
    if (name === "productionBaseline") {
      reports[name] = withDigest(reports[name]);
    }
    assertSanitized(reports[name]);
    if (name === "manifest") {
      assertReleaseManifest(reports[name]);
      assertProducerContract(reports[name], reportTypes[name], {
        allowSynthetic: process.env.NODE_ENV === "test",
      });
    }
    else if (
      name === "productionInventory" ||
      name === "stagingInventory"
    ) {
      assertInventory(reports[name]);
    } else if (name === "productionBaseline") {
      assertInventory(reports[name], { requireProducer: false });
    } else {
      if (typeof reports[name].digest !== "string") {
        throw new Error(`${option} report is missing its digest.`);
      }
      const expected = digestObject(
        Object.fromEntries(
          Object.entries(reports[name]).filter(([key]) => key !== "digest"),
        ),
      );
      if (reports[name].digest !== expected) {
        throw new Error(`${option} report digest does not match its payload.`);
      }
      assertProducerContract(reports[name], reportTypes[name], {
        allowSynthetic: process.env.NODE_ENV === "test",
      });
    }
  }
  const manifest = reports.manifest;
  const baseline = withDigest(reports.productionBaseline);
  const production = reports.productionInventory;
  const staging = reports.stagingInventory;
  const sha = manifest.releaseCandidateSha;
  const image = manifest.releaseImageDigest;
  const hasUnknown = (value) => {
    if (Array.isArray(value)) return value.some(hasUnknown);
    if (value && typeof value === "object") return Object.values(value).some(hasUnknown);
    return value === "unknown";
  };
  const reportSha = (report) =>
    report.releaseCandidateSha ?? report.expectedSha ?? report.input?.releaseCandidateSha;
  const reportImage = (report) =>
    report.releaseImageDigest ?? report.expectedImage ?? report.input?.releaseImageDigest;
  const dataPlanePresent = production.database.present || production.objectStorage.present;
  const liveReportNames = [
    "manifest",
    "productionInventory",
    "stagingInventory",
    "diff",
    "preflight",
    "rehearsal",
    "restoreDrill",
    "smoke",
    "rollbackCheck",
    "disabledImage",
    "oldApp",
    "backup",
    "ciEvidence",
  ];
  const liveSessionsMatch = liveReportNames.every(
    (name) => reports[name].releaseSessionId === session.releaseSessionId,
  );
  const noSyntheticReports =
    process.env.NODE_ENV === "test" ||
    Object.values(reports).every(
      (report) => report.sourceMode !== "synthetic-test",
    );
  const artifactMap = reports.ciEvidence.artifactReportDigestMap;
  const ciReportBound = (filename, report) => {
    if (!Array.isArray(artifactMap)) return false;
    const entry = artifactMap.find((candidate) => candidate.filename === filename);
    return Boolean(
      entry &&
      entry.reportDigest === report.digest &&
      entry.reportType === report.reportType &&
      entry.releaseCandidateSha === report.releaseCandidateSha &&
      entry.releaseImageDigest === report.releaseImageDigest,
    );
  };
  const backupBound =
    reports.backup.inventoryDigest === production.digest &&
    reports.backup.dataPlanePresent === dataPlanePresent &&
    (dataPlanePresent
      ? reports.backup.result === "passed" &&
        manifest.backupIds.length > 0 &&
        manifest.backupDigests.length > 0 &&
        reports.backup.backupIds?.length > 0 &&
        JSON.stringify(reports.backup.backupIds) === JSON.stringify(manifest.backupIds) &&
        JSON.stringify(reports.backup.backupDigests) === JSON.stringify(manifest.backupDigests)
      : reports.backup.plan?.database === "not-applicable" &&
        reports.backup.plan?.objectStorage === "not-applicable" &&
        manifest.backupIds.length === 0 &&
        manifest.backupDigests.length === 0);
  const gates = {
    productionEnvironment: production.environment === "production",
    stagingEnvironment: staging.environment === "staging",
    productionBaselineBound:
      baseline.environment === "production" &&
      manifest.productionBaselineDigest === baseline.digest,
    currentProductionImageBound:
      manifest.currentProductionImage === production.app.imageDigest,
    diffBound:
      reports.diff.productionInventoryDigest === production.digest &&
      reports.diff.stagingInventoryDigest === staging.digest &&
      reports.diff.blockingDifferenceCount === 0,
    preflightPassed:
      reports.preflight.result === "GO" &&
      reports.preflight.releaseManifestDigest === manifest.digest &&
      reports.preflight.productionInventoryDigest === production.digest &&
      reports.preflight.productionBaselineDigest === baseline.digest &&
      reports.preflight.gates?.productionBaselineStable === true,
    ciEvidenceBound:
      reports.ciEvidence.status === "success" &&
      reports.ciEvidence.headSha === sha &&
      String(reports.ciEvidence.workflowRunId) === String(reports.preflight.ciRunId) &&
      reports.ciEvidence.artifactDigest === manifest.evidenceDigest &&
      reports.ciEvidence.artifactName ===
        `product-review-evidence-${reports.ciEvidence.workflowRunId}-1`,
    ciArtifactReportsBound:
      ciReportBound(
        "release-database-rehearsal.json",
        reports.ciDatabaseRehearsal,
      ) &&
      ciReportBound(
        "release-disabled-image-rehearsal.json",
        reports.ciDisabledImage,
      ) &&
      ciReportBound("release-smoke.json", reports.ciSmoke) &&
      reports.ciDatabaseRehearsal.sourceMode === "ci-artifact" &&
      reports.ciDisabledImage.sourceMode === "ci-artifact" &&
      reports.ciSmoke.sourceMode === "ci-artifact",
    liveReleaseSessionBound: liveSessionsMatch,
    noSyntheticReports,
    rehearsalPassed:
      reports.rehearsal.result === "passed" &&
      reportSha(reports.rehearsal) === sha &&
      reportImage(reports.rehearsal) === image &&
      (reports.rehearsal.checks?.migration0004To0007 === true ||
        reports.rehearsal.input?.checks?.migration0004To0007 === true),
    restoreDrillPassed:
      reports.restoreDrill.result === "passed" &&
      reportSha(reports.restoreDrill) === sha &&
      reportImage(reports.restoreDrill) === image &&
      (reports.restoreDrill.checks?.backupChecksum === true ||
        reports.restoreDrill.input?.checks?.backupChecksum === true),
    smokePassed:
      reports.smoke.result === "passed" &&
      reportSha(reports.smoke) === sha &&
      reportImage(reports.smoke) === image,
    rollbackPassed:
      reports.rollbackCheck.result === "passed" &&
      reports.rollbackCheck.rehearsalDigest === reports.rehearsal.digest &&
      reportSha(reports.rollbackCheck) === sha &&
      reportImage(reports.rollbackCheck) === image,
    disabledImagePassed:
      reports.disabledImage.passed === true &&
      reportSha(reports.disabledImage) === sha &&
      reportImage(reports.disabledImage) === image,
    oldAppScopePassed:
      reports.oldApp.passed === true &&
      reportSha(reports.oldApp) === sha &&
      reports.oldApp.rollbackImageDigest === manifest.rollbackImage &&
      reports.oldApp.oldAppOperationalWithParallel0007Database === true &&
      reports.oldApp.oldAppDatabaseDependency === "absent" &&
      reports.oldApp.oldAppDatabaseConnectionObserved === false &&
      reports.oldApp.schemaForwardRollbackScope === "legacy-application-shell" &&
      reports.oldApp.newDataPlaneFeaturesAvailableAfterRollback === false,
    backupApplicabilityBound: backupBound,
    productionApplyHardBlocked: reports.backup.productionWritePerformed === false,
    noUnknown: !Object.values(reports).some(hasUnknown),
  };
  const failed = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "go-no-go",
      sourceMode: "live-readonly",
      session,
    }),
    evaluatedAt: new Date().toISOString(),
    releaseCandidateSha: sha,
    releaseImageDigest: image,
    inputs: Object.fromEntries(
      Object.entries(reports).map(([name, report]) => [name, report.digest]),
    ),
    gates,
    failed,
    backupApplicability: dataPlanePresent ? "required" : "not-applicable",
    machineReadiness: failed.length === 0 ? "GO" : "NO-GO",
    independentReview: "pending",
    productionRolloutAuthorized: false,
    result: failed.length === 0 ? "GO" : "NO-GO",
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("go-no-go"),
    stem: "release-go-no-go",
    payload,
    markdown: `# Production Go / No-Go

Machine readiness: **${payload.machineReadiness}**

Independent review: **${payload.independentReview}**

Production rollout authorized: **${payload.productionRolloutAuthorized}**

Failed required gates: ${payload.failed.length ? payload.failed.join(", ") : "none"}.`,
  });
  if (written.machineReadiness !== "GO") process.exitCode = 2;
  process.stdout.write(`${written.digest}\n`);
}

async function statusCommand() {
  const session = await releaseSession();
  const files = String(requiredOption(options, "inputs"))
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
  const reports = await Promise.all(files.map(readJson));
  reports.forEach(assertSanitized);
  const payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "release-status",
      sourceMode: "live-readonly",
      session,
    }),
    recordedAt: new Date().toISOString(),
    reports: reports.map((report, index) => ({
      file: path.basename(files[index]),
      digest: report.digest ?? null,
      result: report.result ?? report.status ?? null,
    })),
  };
  const finalized = withDigest(payload);
  await writeJson(path.join(outputDirectory("status"), "release-status.json"), finalized);
  process.stdout.write(`${finalized.digest}\n`);
}

const commands = {
  session: sessionCommand,
  inventory: inventoryCommand,
  diff: diffCommand,
  manifest: manifestCommand,
  preflight: preflightCommand,
  backup: backupCommand,
  rehearse: () => guardedReportCommand("rehearse"),
  "restore-drill": () => guardedReportCommand("restore-drill"),
  smoke: () => guardedReportCommand("smoke"),
  "rollback-check": rollbackCheckCommand,
  "ci-evidence": ciEvidenceCommand,
  "go-no-go": goNoGoCommand,
  status: statusCommand,
};

if (!commands[command]) {
  process.stderr.write(`Unknown release command: ${command || "missing"}.\n`);
  process.exit(64);
}

commands[command]().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Release command failed."}\n`);
  process.exitCode = error?.code === "PRODUCTION_APPLY_NOT_AUTHORIZED" ? 78 : 1;
});
