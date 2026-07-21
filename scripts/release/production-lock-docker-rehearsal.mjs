#!/usr/bin/env node

import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseLastJsonLine(stdout, label) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  try {
    return JSON.parse(lines.at(-1));
  } catch {
    throw new Error(`${label} did not emit one structured result.`);
  }
}

export async function runDockerLockRehearsal({
  project,
  composeFile,
  commandOptions,
}) {
  const composeRun = [
    "compose",
    "--project-name",
    project,
    "--file",
    composeFile,
    "run",
    "--rm",
    "--no-deps",
    "-T",
  ];
  const contenderTasks = ["A", "B"].map((contenderId) =>
    execFileAsync(
      "docker",
      [
        ...composeRun,
        "--env",
        "LOCK_REHEARSAL_MODE=contend",
        "--env",
        `LOCK_CONTENDER_ID=${contenderId}`,
        "lock-race-probe",
      ],
      commandOptions(),
    ).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    ),
  );
  try {
    for (const phase of ["go", "attempt"]) {
      await execFileAsync(
        "docker",
        [
          ...composeRun,
          "--env",
          "LOCK_REHEARSAL_MODE=gate",
          "--env",
          `LOCK_GATE_PHASE=${phase}`,
          "lock-race-probe",
        ],
        commandOptions(),
      );
    }
  } catch (error) {
    await Promise.all(contenderTasks);
    throw error;
  }
  const settledContenders = await Promise.all(contenderTasks);
  const failedContender = settledContenders.find((result) => result.status === "rejected");
  if (failedContender) throw failedContender.reason;
  const contenders = settledContenders.map((result) => result.value);
  const contenderResults = contenders.map((result, index) =>
    parseLastJsonLine(result.stdout, `Container ${index === 0 ? "A" : "B"}`),
  );
  if (
    contenderResults.filter((result) => result.result === "acquired-and-released").length !== 1 ||
    contenderResults.filter(
      (result) =>
        result.result === "rejected" &&
        result.errorCode === "PRODUCTION_DEPLOYMENT_LOCK_HELD",
    ).length !== 1
  ) {
    throw new Error("Container Lock contenders did not produce one winner and one exact rejection.");
  }
  const inspected = await execFileAsync(
    "docker",
    [
      ...composeRun,
      "--env",
      "LOCK_REHEARSAL_MODE=inspect",
      "lock-race-probe",
    ],
    commandOptions(),
  );
  const report = parseLastJsonLine(inspected.stdout, "Container Lock inspection");
  if (
    report.containerLockAcquireSuccesses !== 1 ||
    report.containerLockAcquireRejections !== 1 ||
    report.rejectionCodeVerified !== true ||
    report.hostControlledBarrierVerified !== true ||
    report.activeLockAfter !== false ||
    report.activeGuardAfter !== false ||
    report.temporaryFilesAfter !== 0 ||
    report.isolatedNamedVolume !== true ||
    report.productionConnected !== false
  ) {
    throw new Error("Container Lock inspection did not satisfy the isolation contract.");
  }
  return report;
}

export async function cleanupDockerLockRehearsal({
  project,
  composeFile,
  commandOptions,
}) {
  await execFileAsync(
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "--file",
      composeFile,
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    commandOptions(),
  );
  const resourceKinds = ["container", "volume", "network"];
  const remaining = await Promise.all(
    resourceKinds.map(async (kind) => {
      const result = await execFileAsync(
        "docker",
        [
          kind,
          "ls",
          ...(kind === "container" ? ["--all"] : []),
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ],
        commandOptions(),
      );
      return { kind, ids: result.stdout.trim().split("\n").filter(Boolean) };
    }),
  );
  const orphaned = remaining.filter(({ ids }) => ids.length > 0);
  if (orphaned.length > 0) {
    throw new Error(
      `Docker Lock rehearsal cleanup left Compose resources: ${orphaned
        .map(({ kind, ids }) => `${kind}=${ids.length}`)
        .join(", ")}.`,
    );
  }
  return {
    cleanupComplete: true,
    composeContainersAfter: 0,
    composeVolumesAfter: 0,
    composeNetworksAfter: 0,
  };
}

async function standalone() {
  const root = path.resolve(process.cwd());
  const project = `projectai-lock-rehearsal-${process.pid}`;
  const composeFile = path.join(root, "docker-compose.production-rehearsal.yml");
  const commandOptions = () => ({
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED: "0",
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  let report = null;
  let runError = null;
  try {
    report = await runDockerLockRehearsal({
      project,
      composeFile,
      commandOptions,
    });
  } catch (error) {
    runError = error;
  } finally {
    const cleanup = await cleanupDockerLockRehearsal({
      project,
      composeFile,
      commandOptions,
    });
    if (!runError) report = { ...report, ...cleanup };
  }
  if (runError) throw runError;
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Docker Lock rehearsal requires NODE_ENV=test.");
  }
  await standalone();
}
