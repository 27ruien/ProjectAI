#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const baseUrl = required("APP_BASE_URL").replace(/\/+$/, "");
const origin = required("AUTH_REQUEST_ORIGIN");
const projectProfile = "qwen-project-assistant-cn-v1";
const marker = `phase1-staging-${randomUUID()}`;
const userAgent = `projectai-phase1-staging-verifier/${randomUUID()}`;

const credentials = {
  admin: pair("SEED_ADMIN"),
  departmentAdmin: pair("SEED_DEPT_ADMIN"),
  manager: pair("SEED_MANAGER_A"),
  member: pair("SEED_MEMBER_A"),
  viewer: pair("SEED_VIEWER_A"),
  otherDepartment: pair("SEED_OTHER_DEPT"),
  outsider: pair("SEED_OUTSIDER"),
};

const sessions = new Map();
let temporaryOrganizationId = null;
let departmentId = null;
let knowledgeSpaceId = null;
let projectId = null;

function assertStagingBoundary() {
  assert(process.env.NEXT_PUBLIC_APP_ENV === "staging", "cleanup requires the Staging runtime");
  const applicationUrl = new URL(baseUrl);
  assert(
    applicationUrl.protocol === "https:" &&
      applicationUrl.hostname === "gridworks.cn" &&
      applicationUrl.pathname.replace(/\/+$/, "") === "/tool/projectai-staging",
    "cleanup refused a non-Staging application URL",
  );
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert(
    databaseUrl.hostname === "projectai-postgres" &&
      databaseUrl.port === "5432" &&
      databaseUrl.pathname === "/projectai_staging" &&
      databaseUrl.username === "projectai_staging",
    "cleanup refused a non-Staging database",
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function pair(prefix) {
  return {
    email: required(`${prefix}_EMAIL`),
    password: required(`${prefix}_PASSWORD`),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function endpoint(pathname) {
  return `${baseUrl}/${pathname.replace(/^\/+/, "")}`;
}

function cookieHeader(response) {
  return (response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")])
    .filter(Boolean)
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function responseJson(response, label) {
  const type = response.headers.get("content-type") ?? "";
  assert(type.includes("application/json"), `${label} did not return JSON`);
  return response.json();
}

async function signIn(name) {
  const response = await fetch(endpoint("api/auth/sign-in/email"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin,
      "user-agent": userAgent,
    },
    body: JSON.stringify(credentials[name]),
  });
  assert(response.status === 200, `${name} sign-in returned ${response.status}`);
  const cookie = cookieHeader(response);
  assert(cookie, `${name} sign-in did not issue a cookie`);
  sessions.set(name, cookie);
  const session = await request(name, "api/auth/get-session");
  assert(session.user?.id, `${name} session has no user id`);
  return session;
}

async function request(name, pathname, options = {}) {
  const response = await fetch(endpoint(pathname), {
    method: options.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
      cookie: sessions.get(name) ?? "",
      origin,
      "user-agent": userAgent,
    },
    body:
      options.form ??
      (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const expected = Array.isArray(options.expected)
    ? options.expected
    : [options.expected ?? 200];
  assert(
    expected.includes(response.status),
    `${name} ${options.method ?? "GET"} ${pathname} returned ${response.status}`,
  );
  if (response.status === 204) return null;
  if (options.text) return response.text();
  return responseJson(response, pathname);
}

async function requestRaw(name, pathname, options = {}) {
  const response = await fetch(endpoint(pathname), {
    method: options.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(options.headers ?? {}),
      cookie: sessions.get(name) ?? "",
      origin,
      "user-agent": userAgent,
    },
    body: options.form,
  });
  const expected = Array.isArray(options.expected)
    ? options.expected
    : [options.expected ?? 200];
  assert(expected.includes(response.status), `${pathname} returned ${response.status}`);
  return response;
}

async function waitForIngestion(documentId) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const payload = await request(
      "manager",
      `api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    );
    const status = payload.document?.currentVersion?.ingestion?.status;
    if (status === "succeeded") return payload.document;
    if (["failed", "needs_ocr"].includes(status)) {
      throw new Error(`document ingestion ended as ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("document ingestion timed out");
}

async function deleteProjectObjects(targetProjectId) {
  if (!targetProjectId) return;
  const client = new S3Client({
    endpoint: required("OBJECT_STORAGE_ENDPOINT"),
    region: required("OBJECT_STORAGE_REGION"),
    forcePathStyle: required("OBJECT_STORAGE_FORCE_PATH_STYLE") === "true",
    credentials: {
      accessKeyId: required("OBJECT_STORAGE_ACCESS_KEY"),
      secretAccessKey: required("OBJECT_STORAGE_SECRET_KEY"),
    },
  });
  const bucket = required("OBJECT_STORAGE_BUCKET");
  const prefix = `projects/${targetProjectId}/`;
  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    const objects = (page.Contents ?? []).flatMap((entry) =>
      entry.Key ? [{ Key: entry.Key }] : [],
    );
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  client.destroy();
}

async function deleteProjectDatabaseState(client, targetProjectId) {
  const tables = [
    "weekly_report_versions",
    "weekly_report_drafts",
    "risk_sources",
    "risk_history",
    "risk_reviews",
    "risks",
    "risk_drafts",
    "action_item_dependencies",
    "action_item_sources",
    "action_item_history",
    "action_item_reviews",
    "action_items",
    "action_item_drafts",
    "project_management_ai_executions",
    "project_management_audits",
    "scope_diff_reviews",
    "scope_diff_items",
    "scope_comparison_runs",
    "scope_versions",
    "requirement_sources",
    "requirement_versions",
    "requirement_reviews",
    "requirement_drafts",
    "requirement_audits",
    "requirements",
    "requirement_extraction_runs",
    "ai_message_citations",
    "ai_retrieval_candidates",
    "ai_retrieval_query_embedding_calls",
    "ai_retrieval_runs",
    "ai_executions",
    "ai_messages",
    "ai_threads",
    "document_chunk_embeddings",
    "document_embedding_provider_calls",
    "document_embedding_batches",
    "document_embedding_jobs",
    "document_chunks",
    "document_sections",
    "document_ingestion_jobs",
  ];
  for (const table of tables) {
    await client.query(`delete from ${table} where project_id = $1`, [targetProjectId]);
  }
  await client.query(
    `delete from permission_audits
     where project_id = $1
        or resource_id = $1
        or resource_id in (select id from project_documents where project_id = $1)
        or resource_id in (select id from knowledge_spaces where project_id = $1)`,
    [targetProjectId],
  );
  await client.query("delete from audit_events where project_id = $1 or entity_id = $1", [targetProjectId]);
  await client.query("delete from document_grants where project_id = $1", [targetProjectId]);
  await client.query("delete from project_knowledge_sources where project_id = $1", [targetProjectId]);
  await client.query(
    "delete from knowledge_space_grants where subject_type = 'project' and subject_id = $1",
    [targetProjectId],
  );
  await client.query("delete from project_document_versions where project_id = $1", [targetProjectId]);
  await client.query("delete from project_documents where project_id = $1", [targetProjectId]);
  await client.query("delete from project_members where project_id = $1", [targetProjectId]);
  await client.query("delete from projects where id = $1", [targetProjectId]);
}

async function deleteOrganizationState(client, input) {
  const resourceIds = [
    ...input.knowledgeSpaceIds,
    ...input.departmentIds,
    ...input.organizationIds,
  ];
  if (resourceIds.length > 0) {
    await client.query(
      "delete from permission_audits where resource_id = any($1::text[]) or organization_id = any($2::text[])",
      [resourceIds, input.organizationIds],
    );
    await client.query("delete from audit_events where entity_id = any($1::text[])", [resourceIds]);
  }
  if (input.knowledgeSpaceIds.length > 0) {
    await client.query("delete from knowledge_space_grants where knowledge_space_id = any($1::text[])", [input.knowledgeSpaceIds]);
    await client.query("delete from knowledge_space_members where knowledge_space_id = any($1::text[])", [input.knowledgeSpaceIds]);
    await client.query("delete from project_knowledge_sources where knowledge_space_id = any($1::text[])", [input.knowledgeSpaceIds]);
    await client.query("delete from knowledge_spaces where id = any($1::text[])", [input.knowledgeSpaceIds]);
  }
  if (input.departmentIds.length > 0) {
    await client.query("delete from department_members where department_id = any($1::text[])", [input.departmentIds]);
    await client.query("delete from departments where id = any($1::text[])", [input.departmentIds]);
  }
  if (input.organizationIds.length > 0) {
    await client.query("delete from organization_members where organization_id = any($1::text[])", [input.organizationIds]);
    await client.query("delete from organizations where id = any($1::text[])", [input.organizationIds]);
  }
}

async function cleanupStaleVerificationState() {
  assertStagingBoundary();
  const client = new pg.Client({ connectionString: required("DATABASE_URL") });
  await client.connect();
  try {
    const [projects, spaces, departments, organizations] = await Promise.all([
      client.query("select id from projects where name like '[TEST] phase1-staging-%'"),
      client.query("select id from knowledge_spaces where name like '[TEST] phase1-staging-%'"),
      client.query("select id from departments where name like '[TEST] phase1-staging-%'"),
      client.query("select id from organizations where name like '[TEST] phase1-staging-%'"),
    ]);
    const projectIds = projects.rows.map((row) => row.id);
    for (const targetProjectId of projectIds) await deleteProjectObjects(targetProjectId);
    await client.query("begin");
    for (const targetProjectId of projectIds) {
      await deleteProjectDatabaseState(client, targetProjectId);
    }
    await deleteOrganizationState(client, {
      knowledgeSpaceIds: spaces.rows.map((row) => row.id),
      departmentIds: departments.rows.map((row) => row.id),
      organizationIds: organizations.rows.map((row) => row.id),
    });
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ status: "success", cleanup: "phase1-staging-stale", projects: projectIds.length })}\n`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function cleanup() {
  for (const [name, cookie] of [...sessions]) {
    try {
      await fetch(endpoint("api/auth/sign-out"), {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin, "user-agent": userAgent },
        body: "{}",
      });
    } catch {
      // Database cleanup below also removes verification sessions.
    }
    sessions.delete(name);
  }
  await deleteProjectObjects(projectId);
  const client = new pg.Client({ connectionString: required("DATABASE_URL") });
  await client.connect();
  try {
    await client.query("begin");
    if (projectId) await deleteProjectDatabaseState(client, projectId);
    await deleteOrganizationState(client, {
      knowledgeSpaceIds: knowledgeSpaceId ? [knowledgeSpaceId] : [],
      departmentIds: departmentId ? [departmentId] : [],
      organizationIds: temporaryOrganizationId ? [temporaryOrganizationId] : [],
    });
    await client.query(
      "delete from sessions where user_id in (select id from users where email = any($1::text[]))",
      [Object.values(credentials).map((item) => item.email.toLowerCase())],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const identities = Object.fromEntries(
    await Promise.all(
      Object.keys(credentials).map(async (name) => [name, await signIn(name)]),
    ),
  );
  const administration = await request("admin", "api/organizations");
  const defaultOrganization = administration.organizations.find(
    (item) => item.id === "org-legacy-default",
  );
  assert(defaultOrganization, "default Staging organization is unavailable");

  const createdOrganization = await request("admin", "api/organizations", {
    method: "POST",
    expected: 201,
    body: { name: `[TEST] ${marker}`, slug: marker },
  });
  temporaryOrganizationId = createdOrganization.organization.id;
  const outsiderAdministration = await request("outsider", "api/organizations");
  assert(outsiderAdministration.organizations.length === 0, "outsider can enumerate organizations");

  const createdDepartment = await request(
    "admin",
    `api/organizations/${defaultOrganization.id}/departments`,
    {
      method: "POST",
      expected: 201,
      body: { name: `[TEST] ${marker}`, code: marker.toUpperCase(), description: "虚构 Staging 验证部门" },
    },
  );
  departmentId = createdDepartment.department.id;
  await request("admin", `api/departments/${departmentId}/members`, {
    method: "POST",
    body: { userId: identities.departmentAdmin.user.id, role: "department_admin" },
  });

  const createdProject = await request("admin", "api/projects", {
    method: "POST",
    expected: 201,
    body: {
      name: `[TEST] ${marker}`,
      clientName: "虚构 Staging 客户",
      description: "第一阶段端到端验证项目",
      status: "active",
      stage: "testing",
      health: "healthy",
      targetLaunchDate: "2026-12-31",
    },
  });
  projectId = createdProject.project.id;
  await request("admin", `api/projects/${projectId}`, {
    method: "PATCH",
    body: { departmentId },
  });
  for (const [name, role] of [
    ["manager", "project_manager"],
    ["member", "project_member"],
    ["viewer", "viewer"],
    ["departmentAdmin", "project_member"],
  ]) {
    await request("admin", `api/projects/${projectId}/members`, {
      method: "POST",
      expected: 201,
      body: { email: credentials[name].email, role },
    });
  }

  const createdSpace = await request("departmentAdmin", "api/knowledge-spaces", {
    method: "POST",
    expected: 201,
    body: {
      organizationId: defaultOrganization.id,
      departmentId,
      projectId: null,
      type: "restricted",
      visibility: "restricted",
      name: `[TEST] ${marker}`,
      description: "虚构受限部门资料",
    },
  });
  knowledgeSpaceId = createdSpace.knowledgeSpace.id;

  const deniedForm = new FormData();
  deniedForm.set("file", new File(["unauthorized"], "unauthorized.txt", { type: "text/plain" }));
  deniedForm.set("knowledgeSpaceId", knowledgeSpaceId);
  const deniedUpload = await requestRaw(
    "manager",
    `api/projects/${projectId}/documents`,
    { method: "POST", form: deniedForm, headers: { "idempotency-key": randomUUID() }, expected: 404 },
  );
  const deniedPayload = await responseJson(deniedUpload, "denied knowledge-space upload");
  assert(deniedPayload.error?.code === "KNOWLEDGE_SPACE_NOT_FOUND", "unauthorized upload did not fail closed");

  const sourceText = "虚构客户要求在 2026 年 12 月 18 日前完成第一阶段知识管理验收，并由项目经理人工确认。";
  const uploadForm = new FormData();
  uploadForm.set("file", new File([sourceText], `${marker}.txt`, { type: "text/plain" }));
  uploadForm.set("displayName", `[TEST] ${marker}`);
  uploadForm.set("knowledgeSpaceId", knowledgeSpaceId);
  const uploadResponse = await requestRaw(
    "departmentAdmin",
    `api/projects/${projectId}/documents`,
    { method: "POST", form: uploadForm, headers: { "idempotency-key": randomUUID() }, expected: 201 },
  );
  const upload = await responseJson(uploadResponse, "department document upload");
  assert(upload.document.knowledgeSpaceId === knowledgeSpaceId, "document was not bound to the selected space");
  const documentId = upload.document.id;
  const versionId = upload.version.id;

  await request("departmentAdmin", `api/knowledge-spaces/${knowledgeSpaceId}/grants`, {
    method: "POST",
    expected: 201,
    body: { subjectType: "project", subjectId: projectId, permission: "view", effect: "allow" },
  });
  await request("manager", `api/projects/${projectId}/knowledge-sources`, {
    method: "POST",
    expected: 201,
    body: { sourceType: "knowledge_space", knowledgeSpaceId, documentId: null },
  });
  await waitForIngestion(documentId);

  const viewerDocument = await request("viewer", `api/projects/${projectId}/documents/${documentId}`);
  assert(viewerDocument.document.permissions.canDownload === false, "view grant unexpectedly implied download");
  await requestRaw(
    "viewer",
    `api/projects/${projectId}/documents/${documentId}/versions/${versionId}/download`,
    { expected: 404 },
  );
  await request("departmentAdmin", `api/knowledge-spaces/${knowledgeSpaceId}/grants`, {
    method: "POST",
    expected: 201,
    body: { subjectType: "project", subjectId: projectId, permission: "download", effect: "allow" },
  });
  const downloaded = await requestRaw(
    "viewer",
    `api/projects/${projectId}/documents/${documentId}/versions/${versionId}/download`,
  );
  assert((await downloaded.text()) === sourceText, "authorized download content mismatch");

  const search = await request("manager", `api/projects/${projectId}/knowledge/search`, {
    method: "POST",
    body: { query: "第一阶段知识管理验收", limit: 10 },
  });
  assert(search.results?.some((result) => result.documentId === documentId), "authorized lexical search missed the document");
  for (const name of ["otherDepartment", "outsider"]) {
    await request(name, `api/projects/${projectId}/knowledge/search`, {
      method: "POST",
      expected: 404,
      body: { query: "第一阶段知识管理验收", limit: 10 },
    });
  }

  const thread = await request("manager", `api/projects/${projectId}/ai/threads`, {
    method: "POST",
    expected: 201,
    body: {},
  });
  const answer = await request(
    "manager",
    `api/projects/${projectId}/ai/threads/${thread.thread.id}/messages`,
    {
      method: "POST",
      expected: [200, 202],
      headers: { "idempotency-key": randomUUID() },
      body: {
        question: "虚构客户要求何时完成第一阶段知识管理验收？",
        modelProfileId: projectProfile,
        sourceDocumentIds: [documentId],
      },
    },
  );
  if (answer.execution?.status !== "succeeded") {
    throw new Error(`assistant execution ended as ${answer.execution?.status ?? "unknown"}`);
  }
  assert(answer.assistantMessage?.citations?.length > 0, "assistant answer has no authorized citation");
  await request("otherDepartment", `api/projects/${projectId}/ai/threads`, {
    method: "POST",
    expected: 404,
    body: {},
  });

  const extraction = await request("manager", `api/projects/${projectId}/requirement-extractions`, {
    method: "POST",
    expected: 201,
    body: { documentIds: [documentId], idempotencyKey: randomUUID() },
  });
  assert(extraction.drafts?.length > 0, "requirement extraction returned no draft");
  const draft = extraction.drafts[0];
  const reviewed = await request(
    "manager",
    `api/projects/${projectId}/requirement-drafts/${draft.id}/review`,
    {
      method: "POST",
      body: {
        decision: "edit_accept",
        fields: {
          title: "人工确认的第一阶段知识管理验收",
          description: draft.description,
          type: draft.type,
          priority: draft.priority,
          ownerUserId: null,
          acceptanceCriteria: draft.acceptanceCriteria,
          assumptions: draft.assumptions,
          openQuestions: draft.openQuestions,
        },
        note: "Staging 虚构人工审核",
      },
    },
  );
  const requirementId = reviewed.requirement.id;

  const baseline = await request("manager", `api/projects/${projectId}/scope`, {
    method: "POST",
    expected: 201,
    body: { name: "Staging Baseline", includedRequirementIds: [requirementId] },
  });
  const omitted = await request("manager", `api/projects/${projectId}/scope`, {
    method: "POST",
    expected: 201,
    body: { name: "Staging Candidate", includedRequirementIds: [] },
  });
  const comparison = await request("manager", `api/projects/${projectId}/scope/comparisons`, {
    method: "POST",
    expected: 201,
    body: { baselineVersionId: baseline.version.id, candidateVersionId: omitted.version.id },
  });
  assert(comparison.items?.some((item) => item.diffType === "not_mentioned"), "Scope omitted item was not preserved as not_mentioned");

  const actionDrafts = await request("manager", `api/projects/${projectId}/actions/drafts`, {
    method: "POST",
    expected: 201,
    body: { requirementIds: [requirementId], documentIds: [] },
  });
  const actionReview = await request(
    "manager",
    `api/projects/${projectId}/actions/drafts/${actionDrafts.drafts[0].id}/review`,
    {
      method: "POST",
      body: {
        decision: "edit_accept",
        note: "Staging 虚构人工审核",
        fields: {
          title: "人工确认 Staging Action",
          description: actionDrafts.drafts[0].description,
          ownerUserId: identities.member.user.id,
          startDate: null,
          dueDate: "2026-12-17",
          status: "todo",
          priority: "high",
          progress: 0,
          blocker: "",
          relatedRequirementId: requirementId,
          relatedScopeItemId: null,
        },
      },
    },
  );
  await request("member", `api/projects/${projectId}/actions`, {
    method: "PATCH",
    body: {
      actionItemId: actionReview.action.id,
      fields: {
        title: actionReview.action.title,
        description: actionReview.action.description,
        ownerUserId: actionReview.action.ownerUserId,
        startDate: actionReview.action.startDate,
        dueDate: actionReview.action.dueDate,
        status: "in_progress",
        priority: actionReview.action.priority,
        progress: 25,
        blocker: actionReview.action.blocker,
        relatedRequirementId: actionReview.action.relatedRequirementId,
        relatedScopeItemId: actionReview.action.relatedScopeItemId,
      },
      changeReason: "Staging assigned-member verification",
    },
  });
  await request("viewer", `api/projects/${projectId}/actions`, {
    method: "POST",
    expected: 403,
    body: { fields: { title: "拒绝写入", description: "Viewer 不得写入", ownerUserId: null, startDate: null, dueDate: null, status: "todo", priority: "low", progress: 0, blocker: "", relatedRequirementId: null, relatedScopeItemId: null } },
  });

  const riskDrafts = await request("manager", `api/projects/${projectId}/risks/drafts`, {
    method: "POST",
    expected: 201,
    body: { requirementIds: [requirementId], documentIds: [] },
  });
  const riskReview = await request(
    "manager",
    `api/projects/${projectId}/risks/drafts/${riskDrafts.drafts[0].id}/review`,
    { method: "POST", body: { decision: "accept", note: "Staging 虚构人工审核" } },
  );
  assert(riskReview.risk.severity === riskReview.risk.probability * riskReview.risk.impact, "risk matrix is inconsistent");

  const weekly = await request("manager", `api/projects/${projectId}/weekly-reports`, {
    method: "POST",
    expected: 201,
    body: { periodStart: "2026-07-13", periodEnd: "2026-07-19" },
  });
  const published = await request(
    "manager",
    `api/projects/${projectId}/weekly-reports/drafts/${weekly.draft.id}/publish`,
    { method: "POST", expected: 201, body: {} },
  );
  const markdown = await request(
    "member",
    `api/projects/${projectId}/weekly-reports/${published.version.id}/export`,
    { text: true },
  );
  assert(markdown.startsWith("# ProjectAI 周报"), "weekly Markdown export is invalid");
  const audits = await request("manager", `api/projects/${projectId}/management-audits`);
  assert(audits.audits?.some((event) => event.eventType === "weekly_report_published"), "management audit is incomplete");
  await request("viewer", `api/projects/${projectId}/management-audits`, { expected: 403 });

  for (const path of [
    "knowledge",
    `projects/${projectId}/documents`,
    `projects/${projectId}/knowledge`,
    `projects/${projectId}/requirements`,
    `projects/${projectId}/scope`,
    `projects/${projectId}/actions`,
    `projects/${projectId}/risks`,
    `projects/${projectId}/reports`,
    `projects/${projectId}/audit`,
  ]) {
    const page = await requestRaw("manager", path);
    assert((page.headers.get("content-type") ?? "").includes("text/html"), `${path} is not an HTML UI`);
  }

  process.stdout.write(
    JSON.stringify({
      status: "success",
      verification: "phase1-staging-http-e2e",
      checks: 20,
      projectIsolation: true,
      documentAcl: true,
      assistantCitation: true,
      aiDraftReview: true,
      export: true,
      cleanupPending: true,
    }) + "\n",
  );
}

if (process.argv.includes("--cleanup-stale")) {
  await cleanupStaleVerificationState();
  process.exit(0);
}

assertStagingBoundary();
let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    failure = failure
      ? new AggregateError([failure, cleanupError], "verification and cleanup failed")
      : cleanupError;
  }
}
if (failure) throw failure;
