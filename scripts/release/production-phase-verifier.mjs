#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  assertProductionEgressMembership,
  productionEgressExpectation,
  PRODUCTION_PHASE_VERIFIER,
  PRODUCTION_ROLLOUT_VERSION,
} from "./production-rollout-contract.mjs";
import {
  assertDigest,
  assertFullSha,
  assertReleaseSessionId,
  parseArguments,
  withDigest,
} from "./contract.mjs";

const { options } = parseArguments(process.argv.slice(2));

function required(name) {
  const value = options[name];
  if (typeof value !== "string" || !value) throw new Error(`--${name} is required.`);
  return value;
}

const phase = Number(required("phase"));
const mutationStartedAt = required("mutation-started-at");
const observationStartedAt = required("observation-started-at");
const direction = required("direction");
const releaseSessionId = required("release-session-id");
const releaseCandidateSha = required("release-candidate-sha");
const releaseImageDigest = required("release-image-digest");
const databaseToolsImageDigest = required("database-tools-image-digest");
const releaseManifestDigest = required("release-manifest-digest");
const applyReportDigest = required("apply-report-digest");
const commandResultDigest = required("command-result-digest");
const rollbackImageDigest = required("rollback-image-digest");
const rollback = direction === "rollback";

if (!Number.isInteger(phase) || phase < 0 || phase > 6) throw new Error("Invalid Phase.");
if (!rollback && direction !== "forward") throw new Error("Invalid verification direction.");
if (process.cwd() !== "/srv/projectai") throw new Error("Production verifier requires /srv/projectai.");
assertReleaseSessionId(releaseSessionId);
assertFullSha(releaseCandidateSha, "release-candidate-sha");
for (const [name, value] of [
  ["release-image-digest", releaseImageDigest],
  ["database-tools-image-digest", databaseToolsImageDigest],
  ["release-manifest-digest", releaseManifestDigest],
  ["apply-report-digest", applyReportDigest],
  ["command-result-digest", commandResultDigest],
  ["rollback-image-digest", rollbackImageDigest],
]) {
  assertDigest(value, name);
}
const observationStartMs = Date.parse(observationStartedAt);
const mutationStartMs = Date.parse(mutationStartedAt);
if (
  !Number.isFinite(mutationStartMs) ||
  !Number.isFinite(observationStartMs) ||
  mutationStartMs > observationStartMs ||
  observationStartMs > Date.now() + 60_000
) {
  throw new Error("Invalid observation start.");
}

function run(program, args) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${program} verification command failed.`);
  return String(result.stdout ?? "").trim();
}

function inspect(container, format) {
  return run("docker", ["inspect", "--format", format, container]);
}

function containerState(container) {
  const result = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}", container], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout).trim() : "absent";
}

function assertHealthy(container) {
  if (
    inspect(
      container,
      "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    ) !== "running|healthy"
  ) {
    throw new Error(`${container} is not healthy.`);
  }
}

function appHealth() {
  return JSON.parse(
    run("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "20",
      "http://127.0.0.1:3100/tool/projectai/api/health",
    ]),
  );
}

function publicHttp() {
  return Number(
    run("curl", [
      "--silent",
      "--show-error",
      "--output",
      "/dev/null",
      "--write-out",
      "%{http_code}",
      "--max-time",
      "20",
      "https://gridworks.cn/tool/projectai/",
    ]),
  );
}

function dockerExec(container, args, environment = {}) {
  const envArgs = Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
  return run("docker", ["exec", ...envArgs, container, ...args]);
}

function imageMetadata(reference) {
  const value = JSON.parse(
    run("docker", ["image", "inspect", "--format", "{{json .}}", reference]),
  );
  return {
    id: value.Id,
    os: value.Os,
    architecture: value.Architecture,
    revision: value.Config?.Labels?.["org.opencontainers.image.revision"] ?? null,
    environment: value.Config?.Labels?.["com.projectai.release.environment"] ?? null,
  };
}

function egressMembers() {
  const containers = JSON.parse(
    run("docker", [
      "network",
      "inspect",
      "projectai-production-egress",
      "--format",
      "{{json .Containers}}",
    ]),
  );
  return Object.values(containers ?? {})
    .map((value) => value?.Name)
    .filter((value) => typeof value === "string")
    .sort();
}

function numericEnvironment(container, name) {
  const value = Number(
    dockerExec(container, [
      "node",
      "-e",
      `process.stdout.write(process.env.${name} || '')`,
    ]),
  );
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} is not a valid positive integer.`);
  }
  return value;
}

function booleanEnvironment(container, name) {
  const value = dockerExec(container, [
    "node",
    "-e",
    `process.stdout.write(process.env.${name} || '')`,
  ]);
  if (!['true', 'false'].includes(value)) throw new Error(`${name} is invalid in ${container}.`);
  return value === "true";
}

function databaseMetrics() {
  if (!["running"].includes(containerState("project-ai-os-postgres"))) return null;
  const sinceEpoch = Math.floor(mutationStartMs / 1000);
  const row = dockerExec("project-ai-os-postgres", [
    "psql",
    "-U",
    "projectai",
    "-d",
    "projectai",
    "-At",
    "-F",
    "|",
    "-c",
    `select
       coalesce(sum(total_token_count), 0),
       count(*) filter (where failure_code = 'PROVIDER_RESULT_UNKNOWN'),
       count(*) filter (where failure_code like '%RATE_LIMIT%'),
       (select count(*) from document_embedding_provider_calls where status = 'unknown'),
       (select coalesce(sum(input_token_count), 0) from document_embedding_provider_calls
          where status = 'succeeded' and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
       (select count(*) from document_embedding_jobs where reason = 'backfill' and created_at >= to_timestamp(${sinceEpoch})),
       (select coalesce(sum(chunk_count), 0) from document_embedding_jobs where reason = 'backfill' and created_at >= to_timestamp(${sinceEpoch}))
     from ai_executions
     where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`,
  ]).split("|");
  if (row.length !== 7 || row.some((value) => !/^\d+$/.test(value))) {
    throw new Error("Production verification counters are invalid.");
  }
  return {
    answerTokens: Number(row[0]),
    assistantUnknownProviderCalls: Number(row[1]),
    rateLimitedCount: Number(row[2]),
    embeddingUnknownProviderCalls: Number(row[3]),
    embeddingTokens: Number(row[4]),
    backfillJobs: Number(row[5]),
    backfillChunkCount: Number(row[6]),
  };
}

function productionDataCounts() {
  const values = dockerExec("project-ai-os-postgres", [
    "psql", "-U", "projectai", "-d", "projectai", "-At", "-F", "|", "-c",
    `select
       (select count(*) from project_documents),
       (select count(*) from project_document_versions),
       (select count(*) from document_chunks),
       (select count(*) from document_embedding_jobs),
       (select count(*) from document_chunk_embeddings),
       (select count(*) from ai_executions),
       (select count(*) from ai_retrieval_runs)`,
  ]).split("|");
  if (values.length !== 7 || values.some((value) => !/^\d+$/.test(value))) {
    throw new Error("Production data counts are invalid.");
  }
  return Object.fromEntries(
    [
      "documents",
      "versions",
      "chunks",
      "embedding_jobs",
      "vectors",
      "ai_executions",
      "retrieval_runs",
    ].map((name, index) => [name, Number(values[index])]),
  );
}

function cleanupIsEmpty(value) {
  if (typeof value === "number") return value === 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(cleanupIsEmpty);
}

const egressExpectation = productionEgressExpectation(phase, { rollback });
const metrics = {
  phase,
  capturedAt: new Date().toISOString(),
  elapsedSeconds: Math.max(0, Math.floor((Date.now() - observationStartMs) / 1000)),
  publicHttpStatus: publicHttp(),
  egressMembers: egressExpectation ? egressMembers() : [],
  imageMetadata: {
    release: imageMetadata(releaseImageDigest),
    databaseTools: imageMetadata(databaseToolsImageDigest),
    rollback: imageMetadata(rollbackImageDigest),
  },
};
if (metrics.publicHttpStatus !== 200) throw new Error("Public HTTP verification failed.");
if (egressExpectation) {
  assertProductionEgressMembership(metrics.egressMembers, egressExpectation);
}

if (phase === 0) {
  const backupRoot = "/srv/projectai/backups/config";
  const archives = (await readdir(backupRoot)).filter((name) => name.endsWith(".tar"));
  if (archives.length < 1) throw new Error("Phase 0 configuration backup is missing.");
  const latest = archives.sort().at(-1);
  if ((await stat(path.join(backupRoot, latest))).size < 1) {
    throw new Error("Phase 0 backup is empty.");
  }
  run("nginx", ["-t"]);
  run("docker", [
    "compose",
    "--project-name",
    "projectai-production",
    "--file",
    "/srv/projectai/docker-compose.production-rollout.yml",
    "config",
    "--quiet",
  ]);
  metrics.configurationVerified = true;
}

if (phase >= 1 && !(rollback && phase === 1)) {
  assertHealthy("project-ai-os-postgres");
  assertHealthy("project-ai-os-minio");
  const extension = dockerExec("project-ai-os-postgres", [
    "psql", "-U", "projectai", "-d", "projectai", "-Atc",
    "select extversion from pg_extension where extname='vector'",
  ]);
  if (extension !== "0.8.1") throw new Error("pgvector 0.8.1 is not active.");
  const dimension = dockerExec("project-ai-os-postgres", [
    "psql", "-U", "projectai", "-d", "projectai", "-Atc",
    "select vector_dims(array_fill(0::real,array[1024])::vector)",
  ]);
  if (dimension !== "1024") throw new Error("vector(1024) verification failed.");
  for (const container of ["project-ai-os-postgres", "project-ai-os-minio"]) {
    if (inspect(container, "{{json .HostConfig.PortBindings}}") !== "null") {
      throw new Error(`${container} publishes ports.`);
    }
  }
  metrics.dataPlaneVerified = true;
}

if (rollback && phase === 1) {
  const states = ["project-ai-os-postgres", "project-ai-os-minio"].map(containerState);
  if (states.some((state) => !["exited", "created"].includes(state))) {
    throw new Error("Phase 1 rollback did not stop the data plane.");
  }
  metrics.dataPlaneStopped = true;
}

const needsCandidateDocumentWorker = phase >= 2 && !(rollback && phase === 2);
if (phase >= 2) {
  assertHealthy("project-ai-os");
  if (needsCandidateDocumentWorker) assertHealthy("project-ai-os-document-worker");
  const health = appHealth();
  metrics.health = health;
  for (const route of ["login", "dashboard", "projects"]) {
    const code = Number(
      run("curl", [
        "--silent", "--output", "/dev/null", "--write-out", "%{http_code}",
        "--max-time", "20", `http://127.0.0.1:3100/tool/projectai/${route}`,
      ]),
    );
    if (![200, 301, 302, 303, 307, 308].includes(code)) {
      throw new Error(`${route} verification failed.`);
    }
  }
  const expectedFlags = rollback
    ? {
        2: [false, false, "lexical"],
        3: [false, false, "lexical"],
        4: [true, false, "lexical"],
        5: [true, true, "lexical"],
        6: [true, true, "shadow"],
      }[phase]
    : {
        2: [false, false, "lexical"],
        3: [true, false, "lexical"],
        4: [true, true, "lexical"],
        5: [true, true, "shadow"],
        6: [true, true, "hybrid"],
      }[phase];
  if (
    expectedFlags &&
    (health.aiAssistantEnabled !== expectedFlags[0] ||
      health.aiEmbeddingEnabled !== expectedFlags[1] ||
      health.assistantRetrievalMode !== expectedFlags[2])
  ) {
    throw new Error("Production feature flags do not match the verified Phase state.");
  }
  metrics.dataCounts = productionDataCounts();
}

let assistantSmoke = null;
if (phase === 3 && !rollback) {
  assistantSmoke = JSON.parse(
    dockerExec(
      "project-ai-os",
      ["npm", "run", "--silent", "assistant:smoke"],
      {
        APP_BASE_URL: "http://127.0.0.1:3000/tool/projectai",
        AUTH_REQUEST_ORIGIN: "https://gridworks.cn",
      },
    ),
  );
  if (
    assistantSmoke.ok !== true ||
    assistantSmoke.crossProject404 !== true ||
    !cleanupIsEmpty(assistantSmoke.cleanup) ||
    assistantSmoke.runningExecutions !== 0
  ) {
    throw new Error("Grounded Assistant verification did not close its safety assertions.");
  }
  metrics.assistantSmoke = assistantSmoke;
}

let embeddingStatus = null;
if (phase >= 4 && !rollback) {
  assertHealthy("project-ai-os-embedding-worker");
  if (
    booleanEnvironment("project-ai-os", "AI_EMBEDDING_ENABLED") !== true ||
    booleanEnvironment("project-ai-os-document-worker", "AI_EMBEDDING_ENABLED") !== true
  ) {
    throw new Error("Embedding configuration did not propagate to App and Document Worker.");
  }
  const qwenMounts = inspect(
    "project-ai-os-embedding-worker",
    "{{range .Mounts}}{{println .Destination}}{{end}}",
  ).split("\n");
  if (!qwenMounts.includes("/run/secrets/qwen_api_key")) {
    throw new Error("Embedding Worker Qwen Secret mount is missing.");
  }
  embeddingStatus = JSON.parse(
    dockerExec("project-ai-os", ["npm", "run", "--silent", "embeddings:status"]),
  );
  metrics.embeddingStatus = embeddingStatus;
}
if (rollback && phase >= 5) {
  assertHealthy("project-ai-os-embedding-worker");
  if (booleanEnvironment("project-ai-os-embedding-worker", "AI_EMBEDDING_ENABLED") !== true) {
    throw new Error("Embedding Worker configuration drifted before its rollback Phase.");
  }
}

if (phase === 4 && !rollback) {
  const runId = randomUUID();
  const flow = JSON.parse(
    dockerExec(
      "project-ai-os",
      ["./node_modules/.bin/tsx", "scripts/verify-embedding-flow.ts", "--live"],
      {
        APP_BASE_URL: "http://127.0.0.1:3000/tool/projectai",
        AUTH_REQUEST_ORIGIN: "https://gridworks.cn",
        EMBEDDING_SMOKE_RUN_ID: runId,
      },
    ),
  );
  if (
    flow.verified !== true ||
    flow.newDocumentAutoEnqueue !== true ||
    Number(flow.realProviderJobs) < 2 ||
    flow.dimensions !== 1024 ||
    !cleanupIsEmpty(flow.cleanup)
  ) {
    throw new Error("New-document Embedding flow verification failed.");
  }
  metrics.embeddingFlow = flow;
  metrics.newDocumentAutoEnqueue = flow.newDocumentAutoEnqueue;
}

let retrievalStatus = null;
if (phase >= 5 && !rollback) {
  retrievalStatus = JSON.parse(
    dockerExec("project-ai-os", ["npm", "run", "--silent", "retrieval:status"]),
  );
  if (
    (phase === 5 && retrievalStatus.mode !== "shadow") ||
    (phase === 6 && retrievalStatus.mode !== "hybrid")
  ) {
    throw new Error("Retrieval mode verification failed.");
  }
  metrics.retrievalStatus = retrievalStatus;
}

if (rollback && phase === 4 && containerState("project-ai-os-embedding-worker") === "running") {
  throw new Error("Embedding Worker is still running after rollback.");
}
if (
  rollback &&
  phase === 4 &&
  (booleanEnvironment("project-ai-os", "AI_EMBEDDING_ENABLED") !== false ||
    booleanEnvironment("project-ai-os-document-worker", "AI_EMBEDDING_ENABLED") !== false)
) {
  throw new Error("Embedding rollback did not propagate to App and Document Worker.");
}
if (rollback && phase === 2) {
  for (const worker of ["project-ai-os-document-worker", "project-ai-os-embedding-worker"]) {
    if (containerState(worker) === "running") throw new Error(`${worker} is still running.`);
  }
}

const counters = phase >= 3 ? databaseMetrics() : null;
if (counters) {
  const embeddingDailyLimit = numericEnvironment(
    phase >= 4 && !rollback ? "project-ai-os-embedding-worker" : "project-ai-os",
    "AI_EMBEDDING_DAILY_TOKEN_LIMIT",
  );
  const retrievalUnknown = Number(retrievalStatus?.past24Hours?.query_unknown_count ?? 0);
  metrics.answerTokens = counters.answerTokens;
  metrics.embeddingTokens = counters.embeddingTokens;
  metrics.queryEmbeddingTokens = Number(retrievalStatus?.past24Hours?.query_input_tokens ?? 0);
  metrics.dailyTokenLimit = embeddingDailyLimit;
  metrics.providerUnknownCount =
    counters.assistantUnknownProviderCalls +
    counters.embeddingUnknownProviderCalls +
    retrievalUnknown;
  metrics.rateLimited = counters.rateLimitedCount > 0;
  metrics.embeddingUnknownIncrease = counters.embeddingUnknownProviderCalls;
  metrics.backfillJobs = counters.backfillJobs;
  metrics.backfillChunkCount = counters.backfillChunkCount;
}
if (embeddingStatus) {
  metrics.jobBacklog = Number(embeddingStatus.pending) + Number(embeddingStatus.running);
  metrics.jobBacklogLimit = numericEnvironment(
    "project-ai-os-embedding-worker",
    "AI_EMBEDDING_DAILY_JOB_LIMIT",
  );
  if (Number(embeddingStatus.unknownProviderCalls) !== metrics.embeddingUnknownIncrease) {
    throw new Error("Embedding unknown-call counters disagree.");
  }
}
if (retrievalStatus) {
  metrics.controlledRequests = Number(retrievalStatus.past24Hours?.run_count ?? 0);
}
if (assistantSmoke) {
  metrics.crossProjectLeak = assistantSmoke.crossProject404 !== true;
  metrics.cleanupComplete = cleanupIsEmpty(assistantSmoke.cleanup);
}

const observationEndedAt = new Date().toISOString();
const report = withDigest({
  schemaVersion: 1,
  reportType: rollback
    ? "production-rollout-rollback-observation"
    : "production-rollout-phase-observation",
  producer: PRODUCTION_PHASE_VERIFIER,
  producerVersion: PRODUCTION_ROLLOUT_VERSION,
  sourceMode: "live-readonly",
  releaseSessionId,
  releaseCandidateSha,
  releaseImageDigest,
  databaseToolsImageDigest,
  releaseManifestDigest,
  phase,
  direction,
  applyReportDigest,
  commandResultDigest,
  mutationStartedAt,
  result: "passed",
  syntheticResult: false,
  observation: {
    releaseSessionId,
    phase,
    startedAt: observationStartedAt,
    endedAt: observationEndedAt,
  },
  metrics,
});

process.stdout.write(`${JSON.stringify(report)}\n`);
