import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_TOOL_VERSION = "b3-c1-v1";
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const ENVIRONMENTS = ["production", "staging", "rehearsal"];
export const DIFFERENCE_CATEGORIES = [
  "expected",
  "requires_migration",
  "requires_image_change",
  "requires_secret",
  "requires_new_service",
  "requires_configuration",
  "blocking_unknown",
];

const forbiddenKeys = new Set([
  "apikey",
  "authorization",
  "baseurl",
  "bucketcredential",
  "cookie",
  "databaseurl",
  "databasepassword",
  "documentcontent",
  "documentvector",
  "environmentvariables",
  "objectkey",
  "objectstorageaccesskey",
  "objectstoragesecretkey",
  "password",
  "prompt",
  "providerrequest",
  "providerresponse",
  "providerpayload",
  "qwenapikey",
  "question",
  "queryvector",
  "secretvalue",
  "sessiontoken",
]);

const forbiddenValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /(?:cookie|session_token)\s*=/i,
  /postgres(?:ql)?:\/\/[^\s/:]+:[^\s/@]+@/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function normalizedKey(value) {
  return value.replaceAll(/[^A-Za-z0-9]/g, "").toLowerCase();
}

export function assertSanitized(value, location = "root") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSanitized(entry, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.has(normalizedKey(key))) {
        throw new Error(`Release artifact contains forbidden field ${location}.${key}.`);
      }
      assertSanitized(entry, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    for (const pattern of forbiddenValuePatterns) {
      if (pattern.test(value)) {
        throw new Error(`Release artifact contains sensitive content at ${location}.`);
      }
    }
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function digestObject(value) {
  assertSanitized(value);
  return sha256(canonicalJson(value));
}

export function withDigest(value) {
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: digestObject(withoutDigest) };
}

export function assertFullSha(value, field) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error(`${field} must be a full lowercase Git SHA.`);
  }
}

export function assertDigest(value, field) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${field} must be an immutable sha256 digest.`);
  }
}

export function assertEnvironment(value) {
  if (!ENVIRONMENTS.includes(value)) {
    throw new Error(`--environment must be one of ${ENVIRONMENTS.join(", ")}.`);
  }
  return value;
}

export function assertIsoTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp.`);
  }
}

export function assertInventory(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("A release inventory object is required.");
  }
  if (inventory.schemaVersion !== 1) {
    throw new Error("Unsupported release inventory schemaVersion.");
  }
  assertEnvironment(inventory.environment);
  assertIsoTimestamp(inventory.capturedAt, "capturedAt");
  if (!inventory.app || typeof inventory.app !== "object") {
    throw new Error("Release inventory is missing app state.");
  }
  assertDigest(inventory.app.imageDigest, "app.imageDigest");
  if (inventory.app.commitSha !== null) {
    assertFullSha(inventory.app.commitSha, "app.commitSha");
  }
  for (const field of ["restartCount", "filesystemUsagePercent", "inodeUsagePercent"]) {
    const value =
      field === "restartCount" ? inventory.app[field] : inventory.capacity?.[field];
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
      throw new Error(`Release inventory has invalid ${field}.`);
    }
  }
  assertSanitized(inventory);
  const expected = digestObject(
    Object.fromEntries(Object.entries(inventory).filter(([key]) => key !== "digest")),
  );
  if (inventory.digest && inventory.digest !== expected) {
    throw new Error("Release inventory digest does not match its payload.");
  }
}

export function assertReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("A release manifest object is required.");
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported release manifest schemaVersion.");
  }
  if (
    typeof manifest.releaseVersion !== "string" ||
    !/^[0-9A-Za-z._-]{1,64}$/.test(manifest.releaseVersion)
  ) {
    throw new Error("releaseVersion is invalid.");
  }
  for (const field of ["sourceMainSha", "releaseCandidateSha"]) {
    assertFullSha(manifest[field], field);
  }
  for (const field of [
    "releaseImageDigest",
    "databaseToolsImageDigest",
    "currentProductionImage",
    "postgresTargetImage",
    "minioImage",
    "rollbackImage",
    "evidenceDigest",
  ]) {
    assertDigest(manifest[field], field);
  }
  if (typeof manifest.nodeVersion !== "string" || !/^v?22\.[0-9]+\.[0-9]+$/.test(manifest.nodeVersion)) {
    throw new Error("nodeVersion must pin Node.js 22.");
  }
  assertIsoTimestamp(manifest.buildTime, "buildTime");
  if (!Array.isArray(manifest.baseImageDigests) || manifest.baseImageDigests.length < 1) {
    throw new Error("At least one base image digest is required.");
  }
  manifest.baseImageDigests.forEach((digest, index) =>
    assertDigest(digest, `baseImageDigests[${index}]`),
  );
  if (manifest.postgresCurrentImage !== null) {
    assertDigest(manifest.postgresCurrentImage, "postgresCurrentImage");
  }
  if (manifest.databaseMigrationFrom !== "none") {
    if (!Number.isSafeInteger(manifest.databaseMigrationFrom)) {
      throw new Error("databaseMigrationFrom must be none or an integer.");
    }
  }
  if (!Number.isSafeInteger(manifest.databaseMigrationTo)) {
    throw new Error("databaseMigrationTo must be an integer.");
  }
  if (
    !Array.isArray(manifest.releasePhases) ||
    JSON.stringify(manifest.releasePhases) !==
      JSON.stringify([
        "phase-0",
        "phase-1",
        "phase-2",
        "phase-3",
        "phase-4",
        "phase-5",
        "phase-6",
      ])
  ) {
    throw new Error("Release manifest must define exactly seven guarded phases.");
  }
  if (!Array.isArray(manifest.backupIds) || !Array.isArray(manifest.backupDigests)) {
    throw new Error("Release manifest backup provenance is incomplete.");
  }
  manifest.backupDigests.forEach((digest, index) =>
    assertDigest(digest, `backupDigests[${index}]`),
  );
  if (manifest.backupIds.length !== manifest.backupDigests.length) {
    throw new Error("Release manifest backup IDs and digests must have equal length.");
  }
  if (
    manifest.featureFlags?.assistant !== false ||
    manifest.featureFlags?.embedding !== false ||
    manifest.featureFlags?.retrievalMode !== "lexical"
  ) {
    throw new Error(
      "The initial Production release phase must keep both AI flags off and lexical mode selected.",
    );
  }
  assertIsoTimestamp(manifest.createdAt, "createdAt");
  if (manifest.createdByToolVersion !== RELEASE_TOOL_VERSION) {
    throw new Error("Release manifest tool version is not current.");
  }
  assertSanitized(manifest);
  const expected = digestObject(
    Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "digest")),
  );
  if (manifest.digest && manifest.digest !== expected) {
    throw new Error("Release manifest digest does not match its payload.");
  }
}

export async function readJson(filename) {
  return JSON.parse(await readFile(path.resolve(filename), "utf8"));
}

export async function writeJson(filename, value) {
  assertSanitized(value);
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await writeFile(path.resolve(filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeArtifactPair({ outputDir, stem, payload, markdown }) {
  const finalized = withDigest(payload);
  assertSanitized(markdown);
  const root = path.resolve(outputDir);
  await mkdir(root, { recursive: true });
  await writeJson(path.join(root, `${stem}.json`), finalized);
  await writeFile(
    path.join(root, `${stem}.md`),
    `${markdown.trim()}\n\nDigest: \`${finalized.digest}\`\n`,
    "utf8",
  );
  return finalized;
}

export function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    if (equals >= 0) {
      options[argument.slice(2, equals)] = argument.slice(equals + 1);
      continue;
    }
    const key = argument.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { options, positional };
}

export function requiredOption(options, key) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${key} is required.`);
  }
  return value.trim();
}

export function percentFromHuman(value) {
  const match = String(value ?? "").match(/^(\d{1,3})%$/);
  if (!match) return null;
  return Number(match[1]);
}

export function numberOrNull(value) {
  if (value === "" || value === "null" || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
