import {
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RELEASE_REPORT_PRODUCER,
  assertDigest,
  assertFullSha,
  assertIsoTimestamp,
  assertReleaseSessionId,
  assertSanitized,
  canonicalJson,
  digestObject,
  readJson,
  withDigest,
  writeArtifactPair,
} from "./contract.mjs";

export const PRODUCTION_ROLLOUT_VERSION = "b3-c2-v1";
export const AUTHORIZATION_REPORT_TYPE = "production-rollout-authorization";
export const AUTHORIZATION_SOURCE_MODES = [
  "production-approval",
  "rehearsal-command",
  "synthetic-test",
];
export const PHASE_STATES = [
  "not_started",
  "authorized",
  "running",
  "succeeded",
  "failed",
  "rolled_back",
  "rollback_failed",
  "blocked",
];
export const TERMINAL_PHASE_STATES = new Set([
  "succeeded",
  "rolled_back",
  "rollback_failed",
  "blocked",
]);
export const AUTHORIZATION_MAX_LIFETIME_MS = 60 * 60 * 1000;
export const PRODUCTION_LOCK_PATH = "/srv/projectai/.production-rollout-lock";
export const PRODUCTION_JOURNAL_ROOT = "/srv/projectai/releases";
export const PRODUCTION_COMPOSE_PROJECT = "projectai-production";
export const PRODUCTION_COMPOSE_FILE = "docker-compose.production-rollout.yml";
export const PRODUCTION_AI_COMPOSE_FILE = "docker-compose.production-ai.yml";
export const PRODUCTION_BASE_PATH = "/tool/projectai";
export const PRODUCTION_HOST_PORT = "127.0.0.1:3100";

export const PHASES = [
  {
    phase: 0,
    name: "baseline-lock-backup",
    prerequisitePhase: null,
    observationSeconds: 60,
  },
  {
    phase: 1,
    name: "data-plane-bootstrap",
    prerequisitePhase: 0,
    observationSeconds: 300,
  },
  {
    phase: 2,
    name: "disabled-application-rollout",
    prerequisitePhase: 1,
    observationSeconds: 900,
  },
  {
    phase: 3,
    name: "assistant-lexical-enablement",
    prerequisitePhase: 2,
    observationSeconds: 1800,
  },
  {
    phase: 4,
    name: "embedding-and-bounded-backfill",
    prerequisitePhase: 3,
    observationSeconds: 1800,
    firstBatchChunkLimit: 100,
  },
  {
    phase: 5,
    name: "shadow-retrieval",
    prerequisitePhase: 4,
    observationSeconds: 1800,
    minimumControlledRequests: 30,
  },
  {
    phase: 6,
    name: "hybrid-retrieval",
    prerequisitePhase: 5,
    observationSeconds: 1800,
    minimumControlledRequests: 30,
  },
];

const TRANSITIONS = new Map([
  ["not_started", new Set(["authorized", "blocked"])],
  ["authorized", new Set(["running", "blocked"])],
  ["running", new Set(["succeeded", "failed", "blocked"])],
  ["failed", new Set(["running", "rolled_back", "rollback_failed", "blocked"])],
  ["succeeded", new Set(["rolled_back", "rollback_failed"])],
  ["rolled_back", new Set()],
  ["rollback_failed", new Set(["blocked"])],
  ["blocked", new Set(["authorized"])],
]);

export class ProductionRolloutError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ProductionRolloutError";
    this.code = code;
  }
}

export function phaseDefinition(value) {
  const phase = Number(value);
  const definition = PHASES.find((candidate) => candidate.phase === phase);
  if (!definition) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_NOT_AUTHORIZED",
      "Phase must be an integer from 0 through 6.",
    );
  }
  return definition;
}

export function assertPhaseTransition(from, to) {
  if (!PHASE_STATES.includes(from) || !PHASE_STATES.includes(to)) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Unknown Production rollout phase state.",
    );
  }
  if (!TRANSITIONS.get(from)?.has(to)) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_TRANSITION_INVALID",
      `Invalid Production phase transition ${from} -> ${to}.`,
    );
  }
}

function authorizationSigningPayload(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "digest" && key !== "authorizationSignature",
    ),
  );
}

function authorizationDigestPayload(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "digest"),
  );
}

export function authorizationSignatureInput(value) {
  return Buffer.from(canonicalJson(authorizationSigningPayload(value)), "utf8");
}

export function signTestAuthorization(payload, privateKey) {
  if (process.env.NODE_ENV !== "test") {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Test Authorization signing is available only in NODE_ENV=test.",
    );
  }
  const unsigned = {
    ...payload,
    sourceMode: "synthetic-test",
    signatureAlgorithm: "ed25519",
  };
  const authorizationSignature = cryptoSign(
    null,
    authorizationSignatureInput(unsigned),
    privateKey,
  ).toString("base64");
  return {
    ...unsigned,
    authorizationSignature,
    digest: digestObject({ ...unsigned, authorizationSignature }),
  };
}

export function createAuthorizationPayload({
  sourceMode,
  session,
  manifest,
  goNoGo,
  authorizedPhases,
  authorizedAt,
  expiresAt,
}) {
  if (!AUTHORIZATION_SOURCE_MODES.includes(sourceMode)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Authorization sourceMode is invalid.",
    );
  }
  if (sourceMode === "production-approval") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "B3-C2A does not generate formal Production Authorization.",
    );
  }
  if (process.env.NODE_ENV !== "test" && sourceMode === "synthetic-test") {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Synthetic Authorization is restricted to NODE_ENV=test.",
    );
  }
  return {
    schemaVersion: 1,
    reportType: AUTHORIZATION_REPORT_TYPE,
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    sourceMode,
    authorizationId: `pa-${randomUUID().replaceAll("-", "")}`,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    databaseToolsImageDigest: manifest.databaseToolsImageDigest,
    productionBaselineDigest: session.productionBaselineDigest,
    goNoGoDigest: goNoGo.digest,
    authorizedPhases: [...new Set(authorizedPhases)].sort((a, b) => a - b),
    authorizedAt,
    expiresAt,
    independentReview: "passed",
    machineReadiness: "GO",
    openP0: 0,
    openP1: 0,
    openP2: 0,
    productionRolloutAuthorized: true,
  };
}

function assertAuthorizationShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "A generated Production rollout Authorization is required.",
    );
  }
  const fixed = {
    schemaVersion: 1,
    reportType: AUTHORIZATION_REPORT_TYPE,
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    productionRolloutAuthorized: true,
    independentReview: "passed",
    machineReadiness: "GO",
    openP0: 0,
    openP1: 0,
    openP2: 0,
    signatureAlgorithm: "ed25519",
  };
  for (const [field, expected] of Object.entries(fixed)) {
    if (value[field] !== expected) {
      throw new ProductionRolloutError(
        "PRODUCTION_AUTHORIZATION_INVALID",
        `Production Authorization has invalid ${field}.`,
      );
    }
  }
  if (!AUTHORIZATION_SOURCE_MODES.includes(value.sourceMode)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization sourceMode is invalid.",
    );
  }
  if (!/^pa-[0-9a-f]{32}$/.test(value.authorizationId ?? "")) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization ID is invalid.",
    );
  }
  assertReleaseSessionId(value.releaseSessionId);
  assertFullSha(value.releaseCandidateSha, "releaseCandidateSha");
  for (const field of [
    "releaseImageDigest",
    "databaseToolsImageDigest",
    "productionBaselineDigest",
    "goNoGoDigest",
    "digest",
  ]) {
    assertDigest(value[field], field);
  }
  assertIsoTimestamp(value.authorizedAt, "authorizedAt");
  assertIsoTimestamp(value.expiresAt, "expiresAt");
  if (
    !Array.isArray(value.authorizedPhases) ||
    value.authorizedPhases.length < 1 ||
    value.authorizedPhases.length > 7 ||
    new Set(value.authorizedPhases).size !== value.authorizedPhases.length ||
    value.authorizedPhases.some(
      (phase) => !Number.isInteger(phase) || phase < 0 || phase > 6,
    )
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization phase scope is invalid.",
    );
  }
  if (!/^[A-Za-z0-9+/]{86}==$/.test(value.authorizationSignature ?? "")) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization signature is invalid.",
    );
  }
  const expectedDigest = digestObject(authorizationDigestPayload(value));
  if (value.digest !== expectedDigest) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization digest does not match its payload.",
    );
  }
  assertSanitized(value);
}

export function assertProductionAuthorization(
  value,
  { now = new Date(), environment, phase, publicKey } = {},
) {
  assertAuthorizationShape(value);
  const authorizedAtMs = Date.parse(value.authorizedAt);
  const expiresAtMs = Date.parse(value.expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (
    expiresAtMs <= authorizedAtMs ||
    expiresAtMs - authorizedAtMs > AUTHORIZATION_MAX_LIFETIME_MS
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization lifetime exceeds the one-hour maximum.",
    );
  }
  if (!Number.isFinite(nowMs) || nowMs < authorizedAtMs - 60_000) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization is not yet valid.",
    );
  }
  if (nowMs >= expiresAtMs) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_EXPIRED",
      "Production Authorization has expired.",
    );
  }
  if (phase !== undefined && !value.authorizedPhases.includes(Number(phase))) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_NOT_AUTHORIZED",
      "Requested phase is outside the Production Authorization scope.",
    );
  }
  if (environment === "production" && value.sourceMode !== "production-approval") {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Synthetic or rehearsal Authorization cannot authorize Production.",
    );
  }
  if (
    value.sourceMode === "synthetic-test" &&
    process.env.NODE_ENV !== "test"
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Synthetic Authorization is restricted to NODE_ENV=test.",
    );
  }
  if (!publicKey) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization verification key is required.",
    );
  }
  let verified = false;
  try {
    const verificationKey = publicKey?.type === "public"
      ? publicKey
      : createPublicKey(publicKey);
    verified = cryptoVerify(
      null,
      authorizationSignatureInput(value),
      verificationKey,
      Buffer.from(value.authorizationSignature, "base64"),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization signature verification failed.",
    );
  }
  return value;
}

export function assertAuthorizationBindings({
  authorization,
  session,
  manifest,
  productionBaseline,
  goNoGo,
  phase,
}) {
  const bindings = [
    [authorization.releaseSessionId, session.releaseSessionId, "Session"],
    [authorization.releaseCandidateSha, session.releaseCandidateSha, "SHA"],
    [authorization.releaseImageDigest, session.releaseImageDigest, "App image"],
    [
      authorization.databaseToolsImageDigest,
      manifest.databaseToolsImageDigest,
      "DB-tools image",
    ],
    [
      authorization.productionBaselineDigest,
      session.productionBaselineDigest,
      "Production baseline",
    ],
    [authorization.goNoGoDigest, goNoGo.digest, "Go/No-Go"],
  ];
  for (const [actual, expected, label] of bindings) {
    if (actual !== expected) {
      throw new ProductionRolloutError(
        "PRODUCTION_AUTHORIZATION_INVALID",
        `${label} does not match the Production Authorization.`,
      );
    }
  }
  if (productionBaseline.digest !== session.productionBaselineDigest) {
    throw new ProductionRolloutError(
      "PRODUCTION_BASELINE_DRIFT",
      "Production baseline digest does not match the Release Session.",
    );
  }
  if (
    goNoGo.machineReadiness !== "GO" ||
    goNoGo.productionRolloutAuthorized !== false ||
    goNoGo.failed?.length !== 0
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Go/No-Go is not eligible for independent Production authorization.",
    );
  }
  if (!authorization.authorizedPhases.includes(Number(phase))) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_NOT_AUTHORIZED",
      "Phase is outside the Authorization scope.",
    );
  }
}

export function assertProductionBaselineStable({
  baseline,
  current,
  expectedContainer,
  expectedImage,
  phase = 0,
}) {
  const numericPhase = phaseDefinition(phase).phase;
  const fields = ["configuration.composeHash", "configuration.nginxHash"];
  if (numericPhase <= 2) {
    fields.push(
      "app.containerId",
      "app.imageDigest",
      "app.startedAt",
      "app.restartCount",
      "features.qwenSecretMount",
      "features.aiAssistantEnabled",
      "features.aiEmbeddingEnabled",
      "features.retrievalMode",
    );
  }
  if (numericPhase <= 1) {
    fields.push(
      "database.present",
      "objectStorage.present",
      "services.documentWorker",
      "services.embeddingWorker",
    );
  }
  const valueAt = (object, dotted) =>
    dotted.split(".").reduce((value, key) => value?.[key], object);
  if (
    fields.some(
      (field) =>
        JSON.stringify(valueAt(baseline, field)) !==
        JSON.stringify(valueAt(current, field)),
    ) ||
    current.app.containerId !== expectedContainer ||
    current.app.imageDigest !== expectedImage
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_BASELINE_DRIFT",
      "Production baseline changed after authorization.",
    );
  }
}

export function assertPhasePrerequisite({ phase, previousReport, sessionId }) {
  const definition = phaseDefinition(phase);
  if (definition.prerequisitePhase === null) return;
  if (!previousReport) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_PREREQUISITE_MISSING",
      "Previous phase success report is required.",
    );
  }
  if (
    previousReport.reportType !== "production-rollout-phase" ||
    previousReport.producer !== RELEASE_REPORT_PRODUCER ||
    previousReport.producerVersion !== PRODUCTION_ROLLOUT_VERSION ||
    previousReport.releaseSessionId !== sessionId ||
    previousReport.phase !== definition.prerequisitePhase ||
    previousReport.phaseState !== "succeeded" ||
    previousReport.result !== "passed"
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_PREREQUISITE_MISSING",
      "Previous phase report is missing, mismatched, or unsuccessful.",
    );
  }
  const expected = digestObject(
    Object.fromEntries(
      Object.entries(previousReport).filter(([key]) => key !== "digest"),
    ),
  );
  if (previousReport.digest !== expected) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_PREREQUISITE_MISSING",
      "Previous phase report digest is invalid.",
    );
  }
}

export function observationGate({
  phase,
  elapsedSeconds,
  controlledRequests = 0,
  rehearsal = false,
}) {
  const definition = phaseDefinition(phase);
  const minimumSeconds = rehearsal
    ? Math.max(1, Math.min(5, definition.observationSeconds))
    : definition.observationSeconds;
  const timePassed = Number(elapsedSeconds) >= minimumSeconds;
  const requestPassed =
    definition.minimumControlledRequests === undefined ||
    Number(controlledRequests) >= definition.minimumControlledRequests;
  return {
    minimumSeconds,
    elapsedSeconds: Number(elapsedSeconds),
    minimumControlledRequests: definition.minimumControlledRequests ?? 0,
    controlledRequests: Number(controlledRequests),
    passed: timePassed && requestPassed,
  };
}

export function costGate({
  phase,
  answerTokens = 0,
  embeddingTokens = 0,
  queryEmbeddingTokens = 0,
  dailyTokenLimit,
  providerUnknownCount = 0,
  rateLimited = false,
}) {
  const numeric = [answerTokens, embeddingTokens, queryEmbeddingTokens, dailyTokenLimit];
  const total = Number(answerTokens) + Number(embeddingTokens) + Number(queryEmbeddingTokens);
  const required = Number(phase) >= 3;
  const passed =
    numeric.every((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0) &&
    (!required || Number(dailyTokenLimit) > 0) &&
    total <= Number(dailyTokenLimit) &&
    Number(providerUnknownCount) === 0 &&
    rateLimited !== true;
  return {
    answerTokens: Number(answerTokens),
    embeddingTokens: Number(embeddingTokens),
    queryEmbeddingTokens: Number(queryEmbeddingTokens),
    dailyTokenLimit: Number(dailyTokenLimit),
    providerUnknownCount: Number(providerUnknownCount),
    rateLimited: rateLimited === true,
    totalTokens: total,
    passed,
  };
}

export async function inspectSecretMetadata(filename) {
  const resolved = path.resolve(filename);
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_QWEN_SECRET_REQUIRED",
      "Production Qwen Secret file is missing.",
    );
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size < 1) {
    throw new ProductionRolloutError(
      "PRODUCTION_QWEN_SECRET_REQUIRED",
      "Production Qwen Secret metadata is unsafe.",
    );
  }
  const mode = metadata.mode & 0o777;
  if (![0o400, 0o440, 0o600, 0o640].includes(mode)) {
    throw new ProductionRolloutError(
      "PRODUCTION_QWEN_SECRET_REQUIRED",
      "Production Qwen Secret permissions are too broad.",
    );
  }
  return {
    exists: true,
    regularFile: true,
    symbolicLink: false,
    nonEmpty: true,
    mode: mode.toString(8).padStart(3, "0"),
    uid: metadata.uid,
    gid: metadata.gid,
  };
}

export function assertImageContract(metadata, expected) {
  const required = {
    id: expected.digest,
    os: "linux",
    architecture: "amd64",
    revision: expected.sha,
    environment: "production",
  };
  for (const [field, value] of Object.entries(required)) {
    if (metadata?.[field] !== value) {
      throw new ProductionRolloutError(
        "PRODUCTION_IMAGE_CONTRACT_INVALID",
        `Production image ${field} does not match the immutable contract.`,
      );
    }
  }
  return true;
}

export function assertComposeContract(contents, aiContents = "") {
  const required = [
    "name: projectai-production",
    "projectai-app:",
    "projectai-document-worker:",
    "projectai-embedding-worker:",
    "projectai-postgres:",
    "projectai-minio:",
    "projectai-minio-init:",
    "projectai-migrate:",
    "projectai-storage-operations:",
    "127.0.0.1:3100:3000",
    "pgvector/pgvector:0.8.1-pg17@sha256:",
    "quay.io/minio/minio:RELEASE.",
    "restart: unless-stopped",
    "pids_limit:",
    "mem_limit:",
    "healthcheck:",
  ];
  for (const value of required) {
    if (!contents.includes(value)) {
      throw new ProductionRolloutError(
        "PRODUCTION_COMPOSE_CONTRACT_INVALID",
        `Production Compose is missing ${value}.`,
      );
    }
  }
  if (/image:\s*[^\n]*:latest\b/.test(contents)) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Production Compose cannot use latest images.",
    );
  }
  for (const service of ["projectai-postgres", "projectai-minio"]) {
    const start = contents.indexOf(`  ${service}:`);
    const next = contents.indexOf("\n  projectai-", start + 3);
    const block = contents.slice(start, next < 0 ? contents.length : next);
    if (/\n\s+ports:/.test(block)) {
      throw new ProductionRolloutError(
        "PRODUCTION_COMPOSE_CONTRACT_INVALID",
        `${service} must not publish host ports.`,
      );
    }
  }
  const appStart = contents.indexOf("  projectai-app:");
  const documentStart = contents.indexOf("  projectai-document-worker:");
  const embeddingStart = contents.indexOf("  projectai-embedding-worker:");
  const postgresStart = contents.indexOf("  projectai-postgres:");
  const app = contents.slice(appStart, documentStart);
  const document = contents.slice(documentStart, embeddingStart);
  const embedding = contents.slice(embeddingStart, postgresStart);
  const aiApp = aiContents.match(/\n?  projectai-app:\n([\s\S]*?)\n\n  projectai-embedding-worker:/)?.[1] ?? "";
  const aiEmbedding = aiContents.match(/\n  projectai-embedding-worker:\n([\s\S]*?)\n\nsecrets:/)?.[1] ?? "";
  if (
    app.includes("qwen_api_key") ||
    document.includes("qwen_api_key") ||
    embedding.includes("qwen_api_key") ||
    !aiApp.includes("qwen_api_key") ||
    !aiEmbedding.includes("qwen_api_key") ||
    !aiContents.includes("file: /srv/projectai/secrets/qwen_api_key")
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Qwen Secret mount scope is invalid.",
    );
  }
  if (embedding.includes("OBJECT_STORAGE_SECRET_KEY") || document.includes("MINIO_ROOT_")) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Worker Secret scope is invalid.",
    );
  }
  return true;
}

export async function acquireDeploymentLock({ lockPath, metadata }) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await handle.close();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Production rollout lock already exists and requires review.",
      );
    }
    throw error;
  }
  const stats = await lstat(lockPath);
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o777) !== 0o600) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Production rollout lock metadata is unsafe.",
    );
  }
  return metadata;
}

export async function readDeploymentLock(lockPath) {
  try {
    const stats = await lstat(lockPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Production rollout lock is not a regular file.",
      );
    }
    const value = JSON.parse(await readFile(lockPath, "utf8"));
    assertReleaseSessionId(value.releaseSessionId);
    assertFullSha(value.releaseCandidateSha, "releaseCandidateSha");
    phaseDefinition(value.currentPhase);
    assertIsoTimestamp(value.startedAt, "startedAt");
    assertIsoTimestamp(value.expiresAt, "expiresAt");
    if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.hostname !== "string") {
      throw new Error("invalid lock process identity");
    }
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production rollout lock cannot be interpreted safely.",
    );
  }
}

export async function releaseDeploymentLock({ lockPath, releaseSessionId }) {
  const lock = await readDeploymentLock(lockPath);
  if (!lock) return false;
  if (lock.releaseSessionId !== releaseSessionId) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Production rollout lock belongs to another Release Session.",
    );
  }
  await rm(lockPath);
  return true;
}

export async function updateDeploymentLock({ lockPath, releaseSessionId, phase }) {
  const current = await readDeploymentLock(lockPath);
  if (!current || current.releaseSessionId !== releaseSessionId) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Production rollout lock cannot be updated by this Release Session.",
    );
  }
  const now = new Date();
  const next = {
    ...current,
    currentPhase: phaseDefinition(phase).phase,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTHORIZATION_MAX_LIFETIME_MS).toISOString(),
  };
  const temporary = `${lockPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(next)}\n`, "utf8");
    await handle.close();
    handle = null;
    await rename(temporary, lockPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return next;
}

export function createLockMetadata({ session, phase, now = new Date(), ttlMs = 60 * 60 * 1000 }) {
  return {
    schemaVersion: 1,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    currentPhase: Number(phase),
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

export async function readJournal(journalPath) {
  let contents;
  try {
    contents = await readFile(journalPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const entries = contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let previousDigest = null;
  for (const entry of entries) {
    if (entry.previousDigest !== previousDigest) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Production phase journal chain is broken.",
      );
    }
    const expected = digestObject(
      Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "digest")),
    );
    if (entry.digest !== expected) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Production phase journal digest is invalid.",
      );
    }
    previousDigest = entry.digest;
  }
  return entries;
}

export async function appendJournal(journalPath, entry) {
  const entries = await readJournal(journalPath);
  const previousDigest = entries.at(-1)?.digest ?? null;
  const next = withDigest({
    schemaVersion: 1,
    ...entry,
    previousDigest,
  });
  assertSanitized(next);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await appendFile(journalPath, `${JSON.stringify(next)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return next;
}

export function currentPhaseState(entries, phase) {
  const phaseEntries = entries.filter((entry) => entry.phase === Number(phase));
  return phaseEntries.at(-1)?.phaseState ?? "not_started";
}

export function latestSuccessfulPhase(entries) {
  const successful = entries.filter((entry) => entry.phaseState === "succeeded");
  return successful.at(-1)?.phase ?? null;
}

export function phaseActionPlan(phase) {
  const compose = [
    "docker",
    "compose",
    "--project-name",
    PRODUCTION_COMPOSE_PROJECT,
    "--file",
    PRODUCTION_COMPOSE_FILE,
  ];
  const plans = {
    0: [
      ["docker", "compose", "version"],
      ["nginx", "-t"],
      [...compose, "config", "--quiet"],
      ["projectai-internal", "validate-production-config"],
      ["projectai-internal", "backup-config-metadata"],
    ],
    1: [
      [...compose, "up", "--detach", "projectai-postgres", "projectai-minio"],
      [...compose, "run", "--rm", "projectai-minio-init"],
      [...compose, "run", "--rm", "projectai-migrate"],
    ],
    2: [
      [...compose, "up", "--detach", "--no-deps", "projectai-app", "projectai-document-worker"],
      ["projectai-internal", "verify-disabled-application"],
    ],
    3: [
      ["projectai-internal", "set-assistant-lexical"],
      ["projectai-internal", "verify-assistant-lexical"],
    ],
    4: [
      ["projectai-internal", "set-embedding-enabled"],
      ["projectai-internal", "bounded-backfill", "--limit=100"],
    ],
    5: [
      ["projectai-internal", "set-retrieval-mode", "shadow"],
      ["projectai-internal", "verify-shadow-observation"],
    ],
    6: [
      ["projectai-internal", "set-retrieval-mode", "hybrid"],
      ["projectai-internal", "verify-hybrid-observation"],
    ],
  };
  return plans[phaseDefinition(phase).phase];
}

export function rollbackActionPlan(phase) {
  const compose = [
    "docker",
    "compose",
    "--project-name",
    PRODUCTION_COMPOSE_PROJECT,
    "--file",
    PRODUCTION_COMPOSE_FILE,
  ];
  const plans = {
    0: [["projectai-internal", "release-lock"]],
    1: [[...compose, "stop", "projectai-minio", "projectai-postgres"]],
    2: [["projectai-internal", "restore-old-app-image"]],
    3: [["projectai-internal", "set-assistant-disabled"]],
    4: [[...compose, "stop", "projectai-embedding-worker"], ["projectai-internal", "set-embedding-disabled"]],
    5: [["projectai-internal", "set-retrieval-mode", "lexical"]],
    6: [["projectai-internal", "set-retrieval-mode", "lexical"]],
  };
  return plans[phaseDefinition(phase).phase];
}

export function assertPhaseCommandResults(phase, results) {
  phaseDefinition(phase);
  if (
    !Array.isArray(results) ||
    results.length < 1 ||
    results.some(
      (result) =>
        !result ||
        typeof result.command !== "string" ||
        !Number.isSafeInteger(result.status),
    )
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Phase command results are incomplete.",
    );
  }
  const failed = results.find((result) => result.status !== 0);
  if (failed) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_EXECUTION_FAILED",
      `Phase ${phase} command failed: ${failed.command}`,
    );
  }
  return true;
}

export function rolloutReportContract({
  reportType,
  sourceMode,
  session,
  phase,
  phaseState,
  result,
  extra = {},
}) {
  if (!/^[a-z0-9-]{1,64}$/.test(reportType)) {
    throw new Error("Invalid rollout reportType.");
  }
  if (!["ci-artifact", "rehearsal-command", "live-readonly", "synthetic-test"].includes(sourceMode)) {
    throw new Error("Invalid rollout report sourceMode.");
  }
  if (sourceMode === "synthetic-test" && process.env.NODE_ENV !== "test") {
    throw new Error("Synthetic rollout reports require NODE_ENV=test.");
  }
  if (phase !== null) phaseDefinition(phase);
  if (phaseState !== null && !PHASE_STATES.includes(phaseState)) {
    throw new Error("Invalid rollout phase state.");
  }
  return {
    schemaVersion: 1,
    reportType,
    producer: RELEASE_REPORT_PRODUCER,
    producerVersion: PRODUCTION_ROLLOUT_VERSION,
    sourceMode,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    releaseImageDigest: session.releaseImageDigest,
    phase,
    phaseState,
    recordedAt: new Date().toISOString(),
    result,
    ...extra,
  };
}

export async function writeRolloutReport({ outputDir, stem, payload, title }) {
  return writeArtifactPair({
    outputDir,
    stem,
    payload,
    markdown: `# ${title}\n\nResult: **${payload.result}**.`,
  });
}

export function journalPathFor(stateDir) {
  return path.join(path.resolve(stateDir), "journal.jsonl");
}

export function phaseReportPath(stateDir, phase) {
  return path.join(path.resolve(stateDir), `phase-${Number(phase)}.json`);
}

export async function writePhaseReport(stateDir, report) {
  const finalized = withDigest(report);
  assertSanitized(finalized);
  await mkdir(path.resolve(stateDir), { recursive: true });
  await writeFile(
    phaseReportPath(stateDir, report.phase),
    `${JSON.stringify(finalized, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return finalized;
}

export async function readPhaseReport(stateDir, phase) {
  try {
    return await readJson(phaseReportPath(stateDir, phase));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function exitCodeForRolloutError(error) {
  if (error?.code === "PRODUCTION_APPLY_NOT_AUTHORIZED") return 78;
  if (error instanceof ProductionRolloutError) return 1;
  return 1;
}

export function assertNoUnknown(value) {
  const visit = (entry) => {
    if (entry === "unknown") return false;
    if (Array.isArray(entry)) return entry.every(visit);
    if (entry && typeof entry === "object") return Object.values(entry).every(visit);
    return true;
  };
  if (!visit(value)) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Unknown rollout state is a mandatory stop condition.",
    );
  }
}

export function assertMigrationLockClear(inventory) {
  if (
    inventory.locks?.migrationFile !== false ||
    !["clear", "not-applicable"].includes(inventory.locks?.migrationAdvisory) ||
    inventory.locks?.migration !== false
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_MIGRATION_LOCK_HELD",
      "Migration lock is held or unknown.",
    );
  }
}

export function assertStopConditions({ inventory, verification }) {
  assertNoUnknown({ inventory, verification });
  if (
    inventory.app?.health !== "healthy" ||
    inventory.app?.restartCount !== 0 ||
    inventory.app?.publicHttpStatus !== 200 ||
    inventory.capacity?.filesystemUsagePercent >= 85 ||
    inventory.capacity?.inodeUsagePercent >= 85 ||
    inventory.locks?.deployment !== false
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_STOP_CONDITION",
      "Production stop condition is active.",
    );
  }
  assertMigrationLockClear(inventory);
  if (
    verification?.crossProjectLeak === true ||
    verification?.cleanupComplete === false ||
    verification?.providerCostAnomaly === true ||
    Number(verification?.embeddingUnknownIncrease ?? 0) > 0 ||
    Number(verification?.jobBacklog ?? 0) > Number(verification?.jobBacklogLimit ?? 0)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_STOP_CONDITION",
      "Phase verification activated a mandatory stop condition.",
    );
  }
}
