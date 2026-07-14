#!/usr/bin/env node

import { normalizeApplicationCookieName } from "./lib/cookie-name.mjs";

const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");

if (!baseUrl) {
  throw new Error("APP_BASE_URL is required for authentication boundary verification");
}

const projectAId = process.env.SEED_PROJECT_A_ID || "project-001";
const projectBId = process.env.SEED_PROJECT_B_ID || "project-002";
const projectCId = process.env.SEED_PROJECT_C_ID || "project-003";
const expectedCookiePath = process.env.EXPECTED_COOKIE_PATH || new URL(baseUrl).pathname || "/";
const requireSecureCookie = process.env.REQUIRE_SECURE_COOKIE !== "0";
const requestOrigin = process.env.AUTH_REQUEST_ORIGIN || new URL(baseUrl).origin;
const expectedCookiePrefix = process.env.EXPECTED_COOKIE_PREFIX || process.env.AUTH_COOKIE_PREFIX;

const actors = {
  admin: {
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  },
  managerA: {
    email: process.env.SEED_MANAGER_A_EMAIL || process.env.SEED_MANAGER_EMAIL,
    password: process.env.SEED_MANAGER_A_PASSWORD || process.env.SEED_MANAGER_PASSWORD,
  },
  managerB: {
    email: process.env.SEED_MANAGER_B_EMAIL,
    password: process.env.SEED_MANAGER_B_PASSWORD,
  },
  memberA: {
    email: process.env.SEED_MEMBER_A_EMAIL,
    password: process.env.SEED_MEMBER_A_PASSWORD,
  },
  viewerA: {
    email: process.env.SEED_VIEWER_A_EMAIL || process.env.SEED_VIEWER_EMAIL,
    password: process.env.SEED_VIEWER_A_PASSWORD || process.env.SEED_VIEWER_PASSWORD,
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireActor(name) {
  const actor = actors[name];
  assert(actor.email && actor.password, `Seed credentials are missing for ${name}`);
  return actor;
}

function endpoint(pathname) {
  return `${baseUrl}/${pathname.replace(/^\/+/, "")}`;
}

function cookieHeader(response) {
  const setCookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  return setCookies.map((value) => value.split(";", 1)[0]).join("; ");
}

function cookieAttribute(value, name) {
  const prefix = `${name.toLowerCase()}=`;
  const attribute = value
    .split(";")
    .slice(1)
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(prefix));
  return attribute ? attribute.slice(prefix.length) : null;
}

function projectRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.projects)) return payload.projects;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function json(response, label) {
  const type = response.headers.get("content-type") || "";
  assert(type.includes("application/json"), `${label} did not return JSON`);
  return response.json();
}

async function signIn(name) {
  const actor = requireActor(name);
  const response = await fetch(endpoint("api/auth/sign-in/email"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
    },
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  });
  assert(response.status === 200, `${name} login failed with HTTP ${response.status}`);
  assert(/no-store/i.test(response.headers.get("cache-control") || ""), `${name} login response is cacheable`);
  const loginPayload = await json(response, `${name} login`);
  assert(loginPayload?.authenticated === true, `${name} login returned an unexpected response contract`);
  assert(!/token/i.test(JSON.stringify(loginPayload)), `${name} login exposed a Session token`);

  const setCookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  assert(setCookies.some((value) => /httponly/i.test(value)), `${name} session cookie is not HttpOnly`);
  assert(setCookies.some((value) => /samesite=(lax|strict)/i.test(value)), `${name} session cookie has an unsafe SameSite policy`);
  if (requireSecureCookie) {
    assert(setCookies.some((value) => /;\s*secure(?:;|$)/i.test(value)), `${name} session cookie is not Secure`);
  }
  assert(
    setCookies.some((value) => cookieAttribute(value, "path") === expectedCookiePath),
    `${name} session cookie is not scoped to the expected application path`,
  );
  if (expectedCookiePrefix) {
    assert(
      setCookies.some((value) =>
        normalizeApplicationCookieName(value).startsWith(`${expectedCookiePrefix}.`),
      ),
      `${name} session cookie does not use the expected environment prefix`,
    );
  }

  const cookie = cookieHeader(response);
  assert(cookie, `${name} login did not create a session cookie`);
  return cookie;
}

async function authenticatedFetch(pathname, cookie, init = {}) {
  return fetch(endpoint(pathname), {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
      cookie,
      origin: requestOrigin,
    },
  });
}

async function verifySession(name, cookie) {
  for (const pass of ["initial", "refresh"]) {
    const response = await authenticatedFetch("api/auth/get-session", cookie);
    assert(response.status === 200, `${name} ${pass} session lookup failed with HTTP ${response.status}`);
    assert(
      /no-store/i.test(response.headers.get("cache-control") || ""),
      `${name} ${pass} session response is cacheable`,
    );
    const payload = await json(response, `${name} ${pass} session lookup`);
    assert(payload?.user?.email, `${name} ${pass} session lookup returned no user`);
    assert(!/token/i.test(JSON.stringify(payload)), `${name} ${pass} session lookup exposed a token`);
  }

  const unusedEndpoint = await authenticatedFetch("api/auth/list-sessions", cookie);
  assert(unusedEndpoint.status === 404, `${name} reached a non-allowlisted auth endpoint`);
  assert(
    !/token/i.test(await unusedEndpoint.text()),
    `${name} non-allowlisted auth endpoint exposed a token`,
  );
}

async function listProjects(name, cookie) {
  const response = await authenticatedFetch("api/projects", cookie);
  assert(response.status === 200, `${name} project list failed with HTTP ${response.status}`);
  return projectRows(await json(response, `${name} project list`));
}

async function signOut(name, cookie, verifyRevoked = false) {
  const response = await authenticatedFetch("api/auth/sign-out", cookie, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(response.status === 200, `${name} logout failed with HTTP ${response.status}`);
  assert(
    /no-store/i.test(response.headers.get("cache-control") || ""),
    `${name} logout response is cacheable`,
  );
  await response.text();
  if (!verifyRevoked) return;

  const revoked = await authenticatedFetch("api/auth/get-session", cookie);
  assert(
    revoked.status === 200,
    `${name} revoked session lookup failed with HTTP ${revoked.status}`,
  );
  assert(
    /no-store/i.test(revoked.headers.get("cache-control") || ""),
    `${name} revoked session response is cacheable`,
  );
  const revokedPayload = await json(revoked, `${name} revoked session lookup`);
  assert(revokedPayload === null, `${name} session remained valid after logout`);
  assert(
    !/token/i.test(JSON.stringify(revokedPayload)),
    `${name} revoked session lookup exposed a token`,
  );
}

async function verifyManagerIsolation() {
  const cookie = await signIn("managerA");
  await verifySession("managerA", cookie);
  const rows = await listProjects("managerA", cookie);
  const ids = new Set(rows.map((project) => project.id));
  assert(ids.has(projectAId), "managerA cannot see project A");
  assert(!ids.has(projectBId), "managerA project list leaked project B");
  assert(!ids.has(projectCId), "managerA project list leaked project C");

  const denied = await authenticatedFetch(`api/projects/${encodeURIComponent(projectBId)}`, cookie);
  assert(denied.status === 404, `managerA cross-project lookup returned HTTP ${denied.status}, expected 404`);

  const auditDenied = await authenticatedFetch("api/audit-events?limit=5", cookie);
  assert(auditDenied.status === 403, `managerA read audit events with HTTP ${auditDenied.status}`);
  await signOut("managerA", cookie, true);
}

async function verifyManagerBIsolation() {
  const cookie = await signIn("managerB");
  const rows = await listProjects("managerB", cookie);
  const ids = new Set(rows.map((project) => project.id));
  assert(ids.has(projectBId), "managerB cannot see project B");
  assert(!ids.has(projectAId), "managerB project list leaked project A");
  assert(!ids.has(projectCId), "managerB project list leaked project C");

  const denied = await authenticatedFetch(`api/projects/${encodeURIComponent(projectAId)}`, cookie);
  assert(denied.status === 404, `managerB cross-project lookup returned HTTP ${denied.status}, expected 404`);
  await signOut("managerB", cookie);
}

async function verifyMemberPermissions() {
  const cookie = await signIn("memberA");
  const current = await authenticatedFetch(`api/projects/${encodeURIComponent(projectAId)}`, cookie);
  assert(current.status === 200, `memberA cannot read project A (HTTP ${current.status})`);
  const payload = await json(current, "memberA project A read");
  const existingName = payload?.project?.name || payload?.name;
  assert(existingName, "memberA project A response has no project name");

  const edited = await authenticatedFetch(`api/projects/${encodeURIComponent(projectAId)}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: existingName }),
  });
  assert(edited.status === 200, `memberA could not edit allowed project data (HTTP ${edited.status})`);

  const memberManagementDenied = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectAId)}/members`,
    cookie,
    {
      method: "POST",
      body: JSON.stringify({ email: actors.viewerA.email, role: "viewer" }),
    },
  );
  assert(
    memberManagementDenied.status === 403,
    `memberA managed project members with HTTP ${memberManagementDenied.status}`,
  );
  await signOut("memberA", cookie);
}

async function verifyViewerReadOnly() {
  const cookie = await signIn("viewerA");
  await verifySession("viewerA", cookie);
  const current = await authenticatedFetch(`api/projects/${encodeURIComponent(projectAId)}`, cookie);
  assert(current.status === 200, `viewerA cannot read project A (HTTP ${current.status})`);
  const currentProject = await json(current, "viewerA project A read");
  const existingName = currentProject?.project?.name || currentProject?.name;
  assert(existingName, "viewerA project A response has no project name");

  const denied = await authenticatedFetch(`api/projects/${encodeURIComponent(projectAId)}`, cookie, {
    method: "PATCH",
    body: JSON.stringify({ name: existingName }),
  });
  assert(denied.status === 403, `viewerA modified project A with HTTP ${denied.status}`);
  await signOut("viewerA", cookie);
}

async function verifyAdminAccess() {
  const cookie = await signIn("admin");
  await verifySession("admin", cookie);
  const rows = await listProjects("admin", cookie);
  const ids = new Set(rows.map((project) => project.id));
  assert(ids.has(projectAId), "admin cannot see project A");
  assert(ids.has(projectBId), "admin cannot see project B");
  assert(ids.has(projectCId), "admin cannot see project C");

  const auditResponse = await authenticatedFetch("api/audit-events?limit=50", cookie);
  assert(auditResponse.status === 200, `admin audit query failed with HTTP ${auditResponse.status}`);
  const auditPayload = await json(auditResponse, "admin audit query");
  assert(Array.isArray(auditPayload?.events), "admin audit query returned no events array");
  const serializedAudit = JSON.stringify(auditPayload);
  assert(
    !/"[^"]*(?:password|passphrase|secret|token|cookie|authorization|api.?key|database.?url|file.?content|document.?body)[^"]*"\s*:/i.test(serializedAudit),
    "admin audit response exposed a forbidden sensitive metadata key",
  );
  await signOut("admin", cookie);
}

async function verifyAnonymousBoundary() {
  const response = await fetch(endpoint("dashboard"), { redirect: "manual" });
  assert([302, 303, 307, 308].includes(response.status), `anonymous dashboard returned HTTP ${response.status}`);
  assert((response.headers.get("location") || "").includes("/login"), "anonymous dashboard did not redirect to login");
}

try {
  await verifyAnonymousBoundary();
  await verifyManagerIsolation();
  await verifyManagerBIsolation();
  await verifyMemberPermissions();
  await verifyViewerReadOnly();
  await verifyAdminAccess();
  process.stdout.write("Authentication and project-isolation verification passed.\n");
} catch (error) {
  process.stderr.write(`Authentication boundary verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
}
