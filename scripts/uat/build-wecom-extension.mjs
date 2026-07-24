#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function parseEnvironment(source) {
  const values = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Private WeCom config is invalid.");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

const root = process.cwd();
const privateEnvironment = parseEnvironment(await readFile(path.join(root, ".local", "wecom-uat.env"), "utf8"));
const selectorPath = path.join(root, ".local", "wecom-selector.local.json");
let hasSelector = true;
try {
  await access(selectorPath);
} catch {
  hasSelector = false;
}
const env = {
  ...process.env,
  PROJECTAI_ALLOWED_ORIGIN: privateEnvironment.PROJECTAI_ALLOWED_ORIGIN,
  WECOM_ALLOWED_ORIGIN: privateEnvironment.WECOM_ALLOWED_ORIGIN,
  WECOM_EXTENSION_BUILD_MODE: "uat",
  WECOM_EXTENSION_OUTPUT_DIR: "dist/wecom-timesheet-extension-uat",
};
if (hasSelector) {
  env.WECOM_TASK_BOARD_URL = privateEnvironment.WECOM_TASK_BOARD_URL;
  env.WECOM_SELECTOR_CONFIG_PATH = ".local/wecom-selector.local.json";
}
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/build-wecom-timesheet-extension.mjs"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`UAT extension build failed (${code ?? "unknown"}).`)));
});
process.stdout.write(
  hasSelector
    ? "Local UAT extension built with a private validated selector config; the board URL was not printed.\n"
    : "Diagnostics-only Local UAT extension built. Actual sync remains disabled until a private validated selector config exists.\n",
);
