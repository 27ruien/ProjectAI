#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  acquireDeploymentLock,
  createLockMetadata,
  readDeploymentLifecycleGuard,
  readDeploymentLock,
  releaseDeploymentLock,
} from "./production-rollout-contract.mjs";

const raceRoot = "/state/lock-race";
const lockPath = path.join(raceRoot, ".production-rollout-lock");
const mode = process.env.LOCK_REHEARSAL_MODE;
const contenderId = process.env.LOCK_CONTENDER_ID;
const timeoutMs = 15_000;
const session = {
  releaseSessionId: `rs-${"1".repeat(32)}`,
  releaseCandidateSha: "2".repeat(40),
};

function controlledFailure(message) {
  const error = new Error(message);
  error.code = "PRODUCTION_LOCK_REHEARSAL_FAILED";
  return error;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check, label) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(10);
  }
  throw controlledFailure(`Timed out waiting for ${label}.`);
}

async function regularOwnerOnlyFile(filePath) {
  try {
    const metadata = await lstat(filePath);
    return (
      !metadata.isSymbolicLink() &&
      metadata.isFile() &&
      metadata.uid === (process.getuid?.() ?? metadata.uid) &&
      (metadata.mode & 0o777) === 0o600
    );
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeExclusiveJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

async function readOutcome(id) {
  const filePath = path.join(raceRoot, `outcome-${id}.json`);
  if (!(await regularOwnerOnlyFile(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readBothOutcomes() {
  const outcomes = await Promise.all([readOutcome("A"), readOutcome("B")]);
  return outcomes.every(Boolean) ? outcomes : null;
}

async function bothControlFiles(prefix) {
  return (
    (await regularOwnerOnlyFile(path.join(raceRoot, `${prefix}-A.json`))) &&
    (await regularOwnerOnlyFile(path.join(raceRoot, `${prefix}-B.json`)))
  );
}

async function anyOutcome() {
  const outcomes = await Promise.all([readOutcome("A"), readOutcome("B")]);
  return outcomes.some(Boolean);
}

function assertOutcomes(outcomes) {
  if (
    !Array.isArray(outcomes) ||
    outcomes.length !== 2 ||
    new Set(outcomes.map((outcome) => outcome.contenderId)).size !== 2
  ) {
    throw controlledFailure("Container Lock outcomes are incomplete or duplicated.");
  }
  const acquired = outcomes.filter((outcome) => outcome.result === "acquired");
  const rejected = outcomes.filter(
    (outcome) =>
      outcome.result === "rejected" &&
      outcome.errorCode === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
  );
  if (acquired.length !== 1 || rejected.length !== 1) {
    throw controlledFailure("Container Lock race did not produce one winner and one exact rejection.");
  }
  if (!/^pl-[0-9a-f]{32}$/.test(acquired[0].lockId ?? "")) {
    throw controlledFailure("Container Lock winner did not report a valid Lock ID.");
  }
  return { acquired, rejected };
}

async function contend() {
  if (!["A", "B"].includes(contenderId)) {
    throw controlledFailure("LOCK_CONTENDER_ID must be A or B.");
  }
  await mkdir(raceRoot, { recursive: true, mode: 0o700 });
  await writeExclusiveJson(path.join(raceRoot, `ready-${contenderId}.json`), {
    contenderId,
    ready: true,
  });
  await waitFor(
    () => regularOwnerOnlyFile(path.join(raceRoot, "go.json")),
    "host-controlled go gate",
  );
  await writeExclusiveJson(path.join(raceRoot, `armed-${contenderId}.json`), {
    contenderId,
    armed: true,
  });
  await waitFor(
    () => regularOwnerOnlyFile(path.join(raceRoot, "attempt.json")),
    "host-controlled attempt gate",
  );

  let ownedLock = null;
  try {
    try {
      ownedLock = await acquireDeploymentLock({
        lockPath,
        metadata: createLockMetadata({
          session,
          phase: 0,
          authorizationId: `pa-${(contenderId === "A" ? "a" : "b").repeat(32)}`,
        }),
      });
    } catch (error) {
      if (error?.code !== "PRODUCTION_DEPLOYMENT_LOCK_HELD") throw error;
      await writeExclusiveJson(path.join(raceRoot, `outcome-${contenderId}.json`), {
        contenderId,
        result: "rejected",
        errorCode: error.code,
        lockId: null,
      });
      process.stdout.write(`${JSON.stringify({ contenderId, result: "rejected", errorCode: error.code })}\n`);
      return;
    }

    await writeExclusiveJson(path.join(raceRoot, `outcome-${contenderId}.json`), {
      contenderId,
      result: "acquired",
      errorCode: null,
      lockId: ownedLock.lockId,
    });
    await waitFor(async () => Boolean(await readBothOutcomes()), "both container outcomes");
    assertOutcomes(await readBothOutcomes());
    await releaseDeploymentLock({ lockPath, expectedLock: ownedLock });
    ownedLock = null;
    await writeExclusiveJson(path.join(raceRoot, `released-${contenderId}.json`), {
      contenderId,
      released: true,
    });
    process.stdout.write(`${JSON.stringify({ contenderId, result: "acquired-and-released" })}\n`);
  } finally {
    if (ownedLock) {
      await releaseDeploymentLock({ lockPath, expectedLock: ownedLock }).catch(() => {});
    }
  }
}

async function gate() {
  const phase = process.env.LOCK_GATE_PHASE;
  await mkdir(raceRoot, { recursive: true, mode: 0o700 });
  if (phase === "go") {
    await waitFor(() => bothControlFiles("ready"), "both ready contenders");
    if (
      await anyOutcome() ||
      await regularOwnerOnlyFile(path.join(raceRoot, "go.json")) ||
      await regularOwnerOnlyFile(path.join(raceRoot, "attempt.json"))
    ) {
      throw controlledFailure("The go gate observed an early or duplicate Lock attempt.");
    }
    await writeExclusiveJson(path.join(raceRoot, "go.json"), {
      phase: "go",
      readyContenders: 2,
    });
    process.stdout.write(`${JSON.stringify({ gate: "go", readyContenders: 2 })}\n`);
    return;
  }
  if (phase === "attempt") {
    await waitFor(() => bothControlFiles("armed"), "both armed contenders");
    if (
      !(await regularOwnerOnlyFile(path.join(raceRoot, "go.json"))) ||
      await anyOutcome() ||
      await regularOwnerOnlyFile(path.join(raceRoot, "attempt.json"))
    ) {
      throw controlledFailure("The attempt gate observed an invalid or early Lock outcome.");
    }
    await writeExclusiveJson(path.join(raceRoot, "attempt.json"), {
      phase: "attempt",
      armedContenders: 2,
      outcomesBeforeAttempt: 0,
    });
    process.stdout.write(`${JSON.stringify({ gate: "attempt", armedContenders: 2 })}\n`);
    return;
  }
  throw controlledFailure("LOCK_GATE_PHASE must be go or attempt.");
}

async function inspect() {
  const outcomes = await readBothOutcomes();
  const { acquired, rejected } = assertOutcomes(outcomes);
  const released = await Promise.all([
    regularOwnerOnlyFile(path.join(raceRoot, "released-A.json")),
    regularOwnerOnlyFile(path.join(raceRoot, "released-B.json")),
  ]);
  const activeLock = await readDeploymentLock(lockPath);
  const activeGuard = await readDeploymentLifecycleGuard(lockPath);
  const entries = await readdir(raceRoot);
  const temporaryFiles = entries.filter((entry) => entry.includes(".tmp-"));
  const interfaces = Object.keys(networkInterfaces());
  const isolatedNetwork = interfaces.length === 1 && interfaces[0] === "lo";
  const controlFilesValid =
    (await bothControlFiles("ready")) &&
    (await bothControlFiles("armed")) &&
    (await regularOwnerOnlyFile(path.join(raceRoot, "go.json"))) &&
    (await regularOwnerOnlyFile(path.join(raceRoot, "attempt.json")));
  if (
    released.filter(Boolean).length !== 1 ||
    activeLock !== null ||
    activeGuard !== null ||
    temporaryFiles.length !== 0 ||
    !controlFilesValid ||
    !isolatedNetwork
  ) {
    throw controlledFailure("Container Lock rehearsal failed its barrier, isolation, or orphan-state checks.");
  }
  process.stdout.write(`${JSON.stringify({
    containerLockAcquireSuccesses: acquired.length,
    containerLockAcquireRejections: rejected.length,
    rejectionCodeVerified: true,
    hostControlledBarrierVerified: true,
    activeLockAfter: false,
    activeGuardAfter: false,
    temporaryFilesAfter: 0,
    isolatedNamedVolume: true,
    productionConnected: !isolatedNetwork,
  })}\n`);
}

if (process.env.NODE_ENV !== "test") {
  throw controlledFailure("Container Lock rehearsal requires NODE_ENV=test.");
}
if (mode === "contend") await contend();
else if (mode === "gate") await gate();
else if (mode === "inspect") await inspect();
else throw controlledFailure("LOCK_REHEARSAL_MODE must be contend, gate, or inspect.");
