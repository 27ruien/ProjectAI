import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import {
  assertDigest,
  assertFullSha,
  assertIsoTimestamp,
  assertReleaseSessionId,
  assertSanitized,
  digestObject,
  readJson,
  withDigest,
} from "./contract.mjs";
import {
  AUTHORIZATION_ACTIONS,
  assertProductionAuthorizationFresh,
  assertProductionAuthorizationIdentity,
  ProductionRolloutError,
} from "./production-rollout-contract.mjs";

export const PRODUCTION_TRUST_CONTRACT_PATH = path.resolve(
  new URL("../../release/production-rollout-trust.json", import.meta.url).pathname,
);
export const PRODUCTION_AUTHORIZATION_KEY_PATH =
  "/srv/projectai/authorization/production-rollout-public-key.pem";
export const PRODUCTION_ROLLOUT_MARKER_PATH =
  "/srv/projectai/authorization/rollout-enabled.json";
export const PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH =
  "/srv/projectai/scripts/release/production-authorization-claim.mjs";
export const PRODUCTION_AUTHORIZATION_CLAIM_BUNDLE_PATH =
  "/srv/projectai/release/production-authorization-claim-bundle.json";

const USED_AUTHORIZATION_JOURNAL_MODE = 0o600;
const USED_AUTHORIZATION_DIRECTORY_MODE = 0o700;
const USED_AUTHORIZATION_LOCK_WAIT_MS = 10_000;
const USED_AUTHORIZATION_LOCK_RETRY_MS = 10;
const USED_AUTHORIZATION_CLAIMS_DIRECTORY = ".used-authorization-claims";
const USED_AUTHORIZATION_MUTEX_KEYS = [
  "acquiredAt",
  "digest",
  "ownerId",
  "pid",
  "schemaVersion",
].sort();
const USED_AUTHORIZATION_CLAIM_KEYS = [
  "action",
  "authorizationDigest",
  "authorizationId",
  "claimedAt",
  "digest",
  "phase",
  "recordType",
  "releaseSessionId",
  "schemaVersion",
].sort();
const USED_AUTHORIZATION_ENTRY_KEYS = [
  "action",
  "authorizationDigest",
  "authorizationId",
  "claimDigest",
  "consumedAt",
  "digest",
  "phase",
  "previousDigest",
  "recordType",
  "releaseSessionId",
  "schemaVersion",
].sort();

function trustError(message) {
  return new ProductionRolloutError(
    "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    message,
  );
}

export async function inspectProtectedFile(
  filename,
  {
    modes,
    expectedUid = 0,
    errorCode = "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    validateParents = false,
  },
) {
  const protectedFile = await openProtectedFile(filename, {
    modes,
    expectedUid,
    errorCode,
    validateParents,
  });
  try {
    return {
      mode: protectedFile.metadata.mode & 0o777,
      uid: protectedFile.metadata.uid,
      gid: protectedFile.metadata.gid,
      size: protectedFile.metadata.size,
    };
  } finally {
    await protectedFile.handle.close().catch(() => {});
  }
}

function protectedFileError(errorCode, message) {
  return new ProductionRolloutError(errorCode, message);
}

function attachProtectedFileObservation(error, metadata, causeCode) {
  if (metadata) {
    error.observedDev = metadata.dev;
    error.observedIno = metadata.ino;
  }
  if (causeCode) error.fsCauseCode = causeCode;
  return error;
}

async function assertProtectedParents(filename, { expectedUid, errorCode }) {
  const resolved = path.resolve(filename);
  const root = path.parse(resolved).root;
  const relative = path.relative(root, path.dirname(resolved));
  const parts = relative === "" ? [] : relative.split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch {
      throw protectedFileError(errorCode, "Protected authorization parent is missing.");
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.uid !== expectedUid ||
      ((metadata.mode & 0o777) & 0o022) !== 0
    ) {
      throw protectedFileError(errorCode, "Protected authorization parent metadata is invalid.");
    }
  }
}

async function assertProtectedPathIdentity(
  filename,
  metadata,
  errorCode,
  { requireCanonicalPath = false } = {},
) {
  let pathnameMetadata;
  let resolvedRealPath;
  try {
    [pathnameMetadata, resolvedRealPath] = await Promise.all([
      lstat(filename),
      realpath(filename),
    ]);
  } catch {
    throw protectedFileError(errorCode, "Protected authorization file path is unavailable.");
  }
  if (
    pathnameMetadata.isSymbolicLink() ||
    pathnameMetadata.dev !== metadata.dev ||
    pathnameMetadata.ino !== metadata.ino ||
    (requireCanonicalPath && resolvedRealPath !== path.resolve(filename))
  ) {
    throw protectedFileError(errorCode, "Protected authorization file path is invalid.");
  }
}

async function openProtectedFile(
  filename,
  { modes, expectedUid, errorCode, validateParents, nlinks = [1] },
) {
  const resolved = path.resolve(filename);
  if (validateParents) {
    await assertProtectedParents(resolved, { expectedUid, errorCode });
  }
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw protectedFileError(errorCode, "O_NOFOLLOW is required for protected authorization files.");
  }
  let handle;
  let metadata;
  try {
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    metadata = await handle.stat();
    const mode = metadata.mode & 0o777;
    if (
      !metadata.isFile() ||
      metadata.uid !== expectedUid ||
      !modes.includes(mode) ||
      !nlinks.includes(metadata.nlink) ||
      metadata.size < 1 ||
      metadata.size > 1024 * 1024
    ) {
      throw protectedFileError(errorCode, "Protected authorization file metadata is invalid.");
    }
    await assertProtectedPathIdentity(resolved, metadata, errorCode, {
      requireCanonicalPath: validateParents,
    });
    return { handle, metadata, resolved, validateParents };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof ProductionRolloutError) {
      throw attachProtectedFileObservation(error, metadata);
    }
    throw attachProtectedFileObservation(
      protectedFileError(
        errorCode,
        "Protected authorization file could not be opened safely.",
      ),
      metadata,
      error?.code,
    );
  }
}

export async function readProtectedFile(filename, options) {
  const protectedFile = await openProtectedFile(filename, options);
  try {
    const contents = await protectedFile.handle.readFile("utf8");
    const metadata = await protectedFile.handle.stat();
    const allowedLinks = options.nlinks ?? [1];
    if (
      !metadata.isFile() ||
      metadata.uid !== options.expectedUid ||
      !options.modes.includes(metadata.mode & 0o777) ||
      !allowedLinks.includes(metadata.nlink) ||
      metadata.size < 1 ||
      metadata.size > 1024 * 1024
    ) {
      throw protectedFileError(
        options.errorCode,
        "Protected authorization file metadata changed while it was read.",
      );
    }
    await assertProtectedPathIdentity(
      protectedFile.resolved,
      metadata,
      options.errorCode,
      { requireCanonicalPath: protectedFile.validateParents },
    );
    return options.includeMetadata ? { contents, metadata } : contents;
  } catch (error) {
    if (error instanceof ProductionRolloutError) {
      throw attachProtectedFileObservation(error, protectedFile.metadata);
    }
    throw attachProtectedFileObservation(
      protectedFileError(
        options.errorCode,
        "Protected authorization file could not be read safely.",
      ),
      protectedFile.metadata,
      error?.code,
    );
  } finally {
    await protectedFile.handle.close().catch(() => {});
  }
}

export function publicKeyFingerprint(publicKey) {
  let key;
  try {
    key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  } catch {
    throw trustError("Production Authorization key is not a valid public key.");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw trustError("Production Authorization key must be Ed25519.");
  }
  const der = key.export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(der).digest("hex")}`;
}

export async function loadAuthorizationTrust({
  environment,
  rehearsalPublicKeyPath,
  rehearsalTrustPath,
} = {}) {
  const production = environment === "production";
  const trustPath = production
    ? PRODUCTION_TRUST_CONTRACT_PATH
    : path.resolve(rehearsalTrustPath ?? PRODUCTION_TRUST_CONTRACT_PATH);
  let contract;
  try {
    contract = production
      ? JSON.parse(await readProtectedFile(trustPath, {
          modes: [0o400, 0o444],
          expectedUid: 0,
          errorCode: "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
          validateParents: true,
        }))
      : await readJson(trustPath);
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw trustError("Production Authorization Trust Contract is invalid JSON.");
  }
  if (
    contract.schemaVersion !== 1 ||
    contract.algorithm !== "ed25519" ||
    contract.fingerprintEncoding !== "spki-der-sha256" ||
    contract.productionKeyPath !== PRODUCTION_AUTHORIZATION_KEY_PATH ||
    contract.productionMarkerPath !== PRODUCTION_ROLLOUT_MARKER_PATH ||
    contract.productionClaimHelperPath !== PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH ||
    contract.productionClaimBundlePath !== PRODUCTION_AUTHORIZATION_CLAIM_BUNDLE_PATH
  ) {
    throw trustError("Production Authorization Trust Contract is invalid.");
  }
  assertDigest(contract.publicKeySha256, "publicKeySha256");
  assertDigest(contract.productionClaimHelperSha256, "productionClaimHelperSha256");
  assertDigest(contract.productionClaimBundleSha256, "productionClaimBundleSha256");
  const keyPath = production
    ? PRODUCTION_AUTHORIZATION_KEY_PATH
    : path.resolve(rehearsalPublicKeyPath ?? "");
  if (!production && !rehearsalPublicKeyPath) {
    throw trustError("Rehearsal public key path is required.");
  }
  const publicKey = await readProtectedFile(keyPath, {
    modes: production ? [0o400, 0o444] : [0o400, 0o440, 0o444, 0o600, 0o640, 0o644],
    expectedUid: production ? 0 : process.getuid?.() ?? 0,
    errorCode: "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
    validateParents: production,
  });
  const fingerprint = publicKeyFingerprint(publicKey);
  if (fingerprint !== contract.publicKeySha256) {
    throw trustError("Production Authorization key fingerprint does not match the reviewed contract.");
  }
  return { contract, publicKey, fingerprint, keyPath };
}

function markerDigestPayload(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest"));
}

export async function assertAuthorizationMarker({
  environment,
  authorization,
  phase,
  action,
  markerPath,
  now = new Date(),
}) {
  const production = environment === "production";
  const resolved = production
    ? PRODUCTION_ROLLOUT_MARKER_PATH
    : path.resolve(markerPath ?? "");
  if (!production && !markerPath) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
      "Rehearsal Authorization Marker is required.",
    );
  }
  let marker;
  try {
    marker = JSON.parse(await readProtectedFile(resolved, {
    modes: production ? [0o400, 0o600] : [0o400, 0o600, 0o640, 0o644],
    expectedUid: production ? 0 : process.getuid?.() ?? 0,
    errorCode: "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
      validateParents: production,
    }));
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
      "Authorization Marker is invalid JSON.",
    );
  }
  return assertAuthorizationMarkerValue({ marker, authorization, phase, action, now });
}

export function assertAuthorizationMarkerValue({
  marker,
  authorization,
  phase,
  action,
  now = new Date(),
}) {
  if (
    marker.schemaVersion !== 1 ||
    marker.releaseSessionId !== authorization.releaseSessionId ||
    marker.authorizationId !== authorization.authorizationId ||
    marker.releaseCandidateSha !== authorization.releaseCandidateSha ||
    marker.phase !== Number(phase) ||
    marker.action !== action ||
    marker.action !== authorization.action ||
    marker.digest !== digestObject(markerDigestPayload(marker))
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
      "Authorization Marker does not match the signed Authorization.",
    );
  }
  assertReleaseSessionId(marker.releaseSessionId);
  assertFullSha(marker.releaseCandidateSha, "marker.releaseCandidateSha");
  assertIsoTimestamp(marker.expiresAt, "marker.expiresAt");
  if (Date.parse(marker.expiresAt) <= now.getTime()) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_MARKER_INVALID",
      "Authorization Marker has expired.",
    );
  }
  assertSanitized(marker);
  return marker;
}

export function createTestAuthorizationMarker({ authorization, phase, action, expiresAt }) {
  if (process.env.NODE_ENV !== "test") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Test Authorization Marker is restricted to NODE_ENV=test.",
    );
  }
  if (!AUTHORIZATION_ACTIONS.includes(action) || action !== authorization.action) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      "Test Authorization Marker action does not match the signed Authorization.",
    );
  }
  return withDigest({
    schemaVersion: 1,
    markerId: `pm-${randomUUID().replaceAll("-", "")}`,
    releaseSessionId: authorization.releaseSessionId,
    authorizationId: authorization.authorizationId,
    releaseCandidateSha: authorization.releaseCandidateSha,
    phase: Number(phase),
    action,
    expiresAt,
  });
}

export function usedAuthorizationsPath(stateDir) {
  return path.join(path.resolve(stateDir), "used-authorizations.jsonl");
}

function rolloutStateError(message) {
  return new ProductionRolloutError("PRODUCTION_ROLLOUT_STATE_UNKNOWN", message);
}

function expectedOwner(environment) {
  if (environment === "production") return 0;
  if (environment === "rehearsal") return process.getuid?.() ?? 0;
  throw rolloutStateError("Used Authorization environment is invalid.");
}

function assertProtectedMetadata(
  metadata,
  { expectedUid, mode, kind = "file", label, nlinks = [1] },
) {
  const actualMode = metadata.mode & 0o777;
  const correctKind = kind === "directory" ? metadata.isDirectory() : metadata.isFile();
  if (
    metadata.isSymbolicLink() ||
    !correctKind ||
    metadata.uid !== expectedUid ||
    actualMode !== mode ||
    (kind === "file" && !nlinks.includes(metadata.nlink))
  ) {
    throw rolloutStateError(`${label} metadata is invalid.`);
  }
  return metadata;
}

async function prepareUsedAuthorizationDirectory({ stateDir, authorization, environment }) {
  const resolved = path.resolve(stateDir);
  const expectedUid = expectedOwner(environment);
  const productionPath = `/srv/projectai/releases/${authorization.releaseSessionId}`;
  if (environment === "production") {
    if (resolved !== productionPath) {
      throw rolloutStateError("Used Authorization state directory is not the fixed Release Session path.");
    }
    for (const parent of ["/srv", "/srv/projectai", "/srv/projectai/releases"]) {
      let metadata;
      try {
        metadata = await lstat(parent);
      } catch {
        throw rolloutStateError("Used Authorization parent directory is unavailable.");
      }
      const mode = metadata.mode & 0o777;
      if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        metadata.uid !== expectedUid ||
        (mode & 0o022) !== 0
      ) {
        throw rolloutStateError("Used Authorization parent directory is unsafe.");
      }
    }
  } else {
    let existed = true;
    try {
      await lstat(resolved);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw rolloutStateError("Used Authorization state directory could not be inspected.");
      }
      existed = false;
    }
    await mkdir(resolved, { recursive: true, mode: USED_AUTHORIZATION_DIRECTORY_MODE });
    if (!existed) await syncDirectory(path.dirname(resolved));
  }
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch {
    throw rolloutStateError("Used Authorization state directory is unavailable.");
  }
  assertProtectedMetadata(metadata, {
    expectedUid,
    mode: USED_AUTHORIZATION_DIRECTORY_MODE,
    kind: "directory",
    label: "Used Authorization state directory",
  });
  if (environment === "production") {
    let resolvedRealPath;
    try {
      resolvedRealPath = await realpath(resolved);
    } catch {
      throw rolloutStateError("Used Authorization state directory real path is unavailable.");
    }
    if (resolvedRealPath !== resolved) {
      throw rolloutStateError("Used Authorization state directory contains a symbolic link.");
    }
  }
  return { resolved, expectedUid };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, fsConstants.O_RDONLY | noFollowFlag());
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) throw new Error("not a directory");
    await handle.sync();
  } catch {
    throw rolloutStateError("Used Authorization directory could not be synchronized.");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function noFollowFlag() {
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw rolloutStateError("O_NOFOLLOW is required for Used Authorization state.");
  }
  return fsConstants.O_NOFOLLOW;
}

function claimsDirectoryPath(stateDir) {
  return path.join(path.resolve(stateDir), USED_AUTHORIZATION_CLAIMS_DIRECTORY);
}

function authorizationClaimPath(stateDir, authorizationId) {
  return path.join(claimsDirectoryPath(stateDir), `${authorizationId}.json`);
}

function assertClaimRecord(claim, { authorization, phase, action }) {
  try {
    if (
      !claim ||
      typeof claim !== "object" ||
      Array.isArray(claim) ||
      Object.keys(claim).sort().join("\0") !== USED_AUTHORIZATION_CLAIM_KEYS.join("\0") ||
      claim.schemaVersion !== 1 ||
      claim.recordType !== "production-authorization-claim" ||
      claim.authorizationId !== authorization.authorizationId ||
      claim.authorizationDigest !== authorization.digest ||
      claim.releaseSessionId !== authorization.releaseSessionId ||
      claim.phase !== Number(phase) ||
      claim.action !== action
    ) {
      throw new Error("invalid claim");
    }
    assertIsoTimestamp(claim.claimedAt, "claimedAt");
    assertDigest(claim.digest, "claim.digest");
    assertSanitized(claim);
    const expectedDigest = digestObject(
      Object.fromEntries(Object.entries(claim).filter(([key]) => key !== "digest")),
    );
    if (claim.digest !== expectedDigest) throw new Error("invalid claim digest");
    return claim;
  } catch {
    throw rolloutStateError("Used Authorization atomic claim is invalid.");
  }
}

async function inspectClaimsDirectory(stateDir, expectedUid, { create = false } = {}) {
  const directory = claimsDirectoryPath(stateDir);
  let created = false;
  try {
    const metadata = await lstat(directory);
    assertProtectedMetadata(metadata, {
      expectedUid,
      mode: USED_AUTHORIZATION_DIRECTORY_MODE,
      kind: "directory",
      label: "Used Authorization claims directory",
    });
  } catch (error) {
    if (error?.code !== "ENOENT" || !create) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof ProductionRolloutError) throw error;
      throw rolloutStateError("Used Authorization claims directory is unavailable.");
    }
    try {
      await mkdir(directory, { mode: USED_AUTHORIZATION_DIRECTORY_MODE });
      created = true;
    } catch (mkdirError) {
      if (mkdirError?.code !== "EEXIST") {
        throw rolloutStateError("Used Authorization claims directory could not be created.");
      }
    }
    let metadata;
    try {
      metadata = await lstat(directory);
    } catch {
      throw rolloutStateError("Used Authorization claims directory is unavailable.");
    }
    assertProtectedMetadata(metadata, {
      expectedUid,
      mode: USED_AUTHORIZATION_DIRECTORY_MODE,
      kind: "directory",
      label: "Used Authorization claims directory",
    });
  }
  if (created) await syncDirectory(stateDir);
  return directory;
}

async function readAuthorizationClaim({ stateDir, authorization, phase, action, expectedUid }) {
  const directory = await inspectClaimsDirectory(stateDir, expectedUid);
  if (!directory) return null;
  const filename = authorizationClaimPath(stateDir, authorization.authorizationId);
  let contents;
  try {
    contents = await readProtectedFile(filename, {
      modes: [USED_AUTHORIZATION_JOURNAL_MODE],
      expectedUid,
      errorCode: "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      validateParents: false,
      // Publication uses a hard link. A competing process can observe the
      // complete, fsynced claim before the publisher removes its temp link.
      nlinks: [1, 2],
    });
  } catch (error) {
    if (error?.fsCauseCode === "ENOENT") return null;
    if (error?.code === "PRODUCTION_ROLLOUT_STATE_UNKNOWN") {
      try {
        await lstat(filename);
      } catch (metadataError) {
        if (metadataError?.code === "ENOENT") return null;
      }
    }
    throw error;
  }
  let claim;
  try {
    claim = JSON.parse(contents);
  } catch {
    throw rolloutStateError("Used Authorization atomic claim is invalid JSON.");
  }
  return assertClaimRecord(claim, { authorization, phase, action });
}

function alreadyConsumedError() {
  return new ProductionRolloutError(
    "PRODUCTION_AUTHORIZATION_REPLAYED",
    "already_consumed: Production Authorization has already been consumed.",
  );
}

async function atomicClaimAuthorization({
  stateDir,
  authorization,
  phase,
  action,
  expectedUid,
}) {
  const directory = await inspectClaimsDirectory(stateDir, expectedUid, { create: true });
  const filename = authorizationClaimPath(stateDir, authorization.authorizationId);
  const temporary = path.join(
    directory,
    `.${authorization.authorizationId}.${process.pid}.${randomUUID()}.tmp`,
  );
  const claim = withDigest({
    schemaVersion: 1,
    recordType: "production-authorization-claim",
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.digest,
    releaseSessionId: authorization.releaseSessionId,
    phase: Number(phase),
    action,
    claimedAt: new Date().toISOString(),
  });
  assertClaimRecord(claim, { authorization, phase, action });
  let handle;
  let linked = false;
  try {
    handle = await open(
      temporary,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        noFollowFlag(),
      USED_AUTHORIZATION_JOURNAL_MODE,
    );
    const metadata = assertProtectedMetadata(await handle.stat(), {
      expectedUid,
      mode: USED_AUTHORIZATION_JOURNAL_MODE,
      label: "Used Authorization claim temporary file",
    });
    const bytes = Buffer.from(`${JSON.stringify(claim)}\n`, "utf8");
    const result = await handle.write(bytes, 0, bytes.length, null);
    if (result.bytesWritten !== bytes.length) {
      throw rolloutStateError("Used Authorization atomic claim write was incomplete.");
    }
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, filename);
      linked = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw rolloutStateError("Used Authorization could not be claimed atomically.");
      }
    }
    await unlink(temporary);
    await syncDirectory(directory);
    if (!linked) {
      const existing = await readAuthorizationClaim({
        stateDir,
        authorization,
        phase,
        action,
        expectedUid,
      });
      if (!existing) throw rolloutStateError("Used Authorization claim disappeared.");
      return { claim: existing, owned: false };
    }
    const finalMetadata = await lstat(filename);
    assertProtectedMetadata(finalMetadata, {
      expectedUid,
      mode: USED_AUTHORIZATION_JOURNAL_MODE,
      label: "Used Authorization claim",
    });
    if (finalMetadata.dev !== metadata.dev || finalMetadata.ino !== metadata.ino) {
      throw rolloutStateError("Used Authorization claim path changed unexpectedly.");
    }
    return { claim, owned: true };
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    if (error instanceof ProductionRolloutError) throw error;
    throw rolloutStateError("Used Authorization could not be claimed atomically.");
  }
}

function assertMutexRecord(value) {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== USED_AUTHORIZATION_MUTEX_KEYS.join("\0") ||
      value.schemaVersion !== 1 ||
      !/^um-[0-9a-f]{32}$/.test(value.ownerId ?? "") ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1
    ) {
      throw new Error("invalid mutex");
    }
    assertIsoTimestamp(value.acquiredAt, "mutex.acquiredAt");
    assertDigest(value.digest, "mutex.digest");
    assertSanitized(value);
    const expectedDigest = digestObject(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")),
    );
    if (value.digest !== expectedDigest) throw new Error("invalid mutex digest");
    return value;
  } catch {
    throw rolloutStateError("Used Authorization mutex metadata is invalid.");
  }
}

async function readExistingMutex(lockPath, expectedUid) {
  let protectedMutex;
  try {
    protectedMutex = await readProtectedFile(lockPath, {
      modes: [USED_AUTHORIZATION_JOURNAL_MODE],
      expectedUid,
      errorCode: "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
      validateParents: false,
      nlinks: [1, 2],
      includeMetadata: true,
    });
  } catch (error) {
    if (error?.fsCauseCode === "ENOENT") return null;
    let current;
    try {
      current = await lstat(lockPath);
    } catch (metadataError) {
      if (metadataError?.code === "ENOENT") return null;
      throw rolloutStateError("Used Authorization mutex could not be re-inspected.");
    }
    assertProtectedMetadata(current, {
      expectedUid,
      mode: USED_AUTHORIZATION_JOURNAL_MODE,
      label: "Used Authorization mutex",
      nlinks: [1, 2],
    });
    if (current.size < 1 || current.size > 1024 * 1024) {
      throw rolloutStateError("Used Authorization mutex metadata is invalid.");
    }
    if (
      error?.observedDev !== undefined &&
      error?.observedIno !== undefined &&
      (current.dev !== error.observedDev || current.ino !== error.observedIno)
    ) {
      return null;
    }
    throw error;
  }
  let value;
  try {
    value = JSON.parse(protectedMutex.contents);
  } catch {
    throw rolloutStateError("Used Authorization mutex metadata is invalid JSON.");
  }
  assertMutexRecord(value);
  return {
    ...value,
    dev: protectedMutex.metadata.dev,
    ino: protectedMutex.metadata.ino,
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function mutexPathStillMatches(lockPath, owner, expectedUid) {
  let metadata;
  try {
    metadata = await lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw rolloutStateError("Used Authorization mutex could not be re-inspected.");
  }
  if (metadata.dev !== owner.dev || metadata.ino !== owner.ino) return false;
  assertProtectedMetadata(metadata, {
    expectedUid,
    mode: USED_AUTHORIZATION_JOURNAL_MODE,
    label: "Used Authorization mutex",
    nlinks: [1, 2],
  });
  return true;
}

async function acquireUsedAuthorizationMutex(filename, expectedUid) {
  const lockPath = `${filename}.lock`;
  const lockDirectory = path.dirname(lockPath);
  const deadline = Date.now() + USED_AUTHORIZATION_LOCK_WAIT_MS;
  while (true) {
    const temporary = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
    const owner = withDigest({
      schemaVersion: 1,
      ownerId: `um-${randomUUID().replaceAll("-", "")}`,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    });
    assertMutexRecord(owner);
    let handle;
    let linked = false;
    let owned;
    try {
      handle = await open(
        temporary,
        fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_WRONLY |
          noFollowFlag(),
        USED_AUTHORIZATION_JOURNAL_MODE,
      );
      const metadata = assertProtectedMetadata(await handle.stat(), {
        expectedUid,
        mode: USED_AUTHORIZATION_JOURNAL_MODE,
        label: "Used Authorization mutex temporary file",
      });
      owned = { dev: metadata.dev, ino: metadata.ino };
      const bytes = Buffer.from(`${JSON.stringify(owner)}\n`, "utf8");
      const result = await handle.write(bytes, 0, bytes.length, null);
      if (result.bytesWritten !== bytes.length) {
        throw rolloutStateError("Used Authorization mutex write was incomplete.");
      }
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await link(temporary, lockPath);
        linked = true;
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw rolloutStateError("Used Authorization mutex could not be published atomically.");
        }
      }
      await unlink(temporary);
      await syncDirectory(lockDirectory);
      if (linked) {
        const metadataAtPath = await lstat(lockPath);
        if (
          metadataAtPath.isSymbolicLink() ||
          metadataAtPath.dev !== owned.dev ||
          metadataAtPath.ino !== owned.ino
        ) {
          throw rolloutStateError("Used Authorization mutex ownership changed unexpectedly.");
        }
        return { lockPath, ...owned };
      }
      const existing = await readExistingMutex(lockPath, expectedUid);
      if (!existing) continue;
      if (!processIsAlive(existing.pid)) {
        if (!(await mutexPathStillMatches(lockPath, existing, expectedUid))) continue;
        throw rolloutStateError(
          "Used Authorization mutex owner is not alive and requires explicit review.",
        );
      }
      if (Date.now() >= deadline) {
        throw rolloutStateError("Used Authorization mutex is busy and requires explicit review.");
      }
      await new Promise((resolve) => setTimeout(resolve, USED_AUTHORIZATION_LOCK_RETRY_MS));
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      if (linked && owned) {
        await unlinkOwnedMutex(lockPath, owned).catch(() => {});
        await syncDirectory(lockDirectory).catch(() => {});
      }
      if (error instanceof ProductionRolloutError) throw error;
      throw rolloutStateError("Used Authorization mutex could not be acquired safely.");
    }
  }
}

async function unlinkOwnedMutex(lockPath, owner) {
  const metadata = await lstat(lockPath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.dev !== owner.dev ||
    metadata.ino !== owner.ino
  ) {
    throw rolloutStateError("Used Authorization mutex ownership changed unexpectedly.");
  }
  await unlink(lockPath);
}

async function releaseUsedAuthorizationMutex(mutex) {
  try {
    await unlinkOwnedMutex(mutex.lockPath, mutex);
    await syncDirectory(path.dirname(mutex.lockPath));
  } catch (error) {
    if (error instanceof ProductionRolloutError) throw error;
    throw rolloutStateError("Used Authorization mutex could not be released safely.");
  }
}

async function openUsedAuthorizationJournal(filename, expectedUid) {
  let handle;
  try {
    handle = await open(
      filename,
      fsConstants.O_CREAT |
        fsConstants.O_RDWR |
        fsConstants.O_APPEND |
        noFollowFlag(),
      USED_AUTHORIZATION_JOURNAL_MODE,
    );
    const metadata = assertProtectedMetadata(await handle.stat(), {
      expectedUid,
      mode: USED_AUTHORIZATION_JOURNAL_MODE,
      label: "Used Authorization journal",
    });
    const pathnameMetadata = await lstat(filename);
    if (
      pathnameMetadata.isSymbolicLink() ||
      pathnameMetadata.dev !== metadata.dev ||
      pathnameMetadata.ino !== metadata.ino
    ) {
      throw rolloutStateError("Used Authorization journal path changed unexpectedly.");
    }
    return { handle, size: metadata.size, metadata };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof ProductionRolloutError) throw error;
    throw rolloutStateError("Used Authorization journal could not be opened safely.");
  }
}

async function assertOpenJournalIdentity(filename, handle, expectedUid) {
  const metadata = assertProtectedMetadata(await handle.stat(), {
    expectedUid,
    mode: USED_AUTHORIZATION_JOURNAL_MODE,
    label: "Used Authorization journal",
  });
  const pathnameMetadata = await lstat(filename);
  if (
    pathnameMetadata.isSymbolicLink() ||
    pathnameMetadata.dev !== metadata.dev ||
    pathnameMetadata.ino !== metadata.ino
  ) {
    throw rolloutStateError("Used Authorization journal path changed unexpectedly.");
  }
  return metadata;
}

function assertJournalEntry(entry, { previousDigest, releaseSessionId, seenIds }) {
  try {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join("\0") !== USED_AUTHORIZATION_ENTRY_KEYS.join("\0") ||
      entry.schemaVersion !== 1 ||
      entry.recordType !== "production-authorization-consumption" ||
      !/^pa-[0-9a-f]{32}$/.test(entry.authorizationId ?? "") ||
      entry.releaseSessionId !== releaseSessionId ||
      !Number.isInteger(entry.phase) ||
      entry.phase < 0 ||
      entry.phase > 6 ||
      !AUTHORIZATION_ACTIONS.includes(entry.action) ||
      entry.previousDigest !== previousDigest ||
      seenIds.has(entry.authorizationId)
    ) {
      throw new Error("invalid journal entry");
    }
    assertDigest(entry.authorizationDigest, "authorizationDigest");
    assertDigest(entry.claimDigest, "claimDigest");
    assertDigest(entry.digest, "digest");
    assertIsoTimestamp(entry.consumedAt, "consumedAt");
    assertSanitized(entry);
    const expectedDigest = digestObject(
      Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "digest")),
    );
    if (entry.digest !== expectedDigest) throw new Error("invalid journal digest");
    seenIds.add(entry.authorizationId);
  } catch {
    throw rolloutStateError("Used Authorization journal is invalid.");
  }
}

async function readDigestChain(handle, { releaseSessionId }) {
  let contents;
  try {
    contents = await handle.readFile("utf8");
  } catch {
    throw rolloutStateError("Used Authorization journal could not be read safely.");
  }
  if (contents !== "" && !contents.endsWith("\n")) {
    throw rolloutStateError("Used Authorization journal contains a partial record.");
  }
  const lines = contents === "" ? [] : contents.slice(0, -1).split("\n");
  if (lines.some((line) => line.trim() === "")) {
    throw rolloutStateError("Used Authorization journal contains an empty record.");
  }
  const entries = [];
  const seenIds = new Set();
  let previousDigest = null;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw rolloutStateError("Used Authorization journal contains invalid JSON.");
    }
    assertJournalEntry(entry, { previousDigest, releaseSessionId, seenIds });
    entries.push(entry);
    previousDigest = entry.digest;
  }
  return entries;
}

function assertAuthorizationConsumptionBinding({ authorization, phase, action }) {
  try {
    assertReleaseSessionId(authorization.releaseSessionId);
    assertDigest(authorization.digest, "authorization.digest");
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization consumption binding is invalid.",
    );
  }
  if (!AUTHORIZATION_ACTIONS.includes(action) || authorization.action !== action) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_ACTION_INVALID",
      "Production Authorization is bound to a different action.",
    );
  }
  if (
    !Array.isArray(authorization.authorizedPhases) ||
    authorization.authorizedPhases.length !== 1 ||
    authorization.authorizedPhases[0] !== Number(phase)
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_PHASE_NOT_AUTHORIZED",
      "Production Authorization is bound to a different Phase.",
    );
  }
  const expectedDigest = digestObject(
    Object.fromEntries(Object.entries(authorization).filter(([key]) => key !== "digest")),
  );
  if (authorization.digest !== expectedDigest) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization digest is invalid at consumption.",
    );
  }
}

export async function consumeAuthorization({
  stateDir,
  authorization,
  phase,
  action,
  environment,
  publicKey,
  markerPath,
}) {
  assertProductionAuthorizationIdentity(authorization, {
    environment,
    phase,
    action,
    publicKey,
  });
  assertAuthorizationConsumptionBinding({ authorization, phase, action });
  const { resolved, expectedUid } = await prepareUsedAuthorizationDirectory({
    stateDir,
    authorization,
    environment,
  });
  const existingClaim = await readAuthorizationClaim({
    stateDir: resolved,
    authorization,
    phase,
    action,
    expectedUid,
  });
  if (existingClaim) {
    await recordAuthorizationClaim({
      stateDir: resolved,
      authorization,
      phase,
      action,
      claim: existingClaim,
      expectedUid,
    });
    throw alreadyConsumedError();
  }
  assertProductionAuthorizationFresh(authorization);
  await assertAuthorizationMarker({
    environment,
    authorization,
    phase,
    action,
    markerPath,
  });
  const publication = await atomicClaimAuthorization({
    stateDir: resolved,
    authorization,
    phase,
    action,
    expectedUid,
  });
  const entry = await recordAuthorizationClaim({
    stateDir: resolved,
    authorization,
    phase,
    action,
    claim: publication.claim,
    expectedUid,
  });
  if (!publication.owned) throw alreadyConsumedError();
  return entry;
}

async function recordAuthorizationClaim({
  stateDir,
  authorization,
  phase,
  action,
  claim,
  expectedUid,
}) {
  const filename = usedAuthorizationsPath(stateDir);
  const mutex = await acquireUsedAuthorizationMutex(filename, expectedUid);
  let journal;
  try {
    journal = await openUsedAuthorizationJournal(filename, expectedUid);
    const entries = await readDigestChain(journal.handle, {
      releaseSessionId: authorization.releaseSessionId,
    });
    const existing = entries.find(
      (entry) => entry.authorizationId === authorization.authorizationId,
    );
    if (existing) {
      if (
        existing.authorizationDigest !== authorization.digest ||
        existing.phase !== Number(phase) ||
        existing.action !== action ||
        existing.claimDigest !== claim.digest
      ) {
        throw rolloutStateError("Used Authorization identity is inconsistent.");
      }
      return existing;
    }
    const entry = withDigest({
      schemaVersion: 1,
      recordType: "production-authorization-consumption",
      authorizationId: authorization.authorizationId,
      authorizationDigest: authorization.digest,
      claimDigest: claim.digest,
      releaseSessionId: authorization.releaseSessionId,
      phase: Number(phase),
      action,
      consumedAt: new Date().toISOString(),
      previousDigest: entries.at(-1)?.digest ?? null,
    });
    assertJournalEntry(entry, {
      previousDigest: entries.at(-1)?.digest ?? null,
      releaseSessionId: authorization.releaseSessionId,
      seenIds: new Set(entries.map((value) => value.authorizationId)),
    });
    const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    const result = await journal.handle.write(line, 0, line.length, null);
    if (result.bytesWritten !== line.length) {
      throw rolloutStateError("Used Authorization journal append was incomplete.");
    }
    await journal.handle.sync();
    const after = await assertOpenJournalIdentity(
      filename,
      journal.handle,
      expectedUid,
    );
    if (after.size !== journal.size + line.length) {
      throw rolloutStateError("Used Authorization journal append size is invalid.");
    }
    await syncDirectory(stateDir);
    return entry;
  } finally {
    await journal?.handle.close().catch(() => {});
    await releaseUsedAuthorizationMutex(mutex);
  }
}
