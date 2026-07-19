#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertDigest,
  assertFullSha,
  parseArguments,
  requiredOption,
  writeArtifactPair,
} from "./contract.mjs";

const { options } = parseArguments(process.argv.slice(2));
const kind = requiredOption(options, "kind");
const inputPath = requiredOption(options, "input");
const outputDir = path.resolve(
  typeof options["output-dir"] === "string"
    ? options["output-dir"]
    : "review-artifacts",
);

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^(?:0|[1-9][0-9]{0,14})$/.test(value)) return Number(value);
  return value;
}

function parseTsv(input) {
  const result = {};
  for (const line of input.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf("\t");
    if (separator < 1) throw new Error("Rehearsal output contains an invalid record.");
    const key = line.slice(0, separator);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || Object.hasOwn(result, key)) {
      throw new Error("Rehearsal output contains an unsafe or duplicate key.");
    }
    result[key] = parseValue(line.slice(separator + 1));
  }
  return result;
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} did not satisfy the release rehearsal contract.`);
  }
}

const raw = parseTsv(await readFile(path.resolve(inputPath), "utf8"));
let stem;
let title;
let payload;

if (kind === "disabled-image") {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  assertDigest(raw.dbToolsImageDigest, "dbToolsImageDigest");
  requireEqual(raw.appImageDigest, expectedImage, "Application image digest");
  requireEqual(raw.expectedSha, expectedSha, "Application commit SHA");
  requireEqual(raw.health, "healthy", "Application health");
  requireEqual(raw.assistantEnabled, false, "Assistant disabled state");
  requireEqual(raw.embeddingEnabled, false, "Embedding disabled state");
  requireEqual(raw.retrievalMode, "lexical", "Retrieval mode");
  requireEqual(raw.qwenSecretMount, false, "Qwen Secret mount");
  requireEqual(raw.activeEmbeddingJobs, 0, "Active Embedding jobs");
  requireEqual(raw.activeQueryEmbeddingCalls, 0, "Active Query Embedding calls");
  requireEqual(raw.activeAiExecutions, 0, "Active AI executions");
  requireEqual(raw.publicPortPublished, false, "Public port publication");
  requireEqual(raw.productionConnected, false, "Production connectivity");
  requireEqual(raw.cleanupComplete, true, "Cleanup");
  requireEqual(raw.passed, true, "Disabled-image rehearsal");
  stem = "release-disabled-image-rehearsal";
  title = "B3-C1 disabled release image rehearsal";
  payload = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    releaseCandidateSha: expectedSha,
    releaseImageDigest: expectedImage,
    databaseToolsImageDigest: raw.dbToolsImageDigest,
    checks: {
      health: true,
      assistantDisabled: true,
      embeddingDisabled: true,
      lexicalMode: true,
      qwenSecretAbsent: true,
      noActiveAiWork: true,
      coreRoutesBelow500: raw.loginStatus < 500 && raw.projectsStatus < 500,
      noPublicPort: true,
      noProductionConnection: true,
      cleanup: true,
    },
    routeStatuses: {
      login: raw.loginStatus,
      projects: raw.projectsStatus,
    },
    passed: raw.loginStatus < 500 && raw.projectsStatus < 500,
  };
} else if (kind === "old-app") {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  assertDigest(raw.dbToolsImageDigest, "dbToolsImageDigest");
  requireEqual(raw.productionImageDigest, expectedImage, "Production image digest");
  requireEqual(raw.targetMigration, 7, "Target migration");
  requireEqual(raw.migrationCount, 8, "Migration count");
  requireEqual(raw.pgvectorVersion, "0.8.1", "pgvector version");
  for (const [field, status] of [
    ["login", raw.oldAppLoginStatus],
    ["dashboard", raw.oldAppDashboardStatus],
    ["projects", raw.oldAppProjectsStatus],
  ]) {
    if (!Number.isSafeInteger(status) || status < 200 || status >= 500) {
      throw new Error(`Old application ${field} route did not satisfy the release rehearsal contract.`);
    }
  }
  requireEqual(raw.oldAppRestartCount, 0, "Old application restart count");
  requireEqual(raw.databaseUrlSuppliedToOldApp, true, "Database URL supply");
  requireEqual(raw.oldAppOperationalWithParallel0007Database, true, "Parallel 0007 operation");
  requireEqual(raw.oldAppDatabaseDependency, "absent", "Old application database dependency");
  requireEqual(raw.oldAppDatabaseConnectionObserved, false, "Old application database connection");
  requireEqual(raw.schemaForwardRollbackScope, "legacy-application-shell", "Schema-forward rollback scope");
  requireEqual(raw.newDataPlaneFeaturesAvailableAfterRollback, false, "Rolled-back data-plane features");
  requireEqual(raw.publicPortPublished, false, "Public port publication");
  requireEqual(raw.productionContainerTouched, false, "Production container isolation");
  requireEqual(raw.productionNetworkJoined, false, "Production network isolation");
  requireEqual(raw.productionSecretMounted, false, "Production Secret isolation");
  requireEqual(raw.cleanupComplete, true, "Cleanup");
  requireEqual(raw.passed, true, "Old application compatibility rehearsal");
  stem = "release-old-app-compatibility";
  title = "B3-C1 old Production image with a parallel 0007 database";
  payload = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    releaseCandidateSha: expectedSha,
    rollbackImageDigest: expectedImage,
    databaseToolsImageDigest: raw.dbToolsImageDigest,
    targetMigration: 7,
    migrationCount: 8,
    pgvectorVersion: "0.8.1",
    oldAppOperationalWithParallel0007Database: true,
    oldAppDatabaseDependency: raw.oldAppDatabaseDependency,
    oldAppDatabaseConnectionObserved: false,
    schemaForwardRollbackScope: raw.schemaForwardRollbackScope,
    newDataPlaneFeaturesAvailableAfterRollback: false,
    databaseUrlSupplied: true,
    routeStatuses: {
      login: raw.oldAppLoginStatus,
      dashboard: raw.oldAppDashboardStatus,
      projects: raw.oldAppProjectsStatus,
    },
    checks: {
      corePublicRoutesBelow500: true,
      restartCountZero: true,
      legacyApplicationShellRollback: true,
      noPublicPort: true,
      productionUntouched: true,
      productionSecretAbsent: true,
      cleanup: true,
    },
    passed: true,
  };
} else {
  throw new Error("--kind must be disabled-image or old-app.");
}

const written = await writeArtifactPair({
  outputDir,
  stem,
  payload,
  markdown: `# ${title}\n\nResult: **${payload.passed ? "passed" : "failed"}**.`,
});
if (!written.passed) process.exitCode = 2;
process.stdout.write(`${written.digest}\n`);
