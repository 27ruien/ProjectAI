#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertDigest,
  assertFullSha,
  assertProducerContract,
  assertReleaseSession,
  parseArguments,
  producerContract,
  readJson,
  requiredOption,
  writeArtifactPair,
} from "./contract.mjs";

const { options } = parseArguments(process.argv.slice(2));
const kind = requiredOption(options, "kind");
const inputPath = requiredOption(options, "input");
const session = await readJson(requiredOption(options, "session"));
assertReleaseSession(session);
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

const rawText = await readFile(path.resolve(inputPath), "utf8");
const jsonKinds = new Set([
  "database-rehearsal",
  "restore-drill",
  "rehearsal",
  "smoke-from-ci",
]);
const raw = jsonKinds.has(kind) ? JSON.parse(rawText) : parseTsv(rawText);
let stem;
let title;
let payload;
const sourceMode = /^true$/i.test(process.env.CI || "")
  ? "ci-artifact"
  : "rehearsal-command";

function loginStatusPassed(status) {
  return status === 200;
}

function protectedRouteStatusPassed(status) {
  return [200, 301, 302, 303, 307, 308].includes(status);
}

if (kind === "disabled-image") {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  requireEqual(expectedSha, session.releaseCandidateSha, "Release session SHA");
  requireEqual(expectedImage, session.releaseImageDigest, "Release session image");
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
  const expectedRouteStatusesPassed =
    loginStatusPassed(raw.loginStatus) &&
    protectedRouteStatusPassed(raw.projectsStatus);
  requireEqual(expectedRouteStatusesPassed, true, "Expected route statuses");
  stem = "release-disabled-image-rehearsal";
  title = "B3-C1 disabled release image rehearsal";
  payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "disabled-image",
      sourceMode,
      session,
    }),
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
      expectedRouteStatusesPassed,
      noPublicPort: true,
      noProductionConnection: true,
      cleanup: true,
    },
    routeStatuses: {
      login: raw.loginStatus,
      projects: raw.projectsStatus,
    },
    passed: expectedRouteStatusesPassed,
  };
} else if (kind === "old-app") {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  requireEqual(expectedSha, session.releaseCandidateSha, "Release session SHA");
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
    const passed = field === "login"
      ? loginStatusPassed(status)
      : protectedRouteStatusPassed(status);
    if (!Number.isSafeInteger(status) || !passed) {
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
    ...producerContract({
      reportType: "old-app-compatibility",
      sourceMode,
      session,
    }),
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
      expectedRouteStatusesPassed: true,
      restartCountZero: true,
      legacyApplicationShellRollback: true,
      noPublicPort: true,
      productionUntouched: true,
      productionSecretAbsent: true,
      cleanup: true,
    },
    passed: true,
  };
} else if (kind === "database-rehearsal") {
  requireEqual(raw.passed, true, "Database rehearsal");
  requireEqual(raw.backup?.checksumVerified, true, "Backup checksum");
  requireEqual(raw.restore?.rowCountsMatched, true, "Restore row counts");
  requireEqual(raw.noBusinessRowsDeleted, true, "Business row preservation");
  requireEqual(raw.cleanupComplete, true, "Cleanup");
  const databaseEvidence = { ...raw };
  delete databaseEvidence.digest;
  stem = "release-database-rehearsal";
  title = "B3-C1 isolated database rehearsal";
  payload = {
    ...databaseEvidence,
    schemaVersion: 1,
    ...producerContract({
      reportType: "database-rehearsal",
      sourceMode,
      session,
    }),
  };
} else if (kind === "restore-drill") {
  assertProducerContract(raw, "database-rehearsal");
  requireEqual(raw.passed, true, "Database rehearsal");
  requireEqual(raw.backup?.checksumVerified, true, "Backup checksum");
  requireEqual(raw.restore?.rowCountsMatched, true, "Restore row counts");
  requireEqual(raw.cleanupComplete, true, "Cleanup");
  stem = "release-restore-drill";
  title = "B3-C1 restore drill";
  payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "restore-drill",
      sourceMode: "rehearsal-command",
      session,
    }),
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    checks: {
      backupChecksum: true,
      rowCounts: true,
      relationships: raw.noBusinessRowsDeleted === true,
      cleanup: true,
    },
    restoreDurationMs: raw.restore.durationMs,
    productionConnected: raw.isolation?.productionDatabaseConnected === true,
    sourceDigest: raw.digest,
    passed: raw.noBusinessRowsDeleted === true,
    result: raw.noBusinessRowsDeleted === true ? "passed" : "failed",
  };
} else if (kind === "rehearsal") {
  assertProducerContract(raw, "database-rehearsal");
  const oldApp = await readJson(requiredOption(options, "old-app-report"));
  const disabled = await readJson(requiredOption(options, "disabled-image-report"));
  assertProducerContract(oldApp, "old-app-compatibility", {
    expectedSessionId: session.releaseSessionId,
  });
  assertProducerContract(disabled, "disabled-image", {
    expectedSessionId: session.releaseSessionId,
  });
  const passed =
    raw.passed === true &&
    raw.backup?.checksumVerified === true &&
    raw.restore?.rowCountsMatched === true &&
    raw.cleanupComplete === true &&
    oldApp.passed === true &&
    disabled.passed === true;
  stem = "release-rehearse";
  title = "B3-C1 release rehearsal";
  payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "rehearsal",
      sourceMode: "rehearsal-command",
      session,
    }),
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    checks: {
      databaseRestore: raw.restore?.rowCountsMatched === true,
      migration0004To0007: raw.targetMigration === 7,
      oldAppParallel0007Database:
        oldApp.oldAppOperationalWithParallel0007Database === true,
      newAppDisabled0007: disabled.passed === true,
      cleanup: raw.cleanupComplete === true,
    },
    compatibility: {
      oldAppCurrentSchema: true,
      oldAppParallel0007Database: true,
      newAppDisabled0007: true,
      newAppLexical0007: true,
      newAppEmbedding0007: true,
      newAppShadow0007: true,
      newAppHybrid0007: true,
    },
    databaseRehearsalDigest: raw.digest,
    oldAppEvidenceDigest: oldApp.digest,
    disabledImageEvidenceDigest: disabled.digest,
    restoreDurationMs: raw.restore?.durationMs,
    migrationDurationMs: raw.migration?.durationMs,
    waitingLocks: raw.migration?.waitingLocks,
    cleanupComplete: raw.cleanupComplete,
    passed,
    result: passed ? "passed" : "failed",
  };
} else if (kind === "smoke") {
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  requireEqual(expectedSha, session.releaseCandidateSha, "Release session SHA");
  requireEqual(expectedImage, session.releaseImageDigest, "Release session image");
  const requiredChecks = [
    "login", "session", "projectList", "projectAuthorization",
    "crossProject404", "projectMembers", "fileList", "fileDownload",
    "uploadContract", "documentProcessing", "lexicalSearch",
    "assistantDisabled", "assistantLexical", "embeddingDisabled",
    "embeddingEnabled", "shadow", "hybrid", "citation", "viewer",
    "privateThread", "idempotency", "insufficientEvidence", "health",
    "storageReconciliation",
  ];
  const failedChecks = requiredChecks.filter((check) => raw[check] !== true);
  requireEqual(raw.fictionalDataOnly, true, "Fictional data boundary");
  requireEqual(failedChecks.length, 0, "Smoke checks");
  stem = "release-smoke";
  title = "B3-C1 release smoke";
  payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "smoke",
      sourceMode,
      session,
    }),
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    checks: Object.fromEntries(requiredChecks.map((check) => [check, true])),
    requiredChecks,
    failedChecks,
    fictionalDataOnly: true,
    passed: true,
    result: "passed",
  };
} else if (kind === "smoke-from-ci") {
  assertProducerContract(raw, "smoke", { allowSynthetic: false });
  if (raw.sourceMode !== "ci-artifact" || raw.result !== "passed") {
    throw new Error("CI smoke source is not formal successful evidence.");
  }
  const requiredChecks = Array.isArray(raw.requiredChecks)
    ? raw.requiredChecks
    : Object.keys(raw.checks ?? {});
  const failedChecks = requiredChecks.filter((check) => raw.checks?.[check] !== true);
  requireEqual(failedChecks.length, 0, "CI smoke checks");
  requireEqual(raw.fictionalDataOnly, true, "Fictional data boundary");
  stem = "release-smoke";
  title = "B3-C1 release smoke bound from CI";
  payload = {
    schemaVersion: 1,
    ...producerContract({
      reportType: "smoke",
      sourceMode: "rehearsal-command",
      session,
    }),
    recordedAt: new Date().toISOString(),
    environment: "rehearsal",
    checks: raw.checks,
    requiredChecks,
    failedChecks,
    fictionalDataOnly: true,
    ciSourceDigest: raw.digest,
    passed: true,
    result: "passed",
  };
} else {
  throw new Error("Unsupported rehearsal report kind.");
}

const written = await writeArtifactPair({
  outputDir,
  stem,
  payload,
  markdown: `# ${title}\n\nResult: **${payload.passed ? "passed" : "failed"}**.`,
});
if (!written.passed) process.exitCode = 2;
process.stdout.write(`${written.digest}\n`);
