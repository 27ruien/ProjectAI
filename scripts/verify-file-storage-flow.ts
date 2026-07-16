import { createHash, randomUUID } from "node:crypto";
import { closeDatabasePool } from "../lib/db/client";
import { fetchWithPublicHost } from "./lib/fetch-with-public-host";
import { cleanupDocumentVerification } from "./lib/staging-document-verification";

const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "");
const requestOrigin = process.env.AUTH_REQUEST_ORIGIN?.trim();
const projectId = process.env.SEED_PROJECT_A_ID?.trim() || "project-001";
const email = process.env.SEED_MANAGER_A_EMAIL?.trim();
const password = process.env.SEED_MANAGER_A_PASSWORD;
const verifierUserAgent = `projectai-staging-file-verifier/0.5/${randomUUID()}`;
const displayNamePrefix = "虚构 Staging 文件验收 ";
const displayName = `${displayNamePrefix}${randomUUID()}`;

if (!baseUrl || !requestOrigin || !email || !password) {
  throw new Error("Staging file verification environment is incomplete.");
}
const configuredBaseUrl: string = baseUrl;
const configuredRequestOrigin: string = requestOrigin;
const configuredEmail: string = email;
const configuredPassword: string = password;

const endpoint = (path: string) =>
  `${configuredBaseUrl}/${path.replace(/^\/+/, "")}`;
const stagingFetch = (path: string, init: RequestInit = {}) =>
  fetchWithPublicHost(endpoint(path), configuredRequestOrigin, init);
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const pdf = (version: number) =>
  new TextEncoder().encode(
    `%PDF-1.4\n% Project AI OS fictitious staging verification v${version}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

let cookie = "";
let documentId = "";

async function responseJson<T>(response: Response, label: string): Promise<T> {
  assert(
    (response.headers.get("content-type") || "").includes("application/json"),
    `${label} did not return JSON`,
  );
  return (await response.json()) as T;
}

async function authenticatedFetch(path: string, init: RequestInit = {}) {
  return stagingFetch(path, {
    ...init,
    redirect: "manual",
    headers: {
      ...init.headers,
      cookie,
      origin: configuredRequestOrigin,
      "user-agent": verifierUserAgent,
    },
  });
}

async function signIn(): Promise<void> {
  const response = await stagingFetch("api/auth/sign-in/email", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: configuredRequestOrigin,
      "user-agent": verifierUserAgent,
    },
    body: JSON.stringify({
      email: configuredEmail,
      password: configuredPassword,
    }),
  });
  assert(response.status === 200, `Staging file verifier login returned ${response.status}`);
  const cookies = response.headers.getSetCookie?.() ?? [];
  cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  assert(cookie, "Staging file verifier login did not create a Session");
}

async function signOut(): Promise<void> {
  if (!cookie) return;
  const response = await authenticatedFetch("api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(response.status === 200, `Staging file verifier logout returned ${response.status}`);
  cookie = "";
}

async function upload(
  bytes: Uint8Array,
  filename: string,
  existingDocumentId?: string,
): Promise<{
  document: { id: string };
  version: { id: string; versionNumber: number; isCurrent: boolean };
}> {
  const form = new FormData();
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  form.set("file", new Blob([body], { type: "application/pdf" }), filename);
  if (!existingDocumentId) form.set("displayName", displayName);
  const suffix = existingDocumentId
    ? `/${encodeURIComponent(existingDocumentId)}/versions`
    : "";
  const response = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectId)}/documents${suffix}`,
    {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: form,
    },
  );
  assert(response.status === 201, `Staging file upload returned ${response.status}`);
  return responseJson(response, "Staging file upload");
}

async function cleanup(): Promise<void> {
  try {
    await cleanupDocumentVerification({
      projectId,
      displayNamePrefix,
      userAgents: [verifierUserAgent],
      userAgentPrefixes: ["projectai-staging-file-verifier/0.5/"],
    });
  } finally {
    await closeDatabasePool();
  }
}

let verificationError: unknown;
try {
  await signIn();
  const firstBytes = pdf(1);
  const first = await upload(firstBytes, "虚构-staging-verification-v1.pdf");
  documentId = first.document.id;
  assert(first.version.versionNumber === 1, "First upload did not create version 1");
  assert(first.version.isCurrent, "First upload is not current");

  const download = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(first.version.id)}/download`,
  );
  assert(download.status === 200, `Staging file download returned ${download.status}`);
  assert(
    /attachment/i.test(download.headers.get("content-disposition") || ""),
    "Staging file download is not an attachment",
  );
  assert(
    download.headers.get("x-content-type-options") === "nosniff",
    "Staging file download is missing nosniff",
  );
  const downloadedBytes = new Uint8Array(await download.arrayBuffer());
  assert(
    sha256(downloadedBytes) === sha256(firstBytes),
    "Staging file download SHA-256 mismatch",
  );

  const second = await upload(
    pdf(2),
    "虚构-staging-verification-v2.pdf",
    documentId,
  );
  assert(second.version.versionNumber === 2, "Second upload did not create version 2");
  assert(second.version.isCurrent, "Second upload is not current");

  const currentResponse = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(first.version.id)}/current`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert(currentResponse.status === 200, `Set-current returned ${currentResponse.status}`);

  const archive = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/archive`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert(archive.status === 200, `Archive returned ${archive.status}`);
  const restore = await authenticatedFetch(
    `api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/restore`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert(restore.status === 200, `Restore returned ${restore.status}`);
  await signOut();
  process.stdout.write(
    `${JSON.stringify({ ok: true, uploadedVersions: 2, downloadIntegrity: true, lifecycle: true })}\n`,
  );
} catch (error) {
  verificationError = error;
  throw error;
} finally {
  try {
    await signOut();
  } catch (cleanupError) {
    if (!verificationError) throw cleanupError;
  }
  await cleanup();
}
