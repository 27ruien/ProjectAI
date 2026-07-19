#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { assertEvidenceIndex } from "./review-evidence-contract.mjs";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const sourceRoots = [
  "review-artifacts",
  "test-logs",
];
const allowedTestLogs = new Set([
  "artifact-sanitizer.log",
  "assistant-integration.log",
  "assistant-unit.log",
  "build-and-ssr.log",
  "deployment-contract.log",
  "document-processing-integration.log",
  "document-processing-unit.log",
  "embedding-integration.log",
  "embedding-unit.log",
  "integration.log",
  "lint.log",
  "playwright.log",
  "storage-integration.log",
  "storage-verify.log",
  "post-cleanup-storage-verify.log",
  "test-cleanup.log",
  "retrieval-evaluation.log",
  "retrieval-integration.log",
  "retrieval-migration-upgrade.log",
  "retrieval-unit.log",
  "release-database-rehearsal.log",
  "release-disabled-image-rehearsal.log",
  "release-tooling.log",
  "typecheck.log",
]);
const allowedReviewReports = new Set([
  "retrieval-calibration.json",
  "retrieval-calibration.md",
  "retrieval-evaluation.json",
  "retrieval-evaluation.md",
  "retrieval-verification-summary.json",
  "retrieval-verification-summary.md",
  "release-database-rehearsal.json",
  "release-database-rehearsal.md",
  "release-disabled-image-rehearsal.json",
  "release-disabled-image-rehearsal.md",
  "release-smoke.json",
  "release-smoke.md",
]);
const requiredRetrievalReports = [
  "retrieval-calibration.json",
  "retrieval-calibration.md",
  "retrieval-evaluation.json",
  "retrieval-evaluation.md",
  "retrieval-verification-summary.json",
  "retrieval-verification-summary.md",
];
const requiredReleaseReports = [
  "release-database-rehearsal.json",
  "release-database-rehearsal.md",
  "release-disabled-image-rehearsal.json",
  "release-disabled-image-rehearsal.md",
  "release-smoke.json",
  "release-smoke.md",
];
const outputRoot = path.resolve("product-review-evidence");
const redacted = "[REDACTED]";
const whitespaceEncodedSecrets = new Set();
const canonicalObjectKeySegment = String.raw`[A-Za-z0-9_-]{1,128}`;
const canonicalObjectKeySeparator = String.raw`(?:/|\\+/|%2f)`;
const canonicalObjectKeyUuid =
  String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
const canonicalObjectKeySource =
  String.raw`(?<![A-Za-z0-9_-])projects${canonicalObjectKeySeparator}` +
  `${canonicalObjectKeySegment}${canonicalObjectKeySeparator}` +
  `documents${canonicalObjectKeySeparator}${canonicalObjectKeySegment}` +
  `${canonicalObjectKeySeparator}versions${canonicalObjectKeySeparator}` +
  `${canonicalObjectKeySegment}${canonicalObjectKeySeparator}` +
  `${canonicalObjectKeyUuid}(?![A-Za-z0-9_-])`;
const canonicalObjectKeyPattern = new RegExp(canonicalObjectKeySource, "gi");
const canonicalObjectKeyVerificationPattern = new RegExp(
  canonicalObjectKeySource,
  "i",
);
const requiredReviewScreenshots = [
  "screenshots/login.png",
  "screenshots/dashboard-admin.png",
  "screenshots/projects-manager-a.png",
  "screenshots/project-a-overview.png",
  "screenshots/project-access-denied.png",
  "screenshots/viewer-readonly.png",
  "screenshots/documents-empty.png",
  "screenshots/documents-upload-dialog.png",
  "screenshots/documents-uploaded.png",
  "screenshots/document-version-history.png",
  "screenshots/viewer-documents-readonly.png",
  "screenshots/document-upload-rejected.png",
  "screenshots/document-processing-pending.png",
  "screenshots/document-processing-succeeded.png",
  "screenshots/document-processing-failed.png",
  "screenshots/document-needs-ocr.png",
  "screenshots/knowledge-search-results.png",
  "screenshots/knowledge-search-pdf-citation.png",
  "screenshots/knowledge-search-docx-citation.png",
  "screenshots/knowledge-search-xlsx-citation.png",
  "screenshots/knowledge-search-pptx-citation.png",
  "screenshots/viewer-knowledge-search.png",
  "screenshots/ai-assistant-disabled.png",
  "screenshots/ai-assistant-empty.png",
  "screenshots/ai-assistant-grounded-answer.png",
  "screenshots/ai-assistant-citation-expanded.png",
  "screenshots/ai-assistant-insufficient-evidence.png",
  "screenshots/ai-assistant-provider-error.png",
  "screenshots/ai-assistant-viewer.png",
  "screenshots/ai-assistant-thread-history.png",
];
const metrics = {
  copiedRoots: [],
  textFilesSanitized: 0,
  archivesSanitized: 0,
  embeddedArchivesSanitized: 0,
  gzipStreamsSanitized: 0,
  artifactNamesSanitized: 0,
  disallowedEvidenceEntriesRemoved: 0,
  unsafeBinaryFilesRemoved: 0,
  unsafeArchivesRemoved: 0,
  sessionTokensLoaded: 0,
  reviewStatus: null,
  screenshotsComplete: false,
  screenshotCount: 0,
  missingReviewScreenshots: [],
};

const sensitivePropertyName =
  /^(?:password|database_url|databaseUrl|better_auth_secret|betterAuthSecret|sessionToken|session_token|minio_root_user|minioRootUser|minio_root_password|minioRootPassword|object_storage_access_key|objectStorageAccessKey|object_storage_secret_key|objectStorageSecretKey|object_storage_endpoint|objectStorageEndpoint|storageEndpoint|object_storage_bucket|objectStorageBucket|bucket|object_key|objectKey|qwen_api_key|qwenApiKey|qwen_base_url|qwenBaseUrl|api_key|apiKey|authorizationHeader|system_prompt|systemPrompt|provider_request|providerRequest|provider_response|providerResponse|raw_provider_request|rawProviderRequest|raw_provider_response|rawProviderResponse|embedding|vector)$/i;

function isSensitiveStructuredName(value) {
  return (
    typeof value === "string" &&
    /^(?:cookie|set-cookie|authorization|(?:__Secure-|__Host-)?[^\s]*session_token)$/i.test(
      value,
    )
  );
}

function lowerCasePercentEscapes(value) {
  return value.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
}

function redactCanonicalObjectKeys(input) {
  return input.replace(canonicalObjectKeyPattern, redacted);
}

function containsCanonicalObjectKey(input) {
  return canonicalObjectKeyVerificationPattern.test(input);
}

function flexibleEncodedPattern(value) {
  const escapedCharacters = [...value].map((character) =>
    character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(escapedCharacters.join("[\\t\\n\\r ]*"), "g");
}

function redactWhitespaceEncodedSecrets(input) {
  const compactInput = input.replace(/[\t\n\r ]/g, "");
  let output = input;
  for (const secret of whitespaceEncodedSecrets) {
    if (!compactInput.includes(secret)) continue;
    output = output.replace(flexibleEncodedPattern(secret), redacted);
  }
  return output;
}

function containsWhitespaceEncodedSecret(input) {
  const compactInput = input.replace(/[\t\n\r ]/g, "");
  return [...whitespaceEncodedSecrets].some((secret) =>
    compactInput.includes(secret),
  );
}

function transformJsonValue(value, mode) {
  if (Array.isArray(value)) {
    let changed = false;
    const transformed = value.map((entry) => {
      const result = transformJsonValue(entry, mode);
      changed ||= result.changed;
      return result.value;
    });
    return { value: transformed, changed };
  }
  if (!value || typeof value !== "object") {
    return { value, changed: false };
  }

  const transformed = { ...value };
  let changed = false;
  const structuredName = transformed.name;
  for (const [key, entry] of Object.entries(transformed)) {
    const sensitiveValue =
      sensitivePropertyName.test(key) ||
      (key.toLowerCase() === "value" && isSensitiveStructuredName(structuredName));
    if (sensitiveValue && entry !== redacted) {
      if (mode === "verify") return { value: transformed, changed: true };
      transformed[key] = redacted;
      changed = true;
      continue;
    }
    const result = transformJsonValue(entry, mode);
    if (mode === "verify" && result.changed) {
      return { value: transformed, changed: true };
    }
    transformed[key] = result.value;
    changed ||= result.changed;
  }
  return { value: transformed, changed };
}

function transformJsonDocument(input, mode) {
  const trailingNewline = input.endsWith("\n") ? "\n" : "";
  try {
    const parsed = JSON.parse(input);
    const result = transformJsonValue(parsed, mode);
    if (!result.changed || mode === "verify") {
      return { value: input, changed: result.changed };
    }
    return { value: `${JSON.stringify(result.value)}${trailingNewline}`, changed: true };
  } catch {
    // Playwright trace and HAR artifacts may be JSON Lines rather than one JSON document.
  }

  let changed = false;
  const lines = input.split("\n").map((line) => {
    if (!line.trim()) return line;
    try {
      const parsed = JSON.parse(line);
      const result = transformJsonValue(parsed, mode);
      changed ||= result.changed;
      if (!result.changed || mode === "verify") return line;
      return JSON.stringify(result.value);
    } catch {
      return line;
    }
  });
  return { value: lines.join("\n"), changed };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadDatabaseSessionTokens() {
  if (!process.env.DATABASE_URL) return [];
  let client;
  try {
    const { Client } = await import("pg");
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      application_name: "project-ai-artifact-sanitizer",
      connectionTimeoutMillis: 5_000,
    });
    await client.connect();
    const result = await client.query("select token from sessions");
    return result.rows
      .map((row) => (typeof row.token === "string" ? row.token : ""))
      .filter(Boolean);
  } catch {
    throw new Error(
      "Session-token verification is unavailable; refusing to publish evidence.",
    );
  } finally {
    await client?.end().catch(() => undefined);
  }
}

function addSecretVariants(target, value) {
  if (typeof value !== "string" || value.length < 8) return;
  const standardBase64 = Buffer.from(value, "utf8").toString("base64");
  const urlSafeBase64 = standardBase64.replaceAll("+", "-").replaceAll("/", "_");
  const encodedCandidates = new Set([
    standardBase64,
    standardBase64.replace(/=+$/, ""),
    urlSafeBase64,
    urlSafeBase64.replace(/=+$/, ""),
  ]);
  for (const candidate of encodedCandidates) {
    if (candidate.length >= 8) whitespaceEncodedSecrets.add(candidate);
  }
  const candidates = new Set([
    value,
    JSON.stringify(value).slice(1, -1),
    ...encodedCandidates,
  ]);
  for (const candidate of candidates) {
    target.add(candidate);
    const encoded = encodeURIComponent(candidate);
    target.add(encoded);
    target.add(lowerCasePercentEscapes(encoded));
  }
}

async function collectSecrets() {
  const secrets = new Set();
  const secretEnvironmentKeys = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "POSTGRES_PASSWORD",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "QWEN_API_KEY",
    "QWEN_BASE_URL",
    "SEED_ADMIN_PASSWORD",
    "SEED_MANAGER_A_PASSWORD",
    "SEED_MANAGER_B_PASSWORD",
    "SEED_MEMBER_A_PASSWORD",
    "SEED_VIEWER_A_PASSWORD",
  ];
  for (const key of secretEnvironmentKeys) {
    addSecretVariants(secrets, process.env[key]);
  }
  if (process.env.DATABASE_URL) {
    try {
      const databaseUrl = new URL(process.env.DATABASE_URL);
      addSecretVariants(secrets, decodeURIComponent(databaseUrl.password));
    } catch {
      throw new Error("DATABASE_URL could not be parsed for evidence sanitization.");
    }
  }

  const sessionTokens = await loadDatabaseSessionTokens();
  metrics.sessionTokensLoaded = sessionTokens.length;
  for (const token of sessionTokens) addSecretVariants(secrets, token);
  return [...secrets].sort((left, right) => right.length - left.length);
}

function redactStructuredValues(input) {
  return input
    .replace(/\{[^{}]*\}/g, (objectValue) => {
      const sensitiveName =
        /"name"\s*:\s*"(?:cookie|set-cookie|authorization|(?:__Secure-|__Host-)?[^"]*session_token)"/i;
      if (!sensitiveName.test(objectValue)) return objectValue;
      return objectValue.replace(
        /("value"\s*:\s*")[^"]*(")/gi,
        `$1${redacted}$2`,
      );
    })
    .replace(
      /("name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*")[^"]*(")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /("name"\s*:\s*"(?:__Secure-|__Host-)?[^"]*session_token"\s*,\s*"value"\s*:\s*")[^"]*(")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /("name"\s*:\s*"(?:__Secure-|__Host-)?[^"]*session_token"[\s\S]*?"value"\s*:\s*")[^"]*(")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /("value"\s*:\s*")[^"]*("\s*,\s*"name"\s*:\s*"(?:cookie|set-cookie|authorization|(?:__Secure-|__Host-)?[^"]*session_token)")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /("value"\s*:\s*")[^"]*("[\s\S]*?"name"\s*:\s*"(?:__Secure-|__Host-)?[^"]*session_token")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /((?:[A-Za-z0-9_-]+\.)?session_token=)[^;\s"',}\\]+/gi,
      `$1${redacted}`,
    )
    .replace(
      /((?:[A-Za-z0-9_-]+\.)?session_token%3D)[^;%\s"',}\\]+/gi,
      `$1${redacted}`,
    )
    .replace(/^(cookie|set-cookie|authorization):.*$/gim, `$1: ${redacted}`)
    .replace(
      /("(?:password|database_url|databaseUrl|better_auth_secret|betterAuthSecret|sessionToken|session_token|minio_root_user|minioRootUser|minio_root_password|minioRootPassword|object_storage_access_key|objectStorageAccessKey|object_storage_secret_key|objectStorageSecretKey|object_storage_endpoint|objectStorageEndpoint|storageEndpoint|object_storage_bucket|objectStorageBucket|bucket|object_key|objectKey|qwen_api_key|qwenApiKey|qwen_base_url|qwenBaseUrl|api_key|apiKey|authorizationHeader|system_prompt|systemPrompt|provider_request|providerRequest|provider_response|providerResponse|raw_provider_request|rawProviderRequest|raw_provider_response|rawProviderResponse|embedding|vector)"\s*:\s*")[^"]*(")/gi,
      `$1${redacted}$2`,
    )
    .replace(
      /\b(objectKey|object_key|OBJECT_STORAGE_ENDPOINT|OBJECT_STORAGE_BUCKET|QWEN_API_KEY|QWEN_BASE_URL|QWEN_API_KEY_FILE)=(?!\[REDACTED\])[^\s,;]+/gi,
      `$1=${redacted}`,
    );
}

function containsUnsafeStorageMetadata(input) {
  return (
    containsCanonicalObjectKey(input) ||
    /"(?:objectKey|object_key|objectStorageEndpoint|storageEndpoint|object_storage_endpoint|objectStorageBucket|object_storage_bucket|bucket)"\s*:\s*"(?!\[REDACTED\]")[^"]+"/i.test(
      input,
    ) ||
    /\b(?:objectKey|object_key|OBJECT_STORAGE_ENDPOINT|OBJECT_STORAGE_BUCKET|QWEN_API_KEY|QWEN_BASE_URL|QWEN_API_KEY_FILE)=(?!\[REDACTED\])[^\s,;]+/i.test(
      input,
    )
  );
}

function bufferContainsSecret(buffer, secrets) {
  return secrets.some((secret) => buffer.includes(Buffer.from(secret, "utf8")));
}

function textContainsSecret(input, secrets) {
  return (
    secrets.some((secret) => input.includes(secret)) ||
    containsWhitespaceEncodedSecret(input)
  );
}

function unsafeStructuredValue(input) {
  if (transformJsonDocument(input, "verify").changed) return true;
  if (containsUnsafeStorageMetadata(input)) return true;
  const values = [
    ...input.matchAll(/(?:[A-Za-z0-9_-]+\.)?session_token(?:=|%3D)([^;\s"',}\\]+)/gi),
  ].map((match) => match[1]);
  if (values.some((value) => value && value !== redacted)) return true;
  return (
    /"name"\s*:\s*"(?:__Secure-|__Host-)?[^"]*session_token"[\s\S]*?"value"\s*:\s*"(?!\[REDACTED\]")[^"]+"/i.test(
      input,
    ) ||
    /"value"\s*:\s*"(?!\[REDACTED\]")[^"]+"[\s\S]*?"name"\s*:\s*"(?:__Secure-|__Host-)?[^"]*session_token"/i.test(
      input,
    )
  );
}

function isZipBuffer(buffer) {
  return [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ].some((signature) => buffer.indexOf(signature) >= 0);
}

function isGzipBuffer(buffer) {
  return buffer.length >= 3 && buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[2] === 0x08;
}

function sanitizeText(input, secrets) {
  let sanitized = input;
  for (const secret of secrets) sanitized = sanitized.split(secret).join(redacted);
  sanitized = redactWhitespaceEncodedSecrets(sanitized);
  sanitized = redactCanonicalObjectKeys(sanitized);
  sanitized = transformJsonDocument(sanitized, "sanitize").value;
  return redactStructuredValues(sanitized);
}

function sanitizedArtifactName(name, secrets) {
  const sanitized = sanitizeText(name, secrets)
    .replaceAll("/", "_")
    .replaceAll("\\", "_");
  return sanitized || "redacted-artifact";
}

async function sanitizeEntryName(directory, entryName, secrets, rootDirectory) {
  const source = path.join(directory, entryName);
  const relativePath = path.relative(rootDirectory, source).split(path.sep).join("/");
  const unsafePath =
    bufferContainsSecret(Buffer.from(relativePath, "utf8"), secrets) ||
    unsafeStructuredValue(relativePath);
  const sanitizedName = unsafePath
    ? "redacted-artifact"
    : sanitizedArtifactName(entryName, secrets);
  if (sanitizedName === entryName) return path.join(directory, entryName);

  let destination = path.join(directory, sanitizedName);
  for (let suffix = 1; await exists(destination); suffix += 1) {
    destination = path.join(directory, `${sanitizedName}.redacted-${suffix}`);
  }
  await rename(source, destination);
  metrics.artifactNamesSanitized += 1;
  return destination;
}

async function rebuildSanitizedArchive(buffer, secrets) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-archive-"));
  const sourceArchive = path.join(temporaryRoot, "source.zip");
  const extractedRoot = path.join(temporaryRoot, "contents");
  const rebuiltArchive = path.join(temporaryRoot, "sanitized.zip");
  await writeFile(sourceArchive, buffer);
  await mkdir(extractedRoot);
  try {
    await execFileAsync("unzip", ["-qq", "-o", sourceArchive, "-d", extractedRoot]);
    await sanitizeTree(extractedRoot, secrets);
    await verifyTree(extractedRoot, secrets);
    await execFileAsync("zip", ["-q", "-r", rebuiltArchive, "."], {
      cwd: extractedRoot,
    });
    return await readFile(rebuiltArchive);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function verifyArchiveBuffer(buffer, secrets) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-verify-"));
  const sourceArchive = path.join(temporaryRoot, "source.zip");
  const extractedRoot = path.join(temporaryRoot, "contents");
  await writeFile(sourceArchive, buffer);
  await mkdir(extractedRoot);
  try {
    await execFileAsync("unzip", ["-qq", "-o", sourceArchive, "-d", extractedRoot]);
    await verifyTree(extractedRoot, secrets);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function rebuildSanitizedGzip(buffer, secrets) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-gzip-"));
  const payloadPath = path.join(temporaryRoot, "payload");
  try {
    await writeFile(payloadPath, await gunzipAsync(buffer));
    await sanitizeTree(temporaryRoot, secrets);
    if (!(await exists(payloadPath))) {
      throw new Error("A gzip payload could not be sanitized safely.");
    }
    await verifyTree(temporaryRoot, secrets);
    return await gzipAsync(await readFile(payloadPath));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function verifyGzipBuffer(buffer, secrets) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-gzip-verify-"));
  const payloadPath = path.join(temporaryRoot, "payload");
  try {
    await writeFile(payloadPath, await gunzipAsync(buffer));
    await verifyTree(temporaryRoot, secrets);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const embeddedArchiveMarker =
  /data\s*:\s*application\/(?:zip|x-zip-compressed|octet-stream)/i;
const embeddedArchiveMarkerGlobal =
  /data\s*:\s*application\/(?:zip|x-zip-compressed|octet-stream)/gi;

function decodeEmbeddedArchive(encoded) {
  let decoded;
  try {
    decoded = decodeURIComponent(encoded.replace(/[\t\n\r ]/g, ""));
  } catch {
    throw new Error("An embedded Playwright report archive has invalid encoding.");
  }
  const normalized = decoded.replace(/[\t\n\r ]/g, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error("An embedded Playwright report archive has invalid base64.");
  }
  const archive = Buffer.from(normalized, "base64");
  const canonicalInput = normalized.replace(/=+$/, "");
  const canonicalDecoded = archive.toString("base64").replace(/=+$/, "");
  if (canonicalInput !== canonicalDecoded || !isZipBuffer(archive)) {
    throw new Error("An embedded Playwright report archive is invalid.");
  }
  return archive;
}

function decodePercentEncodedArchive(encoded) {
  const normalized = encoded.replace(/[\t\n\r ]/g, "");
  if (!/^(?:%[0-9a-f]{2})+$/i.test(normalized)) {
    throw new Error("A percent-encoded report archive has invalid encoding.");
  }
  const bytes = [];
  for (let index = 0; index < normalized.length; index += 3) {
    bytes.push(Number.parseInt(normalized.slice(index + 1, index + 3), 16));
  }
  const archive = Buffer.from(bytes);
  if (!isZipBuffer(archive)) {
    throw new Error("A percent-encoded report archive is invalid.");
  }
  return archive;
}

function findEmbeddedArchives(input) {
  const matches = [];
  const marker = new RegExp(embeddedArchiveMarkerGlobal.source, "gi");
  for (let match = marker.exec(input); match; match = marker.exec(input)) {
    const headerStart = marker.lastIndex;
    const comma = input.indexOf(",", headerStart);
    if (comma < 0 || comma - headerStart > 4_096) {
      throw new Error("An embedded report archive has an invalid Data URI header.");
    }
    const metadata = input.slice(headerStart, comma);
    if (!/^(?:\s*;[^,;]*)*\s*$/.test(metadata)) {
      throw new Error("An embedded report archive has invalid media parameters.");
    }
    const parameters = metadata
      .split(";")
      .map((parameter) => parameter.trim().toLowerCase())
      .filter(Boolean);
    const isBase64 = parameters.includes("base64");
    let cursor = comma + 1;
    if (isBase64) {
      while (cursor < input.length) {
        const character = input[cursor];
        if (/[A-Za-z0-9+/=\t\n\r ]/.test(character)) {
          cursor += 1;
          continue;
        }
        if (
          character === "%" &&
          /^[0-9a-f]{2}$/i.test(input.slice(cursor + 1, cursor + 3))
        ) {
          cursor += 3;
          continue;
        }
        break;
      }
    } else {
      while (cursor < input.length) {
        const character = input[cursor];
        if (/[\t\n\r ]/.test(character)) {
          cursor += 1;
          continue;
        }
        if (
          character === "%" &&
          /^[0-9a-f]{2}$/i.test(input.slice(cursor + 1, cursor + 3))
        ) {
          cursor += 3;
          continue;
        }
        break;
      }
    }
    const payload = input.slice(comma + 1, cursor);
    if (!payload.trim()) {
      throw new Error("An embedded report archive has an empty payload.");
    }
    matches.push({
      start: match.index,
      end: cursor,
      archive: isBase64
        ? decodeEmbeddedArchive(payload)
        : decodePercentEncodedArchive(payload),
    });
    marker.lastIndex = cursor;
  }
  return matches;
}

async function sanitizeEmbeddedArchives(input, secrets) {
  let cursor = 0;
  let output = "";
  const matches = findEmbeddedArchives(input);
  for (const match of matches) {
    const sanitizedArchive = await rebuildSanitizedArchive(match.archive, secrets);
    output += input.slice(cursor, match.start);
    output += `data:application/zip;base64,${sanitizedArchive.toString("base64")}`;
    cursor = match.end;
    metrics.embeddedArchivesSanitized += 1;
  }
  return matches.length > 0 ? output + input.slice(cursor) : input;
}

async function verifyEmbeddedArchives(input, secrets) {
  const matches = findEmbeddedArchives(input);
  if (embeddedArchiveMarker.test(input) && matches.length === 0) {
    throw new Error("An embedded Playwright report archive could not be parsed safely.");
  }
  for (const match of matches) await verifyArchiveBuffer(match.archive, secrets);
}

async function sanitizeRegularFile(filePath, secrets) {
  const buffer = await readFile(filePath);
  if (isZipBuffer(buffer)) {
    await sanitizeArchive(filePath, secrets);
    return;
  }
  if (isGzipBuffer(buffer)) {
    await sanitizeGzip(filePath, secrets);
    return;
  }

  const looksBinary = buffer.subarray(0, 8_192).includes(0);
  if (looksBinary) {
    const inspectableText = buffer.toString("utf8").replaceAll("\0", "");
    if (
      bufferContainsSecret(buffer, secrets) ||
      textContainsSecret(inspectableText, secrets) ||
      unsafeStructuredValue(inspectableText) ||
      embeddedArchiveMarker.test(inspectableText)
    ) {
      await rm(filePath, { force: true });
      metrics.unsafeBinaryFilesRemoved += 1;
      throw new Error(
        "An unsafe binary artifact was removed; refusing to publish incomplete evidence.",
      );
    }
    return;
  }

  const original = buffer.toString("utf8");
  let sanitized = sanitizeText(original, secrets);
  if (embeddedArchiveMarker.test(sanitized)) {
    sanitized = await sanitizeEmbeddedArchives(sanitized, secrets);
  }
  if (sanitized !== original) {
    await writeFile(filePath, sanitized, "utf8");
    metrics.textFilesSanitized += 1;
  }
  for (const secret of secrets) {
    if (sanitized.includes(secret)) {
      throw new Error("Exact secret remained in a sanitized text artifact.");
    }
  }
  if (unsafeStructuredValue(sanitized)) {
    throw new Error("A Session cookie value remained in a sanitized text artifact.");
  }
  if (embeddedArchiveMarker.test(sanitized)) {
    await verifyEmbeddedArchives(sanitized, secrets);
  }
}

async function sanitizeArchive(archivePath, secrets) {
  try {
    const rebuiltArchive = await rebuildSanitizedArchive(
      await readFile(archivePath),
      secrets,
    );
    await writeFile(archivePath, rebuiltArchive);
    metrics.archivesSanitized += 1;
  } catch (error) {
    // Never upload an original archive if it could not be safely rebuilt.
    await rm(archivePath, { force: true });
    await writeFile(`${archivePath}.omitted.txt`, "Archive omitted because sanitization could not be guaranteed.\n");
    metrics.unsafeArchivesRemoved += 1;
    throw new Error(
      "An unsafe archive was removed; refusing to publish incomplete evidence.",
      { cause: error },
    );
  }
}

async function sanitizeGzip(gzipPath, secrets) {
  try {
    const rebuiltGzip = await rebuildSanitizedGzip(
      await readFile(gzipPath),
      secrets,
    );
    await writeFile(gzipPath, rebuiltGzip);
    metrics.gzipStreamsSanitized += 1;
  } catch (error) {
    await rm(gzipPath, { force: true });
    await writeFile(
      `${gzipPath}.omitted.txt`,
      "Gzip stream omitted because sanitization could not be guaranteed.\n",
    );
    metrics.unsafeArchivesRemoved += 1;
    throw new Error(
      "An unsafe gzip stream was removed; refusing to publish incomplete evidence.",
      { cause: error },
    );
  }
}

async function sanitizeTree(directory, secrets, rootDirectory = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = await sanitizeEntryName(
      directory,
      entry.name,
      secrets,
      rootDirectory,
    );
    if (entry.isSymbolicLink()) {
      await rm(entryPath, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await sanitizeTree(entryPath, secrets, rootDirectory);
    } else if (entry.isFile()) {
      await sanitizeRegularFile(entryPath, secrets);
    }
  }
}

async function verifyTree(directory, secrets, rootDirectory = directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const relativePath = path
      .relative(rootDirectory, entryPath)
      .split(path.sep)
      .join("/");
    if (bufferContainsSecret(Buffer.from(relativePath, "utf8"), secrets)) {
      throw new Error("Exact secret remained in an artifact path.");
    }
    if (unsafeStructuredValue(relativePath)) {
      throw new Error("A Session cookie value remained in an artifact path.");
    }
    if (entry.isDirectory()) {
      await verifyTree(entryPath, secrets, rootDirectory);
      continue;
    }
    if (!entry.isFile()) continue;
    const buffer = await readFile(entryPath);
    if (isZipBuffer(buffer)) {
      await verifyArchiveBuffer(buffer, secrets);
      continue;
    }
    if (isGzipBuffer(buffer)) {
      await verifyGzipBuffer(buffer, secrets);
      continue;
    }
    if (bufferContainsSecret(buffer, secrets)) {
      throw new Error("Exact secret remained in the sanitized artifact tree.");
    }
    const looksBinary = buffer.subarray(0, 8_192).includes(0);
    const text = buffer.toString("utf8").replaceAll("\0", "");
    if (textContainsSecret(text, secrets)) {
      throw new Error("An encoded secret remained in the sanitized artifact tree.");
    }
    if (looksBinary) {
      if (unsafeStructuredValue(text) || embeddedArchiveMarker.test(text)) {
        throw new Error("Unsafe structured data remained in a binary artifact.");
      }
    } else {
      if (unsafeStructuredValue(text)) {
        throw new Error("A Session cookie value remained in the sanitized artifact tree.");
      }
      if (embeddedArchiveMarker.test(text)) {
        await verifyEmbeddedArchives(text, secrets);
      }
    }
  }
}

function assertSafeReviewRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.startsWith("../")
  ) {
    throw new Error("The product review manifest contains an unsafe artifact path.");
  }
}

function isSupportedReviewScreenshot(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (extension === ".webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("Review screenshot is not a valid PNG.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function isSafeTextLog(buffer) {
  if (buffer.length > 10 * 1024 * 1024) return false;
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return false;
  if (isZipBuffer(buffer) || isGzipBuffer(buffer)) return false;
  if (buffer.subarray(0, 8).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

async function enforceEvidenceAllowlist() {
  const reviewRoot = path.join(outputRoot, "review-artifacts");
  if (await exists(reviewRoot)) {
    for (const entry of await readdir(reviewRoot, { withFileTypes: true })) {
      const entryPath = path.join(reviewRoot, entry.name);
      if (
        entry.isFile() &&
        (entry.name === "evidence-index.json" ||
          entry.name === "manifest.json" ||
          allowedReviewReports.has(entry.name))
      ) {
        continue;
      }
      if (entry.isDirectory() && entry.name === "screenshots") {
        for (const screenshot of await readdir(entryPath, { withFileTypes: true })) {
          const screenshotPath = path.join(entryPath, screenshot.name);
          if (
            screenshot.isFile() &&
            isSupportedReviewScreenshot(
              screenshotPath,
              await readFile(screenshotPath),
            )
          ) {
            continue;
          }
          await rm(screenshotPath, { recursive: true, force: true });
          metrics.disallowedEvidenceEntriesRemoved += 1;
        }
        continue;
      }
      await rm(entryPath, { recursive: true, force: true });
      metrics.disallowedEvidenceEntriesRemoved += 1;
    }
  }

  const logsRoot = path.join(outputRoot, "test-logs");
  if (await exists(logsRoot)) {
    for (const entry of await readdir(logsRoot, { withFileTypes: true })) {
      const entryPath = path.join(logsRoot, entry.name);
      if (!entry.isFile() || !allowedTestLogs.has(entry.name)) {
        await rm(entryPath, { recursive: true, force: true });
        metrics.disallowedEvidenceEntriesRemoved += 1;
        continue;
      }
      if (!isSafeTextLog(await readFile(entryPath))) {
        await rm(entryPath, { force: true });
        metrics.disallowedEvidenceEntriesRemoved += 1;
        throw new Error(
          `Allowed test log is not safe UTF-8 text: ${entry.name}`,
        );
      }
    }
  }
}

async function verifyReviewEvidenceCompleteness() {
  const required =
    /^true$/i.test(process.env.CI || "") ||
    metrics.copiedRoots.includes("review-artifacts");
  if (!required) return;
  if (metrics.unsafeBinaryFilesRemoved > 0 || metrics.unsafeArchivesRemoved > 0) {
    throw new Error("Unsafe evidence was removed; the review artifact is incomplete.");
  }

  const reviewRoot = path.join(outputRoot, "review-artifacts");
  if (await exists(path.join(reviewRoot, "manifest.json"))) {
    throw new Error(
      "The evidence payload must not contain a legacy authoritative manifest.",
    );
  }
  const indexPath = path.join(reviewRoot, "evidence-index.json");
  let evidenceIndex;
  try {
    evidenceIndex = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    throw new Error(
      "A valid product review evidence index is required before evidence upload.",
    );
  }
  assertEvidenceIndex(evidenceIndex, {
    ci: /^true$/i.test(process.env.CI || ""),
  });
  if (
    !Array.isArray(evidenceIndex.requiredScreenshots) ||
    !Array.isArray(evidenceIndex.screenshotFiles) ||
    !Array.isArray(evidenceIndex.screenshots) ||
    !Array.isArray(evidenceIndex.missingScreenshots) ||
    typeof evidenceIndex.screenshotsComplete !== "boolean"
  ) {
    throw new Error("The product review evidence index has an invalid screenshot contract.");
  }
  for (const screenshot of requiredReviewScreenshots) {
    if (!evidenceIndex.requiredScreenshots.includes(screenshot)) {
      throw new Error(`Required product review screenshot is undeclared: ${screenshot}`);
    }
  }
  if (
    evidenceIndex.requiredScreenshots.length !== requiredReviewScreenshots.length ||
    new Set(evidenceIndex.requiredScreenshots).size !== requiredReviewScreenshots.length
  ) {
    throw new Error("The product review evidence index changed the required screenshot set.");
  }

  const missingScreenshots = requiredReviewScreenshots.filter(
    (screenshot) => !evidenceIndex.screenshotFiles.includes(screenshot),
  );
  const declaredMissing = [...evidenceIndex.missingScreenshots].sort();
  if (
    new Set(evidenceIndex.screenshotFiles).size !== evidenceIndex.screenshotFiles.length ||
    new Set(evidenceIndex.missingScreenshots).size !== evidenceIndex.missingScreenshots.length ||
    JSON.stringify(declaredMissing) !== JSON.stringify([...missingScreenshots].sort()) ||
    evidenceIndex.screenshotsComplete !== (missingScreenshots.length === 0)
  ) {
    throw new Error("The product review evidence index misstates screenshot completeness.");
  }

  const status = evidenceIndex.status.toLowerCase();
  if ((status === "success" || status === "local") && missingScreenshots.length > 0) {
    throw new Error("Successful product review evidence requires every screenshot.");
  }
  if (status === "success" && evidenceIndex.version.startsWith("0.8.")) {
    for (const report of requiredRetrievalReports) {
      if (!(await exists(path.join(reviewRoot, report)))) {
        throw new Error(`Successful B3-B2 evidence is missing Retrieval report: ${report}`);
      }
    }
    for (const report of requiredReleaseReports) {
      if (!(await exists(path.join(reviewRoot, report)))) {
        throw new Error(`Successful B3-C1 evidence is missing Release report: ${report}`);
      }
    }
  }

  metrics.reviewStatus = status;
  metrics.screenshotsComplete = evidenceIndex.screenshotsComplete;
  metrics.screenshotCount = evidenceIndex.screenshotFiles.length;
  metrics.missingReviewScreenshots = missingScreenshots;

  for (const screenshot of evidenceIndex.screenshotFiles) {
    assertSafeReviewRelativePath(screenshot);
    const screenshotPath = path.join(reviewRoot, ...screenshot.split("/"));
    let stats;
    try {
      stats = await lstat(screenshotPath);
    } catch {
      throw new Error(`Manifest screenshot does not exist: ${screenshot}`);
    }
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Manifest screenshot is not a non-empty file: ${screenshot}`);
    }
    const screenshotBuffer = await readFile(screenshotPath);
    if (!isSupportedReviewScreenshot(screenshotPath, screenshotBuffer)) {
      throw new Error(`Manifest screenshot has invalid image content: ${screenshot}`);
    }
    const filename = path.posix.basename(screenshot);
    const declared = evidenceIndex.screenshots.find(
      (entry) => entry.filename === filename,
    );
    const actual = readPngDimensions(screenshotBuffer);
    if (
      !declared ||
      declared.width !== actual.width ||
      declared.height !== actual.height
    ) {
      throw new Error(`Manifest screenshot dimensions do not match: ${screenshot}`);
    }
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const sourceRoot of sourceRoots) {
  const sourcePath = path.resolve(sourceRoot);
  if (!(await exists(sourcePath))) continue;
  const stats = await lstat(sourcePath);
  if (!stats.isDirectory()) continue;
  await cp(sourcePath, path.join(outputRoot, sourceRoot), {
    recursive: true,
    verbatimSymlinks: false,
  });
  metrics.copiedRoots.push(sourceRoot);
}

await enforceEvidenceAllowlist();
const secrets = await collectSecrets();
await sanitizeTree(outputRoot, secrets);
await verifyTree(outputRoot, secrets);
await verifyReviewEvidenceCompleteness();
await writeFile(
  path.join(outputRoot, "sanitization-report.json"),
  `${JSON.stringify({ status: "passed", ...metrics }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `Sanitized product review evidence is ready (${metrics.copiedRoots.length} source root(s), ${metrics.archivesSanitized} archive(s)).\n`,
);
