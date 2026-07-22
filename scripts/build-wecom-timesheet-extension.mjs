import { execFileSync } from "node:child_process";
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
const projectAiMatches = [
  "https://gridworks.cn/tool/projectai/*",
  "https://gridworks.cn/tool/projectai-staging/*",
  ...(mockMode ? ["http://127.0.0.1/*", "http://localhost/*"] : []),
];
const projectAiOrigins = ["https://gridworks.cn", ...(mockMode ? ["http://127.0.0.1:4173", "http://localhost:4173"] : [])];

function wecomBuildOrigin() {
  const raw = process.env.WECOM_TASK_BOARD_URL?.trim();
  if (!raw) return "";
  const url = new URL(raw);
  if (url.username || url.password || url.hash) throw new Error("WECOM_TASK_BOARD_URL must not contain credentials or fragments.");
  if (url.protocol !== "https:" && !(mockMode && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new Error("WECOM_TASK_BOARD_URL must use HTTPS outside mock builds.");
  }
  return url.origin;
}

const wecomOrigin = wecomBuildOrigin();
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
await cp(path.join(SOURCE, "README.md"), path.join(OUT_DIR, "README.md"));

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
process.stdout.write(`Built ${path.relative(ROOT, OUT_DIR)}${wecomOrigin ? ` for ${wecomOrigin}` : " without a real WeCom origin"}.\n`);
