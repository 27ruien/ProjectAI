#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { fetchWithPublicHost } from "./lib/fetch-with-public-host.ts";

const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/u, "");
const requestOrigin = process.env.AUTH_REQUEST_ORIGIN?.trim();
const expectedCookiePath = process.env.EXPECTED_COOKIE_PATH?.trim() || "/tool/projectai-staging";
if (!baseUrl || !requestOrigin) throw new Error("PRODUCT_V2_STAGING_SMOKE_ENVIRONMENT_INCOMPLETE");

const endpoint = (path) => `${baseUrl}/${path.replace(/^\/+/, "")}`;
const request = (path, init = {}) => fetchWithPublicHost(endpoint(path), requestOrigin, init);
const userAgent = `projectai-product-v2-staging-smoke/${randomUUID()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response, label) {
  assert((response.headers.get("content-type") || "").includes("application/json"), `${label} did not return JSON`);
  return response.json();
}

function cookieFrom(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")].filter(Boolean);
  return {
    header: values.map((value) => value.split(";", 1)[0]).join("; "),
    values,
  };
}

async function login(identity, expectedRole) {
  const response = await request("api/auth/sign-in/mock-wecom", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      "user-agent": userAgent,
    },
    body: JSON.stringify({ identity }),
  });
  assert(response.status === 200, `${identity} Mock WeCom login returned ${response.status}`);
  const body = await json(response, `${identity} login`);
  assert(body.authenticated === true && !("token" in body), `${identity} login exposed an invalid response contract`);
  const cookies = cookieFrom(response);
  assert(cookies.header, `${identity} login did not create a cookie`);
  assert(cookies.values.some((value) => /;\s*httponly(?:;|$)/iu.test(value)), `${identity} cookie is not HttpOnly`);
  assert(cookies.values.some((value) => /;\s*secure(?:;|$)/iu.test(value)), `${identity} cookie is not Secure`);
  assert(cookies.values.some((value) => value.toLowerCase().includes(`path=${expectedCookiePath.toLowerCase()}`)), `${identity} cookie path is incorrect`);

  const sessionResponse = await request("api/auth/get-session", {
    headers: { cookie: cookies.header, "user-agent": userAgent },
  });
  assert(sessionResponse.status === 200, `${identity} session lookup failed`);
  const session = await json(sessionResponse, `${identity} session`);
  assert(session?.user?.productRole === expectedRole, `${identity} role mapping is incorrect`);
  assert(!/token/iu.test(JSON.stringify(session)), `${identity} session lookup exposed a token`);
  return cookies.header;
}

async function authenticated(path, cookie, init = {}) {
  return request(path, {
    ...init,
    headers: {
      ...init.headers,
      cookie,
      origin: requestOrigin,
      "user-agent": userAgent,
    },
  });
}

async function logout(cookie) {
  const response = await authenticated("api/auth/sign-out", cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert(response.status === 200, "Mock WeCom logout failed");
}

const legacyLogin = await request("api/auth/sign-in/email", {
  method: "POST",
  headers: { "content-type": "application/json", origin: requestOrigin, "user-agent": userAgent },
  body: "{}",
});
assert(legacyLogin.status === 404, "Legacy email/password login remains exposed");

const superCookie = await login("super-admin", "super_admin");
const adminCookie = await login("admin", "admin");
const memberCookie = await login("member", "member");

const superOrganization = await authenticated("api/organization/departments", superCookie);
assert(superOrganization.status === 200, "Super Admin cannot open organization structure");
const organizationBody = await json(superOrganization, "organization structure");
assert(organizationBody.organization?.name === "Kivisense", "Kivisense organization is missing");
assert(Array.isArray(organizationBody.departments) && organizationBody.departments.length >= 7, "Kivisense department seed is incomplete");

for (const [label, cookie] of [["Admin", adminCookie], ["Member", memberCookie]]) {
  const response = await authenticated("api/organization/departments", cookie);
  assert(response.status === 404, `${label} can access organization configuration`);
}

const adminKnowledge = await authenticated("api/knowledge-spaces", adminCookie);
const memberKnowledge = await authenticated("api/knowledge-spaces", memberCookie);
assert(adminKnowledge.status === 200 && memberKnowledge.status === 200, "Knowledge-space listing failed");
const adminKnowledgeBody = await json(adminKnowledge, "Admin knowledge spaces");
const memberKnowledgeBody = await json(memberKnowledge, "Member knowledge spaces");
assert(adminKnowledgeBody.knowledgeSpaces.length >= memberKnowledgeBody.knowledgeSpaces.length, "Admin knowledge visibility is narrower than Member visibility");
assert(memberKnowledgeBody.knowledgeSpaces.every((space) => ["view", "edit"].includes(space.accessLevel)), "Member received a legacy permission contract");

const projectsResponse = await authenticated("api/projects", memberCookie);
assert(projectsResponse.status === 200, "Member project listing failed");
const projects = (await json(projectsResponse, "Member projects")).projects;
assert(Array.isArray(projects), "API_CONTRACT_MISSING: Member projects is not an array");
const missingPermissionContract = projects.find((project) =>
  !project.permissions ||
  typeof project.permissions.canEditProject !== "boolean" ||
  typeof project.permissions.canManageMembers !== "boolean" ||
  typeof project.permissions.canUploadDocuments !== "boolean" ||
  typeof project.permissions.canInviteMembers !== "boolean"
);
assert(
  !missingPermissionContract,
  `API_CONTRACT_MISSING: project ${missingPermissionContract?.id ?? "unknown"} has no complete server permissions`,
);
const target = projects.find((project) => project.permissions?.canEditProject);
assert(target, "PROJECT_PERMISSION_DENIED: Member does not have an editable fictional project context");
const detailResponse = await authenticated(`api/projects/${encodeURIComponent(target.id)}`, memberCookie);
assert(detailResponse.status === 200, `Member project detail returned ${detailResponse.status}`);
const detailProject = (await json(detailResponse, "Member project detail")).project;
assert(detailProject?.permissions, "API_CONTRACT_MISSING: project detail has no server permissions");
assert(
  JSON.stringify(detailProject.permissions) === JSON.stringify(target.permissions),
  "PROJECT_PERMISSION_MISMATCH: list and detail permissions differ",
);
const emptyWorkflow = await authenticated(`api/projects/${encodeURIComponent(target.id)}/requirement-extractions`, memberCookie, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ documentIds: [], idempotencyKey: randomUUID() }),
});
assert(emptyWorkflow.status === 400, `Empty Requirement Extraction returned ${emptyWorkflow.status}`);
const emptyWorkflowBody = await json(emptyWorkflow, "Empty Requirement Extraction");
assert(emptyWorkflowBody.error?.code === "SOURCE_REQUIRED", "Empty Requirement Extraction did not return SOURCE_REQUIRED");

await Promise.all([logout(superCookie), logout(adminCookie), logout(memberCookie)]);
process.stdout.write(JSON.stringify({
  status: "success",
  provider: "mock-wecom",
  rolesVerified: 3,
  departmentsVerified: organizationBody.departments.length,
  adminSpaceCount: adminKnowledgeBody.knowledgeSpaces.length,
  memberSpaceCount: memberKnowledgeBody.knowledgeSpaces.length,
  memberEditableProjectPermissions: "list-detail-consistent",
  legacyCredentialLogin: "rejected",
  requirementEmptyState: "SOURCE_REQUIRED",
}) + "\n");
