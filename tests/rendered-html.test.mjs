import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

function withBasePath(path) {
  const normalized = path === "/" ? "/" : `/${path.replace(/^\/+/, "")}`;
  return `${basePath}${normalized}`;
}

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

test("server-renders the Project AI OS shell", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Project AI OS/);
  assert.match(html, /工作台|正在装配项目工作台/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("all primary product routes resolve", async () => {
  const routes = [
    "/dashboard", "/projects", "/projects/new", "/projects/proj-001/overview",
    "/projects/proj-001/documents", "/projects/proj-001/knowledge", "/projects/proj-001/requirements",
    "/projects/proj-001/scope", "/projects/proj-001/actions", "/projects/proj-001/meetings", "/projects/proj-001/risks",
    "/workflows", "/workflows/requirement-extraction", "/reviews", "/skills", "/skills/project-document-summary",
    "/knowledge", "/analytics", "/settings", "/settings/ai-models", "/settings/ai-models/requirement-analysis",
  ];
  for (const route of routes) {
    const response = await render(route);
    assert.equal(response.status, 200, `${route} should resolve`);
  }
});

test("review center renders pending tasks instead of an empty default filter", async () => {
  const response = await render("/reviews");
  const html = await response.text();
  assert.match(html, /客户需求确认稿 v1\.3/);
  assert.match(html, />7<\/strong>待审核/);
});

test("keeps AI infrastructure centralized and removes starter preview", async () => {
  const [packageJson, layout, gateway, knowledge] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/gateway/mock-ai-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/knowledge/mock-project-knowledge-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"name": "project-ai-os"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(layout, /Project AI OS/);
  assert.match(gateway, /MockAIProvider/);
  assert.match(knowledge, /answerProjectQuestion/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
