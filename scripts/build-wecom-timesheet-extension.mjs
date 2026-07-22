import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const VERSION = "0.1.0";
const OUT_DIR = path.join(ROOT, "dist", "wecom-timesheet-extension");
const ZIP_PATH = path.join(ROOT, "release", `wecom-timesheet-extension-v${VERSION}.zip`);
const SOURCE = path.join(ROOT, "extensions", "wecom-timesheet");
const packageMode = process.argv.includes("--package");
const mockMode = process.env.WECOM_EXTENSION_BUILD_MODE === "mock";

function exactOrigin(name, fallback = "") {
  const raw = process.env[name]?.trim() || fallback;
  if (!raw) return "";
  const url = new URL(raw);
  const localMock =
    mockMode &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !localMock) ||
    raw.replace(/\/$/, "") !== url.origin
  ) {
    throw new Error(`${name} must be one exact HTTPS origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

function boardUrl() {
  const raw = process.env.WECOM_TASK_BOARD_URL?.trim() || "";
  if (!raw) return "";
  const url = new URL(raw);
  const localMock =
    mockMode &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== "https:" && !localMock)) {
    throw new Error("WECOM_TASK_BOARD_URL must be HTTPS and contain no credentials.");
  }
  return url.toString();
}

const selectorKeys = [
  "boardReady", "loggedOutIndicator", "overlay", "formIframe", "createTaskButton", "taskForm",
  "descriptionInput", "projectControl", "projectOptions", "projectSelectedValue", "submitterValue",
  "regularHoursInput", "overtimeHoursInput", "statusControl", "statusOptions", "statusSelectedValue",
  "urgencyControl", "urgencyOptions", "urgencySelectedValue", "progressInput", "itemSaveButton",
  "saveSuccess", "saveFailure", "recordRows", "recordDescription", "recordProject", "recordSubmitter",
  "recordRegularHours", "recordOvertimeHours", "recordStatus", "recordUrgency", "recordProgress",
];
const unsafeSelector = /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html|<\s*script\b|\bon[a-z]+\s*=|\[\s*on[a-z]+(?:\s|\]|[~|^$*]?=)|\beval\s*\(|\bfunction\s*\(|=>|\b(?:window|document|globalThis)\s*\.|[`;{}]|[\u0000-\u001f\u007f]/iu;
const broadActionSelector = /^(?:\*|html|body|:root|form|button|input|textarea|select)$/i;
const actionSelectorKeys = new Set(["createTaskButton", "taskForm", "descriptionInput", "projectControl", "regularHoursInput", "overtimeHoursInput", "statusControl", "urgencyControl", "progressInput", "itemSaveButton"]);

function validateBuildSelectors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Selector Config must be an object.");
  const keys = Object.keys(value);
  if (keys.some((key) => /final|submit.?all|daily.?submit/i.test(key))) throw new Error("Final-submit selectors are forbidden.");
  if (value.persistenceMode !== "explicit-save" && value.persistenceMode !== "auto-save") throw new Error("Selector Config persistence mode is invalid.");
  if (keys.length !== selectorKeys.length + 1 || selectorKeys.some((key) => !keys.includes(key))) throw new Error("Selector Config keys do not match the strict schema.");
  for (const key of selectorKeys) {
    const selector = value[key];
    if (
      typeof selector !== "string" ||
      !selector ||
      selector.length > 500 ||
      selector !== selector.trim() ||
      unsafeSelector.test(selector) ||
      (actionSelectorKeys.has(key) && (selector.includes(",") || broadActionSelector.test(selector)))
    ) {
      throw new Error(`Selector Config field ${key} is unsafe or invalid.`);
    }
  }
  return value;
}

const projectAiOrigin = exactOrigin("PROJECTAI_ALLOWED_ORIGIN", "https://gridworks.cn");
const projectAiMatches = mockMode
  ? [`${projectAiOrigin}/*`]
  : [
      `${projectAiOrigin}/tool/projectai/*`,
      `${projectAiOrigin}/tool/projectai-staging/*`,
    ];
const projectAiOrigins = [projectAiOrigin];
const configuredBoardUrl = boardUrl();
const wecomOrigin = exactOrigin("WECOM_ALLOWED_ORIGIN");
if (Boolean(configuredBoardUrl) !== Boolean(wecomOrigin)) {
  throw new Error("WECOM_TASK_BOARD_URL and WECOM_ALLOWED_ORIGIN must be supplied together.");
}
if (configuredBoardUrl && new URL(configuredBoardUrl).origin !== wecomOrigin) {
  throw new Error("WECOM_TASK_BOARD_URL must belong to WECOM_ALLOWED_ORIGIN.");
}

const selectorConfigPath = process.env.WECOM_SELECTOR_CONFIG_PATH?.trim();
if (configuredBoardUrl && !selectorConfigPath) {
  throw new Error("A real-origin build requires WECOM_SELECTOR_CONFIG_PATH.");
}
const defaultSelectorPath = selectorConfigPath
  ? path.resolve(ROOT, selectorConfigPath)
  : path.join(SOURCE, "static", "selector-config.example.json");
const defaultSelectorText = await readFile(defaultSelectorPath, "utf8");
const defaultSelectors = validateBuildSelectors(JSON.parse(defaultSelectorText));
const normalizedSelectorText = `${JSON.stringify(defaultSelectors, null, 2)}\n`;
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const common = {
  bundle: true,
  sourcemap: false,
  minify: true,
  target: "chrome120",
  legalComments: "none",
  define: {
    __PROJECTAI_ALLOWED_ORIGINS__: JSON.stringify(projectAiOrigins),
    __WECOM_ALLOWED_ORIGIN__: JSON.stringify(wecomOrigin),
    __EXTENSION_VERSION__: JSON.stringify(VERSION),
    __WECOM_ADAPTER_TIMEOUT_MS__: JSON.stringify(mockMode ? 500 : 8_000),
    __MANUAL_ACTUAL_SYNC_ALLOWED__: JSON.stringify(mockMode),
  },
};

for (const [entry, outfile, format] of [
  ["service-worker.ts", "service-worker.js", "esm"],
  ["projectai-content.ts", "projectai-content.js", "iife"],
  ["wecom-content.ts", "wecom-content.js", "iife"],
  ["popup.ts", "popup.js", "iife"],
  ["options.ts", "options.js", "iife"],
]) {
  await build({
    ...common,
    entryPoints: [path.join(SOURCE, "src", entry)],
    outfile: path.join(OUT_DIR, outfile),
    format,
  });
}

for (const filename of ["popup.html", "options.html", "extension.css", "selector-config.example.json"]) {
  await cp(path.join(SOURCE, "static", filename), path.join(OUT_DIR, filename));
}
await writeFile(path.join(OUT_DIR, "selector-config.default.json"), normalizedSelectorText, { mode: 0o644 });
await cp(path.join(SOURCE, "README.md"), path.join(OUT_DIR, "README.md"));

await writeFile(
  path.join(OUT_DIR, "build-bindings.json"),
  `${JSON.stringify(
    {
      extensionVersion: VERSION,
      projectAiOrigin,
      wecomOrigin: wecomOrigin || null,
      wecomBoardConfigured: Boolean(configuredBoardUrl),
      manualActualSyncAllowed: mockMode,
      selectorConfigSource: selectorConfigPath ? "provided" : "review-default",
      selectorConfigSha256: createHash("sha256").update(normalizedSelectorText).digest("hex"),
    },
    null,
    2,
  )}\n`,
  { mode: 0o644 },
);

const manifest = {
  manifest_version: 3,
  name: "ProjectAI 企业微信工时同步",
  description: "将 ProjectAI 已人工确认的工时逐条填写并保存到企业微信任务看板，最终提交始终由用户完成。",
  version: VERSION,
  minimum_chrome_version: "120",
  permissions: ["storage", "tabs", "scripting"],
  host_permissions: projectAiMatches,
  optional_host_permissions: wecomOrigin ? [`${wecomOrigin}/*`] : [],
  background: { service_worker: "service-worker.js", type: "module" },
  action: { default_popup: "popup.html", default_title: "ProjectAI 工时同步" },
  options_page: "options.html",
  content_scripts: [
    {
      matches: projectAiMatches,
      js: ["projectai-content.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
};
await writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });

const forbidden = [".map", ".log", ".env", "selector-config.local", "cookie", "token"];
const manifestText = await readFile(path.join(OUT_DIR, "manifest.json"), "utf8");
if (forbidden.some((value) => manifestText.toLowerCase().includes(value))) {
  throw new Error("Generated manifest contains a forbidden release marker.");
}

if (packageMode) {
  await mkdir(path.dirname(ZIP_PATH), { recursive: true });
  await rm(ZIP_PATH, { force: true });
  execFileSync("zip", ["-q", "-r", ZIP_PATH, "."], { cwd: OUT_DIR, stdio: "inherit" });
  process.stdout.write(`Packaged ${path.relative(ROOT, ZIP_PATH)}\n`);
}
process.stdout.write(
  `Built ${path.relative(ROOT, OUT_DIR)}; ProjectAI=${projectAiOrigin}; WeCom=${wecomOrigin || "none"}; selectors=${selectorConfigPath ? "provided" : "review-default"}.\n`,
);
