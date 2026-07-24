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
  assert.match(html, /企业微信登录/);
  assert.match(html, /等待企业微信 OAuth 配置/);
  assert.doesNotMatch(html, /type="password"|邮箱和密码|测试账号密码/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("root and active product routes use the Product V2 entry and authentication boundary", async () => {
  const root = await render("/");
  assert.match(String(root.status), /^30[2378]$/);
  assert.match(root.headers.get("location") ?? "", /\/daily-report$/);

  const routes = [
    "/workflows", "/workflows/requirement-extraction", "/daily-report",
    "/knowledge", "/organization", "/settings", "/settings/ai-models",
  ];
  for (const route of routes) {
    const response = await render(route);
    assert.match(String(response.status), /^30[2378]$/, `${route} should redirect`);
    assert.match(response.headers.get("location") ?? "", /\/login(?:\?|$)/);
  }
});

test("legacy product routes redirect to the retained Product V2 destinations", async () => {
  const redirects = new Map([
    ["/dashboard", "/daily-report"],
    ["/projects", "/knowledge"],
    ["/projects/project-001/overview", "/knowledge?projectId=project-001"],
    ["/reviews", "/workflows"],
    ["/skills", "/workflows"],
    ["/analytics", "/knowledge"],
  ]);
  for (const [route, target] of redirects) {
    const response = await render(route);
    assert.match(String(response.status), /^30[2378]$/, `${route} should redirect`);
    const location = new URL(response.headers.get("location") ?? "", "http://localhost");
    assert.equal(`${location.pathname}${location.search}`, `${basePath}${target}`);
  }
});

test("login is the only public application page", async () => {
  const response = await render("/login?returnTo=%2Fprojects");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /企业微信登录/);
  assert.doesNotMatch(html, /邮箱|密码/);
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
