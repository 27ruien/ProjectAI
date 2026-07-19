#!/usr/bin/env node

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
  assertReleaseManifest,
  assertSanitized,
  numberOrNull,
  parseArguments,
  readJson,
  requiredOption,
  withDigest,
  writeArtifactPair,
  writeJson,
} from "./contract.mjs";

const command = process.argv[2];
const { options } = parseArguments(process.argv.slice(3));
const defaultOutputRoot = path.resolve("release-artifacts");

function outputDirectory(suffix) {
  return path.resolve(
    typeof options["output-dir"] === "string"
      ? options["output-dir"]
      : path.join(defaultOutputRoot, suffix),
  );
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
    "locks.migration",
  ]);
  let normalized = value;
  if (value === "null") normalized = null;
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

async function inventoryCommand() {
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
    const result = spawnSync(
      "ssh",
      ["-o", "BatchMode=yes", remoteHost, "bash", "-s", "--", environment],
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
- Assistant / Embedding / Retrieval: ${finalized.features.aiAssistantEnabled} / ${finalized.features.aiEmbeddingEnabled} / ${finalized.features.retrievalMode}
- Root available bytes: ${finalized.capacity.availableBytes}
- Root / inode usage: ${finalized.capacity.filesystemUsagePercent}% / ${finalized.capacity.inodeUsagePercent}%
- Deployment lock: ${finalized.locks.deployment}`;
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
  const production = await readJson(requiredOption(options, "production-inventory"));
  const staging = await readJson(requiredOption(options, "staging-inventory"));
  assertInventory(production);
  assertInventory(staging);
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
    "database.imageDigest",
    "database.version",
    "database.migrationCount",
    "database.pgvectorVersion",
    "database.sizeBytes",
    "objectStorage.present",
    "objectStorage.imageDigest",
    "objectStorage.objectCount",
    "objectStorage.totalBytes",
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
  const input = await readJson(requiredOption(options, "input"));
  const candidate = {
    ...input,
    schemaVersion: 1,
    createdByToolVersion: RELEASE_TOOL_VERSION,
  };
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
  const manifest = await readJson(requiredOption(options, "manifest"));
  const production = await readJson(requiredOption(options, "production-inventory"));
  const checks = await readJson(requiredOption(options, "checks"));
  assertReleaseManifest(manifest);
  assertInventory(production);
  const requiredBytes = diskRequiredBytes({
    targetImageBytes: Number(checks.targetImageBytes ?? 0),
    databaseBackupBytes: Number(checks.databaseBackupBytes ?? 0),
    objectBackupDeltaBytes: Number(checks.objectBackupDeltaBytes ?? 0),
  });
  const expected = checks.expectedProduction ?? {};
  const explicitNotApplicable = (value) => value === "not-applicable";
  const gates = {
    localWorktreeClean: checks.localWorktreeClean === true,
    localMainMatchesOrigin: checks.localMainMatchesOrigin === true,
    targetShaExists:
      checks.targetShaExists === true &&
      checks.targetSha === manifest.releaseCandidateSha,
    targetCiSucceeded: checks.targetCiSucceeded === true,
    targetImageExists:
      checks.targetImageExists === true &&
      checks.targetImageDigest === manifest.releaseImageDigest,
    productionContainerMatches: production.app.containerId === expected.containerId,
    productionImageMatches:
      production.app.imageDigest === manifest.currentProductionImage &&
      production.app.imageDigest === expected.imageDigest,
    productionStartedAtMatches: production.app.startedAt === expected.startedAt,
    productionHealthy: production.app.health === "healthy",
    restartCountStable: production.app.restartCount === expected.restartCount,
    composeHashMatches: production.configuration.composeHash === expected.composeHash,
    nginxHashMatches: production.configuration.nginxHash === expected.nginxHash,
    migrationMatches: production.database.migrationCount === expected.migrationCount,
    postgresImageMatches: production.database.imageDigest === expected.postgresImageDigest,
    minioImageMatches: production.objectStorage.imageDigest === expected.minioImageDigest,
    documentWorkerMatches:
      production.services.documentWorker === expected.documentWorker,
    embeddingWorkerMatches:
      production.services.embeddingWorker === expected.embeddingWorker,
    secretMountMatches:
      production.features.qwenSecretMount === expected.qwenSecretMount,
    assistantFlagMatches:
      production.features.aiAssistantEnabled === expected.aiAssistantEnabled,
    embeddingFlagMatches:
      production.features.aiEmbeddingEnabled === expected.aiEmbeddingEnabled,
    retrievalModeMatches:
      production.features.retrievalMode === expected.retrievalMode,
    diskHeadroom: production.capacity.availableBytes >= requiredBytes,
    filesystemUsage: production.capacity.filesystemUsagePercent < 85,
    inodeUsage: production.capacity.inodeUsagePercent < 85,
    databaseConnection: production.database.present
      ? checks.databaseConnection === true
      : explicitNotApplicable(checks.databaseConnection),
    migrationStateKnown: checks.migrationStateKnown === true,
    backupToolAvailable:
      checks.backupToolAvailable === true ||
      (!production.database.present &&
        !production.objectStorage.present &&
        explicitNotApplicable(checks.backupToolAvailable)),
    backupDirectoryReady:
      checks.backupDirectoryReady === true ||
      (!production.database.present &&
        !production.objectStorage.present &&
        explicitNotApplicable(checks.backupDirectoryReady)),
    backupSpaceReady:
      checks.backupSpaceReady === true ||
      (!production.database.present &&
        !production.objectStorage.present &&
        explicitNotApplicable(checks.backupSpaceReady)),
    objectInventoryReadable: production.objectStorage.present
      ? checks.objectInventoryReadable === true
      : explicitNotApplicable(checks.objectInventoryReadable),
    nginxConfigValid: production.checks.nginxConfigValid === true,
    composeConfigValid: production.checks.composeConfigValid === true,
    deploymentLockClear: production.locks.deployment === false,
    migrationLockClear: production.locks.migration === false,
    activeWorkClear: Object.values(production.active).every((value) => value === 0),
    serverClockReasonable: checks.serverClockReasonable === true,
    manifestMatchesServer: checks.manifestMatchesServer === true,
  };
  const failed = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const payload = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    releaseManifestDigest: manifest.digest,
    productionInventoryDigest: production.digest,
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
  const contract = mutationContract(name);
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
        "oldApp0007Schema",
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
  const contract = mutationContract("backup");
  const inventory = await readJson(requiredOption(options, "inventory"));
  assertInventory(inventory);
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
  const matrix = await readJson(requiredOption(options, "matrix"));
  const rehearsal = await readJson(requiredOption(options, "rehearsal"));
  assertSanitized(matrix);
  assertSanitized(rehearsal);
  const combinations = matrix.combinations.map((combination) => ({
    ...combination,
    passed:
      combination.required !== true ||
      rehearsal.compatibility?.[combination.evidenceKey] === true,
  }));
  const failed = combinations.filter((combination) => !combination.passed);
  const payload = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
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

async function goNoGoCommand() {
  const checklist = await readJson(requiredOption(options, "checklist"));
  assertSanitized(checklist);
  const failed = checklist.items.filter(
    (item) => item.required === true && item.passed !== true,
  );
  const payload = {
    schemaVersion: 1,
    evaluatedAt: new Date().toISOString(),
    items: checklist.items,
    failed: failed.map((item) => item.id),
    result: failed.length === 0 ? "GO" : "NO-GO",
  };
  const written = await writeArtifactPair({
    outputDir: outputDirectory("go-no-go"),
    stem: "release-go-no-go",
    payload,
    markdown: `# Production Go / No-Go

Result: **${payload.result}**

Failed required gates: ${payload.failed.length ? payload.failed.join(", ") : "none"}.`,
  });
  if (written.result !== "GO") process.exitCode = 2;
  process.stdout.write(`${written.digest}\n`);
}

async function statusCommand() {
  const files = String(requiredOption(options, "inputs"))
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
  const reports = await Promise.all(files.map(readJson));
  reports.forEach(assertSanitized);
  const payload = {
    schemaVersion: 1,
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
  inventory: inventoryCommand,
  diff: diffCommand,
  manifest: manifestCommand,
  preflight: preflightCommand,
  backup: backupCommand,
  rehearse: () => guardedReportCommand("rehearse"),
  "restore-drill": () => guardedReportCommand("restore-drill"),
  smoke: () => guardedReportCommand("smoke"),
  "rollback-check": rollbackCheckCommand,
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
