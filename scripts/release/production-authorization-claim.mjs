#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PRODUCTION_ROOT = "/srv/projectai";
const PRODUCTION_HELPER_PATH =
  "/srv/projectai/scripts/release/production-authorization-claim.mjs";
const PRODUCTION_BUNDLE_PATH =
  "/srv/projectai/release/production-authorization-claim-bundle.json";
const PRODUCTION_TRUST_PATH =
  "/srv/projectai/release/production-rollout-trust.json";
const PRODUCTION_KEY_PATH =
  "/srv/projectai/authorization/production-rollout-public-key.pem";
const PRODUCTION_MARKER_PATH =
  "/srv/projectai/authorization/rollout-enabled.json";
const PRODUCTION_BUNDLE_DIGEST =
  "sha256:d7a9bde693a4b7357784e72d006afa443bb3d14582db2c9364fef2cd9d2e2018";
const MAX_AUTHORIZATION_BYTES = 256 * 1024;
const MAX_PINNED_FILE_BYTES = 2 * 1024 * 1024;

function controlledError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bootstrapArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const equals = argument.indexOf("=");
    const key = equals >= 0 ? argument.slice(2, equals) : argument.slice(2);
    if (Object.hasOwn(options, key)) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_INVALID",
        `Duplicate --${key} option is not allowed.`,
      );
    }
    if (equals >= 0) {
      options[key] = argument.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

async function assertRootOwnedParents(filename) {
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
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency parent is missing.",
      );
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.uid !== 0 ||
      ((metadata.mode & 0o777) & 0o022) !== 0
    ) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency parent is unsafe.",
      );
    }
  }
}

async function readPinnedFile(filename, { modes, expectedDigest } = {}) {
  const resolved = path.resolve(filename);
  await assertRootOwnedParents(resolved);
  if (typeof fsConstants.O_NOFOLLOW !== "number") {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "O_NOFOLLOW is required for the pinned claim bundle.",
    );
  }
  let handle;
  try {
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.uid !== 0 ||
      !modes.includes(metadata.mode & 0o777) ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > MAX_PINNED_FILE_BYTES
    ) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency metadata is invalid.",
      );
    }
    const [pathnameMetadata, canonicalPath] = await Promise.all([
      lstat(resolved),
      realpath(resolved),
    ]);
    if (
      pathnameMetadata.isSymbolicLink() ||
      pathnameMetadata.dev !== metadata.dev ||
      pathnameMetadata.ino !== metadata.ino ||
      canonicalPath !== resolved
    ) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency path is invalid.",
      );
    }
    const contents = await handle.readFile();
    const after = await handle.stat();
    const afterPath = await lstat(resolved);
    if (
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      afterPath.dev !== metadata.dev ||
      afterPath.ino !== metadata.ino
    ) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency changed while it was read.",
      );
    }
    if (expectedDigest && sha256(contents) !== expectedDigest) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Pinned claim dependency Digest does not match.",
      );
    }
    return contents;
  } catch (error) {
    if (error?.code === "PRODUCTION_AUTHORIZATION_TRUST_INVALID") throw error;
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Pinned claim dependency could not be read safely.",
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parsePinnedJson(contents, label) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      `${label} is invalid JSON.`,
    );
  }
}

function assertExactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      `${label} shape is invalid.`,
    );
  }
}

async function verifyProductionBundle() {
  if (process.getuid?.() !== 0 || process.cwd() !== PRODUCTION_ROOT) {
    throw controlledError(
      "PRODUCTION_WORKING_DIRECTORY_INVALID",
      "Production Authorization claim must run as root from /srv/projectai.",
    );
  }
  const executablePath = path.resolve(process.argv[1]);
  if (executablePath !== PRODUCTION_HELPER_PATH) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Production Authorization claim helper path is not fixed.",
    );
  }
  const helperContents = await readPinnedFile(executablePath, {
    modes: [0o500, 0o555],
  });
  const bundleContents = await readPinnedFile(PRODUCTION_BUNDLE_PATH, {
    modes: [0o400, 0o444],
    expectedDigest: PRODUCTION_BUNDLE_DIGEST,
  });
  const bundle = parsePinnedJson(bundleContents, "Production claim bundle");
  assertExactKeys(bundle, [
    "bundleType",
    "claimHelperPath",
    "dependencies",
    "publicKeySha256",
    "schemaVersion",
    "trustContractPath",
  ], "Production claim bundle");
  if (
    bundle.schemaVersion !== 1 ||
    bundle.bundleType !== "production-authorization-claim-dependencies" ||
    bundle.claimHelperPath !== PRODUCTION_HELPER_PATH ||
    bundle.trustContractPath !== PRODUCTION_TRUST_PATH ||
    !/^sha256:[0-9a-f]{64}$/.test(bundle.publicKeySha256 ?? "") ||
    !Array.isArray(bundle.dependencies) ||
    bundle.dependencies.length !== 3
  ) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Production claim bundle contract is invalid.",
    );
  }
  const requiredDependencies = [
    "/srv/projectai/scripts/release/contract.mjs",
    "/srv/projectai/scripts/release/production-rollout-contract.mjs",
    "/srv/projectai/scripts/release/production-rollout-trust.mjs",
  ];
  const seen = new Set();
  for (const dependency of bundle.dependencies) {
    assertExactKeys(dependency, ["path", "sha256"], "Production claim dependency");
    if (
      !requiredDependencies.includes(dependency.path) ||
      seen.has(dependency.path) ||
      !/^sha256:[0-9a-f]{64}$/.test(dependency.sha256 ?? "")
    ) {
      throw controlledError(
        "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
        "Production claim dependency contract is invalid.",
      );
    }
    seen.add(dependency.path);
    await readPinnedFile(dependency.path, {
      modes: [0o400, 0o444],
      expectedDigest: dependency.sha256,
    });
  }
  if (seen.size !== requiredDependencies.length) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Production claim dependency set is incomplete.",
    );
  }
  const trustContents = await readPinnedFile(PRODUCTION_TRUST_PATH, {
    modes: [0o400, 0o444],
  });
  const trust = parsePinnedJson(trustContents, "Production Trust Contract");
  assertExactKeys(trust, [
    "algorithm",
    "fingerprintEncoding",
    "productionClaimBundlePath",
    "productionClaimBundleSha256",
    "productionClaimHelperPath",
    "productionClaimHelperSha256",
    "productionKeyPath",
    "productionMarkerPath",
    "publicKeySha256",
    "schemaVersion",
  ], "Production Trust Contract");
  if (
    trust.schemaVersion !== 1 ||
    trust.algorithm !== "ed25519" ||
    trust.fingerprintEncoding !== "spki-der-sha256" ||
    trust.publicKeySha256 !== bundle.publicKeySha256 ||
    trust.productionKeyPath !== PRODUCTION_KEY_PATH ||
    trust.productionMarkerPath !== PRODUCTION_MARKER_PATH ||
    trust.productionClaimHelperPath !== PRODUCTION_HELPER_PATH ||
    trust.productionClaimHelperSha256 !== sha256(helperContents) ||
    trust.productionClaimBundlePath !== PRODUCTION_BUNDLE_PATH ||
    trust.productionClaimBundleSha256 !== PRODUCTION_BUNDLE_DIGEST
  ) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Production Trust Contract does not match the pinned claim bundle.",
    );
  }
}

async function readStdinJson(ProductionRolloutError) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_AUTHORIZATION_BYTES) {
      throw new ProductionRolloutError(
        "PRODUCTION_AUTHORIZATION_INVALID",
        "Production Authorization input is too large.",
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Production Authorization input is invalid JSON.",
    );
  }
}

async function waitForTestBarrier(options, environment, ProductionRolloutError) {
  const raw = options["test-not-before-ms"];
  if (raw === undefined) return;
  if (environment !== "rehearsal" || process.env.NODE_ENV !== "test") {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Authorization claim test barrier is restricted to isolated tests.",
    );
  }
  const notBefore = Number(raw);
  const delay = notBefore - Date.now();
  if (!Number.isSafeInteger(notBefore) || delay < 0 || delay > 5_000) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Authorization claim test barrier is invalid.",
    );
  }
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

let exitCodeForRolloutError = () => 1;

try {
  const rawOptions = bootstrapArguments(process.argv.slice(2));
  const bootstrapEnvironment = rawOptions.environment;
  const fixedProductionInvocation =
    path.resolve(process.argv[1]) === PRODUCTION_HELPER_PATH ||
    process.cwd() === PRODUCTION_ROOT;
  if (!["production", "rehearsal"].includes(bootstrapEnvironment)) {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Authorization claim environment is invalid.",
    );
  }
  if (fixedProductionInvocation && bootstrapEnvironment !== "production") {
    throw controlledError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "The fixed Production claim helper cannot run in rehearsal mode.",
    );
  }
  if (bootstrapEnvironment === "production") await verifyProductionBundle();

  const [rolloutContract, commonContract, trustContract] = await Promise.all([
    import("./production-rollout-contract.mjs"),
    import("./contract.mjs"),
    import("./production-rollout-trust.mjs"),
  ]);
  const {
    assertProductionAuthorization,
    exitCodeForRolloutError: exitCode,
    ProductionRolloutError,
  } = rolloutContract;
  exitCodeForRolloutError = exitCode;
  const { assertSanitized, parseArguments, readJson, requiredOption } = commonContract;
  const {
    assertAuthorizationMarker,
    consumeAuthorization,
    loadAuthorizationTrust,
  } = trustContract;
  const { options } = parseArguments(process.argv.slice(2));
  const environment = requiredOption(options, "environment");
  if (environment !== bootstrapEnvironment || !["production", "rehearsal"].includes(environment)) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Authorization claim environment is invalid.",
    );
  }
  const phase = Number(requiredOption(options, "phase"));
  const action = requiredOption(options, "action");
  const authorization = environment === "production"
    ? await readStdinJson(ProductionRolloutError)
    : await readJson(requiredOption(options, "authorization"));
  const trust = await loadAuthorizationTrust({
    environment,
    rehearsalPublicKeyPath:
      environment === "rehearsal"
        ? requiredOption(options, "authorization-public-key")
        : undefined,
    rehearsalTrustPath:
      environment === "rehearsal"
        ? requiredOption(options, "authorization-trust")
        : undefined,
  });
  assertProductionAuthorization(authorization, {
    environment,
    phase,
    action,
    publicKey: trust.publicKey,
  });
  const markerPath = environment === "rehearsal"
    ? requiredOption(options, "authorization-marker")
    : undefined;
  await assertAuthorizationMarker({
    environment,
    authorization,
    phase,
    action,
    markerPath,
  });
  await waitForTestBarrier(options, environment, ProductionRolloutError);
  const stateDir = environment === "production"
    ? `/srv/projectai/releases/${authorization.releaseSessionId}`
    : path.resolve(requiredOption(options, "state-dir"));
  const claimed = await consumeAuthorization({
    stateDir,
    authorization,
    phase,
    action,
    environment,
    publicKey: trust.publicKey,
    markerPath,
  });
  const receipt = {
    status: "claimed",
    authorizationId: authorization.authorizationId,
    action,
    phase,
    entryDigest: claimed.digest,
  };
  assertSanitized(receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch (error) {
  process.stderr.write(
    `${error?.code ?? "PRODUCTION_AUTHORIZATION_CLAIM_ERROR"}: ${error?.message ?? String(error)}\n`,
  );
  process.exitCode = error?.code === "PRODUCTION_AUTHORIZATION_REPLAYED"
    ? 79
    : exitCodeForRolloutError(error);
}
