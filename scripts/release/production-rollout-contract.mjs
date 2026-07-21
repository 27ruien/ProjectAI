import {
  createPublicKey,
  randomUUID,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  RELEASE_REPORT_PRODUCER,
  assertDigest,
  assertFullSha,
  assertIsoTimestamp,
  assertReleaseSessionId,
  assertSanitized,
  canonicalJson,
  digestObject,
  withDigest,
  writeArtifactPair,
} from "./contract.mjs";

export const PRODUCTION_ROLLOUT_VERSION = "b3-c2-v2";
export const AUTHORIZATION_REPORT_TYPE = "production-rollout-authorization";
export const AUTHORIZATION_SOURCE_MODES = [
  "production-approval",
  "rehearsal-command",
  "synthetic-test",
];
export const AUTHORIZATION_ACTIONS = [
  "apply",
  "resume",
  "rollback",
  "finalize",
  "lock-clear",
  "image-transfer",
];
export const PHASE_STATES = [
  "not_started",
  "authorized",
  "running",
  "awaiting_verification",
  "succeeded",
  "failed",
  "awaiting_rollback_verification",
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
export const PRODUCTION_LOCK_HEARTBEAT_INTERVAL_MS = 30 * 1000;
export const PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;
export const PRODUCTION_LOCK_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const PRODUCTION_LOCK_PATH = "/srv/projectai/.production-rollout-lock";
export const PRODUCTION_JOURNAL_ROOT = "/srv/projectai/releases";
export const PRODUCTION_COMPOSE_PROJECT = "projectai-production";
export const PRODUCTION_COMPOSE_FILE = "/srv/projectai/docker-compose.production-rollout.yml";
export const PRODUCTION_AI_COMPOSE_FILE = "/srv/projectai/docker-compose.production-ai.yml";
export const PRODUCTION_BASE_PATH = "/tool/projectai";
export const PRODUCTION_HOST_PORT = "127.0.0.1:3100";
export const PRODUCTION_PHASE_VERIFIER = "projectai-production-phase-verifier";

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
  ["running", new Set(["awaiting_verification", "failed", "blocked"])],
  ["awaiting_verification", new Set(["succeeded", "failed", "blocked", "awaiting_rollback_verification"])],
  ["failed", new Set(["running", "awaiting_rollback_verification", "rollback_failed", "blocked"])],
  ["succeeded", new Set(["awaiting_rollback_verification"])],
  ["awaiting_rollback_verification", new Set(["rolled_back", "rollback_failed"])],
  ["rolled_back", new Set()],
  ["rollback_failed", new Set(["awaiting_rollback_verification", "blocked"])],
  ["blocked", new Set(["authorized", "awaiting_rollback_verification"])],
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
  action,
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
  const phases = [...new Set(authorizedPhases)].sort((a, b) => a - b);
  if (phases.length !== 1) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Each Production Authorization must authorize exactly one Phase.",
    );
  }
  if (!AUTHORIZATION_ACTIONS.includes(action)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization action is invalid.",
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
    authorizedPhases: phases,
    action,
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
    value.authorizedPhases.length !== 1 ||
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
  if (!AUTHORIZATION_ACTIONS.includes(value.action)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization action is invalid.",
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

export function assertProductionAuthorizationIdentity(
  value,
  { environment, phase, action, publicKey } = {},
) {
  assertAuthorizationShape(value);
  if (phase !== undefined && !value.authorizedPhases.includes(Number(phase))) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_NOT_AUTHORIZED",
      "Requested phase is outside the Production Authorization scope.",
    );
  }
  if (!AUTHORIZATION_ACTIONS.includes(action) || value.action !== action) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      "Production Authorization is bound to a different action.",
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

export function assertProductionAuthorizationFresh(value, { now = new Date() } = {}) {
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
  return value;
}

export function assertProductionAuthorization(
  value,
  { now = new Date(), environment, phase, action, publicKey } = {},
) {
  assertProductionAuthorizationIdentity(value, {
    environment,
    phase,
    action,
    publicKey,
  });
  assertProductionAuthorizationFresh(value, { now });
  return value;
}

export function assertAuthorizationBindings({
  authorization,
  session,
  manifest,
  productionBaseline,
  goNoGo,
  phase,
  action,
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
  if (!AUTHORIZATION_ACTIONS.includes(action) || authorization.action !== action) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      "Action is outside the Authorization scope.",
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
    (numericPhase <= 2 && current.app.containerId !== expectedContainer) ||
    (numericPhase <= 2 && current.app.imageDigest !== expectedImage)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_BASELINE_DRIFT",
      "Production baseline changed after authorization.",
    );
  }
}

export function assertPhasePrerequisite({
  phase,
  previousReport,
  sessionId,
  session,
  manifest,
}) {
  const definition = phaseDefinition(phase);
  if (definition.prerequisitePhase === null) return;
  if (!previousReport) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_PREREQUISITE_MISSING",
      "Previous phase success report is required.",
    );
  }
  if (
    previousReport.reportType !== "production-rollout-phase-verification" ||
    previousReport.producer !== RELEASE_REPORT_PRODUCER ||
    previousReport.producerVersion !== PRODUCTION_ROLLOUT_VERSION ||
    previousReport.releaseSessionId !== sessionId ||
    previousReport.phase !== definition.prerequisitePhase ||
    previousReport.phaseState !== "succeeded" ||
    previousReport.result !== "passed" ||
    (session && previousReport.releaseCandidateSha !== session.releaseCandidateSha) ||
    (manifest && previousReport.releaseImageDigest !== manifest.releaseImageDigest) ||
    (manifest &&
      previousReport.databaseToolsImageDigest !== manifest.databaseToolsImageDigest) ||
    (manifest && previousReport.releaseManifestDigest !== manifest.digest)
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

export function assertRuntimeImageBinding(metadata, expected, label = "runtime") {
  try {
    assertImageContract(metadata, expected);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      `${label} does not run the trusted Manifest image contract.`,
    );
  }
  return true;
}

export function assertNoCallerImageOverride(environment, variables = process.env) {
  if (
    environment === "production" &&
    [
      "PRODUCTION_APP_IMAGE",
      "PRODUCTION_DB_TOOLS_IMAGE",
      "PROJECTAI_ROLLBACK_IMAGE",
      "PROJECTAI_TRUSTED_ROLLBACK_IMAGE",
    ].some((name) => Object.prototype.hasOwnProperty.call(variables, name))
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      "Caller-supplied Production image environment variables are forbidden.",
    );
  }
  return true;
}

export function assertTrustedBaselineManifest({ manifest, baseline, session }) {
  if (
    manifest.productionBaselineDigest !== baseline.digest ||
    session.productionBaselineDigest !== baseline.digest ||
    manifest.currentProductionImage !== baseline.app?.imageDigest ||
    manifest.rollbackImage !== baseline.app?.imageDigest
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      "Release Manifest rollback image is not bound to the trusted Production baseline.",
    );
  }
  return true;
}

export function assertProductionEgressMembership(
  members,
  { embeddingRequired = false } = {},
) {
  if (!Array.isArray(members) || members.some((value) => typeof value !== "string")) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Production Egress membership could not be established.",
    );
  }
  const unique = [...new Set(members)].sort();
  const allowed = new Set(["project-ai-os", "project-ai-os-embedding-worker"]);
  if (
    unique.some((name) => !allowed.has(name)) ||
    !unique.includes("project-ai-os") ||
    (embeddingRequired && !unique.includes("project-ai-os-embedding-worker"))
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Production Egress contains a forbidden service or is missing an allowed runtime.",
    );
  }
  return unique;
}

export function productionEgressExpectation(phase, { rollback = false } = {}) {
  const numericPhase = phaseDefinition(phase).phase;
  if (numericPhase < 2) return null;
  return {
    embeddingRequired:
      (!rollback && numericPhase >= 4) || (rollback && numericPhase >= 5),
  };
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
    "projectai-production-egress:",
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
  const postgresStart = contents.indexOf("\n  projectai-postgres:", embeddingStart);
  const minioStart = contents.indexOf("\n  projectai-minio:", postgresStart);
  const minioInitStart = contents.indexOf("\n  projectai-minio-init:", minioStart);
  const migrateStart = contents.indexOf("\n  projectai-migrate:", minioInitStart);
  const storageStart = contents.indexOf("\n  projectai-storage-operations:", migrateStart);
  const networksStart = contents.indexOf("\nnetworks:", storageStart);
  const app = contents.slice(appStart, documentStart);
  const document = contents.slice(documentStart, embeddingStart);
  const embedding = contents.slice(embeddingStart, postgresStart);
  const postgres = contents.slice(postgresStart, minioStart);
  const minio = contents.slice(minioStart, minioInitStart);
  const minioInit = contents.slice(minioInitStart, migrateStart);
  const migrate = contents.slice(migrateStart, storageStart);
  const storage = contents.slice(storageStart, networksStart);
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
  if (
    !app.includes("projectai-production-egress") ||
    !embedding.includes("projectai-production-egress") ||
    document.includes("projectai-production-egress") ||
    postgres.includes("projectai-production-egress") ||
    minio.includes("projectai-production-egress") ||
    minioInit.includes("projectai-production-egress") ||
    migrate.includes("projectai-production-egress") ||
    storage.includes("projectai-production-egress") ||
    !document.includes(".env.embedding-production")
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_COMPOSE_CONTRACT_INVALID",
      "Production Egress or Document Worker Embedding configuration is invalid.",
    );
  }
  return true;
}

const DEPLOYMENT_LOCK_KEYS = [
  "authorizationId",
  "currentPhase",
  "digest",
  "expiresAt",
  "heartbeatAt",
  "leaseToken",
  "lockId",
  "ownerHostname",
  "ownerPid",
  "ownerUid",
  "releaseCandidateSha",
  "releaseSessionId",
  "schemaVersion",
  "startedAt",
];
const LIFECYCLE_GUARD_KEYS = [
  "acquiredAt",
  "authorizationId",
  "currentPhase",
  "digest",
  "guardId",
  "operation",
  "ownerHostname",
  "ownerPid",
  "ownerUid",
  "releaseCandidateSha",
  "releaseSessionId",
  "schemaVersion",
  "targetLockDigest",
  "targetLockId",
];
const JOURNAL_APPEND_CLAIM_KEYS = [
  "claimedAt",
  "claimId",
  "digest",
  "entry",
  "ownerHostname",
  "ownerPid",
  "ownerUid",
  "previousDigest",
  "recordType",
  "schemaVersion",
];
const JOURNAL_RECOVERY_GUARD_KEYS = [
  "acquiredAt",
  "claimDigest",
  "claimId",
  "digest",
  "entryDigest",
  "guardId",
  "ownerHostname",
  "ownerPid",
  "ownerUid",
  "recordType",
  "schemaVersion",
];
const SECURE_METADATA_MAX_BYTES = 16 * 1024;
const JOURNAL_MAX_BYTES = 32 * 1024 * 1024;
const JOURNAL_APPEND_WAIT_MS = 10_000;

function currentUid() {
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production lock ownership cannot be established on this platform.",
    );
  }
  return uid;
}

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function digestWithoutDigest(value) {
  return digestObject(
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")),
  );
}

function assertDeploymentLockRecord(value, { fileUid } = {}) {
  if (!exactKeys(value, DEPLOYMENT_LOCK_KEYS) || value.schemaVersion !== 2) {
    throw new Error("invalid Deployment Lock schema");
  }
  assertReleaseSessionId(value.releaseSessionId);
  assertFullSha(value.releaseCandidateSha, "releaseCandidateSha");
  phaseDefinition(value.currentPhase);
  assertIsoTimestamp(value.startedAt, "startedAt");
  assertIsoTimestamp(value.heartbeatAt, "heartbeatAt");
  assertIsoTimestamp(value.expiresAt, "expiresAt");
  assertDigest(value.digest, "digest");
  if (
    !/^pl-[0-9a-f]{32}$/.test(value.lockId ?? "") ||
    !/^pa-[0-9a-f]{32}$/.test(value.authorizationId ?? "") ||
    !/^[0-9a-f]{64}$/.test(value.leaseToken ?? "") ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid < 0 ||
    !Number.isSafeInteger(value.ownerUid) ||
    value.ownerUid < 0 ||
    !/^[A-Za-z0-9._-]{1,255}$/.test(value.ownerHostname ?? "") ||
    (fileUid !== undefined && value.ownerUid !== fileUid) ||
    Date.parse(value.startedAt) > Date.parse(value.heartbeatAt) ||
    Date.parse(value.heartbeatAt) >= Date.parse(value.expiresAt) ||
    value.digest !== digestWithoutDigest(value)
  ) {
    throw new Error("invalid Deployment Lock identity or digest");
  }
  return value;
}

function assertLifecycleGuardRecord(value, { fileUid } = {}) {
  if (!exactKeys(value, LIFECYCLE_GUARD_KEYS) || value.schemaVersion !== 2) {
    throw new Error("invalid lock lifecycle guard schema");
  }
  assertReleaseSessionId(value.releaseSessionId);
  assertFullSha(value.releaseCandidateSha, "releaseCandidateSha");
  phaseDefinition(value.currentPhase);
  assertIsoTimestamp(value.acquiredAt, "acquiredAt");
  assertDigest(value.digest, "digest");
  if (
    !/^pg-[0-9a-f]{32}$/.test(value.guardId ?? "") ||
    !["acquire", "update", "release", "stale-clear"].includes(value.operation) ||
    !/^pa-[0-9a-f]{32}$/.test(value.authorizationId ?? "") ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid <= 0 ||
    !Number.isSafeInteger(value.ownerUid) ||
    value.ownerUid < 0 ||
    !/^[A-Za-z0-9._-]{1,255}$/.test(value.ownerHostname ?? "") ||
    !/^pl-[0-9a-f]{32}$/.test(value.targetLockId ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(value.targetLockDigest ?? "") ||
    (fileUid !== undefined && value.ownerUid !== fileUid) ||
    value.digest !== digestWithoutDigest(value)
  ) {
    throw new Error("invalid lock lifecycle guard identity or digest");
  }
  return value;
}

function assertJournalEntryRecord(value, expectedPreviousDigest) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.previousDigest !== expectedPreviousDigest ||
    (value.previousDigest !== null &&
      !/^sha256:[0-9a-f]{64}$/.test(value.previousDigest ?? "")) ||
    !/^sha256:[0-9a-f]{64}$/.test(value.digest ?? "") ||
    value.digest !== digestWithoutDigest(value)
  ) {
    throw new Error("invalid Journal entry");
  }
  assertSanitized(value);
  return value;
}

function assertJournalAppendClaimRecord(value, { fileUid } = {}) {
  if (
    !exactKeys(value, JOURNAL_APPEND_CLAIM_KEYS) ||
    value.schemaVersion !== 1 ||
    value.recordType !== "production-rollout-journal-append-claim"
  ) {
    throw new Error("invalid Journal append claim schema");
  }
  assertIsoTimestamp(value.claimedAt, "claimedAt");
  if (
    !/^jc-[0-9a-f]{32}$/.test(value.claimId ?? "") ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid <= 0 ||
    !Number.isSafeInteger(value.ownerUid) ||
    value.ownerUid < 0 ||
    !/^[A-Za-z0-9._-]{1,255}$/.test(value.ownerHostname ?? "") ||
    (value.previousDigest !== null &&
      !/^sha256:[0-9a-f]{64}$/.test(value.previousDigest ?? "")) ||
    (fileUid !== undefined && value.ownerUid !== fileUid) ||
    value.digest !== digestWithoutDigest(value)
  ) {
    throw new Error("invalid Journal append claim identity or digest");
  }
  assertJournalEntryRecord(value.entry, value.previousDigest);
  assertSanitized(value);
  return value;
}

function assertJournalRecoveryGuardRecord(value, { fileUid } = {}) {
  if (
    !exactKeys(value, JOURNAL_RECOVERY_GUARD_KEYS) ||
    value.schemaVersion !== 1 ||
    value.recordType !== "production-rollout-journal-recovery-guard"
  ) {
    throw new Error("invalid Journal recovery guard schema");
  }
  assertIsoTimestamp(value.acquiredAt, "acquiredAt");
  if (
    !/^jg-[0-9a-f]{32}$/.test(value.guardId ?? "") ||
    !/^jc-[0-9a-f]{32}$/.test(value.claimId ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(value.claimDigest ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(value.entryDigest ?? "") ||
    !Number.isSafeInteger(value.ownerPid) ||
    value.ownerPid <= 0 ||
    !Number.isSafeInteger(value.ownerUid) ||
    value.ownerUid < 0 ||
    !/^[A-Za-z0-9._-]{1,255}$/.test(value.ownerHostname ?? "") ||
    (fileUid !== undefined && value.ownerUid !== fileUid) ||
    value.digest !== digestWithoutDigest(value)
  ) {
    throw new Error("invalid Journal recovery guard identity or digest");
  }
  assertSanitized(value);
  return value;
}

async function syncDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeSecureTemporary(targetPath, value) {
  const temporary = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    return temporary;
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function publishSecureNoReplace(targetPath, value) {
  const temporary = await writeSecureTemporary(targetPath, value);
  try {
    await link(temporary, targetPath);
    await unlink(temporary);
    await syncDirectory(path.dirname(targetPath));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    if (
      error instanceof ProductionRolloutError ||
      ["EEXIST", "ENOTEMPTY"].includes(error?.code)
    ) {
      throw error;
    }
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Lifecycle guard publication could not be completed safely.",
    );
  }
}

async function replaceSecureAtomic(targetPath, value) {
  const temporary = await writeSecureTemporary(targetPath, value);
  try {
    await rename(temporary, targetPath);
    await syncDirectory(path.dirname(targetPath));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readSecureMetadata(
  filename,
  validator,
  { allowIncompleteNoReplacePublish = false } = {},
) {
  let handle;
  try {
    handle = await open(
      filename,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (
      !before.isFile() ||
      (before.mode & 0o777) !== 0o600 ||
      before.uid !== currentUid() ||
      (before.nlink !== 1 &&
        !(allowIncompleteNoReplacePublish && before.nlink === 2)) ||
      before.size < 2 ||
      before.size > SECURE_METADATA_MAX_BYTES
    ) {
      throw new Error("unsafe metadata file");
    }
    const contents = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathStats = await lstat(filename);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      pathStats.isSymbolicLink() ||
      pathStats.dev !== after.dev ||
      pathStats.ino !== after.ino
    ) {
      throw new Error("metadata file changed while being read");
    }
    return validator(JSON.parse(contents), { fileUid: after.uid });
  } finally {
    await handle?.close().catch(() => {});
  }
}

function defaultPidState(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error?.code === "ESRCH") return "dead";
    return "unknown";
  }
}

function pidState(isPidAlive, pid) {
  if (!isPidAlive) return defaultPidState(pid);
  const value = isPidAlive(pid);
  if (value === true || value === "alive") return "alive";
  if (value === false || value === "dead") return "dead";
  return "unknown";
}

export function assertDeploymentLockLease(
  lock,
  { now = new Date(), isPidAlive, requireOwnership = true } = {},
) {
  assertDeploymentLockRecord(lock);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("Invalid lock lease time.");
  const heartbeatExpired =
    lock.ownerPid > 0 &&
    nowMs - Date.parse(lock.heartbeatAt) >= PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS;
  if (Date.parse(lock.expiresAt) <= nowMs || heartbeatExpired) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_STALE",
      "Production rollout lock lease or heartbeat has expired and requires explicit review.",
    );
  }
  if (lock.ownerPid > 0) {
    if (lock.ownerHostname !== os.hostname() || lock.ownerUid !== currentUid()) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Production rollout lock is actively owned by another host or user.",
      );
    }
    const state = pidState(isPidAlive, lock.ownerPid);
    if (state === "dead") {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_STALE",
        "Production rollout lock owner PID is dead and requires explicit review.",
      );
    }
    if (state !== "alive" || (requireOwnership && lock.ownerPid !== process.pid)) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Production rollout lock ownership cannot be claimed by this process.",
      );
    }
  }
  return lock;
}

export function assertDeploymentLockClearable(
  lock,
  { now = new Date(), isPidAlive } = {},
) {
  assertDeploymentLockRecord(lock);
  const expired = Date.parse(lock.expiresAt) <= now.getTime();
  const heartbeatExpired =
    lock.ownerPid > 0 &&
    now.getTime() - Date.parse(lock.heartbeatAt) >= PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS;
  if (lock.ownerPid === 0) {
    if (expired) return lock;
  } else if (lock.ownerHostname === os.hostname() && lock.ownerUid === currentUid()) {
    const state = pidState(isPidAlive, lock.ownerPid);
    if ((expired || heartbeatExpired) && state === "dead") return lock;
    if (state === "dead") return lock;
  }
  throw new ProductionRolloutError(
    "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    "A live or unverifiable Production rollout lock must not be cleared.",
  );
}

export function assertDeploymentLockBinding(lock, { session, phase }) {
  assertDeploymentLockRecord(lock);
  if (
    lock.releaseSessionId !== session.releaseSessionId ||
    lock.releaseCandidateSha !== session.releaseCandidateSha ||
    lock.currentPhase !== phaseDefinition(phase).phase
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Deployment Lock is not bound to the requested Release Session, SHA, and Phase.",
    );
  }
  return lock;
}

function assertExpectedDeploymentLock(current, expected) {
  try {
    assertDeploymentLockRecord(expected);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Expected Deployment Lock ownership metadata is invalid.",
    );
  }
  const identityFields = [
    "releaseSessionId",
    "releaseCandidateSha",
    "lockId",
    "leaseToken",
    "ownerPid",
    "ownerHostname",
    "ownerUid",
    "digest",
  ];
  if (!current || identityFields.some((field) => current[field] !== expected[field])) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Deployment Lock ownership changed before the requested lifecycle operation.",
    );
  }
  return current;
}

function lifecycleGuardPath(lockPath) {
  return `${lockPath}.lifecycle`;
}

function lifecycleReceiptRoot(lockPath) {
  return `${lockPath}.lifecycle-receipts`;
}

async function assertOwnerDirectory(directory, label) {
  const metadata = await lstat(directory);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.uid !== currentUid() ||
    (metadata.mode & 0o777) !== 0o700
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      `${label} is not an owner-only regular directory.`,
    );
  }
  return metadata;
}

async function publishSecureDirectoryNoReplace(targetPath, value) {
  const temporary = await writeSecureTemporary(targetPath, value);
  const metadataPath = path.join(targetPath, "metadata.json");
  try {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      try {
        await mkdir(targetPath, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      let existingEntries;
      try {
        await assertOwnerDirectory(targetPath, "Lifecycle guard directory");
        existingEntries = (await readdir(targetPath)).sort();
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (
        existingEntries.length > 0 &&
        JSON.stringify(existingEntries) !== JSON.stringify(["metadata.json"])
      ) {
        throw new ProductionRolloutError(
          "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
          "Lifecycle guard directory contains unexpected entries.",
        );
      }
      try {
        await link(temporary, metadataPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        const temporaryMetadata = await lstat(temporary).catch(() => null);
        if (
          !temporaryMetadata?.isFile() ||
          temporaryMetadata.uid !== currentUid() ||
          (temporaryMetadata.mode & 0o777) !== 0o600 ||
          temporaryMetadata.nlink !== 1
        ) {
          throw new ProductionRolloutError(
            "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
            "Lifecycle guard temporary metadata changed before publication.",
          );
        }
        continue;
      }
      await unlink(temporary);
      await syncDirectory(targetPath);
      await syncDirectory(path.dirname(targetPath));
      return;
    }
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Lifecycle guard publication did not stabilize safely.",
    );
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readSecureDirectoryMetadata(
  directory,
  validator,
  label = "Lifecycle guard",
) {
  const before = await assertOwnerDirectory(directory, `${label} directory`);
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(["metadata.json"])) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      `${label} directory contents are invalid.`,
    );
  }
  const value = await readSecureMetadata(
    path.join(directory, "metadata.json"),
    validator,
    { allowIncompleteNoReplacePublish: true },
  );
  const after = await assertOwnerDirectory(directory, `${label} directory`);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(["metadata.json"])
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      `${label} directory changed while being read.`,
    );
  }
  return value;
}

async function readSecureDirectoryMetadataOrNull(directory, validator, label) {
  try {
    const before = await assertOwnerDirectory(directory, `${label} directory`);
    const entries = await readdir(directory);
    if (entries.length === 0) {
      const after = await assertOwnerDirectory(directory, `${label} directory`);
      const afterEntries = await readdir(directory);
      if (before.dev === after.dev && before.ino === after.ino && afterEntries.length === 0) {
        return null;
      }
    }
    return await readSecureDirectoryMetadata(directory, validator, label);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertExpectedLifecycleGuard(current, expected) {
  try {
    assertLifecycleGuardRecord(expected);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Expected lifecycle guard metadata is invalid.",
    );
  }
  if (!current || current.guardId !== expected.guardId || current.digest !== expected.digest) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Lifecycle guard ownership changed before retirement.",
    );
  }
  return current;
}

export function assertDeploymentLifecycleGuardClearable(
  guard,
  { now = new Date(), isPidAlive } = {},
) {
  assertLifecycleGuardRecord(guard);
  const oldEnough =
    now.getTime() - Date.parse(guard.acquiredAt) >= PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS;
  const ownerDead =
    guard.ownerHostname === os.hostname() &&
    guard.ownerUid === currentUid() &&
    pidState(isPidAlive, guard.ownerPid) === "dead";
  if (!oldEnough || !ownerDead) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "A live or unverifiable lifecycle guard must not be cleared.",
    );
  }
  return guard;
}

export function assertDeploymentLifecycleGuardBinding(guard, { session, phase }) {
  assertLifecycleGuardRecord(guard);
  if (
    guard.releaseSessionId !== session.releaseSessionId ||
    guard.releaseCandidateSha !== session.releaseCandidateSha ||
    guard.currentPhase !== phaseDefinition(phase).phase
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Lifecycle guard is not bound to the requested Release Session, SHA, and Phase.",
    );
  }
  return guard;
}

export async function readDeploymentLifecycleGuard(lockPath) {
  try {
    return await readSecureDirectoryMetadataOrNull(
      lifecycleGuardPath(lockPath),
      assertLifecycleGuardRecord,
      "Deployment Lock lifecycle guard",
    );
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Deployment Lock lifecycle guard cannot be interpreted safely.",
    );
  }
}

async function retireLifecycleGuard(lockPath, expectedGuard) {
  const guardPath = lifecycleGuardPath(lockPath);
  const current = assertExpectedLifecycleGuard(
    await readDeploymentLifecycleGuard(lockPath),
    expectedGuard,
  );
  const receiptRoot = lifecycleReceiptRoot(lockPath);
  await mkdir(receiptRoot, { recursive: true, mode: 0o700 });
  await assertOwnerDirectory(receiptRoot, "Lifecycle guard receipt directory");
  const receiptPath = path.join(
    receiptRoot,
    `${current.guardId}--${current.digest.slice("sha256:".length)}`,
  );
  try {
    await rename(guardPath, receiptPath);
    await syncDirectory(path.dirname(guardPath));
    await syncDirectory(receiptRoot);
    return true;
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY", "ENOENT"].includes(error?.code)) throw error;
    let receipt;
    try {
      receipt = await readSecureDirectoryMetadata(receiptPath, assertLifecycleGuardRecord);
    } catch {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Lifecycle guard receipt collision cannot be interpreted safely.",
      );
    }
    assertExpectedLifecycleGuard(receipt, expectedGuard);
    if (await readDeploymentLifecycleGuard(lockPath)) {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "A newer lifecycle guard is active.",
      );
    }
    return false;
  }
}

export async function clearStaleDeploymentLifecycleGuard({
  lockPath,
  expectedGuard,
  now,
  isPidAlive,
}) {
  const current = assertExpectedLifecycleGuard(
    await readDeploymentLifecycleGuard(lockPath),
    expectedGuard,
  );
  assertDeploymentLifecycleGuardClearable(current, {
    now: now ?? new Date(),
    isPidAlive,
  });
  return retireLifecycleGuard(lockPath, current);
}

async function acquireLifecycleGuard({
  lockPath,
  operation,
  expectedLock,
  allowStaleGuard = false,
  now,
  isPidAlive,
}) {
  const guardPath = lifecycleGuardPath(lockPath);
  const guardNow = now ?? new Date();
  const guard = withDigest({
    schemaVersion: 2,
    guardId: `pg-${randomUUID().replaceAll("-", "")}`,
    operation,
    releaseSessionId: expectedLock.releaseSessionId,
    releaseCandidateSha: expectedLock.releaseCandidateSha,
    currentPhase: expectedLock.currentPhase,
    authorizationId: expectedLock.authorizationId,
    targetLockId: expectedLock.lockId,
    targetLockDigest: expectedLock.digest,
    ownerPid: process.pid,
    ownerHostname: os.hostname(),
    ownerUid: currentUid(),
    acquiredAt: guardNow.toISOString(),
  });
  assertLifecycleGuardRecord(guard);
  const publish = async () => {
    try {
      await publishSecureDirectoryNoReplace(guardPath, guard);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Another process owns the Deployment Lock lifecycle operation.",
      );
    }
  };
  try {
    await publish();
  } catch (error) {
    if (!allowStaleGuard || error?.code !== "PRODUCTION_DEPLOYMENT_LOCK_HELD") throw error;
    let existing;
    try {
      existing = await readDeploymentLifecycleGuard(lockPath);
    } catch (readError) {
      throw readError;
    }
    try {
      assertDeploymentLifecycleGuardClearable(existing, {
        now: now ?? new Date(),
        isPidAlive,
      });
    } catch {
      throw error;
    }
    if (
      existing.targetLockId !== expectedLock.lockId ||
      existing.releaseSessionId !== expectedLock.releaseSessionId ||
      existing.releaseCandidateSha !== expectedLock.releaseCandidateSha
    ) {
      throw error;
    }
    await retireLifecycleGuard(lockPath, existing);
    await publish();
  }
  return async () => retireLifecycleGuard(lockPath, guard);
}

export async function acquireDeploymentLock({ lockPath, metadata }) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  assertDeploymentLockRecord(metadata);
  const releaseGuard = await acquireLifecycleGuard({
    lockPath,
    operation: "acquire",
    expectedLock: metadata,
  });
  try {
    await publishSecureNoReplace(lockPath, metadata);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ProductionRolloutError(
        "PRODUCTION_DEPLOYMENT_LOCK_HELD",
        "Production rollout lock already exists and requires review.",
      );
    }
    throw error;
  } finally {
    await releaseGuard();
  }
  return await readDeploymentLock(lockPath);
}

export async function readDeploymentLock(
  lockPath,
  { validateLease = false, now, isPidAlive, requireOwnership = true } = {},
) {
  try {
    const value = await readSecureMetadata(
      lockPath,
      assertDeploymentLockRecord,
      { allowIncompleteNoReplacePublish: true },
    );
    if (validateLease) {
      assertDeploymentLockLease(value, {
        now: now ?? new Date(),
        isPidAlive,
        requireOwnership,
      });
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

export async function releaseDeploymentLock({
  lockPath,
  expectedLock,
  allowStale = false,
  now,
  isPidAlive,
}) {
  try {
    assertDeploymentLockRecord(expectedLock);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Expected Deployment Lock ownership metadata is invalid.",
    );
  }
  const releaseGuard = await acquireLifecycleGuard({
    lockPath,
    operation: allowStale ? "stale-clear" : "release",
    expectedLock,
    allowStaleGuard: allowStale,
    now,
    isPidAlive,
  });
  try {
    const current = assertExpectedDeploymentLock(
      await readDeploymentLock(lockPath),
      expectedLock,
    );
    const checkedAt = now ?? new Date();
    if (allowStale) {
      assertDeploymentLockClearable(current, { now: checkedAt, isPidAlive });
    } else {
      assertDeploymentLockLease(current, { now: checkedAt, isPidAlive });
      if (current.ownerPid !== process.pid) {
        throw new ProductionRolloutError(
          "PRODUCTION_DEPLOYMENT_LOCK_HELD",
          "Only the active Deployment Lock owner may release it.",
        );
      }
    }
    await unlink(lockPath);
    await syncDirectory(path.dirname(lockPath));
    return true;
  } finally {
    await releaseGuard();
  }
}

export async function releaseIdleDeploymentLock({
  lockPath,
  expectedLock,
  phase,
  authorizationId,
  now,
  isPidAlive,
}) {
  try {
    assertDeploymentLockRecord(expectedLock);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Expected idle Deployment Lock ownership metadata is invalid.",
    );
  }
  if (expectedLock.ownerPid !== 0) {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Only the exact newly acquired idle Deployment Lock may use controlled cleanup.",
    );
  }
  const claimed = await updateDeploymentLock({
    lockPath,
    expectedLock,
    phase,
    authorizationId,
    now,
    isPidAlive,
  });
  return releaseDeploymentLock({
    lockPath,
    expectedLock: claimed,
    now,
    isPidAlive,
  });
}

export async function updateDeploymentLock({
  lockPath,
  expectedLock,
  phase,
  authorizationId,
  idle = false,
  now,
  isPidAlive,
}) {
  try {
    assertDeploymentLockRecord(expectedLock);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_DEPLOYMENT_LOCK_HELD",
      "Expected Deployment Lock ownership metadata is invalid.",
    );
  }
  const releaseGuard = await acquireLifecycleGuard({
    lockPath,
    operation: "update",
    expectedLock,
    now,
    isPidAlive,
  });
  try {
    const current = assertExpectedDeploymentLock(
      await readDeploymentLock(lockPath),
      expectedLock,
    );
    const checkedAt = now ?? new Date();
    assertDeploymentLockLease(current, { now: checkedAt, isPidAlive });
    const next = withDigest({
      ...current,
      currentPhase: phaseDefinition(phase).phase,
      authorizationId,
      ownerPid: idle ? 0 : process.pid,
      ownerHostname: os.hostname(),
      ownerUid: currentUid(),
      leaseToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
      heartbeatAt: checkedAt.toISOString(),
      expiresAt: new Date(
        checkedAt.getTime() +
          (idle ? PRODUCTION_LOCK_IDLE_TIMEOUT_MS : AUTHORIZATION_MAX_LIFETIME_MS),
      ).toISOString(),
    });
    assertDeploymentLockRecord(next);
    await replaceSecureAtomic(lockPath, next);
    return await readDeploymentLock(lockPath);
  } finally {
    await releaseGuard();
  }
}

export function createLockMetadata({
  session,
  phase,
  authorizationId,
  now = new Date(),
  ttlMs = AUTHORIZATION_MAX_LIFETIME_MS,
  ownerPid = process.pid,
  ownerHostname = os.hostname(),
  ownerUid = currentUid(),
}) {
  const value = withDigest({
    schemaVersion: 2,
    lockId: `pl-${randomUUID().replaceAll("-", "")}`,
    releaseSessionId: session.releaseSessionId,
    releaseCandidateSha: session.releaseCandidateSha,
    currentPhase: phaseDefinition(phase).phase,
    authorizationId,
    ownerPid,
    ownerHostname,
    ownerUid,
    leaseToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    heartbeatAt: now.toISOString(),
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  return assertDeploymentLockRecord(value);
}

async function readSecureJournal(journalPath) {
  let handle;
  try {
    handle = await open(
      journalPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== currentUid() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      before.size > JOURNAL_MAX_BYTES
    ) {
      throw new Error("unsafe Journal file");
    }
    const contents = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathStats = await lstat(journalPath);
    if (before.size !== after.size) {
      const error = new Error("Journal changed while being read");
      error.code = "PRODUCTION_JOURNAL_READ_RETRY";
      throw error;
    }
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      pathStats.isSymbolicLink() ||
      pathStats.dev !== after.dev ||
      pathStats.ino !== after.ino
    ) {
      throw new Error("Journal changed while being read");
    }
    return contents;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readJournal(journalPath) {
  let contents;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      contents = await readSecureJournal(journalPath);
      break;
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      if (error?.code === "PRODUCTION_JOURNAL_READ_RETRY") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      if (error instanceof ProductionRolloutError) throw error;
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Production phase Journal is not a safe owner-only regular file.",
      );
    }
  }
  if (contents === undefined) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production phase Journal did not stabilize for a safe read.",
    );
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

function journalRecoveryGuardPath(claimPath) {
  return `${claimPath}.recovery`;
}

function journalRecoveryReceiptRoot(claimPath) {
  return `${claimPath}.recovery-receipts`;
}

function isLocallyDeadAfterHeartbeatTimeout(
  value,
  timestampField,
  { now, isPidAlive },
) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Journal recovery review time is invalid.",
    );
  }
  return (
    nowMs - Date.parse(value[timestampField]) >= PRODUCTION_LOCK_HEARTBEAT_TIMEOUT_MS &&
    value.ownerHostname === os.hostname() &&
    value.ownerUid === currentUid() &&
    pidState(isPidAlive, value.ownerPid) === "dead"
  );
}

async function readJournalAppendClaim(claimPath, expectedPreviousDigest) {
  try {
    const claim = await readSecureMetadata(
      claimPath,
      assertJournalAppendClaimRecord,
      { allowIncompleteNoReplacePublish: true },
    );
    if (claim.previousDigest !== expectedPreviousDigest) {
      throw new Error("Journal append claim is bound to another previous Digest");
    }
    return claim;
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production Journal append claim is invalid.",
    );
  }
}

async function readJournalRecoveryGuard(claimPath) {
  try {
    return await readSecureDirectoryMetadataOrNull(
      journalRecoveryGuardPath(claimPath),
      assertJournalRecoveryGuardRecord,
      "Journal recovery guard",
    );
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production Journal recovery guard cannot be interpreted safely.",
    );
  }
}

function assertExpectedJournalRecoveryGuard(current, expected) {
  try {
    assertJournalRecoveryGuardRecord(expected);
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Expected Journal recovery guard metadata is invalid.",
    );
  }
  if (!current || current.guardId !== expected.guardId || current.digest !== expected.digest) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Journal recovery guard ownership changed before retirement.",
    );
  }
  return current;
}

async function retireJournalRecoveryGuard(claimPath, expectedGuard) {
  const guardPath = journalRecoveryGuardPath(claimPath);
  const current = assertExpectedJournalRecoveryGuard(
    await readJournalRecoveryGuard(claimPath),
    expectedGuard,
  );
  const receiptRoot = journalRecoveryReceiptRoot(claimPath);
  await mkdir(receiptRoot, { recursive: true, mode: 0o700 });
  await assertOwnerDirectory(receiptRoot, "Journal recovery receipt directory");
  const receiptPath = path.join(
    receiptRoot,
    `${current.guardId}--${current.digest.slice("sha256:".length)}`,
  );
  try {
    await rename(guardPath, receiptPath);
    await syncDirectory(path.dirname(guardPath));
    await syncDirectory(receiptRoot);
    return true;
  } catch (error) {
    if (!["EEXIST", "ENOTEMPTY", "ENOENT"].includes(error?.code)) throw error;
    let receipt;
    try {
      receipt = await readSecureDirectoryMetadata(
        receiptPath,
        assertJournalRecoveryGuardRecord,
        "Journal recovery receipt",
      );
    } catch {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Journal recovery guard receipt collision cannot be interpreted safely.",
      );
    }
    assertExpectedJournalRecoveryGuard(receipt, expectedGuard);
    if (await readJournalRecoveryGuard(claimPath)) return false;
    return false;
  }
}

async function acquireJournalRecoveryGuard({ claimPath, claim, now, isPidAlive }) {
  const guard = withDigest({
    schemaVersion: 1,
    recordType: "production-rollout-journal-recovery-guard",
    guardId: `jg-${randomUUID().replaceAll("-", "")}`,
    claimId: claim.claimId,
    claimDigest: claim.digest,
    entryDigest: claim.entry.digest,
    ownerPid: process.pid,
    ownerHostname: os.hostname(),
    ownerUid: currentUid(),
    acquiredAt: now.toISOString(),
  });
  assertJournalRecoveryGuardRecord(guard);
  const guardPath = journalRecoveryGuardPath(claimPath);
  const publish = async () => {
    try {
      await publishSecureDirectoryNoReplace(guardPath, guard);
      return true;
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) return false;
      throw error;
    }
  };
  if (!(await publish())) {
    let existing;
    try {
      existing = await readJournalRecoveryGuard(claimPath);
    } catch (error) {
      if (error instanceof ProductionRolloutError) return null;
      throw error;
    }
    if (!existing) return null;
    if (
      existing.claimId !== claim.claimId ||
      existing.claimDigest !== claim.digest ||
      existing.entryDigest !== claim.entry.digest
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Journal recovery guard is bound to another append claim.",
      );
    }
    if (
      !isLocallyDeadAfterHeartbeatTimeout(existing, "acquiredAt", {
        now,
        isPidAlive,
      })
    ) {
      return null;
    }
    try {
      await retireJournalRecoveryGuard(claimPath, existing);
    } catch (error) {
      if (error instanceof ProductionRolloutError) return null;
      throw error;
    }
    if (!(await publish())) return null;
  }
  return {
    guard,
    release: async () => retireJournalRecoveryGuard(claimPath, guard),
  };
}

async function commitClaimedJournalEntry(journalPath, next) {
  const before = await readJournal(journalPath);
  const committedMatches = before.filter((candidate) => candidate.digest === next.digest);
  if (committedMatches.length > 0) {
    if (
      committedMatches.length !== 1 ||
      canonicalJson(committedMatches[0]) !== canonicalJson(next)
    ) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Production Journal contains an ambiguous claimed entry.",
      );
    }
    return next;
  }
  if ((before.at(-1)?.digest ?? null) !== next.previousDigest) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production Journal moved without the claimed append entry.",
    );
  }

  let handle;
  try {
    handle = await open(
      journalPath,
      fsConstants.O_CREAT |
        fsConstants.O_WRONLY |
        fsConstants.O_APPEND |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const metadata = await handle.stat();
    const line = Buffer.from(`${JSON.stringify(next)}\n`, "utf8");
    if (
      !metadata.isFile() ||
      metadata.uid !== currentUid() ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.nlink !== 1 ||
      metadata.size + line.length > JOURNAL_MAX_BYTES
    ) {
      throw new Error("unsafe Journal append target");
    }
    const result = await handle.write(line, 0, line.length, null);
    if (result.bytesWritten !== line.length) {
      throw new Error("incomplete Journal append");
    }
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectory(path.dirname(journalPath));
    const committed = await readJournal(journalPath);
    const exactMatches = committed.filter((candidate) => candidate.digest === next.digest);
    if (
      exactMatches.length !== 1 ||
      canonicalJson(exactMatches[0]) !== canonicalJson(next)
    ) {
      throw new Error("Journal append was not committed exactly once");
    }
    return next;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production Journal append could not be committed safely.",
    );
  }
}

async function recoverJournalAppendClaim({
  journalPath,
  claimPath,
  claim,
  now,
  isPidAlive,
}) {
  if (
    !isLocallyDeadAfterHeartbeatTimeout(claim, "claimedAt", {
      now,
      isPidAlive,
    })
  ) {
    return null;
  }
  const ownership = await acquireJournalRecoveryGuard({
    claimPath,
    claim,
    now,
    isPidAlive,
  });
  if (!ownership) return null;
  try {
    const current = await readJournalAppendClaim(claimPath, claim.previousDigest);
    if (current.claimId !== claim.claimId || current.digest !== claim.digest) {
      throw new ProductionRolloutError(
        "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
        "Journal append claim changed during recovery.",
      );
    }
    return await commitClaimedJournalEntry(journalPath, current.entry);
  } finally {
    await ownership.release();
  }
}

export async function appendJournal(
  journalPath,
  entry,
  { now, isPidAlive, expectedPreviousDigest } = {},
) {
  await mkdir(path.dirname(journalPath), { recursive: true });
  const claimDirectory = `${journalPath}.append-claims`;
  await mkdir(claimDirectory, { recursive: true, mode: 0o700 });
  const claimDirectoryStats = await lstat(claimDirectory);
  if (
    claimDirectoryStats.isSymbolicLink() ||
    !claimDirectoryStats.isDirectory() ||
    claimDirectoryStats.uid !== currentUid() ||
    (claimDirectoryStats.mode & 0o777) !== 0o700
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Production Journal append-claim directory is unsafe.",
    );
  }
  const deadline = performance.now() + JOURNAL_APPEND_WAIT_MS;
  const entries = await readJournal(journalPath);
  const previousDigest = entries.at(-1)?.digest ?? null;
  if (
    expectedPreviousDigest !== undefined &&
    previousDigest !== expectedPreviousDigest
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_CHANGED",
      "Production Journal no longer matches the caller's reviewed state; reload and retry the operation.",
    );
  }
  const next = withDigest({
    schemaVersion: 1,
    ...entry,
    previousDigest,
  });
  assertJournalEntryRecord(next, previousDigest);
  const claim = withDigest({
    schemaVersion: 1,
    recordType: "production-rollout-journal-append-claim",
    claimId: `jc-${randomUUID().replaceAll("-", "")}`,
    previousDigest,
    entry: next,
    ownerPid: process.pid,
    ownerHostname: os.hostname(),
    ownerUid: currentUid(),
    claimedAt: (now ?? new Date()).toISOString(),
  });
  assertJournalAppendClaimRecord(claim);
  const claimName = previousDigest === null
    ? "genesis.json"
    : `${previousDigest.slice("sha256:".length)}.json`;
  const claimPath = path.join(claimDirectory, claimName);
  while (true) {
    try {
      await publishSecureNoReplace(claimPath, claim);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJournalAppendClaim(claimPath, previousDigest);
      const latest = await readJournal(journalPath);
      const latestDigest = latest.at(-1)?.digest ?? null;
      if (latestDigest !== previousDigest) {
        if (
          existing.entry.digest === next.digest &&
          latest.some(
            (candidate) =>
              candidate.digest === next.digest &&
              canonicalJson(candidate) === canonicalJson(existing.entry),
          )
        ) {
          return existing.entry;
        }
        throw new ProductionRolloutError(
          "PRODUCTION_ROLLOUT_STATE_CHANGED",
          "Production Journal advanced before this event was claimed; reload state and retry the operation.",
        );
      }
      const recovered = await recoverJournalAppendClaim({
        journalPath,
        claimPath,
        claim: existing,
        now: now ?? new Date(),
        isPidAlive,
      });
      if (recovered) {
        if (recovered.digest === next.digest) return recovered;
        throw new ProductionRolloutError(
          "PRODUCTION_ROLLOUT_STATE_CHANGED",
          "A prior claimed Journal event was recovered; reload state and retry the operation.",
        );
      }
      if (performance.now() >= deadline) {
        throw new ProductionRolloutError(
          "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
          `Production Journal append claim ${existing.digest} is live or unverifiable and requires explicit review.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    return await commitClaimedJournalEntry(journalPath, next);
  }
}

export function currentPhaseState(entries, phase) {
  const phaseEntries = entries.filter((entry) => entry.phase === Number(phase));
  return phaseEntries.at(-1)?.phaseState ?? "not_started";
}

export function assertRollbackOrder(entries, phase) {
  const requested = phaseDefinition(phase).phase;
  const activePhases = PHASES.map((definition) => definition.phase).filter((candidate) => {
    const state = currentPhaseState(entries, candidate);
    return !["not_started", "rolled_back"].includes(state);
  });
  if (activePhases.at(-1) !== requested) {
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLBACK_ORDER_INVALID",
      "Only the latest non-rolled-back Phase may be rolled back.",
    );
  }
  return true;
}

const FINALIZE_ACTIVE_FIELDS = [
  "documentJobs",
  "embeddingJobs",
  "embeddingBatches",
  "embeddingProviderCalls",
  "retrievalRuns",
  "queryEmbeddingCalls",
  "aiExecutions",
];

function finalizeNotReady(message) {
  throw new ProductionRolloutError("PRODUCTION_FINALIZE_NOT_READY", message);
}

function assertPhaseVerificationReport({
  report,
  journalEntry,
  phase,
  session,
  manifest,
  sourceMode,
}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    finalizeNotReady(`Finalize requires the Phase ${phase} verification report.`);
  }
  try {
    assertDigest(report.digest, "phase verification digest");
  } catch {
    finalizeNotReady(`Phase ${phase} verification report digest is invalid.`);
  }
  if (report.digest !== digestWithoutDigest(report)) {
    finalizeNotReady(`Phase ${phase} verification report digest does not match its payload.`);
  }
  if (
    report.schemaVersion !== 1 ||
    report.reportType !== "production-rollout-phase-verification" ||
    report.producer !== RELEASE_REPORT_PRODUCER ||
    report.producerVersion !== PRODUCTION_ROLLOUT_VERSION ||
    report.sourceMode !== sourceMode ||
    report.releaseSessionId !== session.releaseSessionId ||
    report.releaseCandidateSha !== session.releaseCandidateSha ||
    report.releaseImageDigest !== manifest.releaseImageDigest ||
    report.databaseToolsImageDigest !== manifest.databaseToolsImageDigest ||
    report.candidateSha !== session.releaseCandidateSha ||
    report.appImageDigest !== manifest.releaseImageDigest ||
    report.dbToolsImageDigest !== manifest.databaseToolsImageDigest ||
    report.phase !== phase ||
    report.phaseState !== "succeeded" ||
    report.result !== "passed"
  ) {
    finalizeNotReady(`Phase ${phase} verification report bindings are invalid.`);
  }
  try {
    assertDigest(report.postInventoryDigest, "postInventoryDigest");
    assertDigest(report.postStateDigest, "postStateDigest");
  } catch {
    finalizeNotReady(`Phase ${phase} verification report state digest is invalid.`);
  }
  if (
    !journalEntry ||
    journalEntry.releaseSessionId !== session.releaseSessionId ||
    journalEntry.phase !== phase ||
    journalEntry.event !== "verified" ||
    journalEntry.phaseState !== "succeeded" ||
    journalEntry.reportDigest !== report.digest ||
    journalEntry.postInventoryDigest !== report.postInventoryDigest ||
    journalEntry.postStateDigest !== report.postStateDigest
  ) {
    finalizeNotReady(`Phase ${phase} Journal entry is not bound to its verification report.`);
  }
}

export function assertFinalizeReady({
  entries,
  inventory,
  lock,
  reports,
  session,
  manifest,
  finalStateDigest,
}) {
  try {
    assertDeploymentLockBinding(lock, { session, phase: 6 });
    assertDeploymentLockLease(lock);
    assertDigest(inventory?.digest, "final inventory digest");
    assertDigest(finalStateDigest, "final state digest");
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    finalizeNotReady("Finalize requires a valid Deployment Lock and final Inventory.");
  }
  if (
    inventory.digest !== digestWithoutDigest(inventory) ||
    !["production", "rehearsal"].includes(inventory.environment) ||
    inventory.sourceMode !==
      (inventory.environment === "production" ? "live-readonly" : "synthetic-test") ||
    inventory.releaseSessionId !== session.releaseSessionId ||
    inventory.releaseCandidateSha !== session.releaseCandidateSha ||
    inventory.releaseImageDigest !== manifest.releaseImageDigest
  ) {
    finalizeNotReady("Final Inventory is not bound to the Release Session and Manifest.");
  }
  if (!Array.isArray(reports) || reports.length !== PHASES.length) {
    finalizeNotReady("Finalize requires exactly seven Phase verification reports.");
  }
  for (const definition of PHASES) {
    const phase = definition.phase;
    const report = reports.find((candidate) => candidate?.phase === phase);
    const phaseEntries = entries.filter(
      (entry) =>
        entry.releaseSessionId === session.releaseSessionId && entry.phase === phase,
    );
    const verifiedIndex = phaseEntries.findLastIndex(
      (entry) => entry.event === "verified" && entry.reportDigest === report?.digest,
    );
    const journalEntry = verifiedIndex >= 0 ? phaseEntries[verifiedIndex] : null;
    const laterEntries = verifiedIndex >= 0 ? phaseEntries.slice(verifiedIndex + 1) : [];
    if (currentPhaseState(entries, phase) !== "succeeded") {
      finalizeNotReady("Finalize requires every Phase verification to have succeeded.");
    }
    if (
      laterEntries.some(
        (entry) =>
          ![
            "lock-clear-approved",
            "lock-cleared",
            "lock-reacquired",
            "finalization-prepared",
            "finalization-reacquired",
            "finalization-release-failed",
          ].includes(entry.event) || entry.phaseState !== "succeeded",
      )
    ) {
      finalizeNotReady(
        `Phase ${phase} changed after its bound verification report.`,
      );
    }
    assertPhaseVerificationReport({
      report,
      journalEntry,
      phase,
      session,
      manifest,
      sourceMode:
        inventory.environment === "production" ? "live-readonly" : "rehearsal-command",
    });
  }
  if (reports.find((report) => report?.phase === 6)?.postStateDigest !== finalStateDigest) {
    finalizeNotReady("Final Inventory state does not match the verified Phase 6 state.");
  }
  if (
    !inventory.active ||
    JSON.stringify(Object.keys(inventory.active).sort()) !==
      JSON.stringify([...FINALIZE_ACTIVE_FIELDS].sort()) ||
    FINALIZE_ACTIVE_FIELDS.some(
      (field) => !Number.isSafeInteger(inventory.active[field]) || inventory.active[field] < 0,
    )
  ) {
    finalizeNotReady("Final Inventory active-work counts are incomplete or invalid.");
  }
  const activeTotal = FINALIZE_ACTIVE_FIELDS.reduce(
    (total, field) => total + inventory.active[field],
    0,
  );
  const services = inventory.services ?? {};
  if (
    activeTotal !== 0 ||
    inventory.app?.publicHttpStatus !== 200 ||
    inventory.app?.health !== "healthy" ||
    inventory.app?.restartCount !== 0 ||
    inventory.app?.imageDigest !== manifest.releaseImageDigest ||
    inventory.app?.commitSha !== session.releaseCandidateSha ||
    services.documentWorker !== true ||
    services.documentWorkerHealth !== "healthy" ||
    services.documentWorkerRestartCount !== 0 ||
    services.documentWorkerImageDigest !== manifest.releaseImageDigest ||
    services.embeddingWorker !== true ||
    services.embeddingWorkerHealth !== "healthy" ||
    services.embeddingWorkerRestartCount !== 0 ||
    services.embeddingWorkerImageDigest !== manifest.releaseImageDigest
  ) {
    finalizeNotReady(
      "Finalize requires the Manifest App/Worker image, healthy runtime, zero restarts, and zero active work.",
    );
  }
  return {
    activeTotal,
    reportDigests: reports
      .slice()
      .sort((left, right) => left.phase - right.phase)
      .map((report) => report.digest),
  };
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
      ["projectai-internal", "backup-config-metadata"],
    ],
    1: [
      [...compose, "up", "--detach", "projectai-postgres", "projectai-minio"],
      [...compose, "run", "--rm", "projectai-minio-init"],
      [...compose, "run", "--rm", "projectai-migrate"],
    ],
    2: [
      [...compose, "up", "--detach", "--no-deps", "projectai-app", "projectai-document-worker"],
    ],
    3: [
      ["projectai-internal", "set-assistant-lexical"],
    ],
    4: [
      ["projectai-internal", "set-embedding-enabled"],
      ["projectai-internal", "bounded-backfill", "--limit=100"],
    ],
    5: [
      ["projectai-internal", "set-retrieval-mode", "shadow"],
    ],
    6: [
      ["projectai-internal", "set-retrieval-mode", "hybrid"],
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
    0: [["projectai-internal", "retain-lock-for-verification"]],
    1: [[...compose, "stop", "projectai-minio", "projectai-postgres"]],
    2: [["projectai-internal", "restore-baseline-runtime"]],
    3: [["projectai-internal", "set-assistant-disabled"]],
    4: [[...compose, "stop", "projectai-embedding-worker"], ["projectai-internal", "set-embedding-disabled"]],
    5: [["projectai-internal", "set-retrieval-mode", "lexical"]],
    6: [["projectai-internal", "set-retrieval-mode", "shadow"]],
  };
  return plans[phaseDefinition(phase).phase];
}

function assertReportDigest(report, code, label) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    !/^sha256:[0-9a-f]{64}$/.test(report.digest ?? "") ||
    report.digest !== digestObject(
      Object.fromEntries(Object.entries(report).filter(([key]) => key !== "digest")),
    )
  ) {
    throw new ProductionRolloutError(code, `${label} digest is invalid.`);
  }
}

export function assertApplyReportBinding({
  report,
  session,
  manifest,
  phase,
  rollback = false,
  journalEntry,
}) {
  const code = "PRODUCTION_PHASE_PREREQUISITE_MISSING";
  assertReportDigest(report, code, rollback ? "Rollback Apply Report" : "Apply Report");
  const expectedType = rollback
    ? "production-rollout-rollback-apply"
    : "production-rollout-phase-apply";
  const expectedState = rollback
    ? "awaiting_rollback_verification"
    : "awaiting_verification";
  if (
    report.schemaVersion !== 1 ||
    report.reportType !== expectedType ||
    report.producer !== RELEASE_REPORT_PRODUCER ||
    report.producerVersion !== PRODUCTION_ROLLOUT_VERSION ||
    report.releaseSessionId !== session.releaseSessionId ||
    report.releaseCandidateSha !== session.releaseCandidateSha ||
    report.releaseImageDigest !== manifest.releaseImageDigest ||
    report.databaseToolsImageDigest !== manifest.databaseToolsImageDigest ||
    report.releaseManifestDigest !== manifest.digest ||
    report.phase !== Number(phase) ||
    report.phaseState !== expectedState ||
    report.result !== "mutation-completed" ||
    report.commandResultDigest !== digestObject(report.commandResults) ||
    !Number.isFinite(Date.parse(report.mutationStartedAt ?? "")) ||
    !Number.isFinite(Date.parse(report.observationStartedAt ?? "")) ||
    !Number.isFinite(Date.parse(report.mutationCompletedAt ?? "")) ||
    Date.parse(report.mutationCompletedAt) < Date.parse(report.mutationStartedAt) ||
    Date.parse(report.observationStartedAt) < Date.parse(report.mutationCompletedAt)
  ) {
    throw new ProductionRolloutError(code, "Apply Report binding is invalid.");
  }
  if (
    rollback &&
    (report.rollbackImageDigest !== manifest.rollbackImage ||
      !/^sha256:[0-9a-f]{64}$/.test(report.rollbackTargetStateDigest ?? "") ||
      (Number(phase) === 0
        ? report.rollbackTargetReportDigest !== null
        : !/^sha256:[0-9a-f]{64}$/.test(report.rollbackTargetReportDigest ?? "")) ||
      (Number(phase) >= 2 &&
        !/^sha256:[0-9a-f]{64}$/.test(
          report.rollbackTargetDeploymentStateDigest ?? "",
        )))
  ) {
    throw new ProductionRolloutError(code, "Rollback Apply Report target binding is invalid.");
  }
  if (
    !journalEntry ||
    journalEntry.releaseSessionId !== session.releaseSessionId ||
    journalEntry.phase !== Number(phase) ||
    journalEntry.event !== (rollback ? "rollback-mutation-completed" : "mutation-completed") ||
    journalEntry.phaseState !== expectedState ||
    journalEntry.applyReportDigest !== report.digest ||
    journalEntry.commandResultDigest !== report.commandResultDigest ||
    journalEntry.mutationStartedAt !== report.mutationStartedAt
  ) {
    throw new ProductionRolloutError(code, "Apply Report is not bound to the current Journal mutation.");
  }
  return true;
}

export function assertVerificationEvidence({
  report,
  session,
  manifest,
  phase,
  applyReport,
  rollback = false,
  environment,
  now = new Date(),
}) {
  const code = rollback
    ? "PRODUCTION_ROLLBACK_VERIFICATION_FAILED"
    : "PRODUCTION_PHASE_VERIFICATION_FAILED";
  assertReportDigest(report, code, "Verification evidence");
  const expectedType = rollback
    ? "production-rollout-rollback-observation"
    : "production-rollout-phase-observation";
  const expectedSource = environment === "production" ? "live-readonly" : "synthetic-test";
  const start = Date.parse(report.observation?.startedAt ?? "");
  const end = Date.parse(report.observation?.endedAt ?? "");
  const maximumAge = (phaseDefinition(phase).observationSeconds + 3600) * 1000;
  const observedElapsedSeconds = Math.max(0, Math.floor((end - start) / 1000));
  if (
    report.schemaVersion !== 1 ||
    report.reportType !== expectedType ||
    report.producer !== PRODUCTION_PHASE_VERIFIER ||
    report.producerVersion !== PRODUCTION_ROLLOUT_VERSION ||
    report.sourceMode !== expectedSource ||
    report.releaseSessionId !== session.releaseSessionId ||
    report.releaseCandidateSha !== session.releaseCandidateSha ||
    report.releaseImageDigest !== manifest.releaseImageDigest ||
    report.databaseToolsImageDigest !== manifest.databaseToolsImageDigest ||
    report.releaseManifestDigest !== manifest.digest ||
    report.phase !== Number(phase) ||
    report.direction !== (rollback ? "rollback" : "forward") ||
    report.applyReportDigest !== applyReport.digest ||
    report.commandResultDigest !== applyReport.commandResultDigest ||
    report.mutationStartedAt !== applyReport.mutationStartedAt ||
    report.result !== "passed" ||
    report.syntheticResult !== false ||
    report.observation?.releaseSessionId !== session.releaseSessionId ||
    report.observation?.phase !== Number(phase) ||
    report.observation?.startedAt !== applyReport.observationStartedAt ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end > now.getTime() + 60_000 ||
    now.getTime() - start > maximumAge ||
    !report.metrics ||
    typeof report.metrics !== "object" ||
    Array.isArray(report.metrics) ||
    !Number.isSafeInteger(report.metrics.elapsedSeconds) ||
    Math.abs(report.metrics.elapsedSeconds - observedElapsedSeconds) > 1
  ) {
    throw new ProductionRolloutError(code, "Verification evidence is stale, forged, synthetic, or incorrectly bound.");
  }
  return report.metrics;
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
  await replaceSecureAtomic(phaseReportPath(stateDir, report.phase), finalized);
  return finalized;
}

export async function readPhaseReport(stateDir, phase) {
  try {
    const report = await readSecureMetadata(
      phaseReportPath(stateDir, phase),
      (value) => value,
    );
    assertDigest(report.digest, "phase verification digest");
    if (report.digest !== digestWithoutDigest(report)) {
      throw new Error("Phase verification report digest does not match its payload.");
    }
    return report;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      "Phase verification report cannot be interpreted safely.",
    );
  }
}

export function exitCodeForRolloutError(error) {
  if (error?.code === "PRODUCTION_APPLY_NOT_AUTHORIZED") return 78;
  if (error?.code === "PRODUCTION_AUTHORIZATION_REPLAYED") return 79;
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

export function assertStopConditions({ inventory, verification, allowDeploymentLock = false }) {
  assertNoUnknown({ inventory, verification });
  if (
    inventory.app?.health !== "healthy" ||
    inventory.app?.restartCount !== 0 ||
    inventory.app?.publicHttpStatus !== 200 ||
    inventory.capacity?.filesystemUsagePercent >= 85 ||
    inventory.capacity?.inodeUsagePercent >= 85 ||
    (!allowDeploymentLock && inventory.locks?.deployment !== false)
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
