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

test("server-renders the public Project AI OS login", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Project AI OS/);
  assert.match(html, /登录工作台/);
  assert.match(html, /Project Files Foundation/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("root and every protected product route redirect anonymous users to login", async () => {
  const routes = [
    "/", "/dashboard", "/projects", "/projects/new", "/projects/project-001/overview",
    "/projects/project-001/documents", "/projects/project-001/knowledge", "/projects/project-001/requirements",
    "/projects/project-001/scope", "/projects/project-001/actions", "/projects/project-001/meetings", "/projects/project-001/risks",
    "/workflows", "/workflows/requirement-extraction", "/reviews", "/skills", "/skills/project-document-summary", "/daily-report",
    "/knowledge", "/analytics", "/settings", "/settings/ai-models", "/settings/ai-models/requirement-analysis",
  ];
  for (const route of routes) {
    const response = await render(route);
    assert.match(String(response.status), /^30[2378]$/, `${route} should redirect`);
    assert.match(
      response.headers.get("location") ?? "",
      route === "/" ? /\/dashboard$/ : /\/login(?:\?|$)/,
    );
  }
});

test("login is the only public application page", async () => {
  const response = await render("/login?returnTo=%2Fprojects");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /使用管理员为你预创建的企业账号/);
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
