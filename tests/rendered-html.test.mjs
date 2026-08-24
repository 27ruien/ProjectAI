import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const withBasePath = (path) => `${basePath}${path === "/" ? "/" : `/${path.replace(/^\/+/, "")}`}`;

async function render(path = "/") {
  const requestPath = withBasePath(path);
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${requestPath}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${requestPath}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public Project AI login", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Project AI/);
  assert.match(html, /企业微信登录/);
  assert.doesNotMatch(html, /Project AI OS|Requirement|Workflow|Skill|Product Map/);
  assert.doesNotMatch(html, /type="password"|邮箱和密码|测试账号密码/);
});

test("root and catch-all source expose only Slim product routes", async () => {
  const [home, catchAll] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[...slug]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(home, /redirect\("\/projects"\)/);
  assert.match(catchAll, /\["projects", "organization", "settings"\]/);
  assert.doesNotMatch(catchAll, /assistant|requirements|timesheet|workflow|product-map/);
});

test("active source has no old routes, workers, agents, skills, or self-built RAG services", async () => {
  const catchAll = await readFile(new URL("../app/[...slug]/page.tsx", import.meta.url), "utf8");
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(catchAll, /\["projects", "organization", "settings"\]/);
  assert.doesNotMatch(catchAll, /assistant|requirements|timesheet|workflow|product-map/);
  assert.equal(JSON.parse(packageJson).name, "project-ai-slim");
  for (const relative of ["../scripts/document-worker.ts", "../skills/product-map/SKILL.md", "../extensions/wecom-timesheet/README.md", "../lib/ai/retrieval/index.ts", "../lib/ai/embeddings/index.ts", "../lib/product-map/service.ts"]) {
    await assert.rejects(access(new URL(relative, import.meta.url)));
  }
});
