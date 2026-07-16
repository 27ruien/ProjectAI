import { getPool } from "../../lib/db/client";
import { getObjectStorage } from "../../lib/files/object-storage";
import { fetchWithPublicHost } from "./fetch-with-public-host";

export type VerificationSession = {
  cookie: string;
  userAgent: string;
};

export type DocumentVerificationEnvironment = {
  baseUrl: string;
  requestOrigin: string;
  projectAId: string;
  projectBId: string;
};

export function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Staging verification.`);
  return value;
}

export function documentVerificationEnvironment(): DocumentVerificationEnvironment {
  return {
    baseUrl: requiredEnvironment("APP_BASE_URL").replace(/\/+$/, ""),
    requestOrigin: requiredEnvironment("AUTH_REQUEST_ORIGIN"),
    projectAId: process.env.SEED_PROJECT_A_ID?.trim() || "project-001",
    projectBId: process.env.SEED_PROJECT_B_ID?.trim() || "project-002",
  };
}

function endpoint(
  environment: DocumentVerificationEnvironment,
  path: string,
): string {
  return `${environment.baseUrl}/${path.replace(/^\/+/, "")}`;
}

export function stagingFetch(
  environment: DocumentVerificationEnvironment,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetchWithPublicHost(
    endpoint(environment, path),
    environment.requestOrigin,
    init,
  );
}

export async function responseJson<T>(
  response: Response,
  label: string,
): Promise<T> {
  assert(
    (response.headers.get("content-type") || "").includes("application/json"),
    `${label} did not return JSON.`,
  );
  return (await response.json()) as T;
}

export async function signIn(input: {
  environment: DocumentVerificationEnvironment;
  email: string;
  password: string;
  userAgent: string;
}): Promise<VerificationSession> {
  const response = await stagingFetch(
    input.environment,
    "api/auth/sign-in/email",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        origin: input.environment.requestOrigin,
        "user-agent": input.userAgent,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
      }),
    },
  );
  assert(response.status === 200, `Staging login returned ${response.status}.`);
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  assert(cookie, "Staging login did not create a Session.");
  return { cookie, userAgent: input.userAgent };
}

export function authenticatedFetch(
  environment: DocumentVerificationEnvironment,
  session: VerificationSession,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return stagingFetch(environment, path, {
    ...init,
    redirect: "manual",
    headers: {
      ...init.headers,
      cookie: session.cookie,
      origin: environment.requestOrigin,
      "user-agent": session.userAgent,
    },
  });
}

export async function signOut(
  environment: DocumentVerificationEnvironment,
  session: VerificationSession | null,
): Promise<void> {
  if (!session?.cookie) return;
  const response = await authenticatedFetch(
    environment,
    session,
    "api/auth/sign-out",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assert(response.status === 200, `Staging logout returned ${response.status}.`);
  session.cookie = "";
}

export async function uploadVerificationDocument(input: {
  environment: DocumentVerificationEnvironment;
  session: VerificationSession;
  projectId: string;
  file: File;
  displayName?: string;
  documentId?: string;
}): Promise<Response> {
  const form = new FormData();
  const bytes = await input.file.arrayBuffer();
  form.set(
    "file",
    new Blob([bytes], { type: input.file.type }),
    input.file.name,
  );
  if (!input.documentId && input.displayName) {
    form.set("displayName", input.displayName);
  }
  const suffix = input.documentId
    ? `/${encodeURIComponent(input.documentId)}/versions`
    : "";
  return authenticatedFetch(
    input.environment,
    input.session,
    `api/projects/${encodeURIComponent(input.projectId)}/documents${suffix}`,
    {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: form,
    },
  );
}

type CleanupCounts = {
  sessions: number;
  documents: number;
  versions: number;
  jobs: number;
  sections: number;
  chunks: number;
  objects: number;
  audits: number;
};

function zeroCleanupCounts(): CleanupCounts {
  return {
    sessions: 0,
    documents: 0,
    versions: 0,
    jobs: 0,
    sections: 0,
    chunks: 0,
    objects: 0,
    audits: 0,
  };
}

export async function cleanupDocumentVerification(input: {
  projectId: string;
  displayNamePrefix: string;
  userAgents: string[];
  userAgentPrefixes?: string[];
}): Promise<CleanupCounts> {
  const pool = getPool();
  const userAgentPatterns = (input.userAgentPrefixes ?? []).map(
    (prefix) => `${prefix}%`,
  );
  const documents = await pool.query<{ id: string }>(
    `select id
     from project_documents
     where project_id = $1 and display_name like $2
     order by id`,
    [input.projectId, `${input.displayNamePrefix}%`],
  );
  const documentIds = documents.rows.map((row) => row.id);
  const versions = documentIds.length
    ? await pool.query<{ id: string; object_key: string }>(
        `select id, object_key
         from project_document_versions
         where project_id = $1 and document_id = any($2::text[])
         order by id`,
        [input.projectId, documentIds],
      )
    : { rows: [] as Array<{ id: string; object_key: string }> };
  const jobs = documentIds.length
    ? await pool.query<{ id: string }>(
        `select id
         from document_ingestion_jobs
         where project_id = $1 and document_id = any($2::text[])
         order by id`,
        [input.projectId, documentIds],
      )
    : { rows: [] as Array<{ id: string }> };
  const versionIds = versions.rows.map((row) => row.id);
  const jobIds = jobs.rows.map((row) => row.id);

  if (documentIds.length) {
    await pool.query(
      `update document_ingestion_jobs
       set status = 'cancelled',
           completed_at = coalesce(completed_at, now()),
           leased_by = null,
           lease_expires_at = null,
           heartbeat_at = null,
           updated_at = now()
       where project_id = $1
         and document_id = any($2::text[])
         and status in ('pending', 'running')`,
      [input.projectId, documentIds],
    );
  }

  const storage = getObjectStorage();
  for (const version of versions.rows) {
    await storage.deleteObject(version.object_key);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    if (documentIds.length) {
      await client.query(
        `delete from audit_events
         where (user_agent = any($1::text[]) or user_agent like any($5::text[]))
            or entity_id = any($2::text[])
            or entity_id = any($3::text[])
            or entity_id = any($4::text[])
            or metadata->>'documentId' = any($2::text[])
            or metadata->>'versionId' = any($3::text[])
            or metadata->>'jobId' = any($4::text[])`,
        [
          input.userAgents,
          documentIds,
          versionIds,
          jobIds,
          userAgentPatterns,
        ],
      );
      await client.query(
        `delete from document_chunks
         where project_id = $1 and document_id = any($2::text[])`,
        [input.projectId, documentIds],
      );
      await client.query(
        `delete from document_sections
         where project_id = $1 and document_id = any($2::text[])`,
        [input.projectId, documentIds],
      );
      await client.query(
        `delete from document_ingestion_jobs
         where project_id = $1 and document_id = any($2::text[])`,
        [input.projectId, documentIds],
      );
      await client.query(
        `delete from project_document_versions
         where project_id = $1 and document_id = any($2::text[])`,
        [input.projectId, documentIds],
      );
      await client.query(
        `delete from project_documents
         where project_id = $1 and id = any($2::text[])`,
        [input.projectId, documentIds],
      );
    } else if (input.userAgents.length || userAgentPatterns.length) {
      await client.query(
        `delete from audit_events
         where user_agent = any($1::text[])
            or user_agent like any($2::text[])`,
        [input.userAgents, userAgentPatterns],
      );
    }
    if (input.userAgents.length || userAgentPatterns.length) {
      await client.query(
        `delete from sessions
         where user_agent = any($1::text[])
            or user_agent like any($2::text[])`,
        [input.userAgents, userAgentPatterns],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const remainingDocuments = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from project_documents
     where project_id = $1 and display_name like $2`,
    [input.projectId, `${input.displayNamePrefix}%`],
  );
  const remainingSessions =
    input.userAgents.length || userAgentPatterns.length
    ? await pool.query<{ count: string }>(
        `select count(*)::text as count
         from sessions
         where user_agent = any($1::text[])
            or user_agent like any($2::text[])`,
        [input.userAgents, userAgentPatterns],
      )
    : { rows: [{ count: "0" }] };
  const remainingAudits =
    input.userAgents.length || userAgentPatterns.length
    ? await pool.query<{ count: string }>(
        `select count(*)::text as count
         from audit_events
         where user_agent = any($1::text[])
            or user_agent like any($2::text[])`,
        [input.userAgents, userAgentPatterns],
      )
    : { rows: [{ count: "0" }] };
  const remainingObjects = (
    await storage.listObjects(`projects/${input.projectId}/`)
  ).filter((object) =>
    versions.rows.some((version) => version.object_key === object.key),
  ).length;
  const counts = zeroCleanupCounts();
  counts.sessions = Number(remainingSessions.rows[0]?.count ?? 0);
  counts.documents = Number(remainingDocuments.rows[0]?.count ?? 0);
  counts.objects = remainingObjects;
  counts.audits = Number(remainingAudits.rows[0]?.count ?? 0);
  if (documentIds.length) {
    const remaining = await pool.query<{
      versions: string;
      jobs: string;
      sections: string;
      chunks: string;
    }>(
      `select
         (select count(*) from project_document_versions where document_id = any($1::text[]))::text as versions,
         (select count(*) from document_ingestion_jobs where document_id = any($1::text[]))::text as jobs,
         (select count(*) from document_sections where document_id = any($1::text[]))::text as sections,
         (select count(*) from document_chunks where document_id = any($1::text[]))::text as chunks`,
      [documentIds],
    );
    counts.versions = Number(remaining.rows[0]?.versions ?? 0);
    counts.jobs = Number(remaining.rows[0]?.jobs ?? 0);
    counts.sections = Number(remaining.rows[0]?.sections ?? 0);
    counts.chunks = Number(remaining.rows[0]?.chunks ?? 0);
  }
  assert(
    Object.values(counts).every((value) => value === 0),
    "Staging document verification cleanup was incomplete.",
  );
  return counts;
}
