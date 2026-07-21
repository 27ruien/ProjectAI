#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  assertImageContract,
  assertProductionAuthorization,
  exitCodeForRolloutError,
  rolloutReportContract,
  writeRolloutReport,
  ProductionRolloutError,
} from "./production-rollout-contract.mjs";
import {
  assertDigest,
  assertFullSha,
  assertReleaseSession,
  parseArguments,
  readJson,
  requiredOption,
} from "./contract.mjs";
import {
  executeAuthorizedImageTransfer,
} from "./production-image-transfer-sequence.mjs";
import {
  assertAuthorizationMarkerValue,
  PRODUCTION_AUTHORIZATION_CLAIM_BUNDLE_PATH,
  PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH,
  PRODUCTION_AUTHORIZATION_KEY_PATH,
  PRODUCTION_ROLLOUT_MARKER_PATH,
  PRODUCTION_TRUST_CONTRACT_PATH,
  publicKeyFingerprint,
} from "./production-rollout-trust.mjs";

const command = process.argv[2];
const { options } = parseArguments(process.argv.slice(3));

function run(program, args, spawnOptions = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...spawnOptions,
  });
  if (result.status !== 0) {
    throw new Error(`${program} failed without a valid result.`);
  }
  return String(result.stdout ?? "").trim();
}

function runWithStatus(program, args, spawnOptions = {}) {
  return spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...spawnOptions,
  });
}

function imageMetadata(reference) {
  const raw = run("docker", [
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    reference,
  ]);
  const value = JSON.parse(raw);
  return {
    id: value.Id,
    os: value.Os,
    architecture: value.Architecture,
    revision: value.Config?.Labels?.["org.opencontainers.image.revision"] ?? null,
    environment: value.Config?.Labels?.["com.projectai.release.environment"] ?? null,
    sizeBytes: value.Size,
  };
}

async function fileDigest(filename) {
  const buffer = await readFile(filename);
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

async function planCommand() {
  const session = await readJson(requiredOption(options, "session"));
  assertReleaseSession(session);
  const report = await writeRolloutReport({
    outputDir: options["output-dir"] ?? "release-artifacts/production-image-plan",
    stem: "production-image-transfer-plan",
    payload: rolloutReportContract({
      reportType: "production-image-transfer-plan",
      sourceMode: "live-readonly",
      session,
      phase: 0,
      phaseState: "not_started",
      result: "dry-run",
      extra: {
        platform: "linux/amd64",
        buildFromExactSha: true,
        appTarget: "runner",
        databaseToolsTarget: "db-tools",
        transfer: "checksummed-archive",
        serverBuild: false,
        floatingTag: false,
        remoteDigestReinspection: true,
        productionWritePerformed: false,
      },
    }),
    title: "Production image build and transfer plan",
  });
  process.stdout.write(`${report.digest}\n`);
}

async function buildCommand() {
  const expectedSha = requiredOption(options, "expected-sha");
  const buildTime = requiredOption(options, "build-time");
  const outputDir = path.resolve(requiredOption(options, "output-dir"));
  assertFullSha(expectedSha, "expected-sha");
  if (run("git", ["status", "--porcelain"]) !== "") {
    throw new Error("Image build requires a clean working tree.");
  }
  run("git", ["cat-file", "-e", `${expectedSha}^{commit}`]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "projectai-production-image-"));
  const worktree = path.join(temporary, "worktree");
  const appTag = `projectai-production-candidate:${expectedSha}`;
  const toolsTag = `projectai-production-db-tools:${expectedSha}`;
  try {
    run("git", ["worktree", "add", "--detach", worktree, expectedSha]);
    run("docker", [
      "build",
      "--platform",
      "linux/amd64",
      "--target",
      "runner",
      "--build-arg",
      "NEXT_PUBLIC_BASE_PATH=/tool/projectai",
      "--build-arg",
      "NEXT_PUBLIC_APP_ENV=production",
      "--build-arg",
      `NEXT_PUBLIC_COMMIT_SHA=${expectedSha}`,
      "--build-arg",
      `NEXT_PUBLIC_BUILD_TIME=${buildTime}`,
      "--tag",
      appTag,
      worktree,
    ]);
    run("docker", [
      "build",
      "--platform",
      "linux/amd64",
      "--target",
      "db-tools",
      "--build-arg",
      "NEXT_PUBLIC_APP_ENV=production",
      "--build-arg",
      `NEXT_PUBLIC_COMMIT_SHA=${expectedSha}`,
      "--tag",
      toolsTag,
      worktree,
    ]);
    const app = imageMetadata(appTag);
    const databaseTools = imageMetadata(toolsTag);
    assertImageContract(app, { digest: app.id, sha: expectedSha });
    assertImageContract(databaseTools, {
      digest: databaseTools.id,
      sha: expectedSha,
    });
    await import("node:fs/promises").then(({ mkdir }) => mkdir(outputDir, { recursive: true }));
    const appArchive = path.join(outputDir, "projectai-app.tar");
    const toolsArchive = path.join(outputDir, "projectai-db-tools.tar");
    run("docker", ["save", "--output", appArchive, appTag]);
    run("docker", ["save", "--output", toolsArchive, toolsTag]);
    const report = {
      expectedSha,
      app,
      databaseTools,
      appArchive: {
        filename: path.basename(appArchive),
        sizeBytes: (await stat(appArchive)).size,
        digest: await fileDigest(appArchive),
      },
      databaseToolsArchive: {
        filename: path.basename(toolsArchive),
        sizeBytes: (await stat(toolsArchive)).size,
        digest: await fileDigest(toolsArchive),
      },
    };
    await writeFile(
      path.join(outputDir, "production-image-build.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${app.id}\n`);
  } finally {
    run("git", ["worktree", "remove", "--force", worktree]);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyCommand() {
  const metadata = await readJson(requiredOption(options, "metadata"));
  const expectedSha = requiredOption(options, "expected-sha");
  const expectedImage = requiredOption(options, "expected-image");
  assertFullSha(expectedSha, "expected-sha");
  assertDigest(expectedImage, "expected-image");
  assertImageContract(metadata, { digest: expectedImage, sha: expectedSha });
  process.stdout.write(`${expectedImage}\n`);
}

async function transferCommand() {
  if (options.apply !== true && options.apply !== "true") {
    return planCommand();
  }
  if (typeof options.authorization !== "string") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Production image transfer requires signed Authorization.",
    );
  }
  if (process.env.PROJECTAI_PRODUCTION_IMAGE_TRANSFER_ENABLED !== "1") {
    throw new ProductionRolloutError(
      "PRODUCTION_APPLY_NOT_AUTHORIZED",
      "Production image transfer kill switch is disabled.",
    );
  }
  const remoteHost = "gridworks.cn";
  if (options["remote-host"] !== undefined && options["remote-host"] !== remoteHost) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Production image transfer host is fixed.",
    );
  }
  const authorization = await readJson(options.authorization);
  const appArchive = path.resolve(requiredOption(options, "app-archive"));
  const toolsArchive = path.resolve(requiredOption(options, "db-tools-archive"));
  const appArchiveName = path.basename(appArchive);
  const toolsArchiveName = path.basename(toolsArchive);
  for (const archiveName of [appArchiveName, toolsArchiveName]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(archiveName)) {
      throw new ProductionRolloutError(
        "PRODUCTION_IMAGE_CONTRACT_INVALID",
        "Image archive filename is unsafe for remote transfer.",
      );
    }
  }
  const appDigest = requiredOption(options, "app-digest");
  const toolsDigest = requiredOption(options, "db-tools-digest");
  const appArchiveDigest = requiredOption(options, "app-archive-digest");
  const toolsArchiveDigest = requiredOption(options, "db-tools-archive-digest");
  assertDigest(appDigest, "app-digest");
  assertDigest(toolsDigest, "db-tools-digest");
  assertDigest(appArchiveDigest, "app-archive-digest");
  assertDigest(toolsArchiveDigest, "db-tools-archive-digest");
  if (
    authorization.releaseImageDigest !== appDigest ||
    authorization.databaseToolsImageDigest !== toolsDigest
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_INVALID",
      "Image archives do not match the signed Authorization.",
    );
  }
  if (
    (await fileDigest(appArchive)) !== appArchiveDigest ||
    (await fileDigest(toolsArchive)) !== toolsArchiveDigest
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_IMAGE_CONTRACT_INVALID",
      "Local image archive checksum does not match the transfer contract.",
    );
  }
  const trustContract = await readJson(PRODUCTION_TRUST_CONTRACT_PATH);
  if (
    trustContract.schemaVersion !== 1 ||
    trustContract.algorithm !== "ed25519" ||
    trustContract.fingerprintEncoding !== "spki-der-sha256" ||
    trustContract.productionKeyPath !== PRODUCTION_AUTHORIZATION_KEY_PATH ||
    trustContract.productionMarkerPath !== PRODUCTION_ROLLOUT_MARKER_PATH ||
    trustContract.productionClaimHelperPath !== PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH ||
    trustContract.productionClaimBundlePath !== PRODUCTION_AUTHORIZATION_CLAIM_BUNDLE_PATH
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Reviewed Production Trust Contract is invalid.",
    );
  }
  assertDigest(trustContract.publicKeySha256, "publicKeySha256");
  assertDigest(
    trustContract.productionClaimHelperSha256,
    "productionClaimHelperSha256",
  );
  assertDigest(
    trustContract.productionClaimBundleSha256,
    "productionClaimBundleSha256",
  );
  const trustOutput = run("ssh", [
    "-o", "BatchMode=yes", remoteHost, "bash", "-s", "--",
    PRODUCTION_AUTHORIZATION_KEY_PATH,
    PRODUCTION_ROLLOUT_MARKER_PATH,
    PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH,
    PRODUCTION_AUTHORIZATION_CLAIM_BUNDLE_PATH,
  ], {
    input: [
      "set -Eeuo pipefail",
      "[[ $(id -u) == 0 ]]",
      "key=$1",
      "marker=$2",
      "helper=$3",
      "bundle=$4",
      "[[ -f $key && ! -L $key && $(stat -c %u \"$key\") == 0 ]]",
      "[[ $(stat -c %a \"$key\") =~ ^(400|444)$ ]]",
      "[[ -f $marker && ! -L $marker && $(stat -c %u \"$marker\") == 0 ]]",
      "[[ $(stat -c %a \"$marker\") =~ ^(400|600)$ ]]",
      "[[ -f $helper && ! -L $helper && $(stat -c %u \"$helper\") == 0 ]]",
      "[[ $(stat -c %a \"$helper\") =~ ^(500|555)$ ]]",
      "[[ -f $bundle && ! -L $bundle && $(stat -c %u \"$bundle\") == 0 ]]",
      "[[ $(stat -c %a \"$bundle\") =~ ^(400|444)$ ]]",
      "base64 -w0 \"$key\"",
      "printf '\\n'",
      "base64 -w0 \"$marker\"",
      "printf '\\n'",
      "sha256sum \"$helper\" | awk '{print \"sha256:\" $1}'",
      "sha256sum \"$bundle\" | awk '{print \"sha256:\" $1}'",
    ].join("\n"),
  }).split("\n");
  if (trustOutput.length < 4) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Remote Production Trust Anchor could not be read safely.",
    );
  }
  const publicKey = Buffer.from(trustOutput[0], "base64").toString("utf8");
  const marker = JSON.parse(Buffer.from(trustOutput[1], "base64").toString("utf8"));
  if (
    publicKeyFingerprint(publicKey) !== trustContract.publicKeySha256 ||
    trustOutput[2] !== trustContract.productionClaimHelperSha256 ||
    trustOutput[3] !== trustContract.productionClaimBundleSha256
  ) {
    throw new ProductionRolloutError(
      "PRODUCTION_AUTHORIZATION_TRUST_INVALID",
      "Remote Production Trust Anchor fingerprint is not pinned.",
    );
  }
  assertProductionAuthorization(authorization, {
    environment: "production",
    phase: 0,
    action: "image-transfer",
    publicKey,
  });
  assertAuthorizationMarkerValue({
    marker,
    authorization,
    phase: 0,
    action: "image-transfer",
  });
  const remoteRoot = `/srv/projectai/releases/${authorization.releaseSessionId}/images`;
  await executeAuthorizedImageTransfer({
    authorization,
    claimAuthorization: () => {
      const claimResult = runWithStatus("ssh", [
        "-o",
        "BatchMode=yes",
        remoteHost,
        `cd /srv/projectai && exec node ${PRODUCTION_AUTHORIZATION_CLAIM_HELPER_PATH} --environment=production --phase=0 --action=image-transfer`,
      ], {
        input: `${JSON.stringify(authorization)}\n`,
      });
      if (claimResult.status === 79) {
        throw new ProductionRolloutError(
          "PRODUCTION_AUTHORIZATION_REPLAYED",
          "already_consumed: Production Authorization has already been consumed.",
        );
      }
      if (claimResult.status !== 0) {
        throw new ProductionRolloutError(
          "PRODUCTION_ROLLOUT_STATE_UNKNOWN",
          "Production image transfer Authorization could not be claimed safely.",
        );
      }
      return claimResult.stdout;
    },
    createRemoteDirectory: () => run("ssh", [
      "-o",
      "BatchMode=yes",
      remoteHost,
      "install",
      "-d",
      "-m",
      "0700",
      remoteRoot,
    ]),
    transferArchives: () => run("scp", [
      "-p",
      "--",
      appArchive,
      toolsArchive,
      `${remoteHost}:${remoteRoot}/`,
    ]),
    loadAndVerifyImages: () => run("ssh", [
      "-o",
      "BatchMode=yes",
      remoteHost,
      "bash",
      "-s",
      "--",
      remoteRoot,
      appArchiveName,
      toolsArchiveName,
      appArchiveDigest,
      toolsArchiveDigest,
      appDigest,
      toolsDigest,
      authorization.releaseCandidateSha,
    ], {
      input: [
        "set -Eeuo pipefail",
        "root=$1",
        "app=$2",
        "tools=$3",
        "app_archive_digest=$4",
        "tools_archive_digest=$5",
        "app_digest=$6",
        "tools_digest=$7",
        "expected_sha=$8",
        "[[ $root == /srv/projectai/releases/rs-*/images ]]",
        "[[ $(sha256sum \"$root/$app\" | awk '{print \"sha256:\" $1}') == \"$app_archive_digest\" ]]",
        "[[ $(sha256sum \"$root/$tools\" | awk '{print \"sha256:\" $1}') == \"$tools_archive_digest\" ]]",
        "docker load --input \"$root/$app\" >/dev/null",
        "docker load --input \"$root/$tools\" >/dev/null",
        "inspect_image() {",
        "  local digest=$1",
        "  local metadata",
        "  metadata=$(docker image inspect --format '{{.Id}}|{{.Os}}|{{.Architecture}}|{{index .Config.Labels \"org.opencontainers.image.revision\"}}|{{index .Config.Labels \"com.projectai.release.environment\"}}' \"$digest\")",
        "  [[ $metadata == \"$digest|linux|amd64|$expected_sha|production\" ]]",
        "}",
        "inspect_image \"$app_digest\"",
        "inspect_image \"$tools_digest\"",
      ].join("\n"),
    }),
  });
  process.stdout.write(`${appDigest}\n`);
}

try {
  const commands = { plan: planCommand, build: buildCommand, verify: verifyCommand, transfer: transferCommand };
  const handler = commands[command];
  if (!handler) throw new Error("Unsupported Production image command.");
  await handler();
} catch (error) {
  process.stderr.write(`${error?.code ?? "PRODUCTION_IMAGE_ERROR"}: ${error?.message ?? String(error)}\n`);
  process.exitCode = exitCodeForRolloutError(error);
}
