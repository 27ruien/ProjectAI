import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { POST as authPost } from "../../app/api/auth/[...all]/route";
import {
  GET as listDocumentsRoute,
  POST as createDocumentRoute,
} from "../../app/api/projects/[projectId]/documents/route";
import { GET as getDocumentRoute } from "../../app/api/projects/[projectId]/documents/[documentId]/route";
import { POST as archiveDocumentRoute } from "../../app/api/projects/[projectId]/documents/[documentId]/archive/route";
import { POST as restoreDocumentRoute } from "../../app/api/projects/[projectId]/documents/[documentId]/restore/route";
import {
  GET as listVersionsRoute,
  POST as createVersionRoute,
} from "../../app/api/projects/[projectId]/documents/[documentId]/versions/route";
import { POST as setCurrentVersionRoute } from "../../app/api/projects/[projectId]/documents/[documentId]/versions/[versionId]/current/route";
import { GET as downloadVersionRoute } from "../../app/api/projects/[projectId]/documents/[documentId]/versions/[versionId]/download/route";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  auditEvent,
  project,
  projectDocument,
  projectDocumentVersion,
  projectMember,
  rateLimit,
  session,
} from "../../lib/db/schema";
import { uploadDocument } from "../../lib/files/document-service";
import { FileOperationError } from "../../lib/files/errors";
import {
  getObjectStorage,
  type ObjectStorage,
  type StoredObjectMetadata,
} from "../../lib/files/object-storage";
import { verifyFileStorage } from "../../lib/files/reconciliation";
import {
  createInvalidOfficeFixture,
  createMarkdownFixture,
  createOfficeFixture,
  createPdfFixture,
  createSignatureMismatchFixture,
  createTextFixture,
  fileBytes,
  fileSha256,
} from "../helpers/file-fixtures";

type SeedUser = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

type ApiActor = {
  user: SeedUser;
  cookie: string;
};

type VersionDto = {
  id: string;
  documentId: string;
  versionNumber: number;
  isCurrent: boolean;
  originalFilename: string;
  extension: string;
  detectedMimeType: string;
  sizeBytes: number;
  storageStatus: string;
  failureCode: string | null;
};

type DocumentDto = {
  id: string;
  projectId: string;
  displayName: string;
  status: string;
  currentVersion: VersionDto | null;
};

type UploadResponse = {
  document: DocumentDto;
  version: VersionDto;
  replayed: boolean;
  uploadStatus: string;
};

type ErrorResponse = {
  error: { code: string; message: string };
};

const execFileAsync = promisify(execFile);
const TEST_USER_AGENT = "project-ai-file-storage-integration-test";
const PRIVATE_RESPONSE_KEYS = new Set([
  "objectKey",
  "uploadId",
  "declaredMimeType",
  "storageEtag",
  "sha256",
  "endpoint",
  "accessKeyId",
  "secretAccessKey",
]);

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for file integration tests.`);
  return value;
};

function trustedOrigin(): string {
  return new URL(required("BETTER_AUTH_URL")).origin;
}

function routeUrl(path: string): string {
  return new URL(path, `${trustedOrigin()}/`).toString();
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

function assertNoPrivateResponseFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoPrivateResponseFields(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(
      PRIVATE_RESPONSE_KEYS.has(key),
      false,
      `API response exposed private field ${key}`,
    );
    assertNoPrivateResponseFields(nested);
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function principal(currentUser: SeedUser): AuthenticatedPrincipal {
  return { sessionId: `file-test-session-${currentUser.id}`, user: currentUser };
}

function serviceHeaders(): Headers {
  return new Headers({
    "x-real-ip": "198.51.100.190",
    "user-agent": TEST_USER_AGENT,
  });
}

function actorHeaders(actor?: ApiActor): Headers {
  const headers = new Headers({
    origin: trustedOrigin(),
    "x-real-ip": "198.51.100.191",
    "user-agent": TEST_USER_AGENT,
  });
  if (actor) headers.set("cookie", actor.cookie);
  return headers;
}

async function signIn(
  email: string,
  password: string,
  ipAddress: string,
): Promise<string> {
  const authUrl = required("BETTER_AUTH_URL");
  const response = await authPost(
    new Request(`${authUrl}/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: trustedOrigin(),
        "x-real-ip": ipAddress,
        "user-agent": TEST_USER_AGENT,
      },
      body: JSON.stringify({ email, password, callbackURL: "/dashboard" }),
    }),
  );
  assert.equal(response.status, 200, `seed sign-in failed for ${email}`);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes("session_token="))
    ?.split(";", 1)[0];
  assert.ok(cookie, "sign-in must issue an HttpOnly session cookie");
  return cookie;
}

async function uploadViaRoute(input: {
  actor?: ApiActor;
  projectId: string;
  file: File;
  idempotencyKey?: string;
  displayName?: string;
}): Promise<Response> {
  const form = new FormData();
  form.set("file", input.file);
  if (input.displayName !== undefined) form.set("displayName", input.displayName);
  const headers = actorHeaders(input.actor);
  headers.set("idempotency-key", input.idempotencyKey ?? crypto.randomUUID());
  return createDocumentRoute(
    new Request(routeUrl(`/api/projects/${input.projectId}/documents`), {
      method: "POST",
      headers,
      body: form,
    }),
    { params: Promise.resolve({ projectId: input.projectId }) },
  );
}

async function uploadVersionViaRoute(input: {
  actor: ApiActor;
  projectId: string;
  documentId: string;
  file: File;
  idempotencyKey?: string;
}): Promise<Response> {
  const form = new FormData();
  form.set("file", input.file);
  const headers = actorHeaders(input.actor);
  headers.set("idempotency-key", input.idempotencyKey ?? crypto.randomUUID());
  return createVersionRoute(
    new Request(
      routeUrl(
        `/api/projects/${input.projectId}/documents/${input.documentId}/versions`,
      ),
      { method: "POST", headers, body: form },
    ),
    {
      params: Promise.resolve({
        projectId: input.projectId,
        documentId: input.documentId,
      }),
    },
  );
}

async function listDocuments(
  actor: ApiActor,
  projectId: string,
  status: "active" | "archived" = "active",
): Promise<Response> {
  return listDocumentsRoute(
    new Request(
      routeUrl(`/api/projects/${projectId}/documents?status=${status}`),
      { headers: actorHeaders(actor) },
    ),
    { params: Promise.resolve({ projectId }) },
  );
}

async function getDocument(
  actor: ApiActor,
  projectId: string,
  documentId: string,
): Promise<Response> {
  return getDocumentRoute(
    new Request(routeUrl(`/api/projects/${projectId}/documents/${documentId}`), {
      headers: actorHeaders(actor),
    }),
    { params: Promise.resolve({ projectId, documentId }) },
  );
}

async function listVersions(
  actor: ApiActor,
  projectId: string,
  documentId: string,
): Promise<Response> {
  return listVersionsRoute(
    new Request(
      routeUrl(`/api/projects/${projectId}/documents/${documentId}/versions`),
      { headers: actorHeaders(actor) },
    ),
    { params: Promise.resolve({ projectId, documentId }) },
  );
}

async function mutateDocumentStatus(
  action: "archive" | "restore",
  actor: ApiActor,
  projectId: string,
  documentId: string,
): Promise<Response> {
  const request = new Request(
    routeUrl(`/api/projects/${projectId}/documents/${documentId}/${action}`),
    {
      method: "POST",
      headers: new Headers({
        ...Object.fromEntries(actorHeaders(actor)),
        "content-type": "application/json",
      }),
      body: "{}",
    },
  );
  const context = { params: Promise.resolve({ projectId, documentId }) };
  return action === "archive"
    ? archiveDocumentRoute(request, context)
    : restoreDocumentRoute(request, context);
}

async function setCurrentVersion(
  actor: ApiActor,
  projectId: string,
  documentId: string,
  versionId: string,
): Promise<Response> {
  const headers = actorHeaders(actor);
  headers.set("content-type", "application/json");
  return setCurrentVersionRoute(
    new Request(
      routeUrl(
        `/api/projects/${projectId}/documents/${documentId}/versions/${versionId}/current`,
      ),
      { method: "POST", headers, body: "{}" },
    ),
    { params: Promise.resolve({ projectId, documentId, versionId }) },
  );
}

async function downloadVersion(
  actor: ApiActor,
  projectId: string,
  documentId: string,
  versionId: string,
): Promise<Response> {
  return downloadVersionRoute(
    new Request(
      routeUrl(
        `/api/projects/${projectId}/documents/${documentId}/versions/${versionId}/download`,
      ),
      { headers: actorHeaders(actor) },
    ),
    { params: Promise.resolve({ projectId, documentId, versionId }) },
  );
}

class PutFailureStorage implements ObjectStorage {
  constructor(
    private readonly delegate: ObjectStorage,
    private readonly failCompensation = false,
  ) {}

  async putObject(): Promise<StoredObjectMetadata> {
    throw new Error("injected object put failure");
  }

  getObject(key: string): ReturnType<ObjectStorage["getObject"]> {
    return this.delegate.getObject(key);
  }

  headObject(key: string): ReturnType<ObjectStorage["headObject"]> {
    return this.delegate.headObject(key);
  }

  async deleteObject(key: string): Promise<void> {
    if (this.failCompensation) throw new Error("injected compensation failure");
    await this.delegate.deleteObject(key);
  }

  listObjects(prefix: string): ReturnType<ObjectStorage["listObjects"]> {
    return this.delegate.listObjects(prefix);
  }
}

class InventoryFailureStorage implements ObjectStorage {
  constructor(private readonly delegate: ObjectStorage) {}

  putObject(input: Parameters<ObjectStorage["putObject"]>[0]) {
    return this.delegate.putObject(input);
  }

  getObject(key: string) {
    return this.delegate.getObject(key);
  }

  headObject(key: string) {
    return this.delegate.headObject(key);
  }

  deleteObject(key: string) {
    return this.delegate.deleteObject(key);
  }

  async listObjects(): Promise<never> {
    throw new Error("injected inventory failure with private provider details");
  }
}

class MissingShaMetadataStorage implements ObjectStorage {
  constructor(
    private readonly delegate: ObjectStorage,
    private readonly targetKey: string,
  ) {}

  putObject(input: Parameters<ObjectStorage["putObject"]>[0]) {
    return this.delegate.putObject(input);
  }

  getObject(key: string) {
    return this.delegate.getObject(key);
  }

  async headObject(key: string) {
    const metadata = await this.delegate.headObject(key);
    return metadata && key === this.targetKey
      ? { ...metadata, sha256: null }
      : metadata;
  }

  deleteObject(key: string) {
    return this.delegate.deleteObject(key);
  }

  listObjects(prefix: string) {
    return this.delegate.listObjects(prefix);
  }
}

let admin: ApiActor;
let managerA: ApiActor;
let managerB: ApiActor;
let memberA: ApiActor;
let viewerA: ApiActor;
let projectAId = "";
let projectBId = "";
let storage: ObjectStorage;

async function dropFinalizeFailureTrigger(): Promise<void> {
  await getDb().execute(
    sql.raw(`
      drop trigger if exists projectai_test_reject_file_finalize
      on project_document_versions;
      drop function if exists projectai_test_reject_file_finalize();
    `),
  );
}

async function deleteProjectObjects(projectId: string): Promise<void> {
  if (!projectId || !storage) return;
  const prefix = `projects/${projectId}/`;
  const objects = await storage.listObjects(prefix);
  await Promise.all(objects.map((entry) => storage.deleteObject(entry.key)));
  assert.equal((await storage.listObjects(prefix)).length, 0);
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(databaseUrl.pathname, /test|ci/i, "file tests require a test database");
  assert.ok(
    ["127.0.0.1", "localhost", "postgres", "db"].includes(databaseUrl.hostname),
    "file tests refuse remote PostgreSQL hosts",
  );
  assert.ok(
    process.env.NEXT_PUBLIC_APP_ENV === "test" ||
      process.env.NODE_ENV === "test" ||
      process.env.CI === "true",
    "file integration tests require an explicit test/CI runtime",
  );

  const authUrl = new URL(required("BETTER_AUTH_URL"));
  assert.ok(
    ["127.0.0.1", "localhost"].includes(authUrl.hostname),
    "file tests refuse remote authentication origins",
  );

  const storageEndpoint = new URL(required("OBJECT_STORAGE_ENDPOINT"));
  assert.equal(storageEndpoint.protocol, "http:", "file tests require local HTTP MinIO");
  assert.ok(
    ["127.0.0.1", "localhost", "minio", "projectai-minio"].includes(
      storageEndpoint.hostname,
    ),
    "file tests refuse remote object-storage hosts",
  );
  const bucket = required("OBJECT_STORAGE_BUCKET");
  assert.match(bucket, /test|ci/i, "file tests require an isolated test/CI bucket");
  const anonymous = await fetch(
    `${storageEndpoint.origin}/${encodeURIComponent(bucket)}?list-type=2`,
  );
  assert.equal(anonymous.status, 403, "test object-storage bucket must be private");
  storage = getObjectStorage();

  const users = await Promise.all([
    findUserByEmail(required("SEED_ADMIN_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
    findUserByEmail(required("SEED_MEMBER_A_EMAIL")),
    findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
  ]);
  for (const currentUser of users) assert.ok(currentUser, "seed user should exist");
  const [adminUser, managerAUser, managerBUser, memberAUser, viewerAUser] =
    users as [SeedUser, SeedUser, SeedUser, SeedUser, SeedUser];
  await getDb().delete(session).where(
    inArray(session.userId, users.map((currentUser) => currentUser!.id)),
  );
  await getDb().delete(rateLimit);

  admin = {
    user: adminUser,
    cookie: await signIn(
      required("SEED_ADMIN_EMAIL"),
      required("SEED_ADMIN_PASSWORD"),
      "198.51.100.180",
    ),
  };
  managerA = {
    user: managerAUser,
    cookie: await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      required("SEED_MANAGER_A_PASSWORD"),
      "198.51.100.181",
    ),
  };
  managerB = {
    user: managerBUser,
    cookie: await signIn(
      required("SEED_MANAGER_B_EMAIL"),
      required("SEED_MANAGER_B_PASSWORD"),
      "198.51.100.182",
    ),
  };
  memberA = {
    user: memberAUser,
    cookie: await signIn(
      required("SEED_MEMBER_A_EMAIL"),
      required("SEED_MEMBER_A_PASSWORD"),
      "198.51.100.183",
    ),
  };
  viewerA = {
    user: viewerAUser,
    cookie: await signIn(
      required("SEED_VIEWER_A_EMAIL"),
      required("SEED_VIEWER_A_PASSWORD"),
      "198.51.100.184",
    ),
  };

  projectAId = `project-files-test-${crypto.randomUUID()}`;
  projectBId = `project-files-cross-${crypto.randomUUID()}`;
  await getDb().transaction(async (tx) => {
    await tx.insert(project).values([
      {
        id: projectAId,
        name: "虚构文件能力测试项目 A",
        clientName: "虚构测试客户 A",
        description: "仅用于自动化测试，不包含真实客户数据",
        createdBy: admin.user.id,
      },
      {
        id: projectBId,
        name: "虚构文件隔离测试项目 B",
        clientName: "虚构测试客户 B",
        description: "仅用于跨项目隔离自动化测试",
        createdBy: admin.user.id,
      },
    ]);
    await tx.insert(projectMember).values([
      {
        id: `file-membership-${crypto.randomUUID()}`,
        projectId: projectAId,
        userId: managerA.user.id,
        role: "project_manager",
        createdBy: admin.user.id,
      },
      {
        id: `file-membership-${crypto.randomUUID()}`,
        projectId: projectAId,
        userId: memberA.user.id,
        role: "project_member",
        createdBy: admin.user.id,
      },
      {
        id: `file-membership-${crypto.randomUUID()}`,
        projectId: projectAId,
        userId: viewerA.user.id,
        role: "viewer",
        createdBy: admin.user.id,
      },
      {
        id: `file-membership-${crypto.randomUUID()}`,
        projectId: projectBId,
        userId: managerB.user.id,
        role: "project_manager",
        createdBy: admin.user.id,
      },
    ]);
  });
});

after(async () => {
  try {
    await dropFinalizeFailureTrigger().catch(() => undefined);
    await Promise.all(
      [projectAId, projectBId].filter(Boolean).map(deleteProjectObjects),
    );
    const projectIds = [projectAId, projectBId].filter(Boolean);
    if (projectIds.length > 0) {
      await getDb().delete(auditEvent).where(inArray(auditEvent.projectId, projectIds));
      await getDb()
        .delete(projectDocumentVersion)
        .where(inArray(projectDocumentVersion.projectId, projectIds));
      await getDb()
        .delete(projectDocument)
        .where(inArray(projectDocument.projectId, projectIds));
      await getDb()
        .delete(projectMember)
        .where(inArray(projectMember.projectId, projectIds));
      await getDb().delete(project).where(inArray(project.id, projectIds));
    }
    const users = [admin, managerA, managerB, memberA, viewerA]
      .filter(Boolean)
      .map((actor) => actor.user.id);
    if (users.length > 0) {
      await getDb().delete(session).where(inArray(session.userId, users));
    }
    await getDb().delete(rateLimit);
  } finally {
    await closeDatabasePool();
  }
});

describe("Project Files real PostgreSQL and MinIO integration", () => {
  it("enforces authentication, upload roles, admin bypass, and project isolation", async () => {
    const managerResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createPdfFixture("经理上传.pdf"),
      displayName: "经理上传的虚构资料",
    });
    assert.equal(managerResponse.status, 201);
    const managerPayload = await responseJson<UploadResponse>(managerResponse);
    assert.equal(managerPayload.version.storageStatus, "stored");
    assert.equal(managerPayload.document.projectId, projectAId);
    assertNoPrivateResponseFields(managerPayload);

    const memberResponse = await uploadViaRoute({
      actor: memberA,
      projectId: projectAId,
      file: createTextFixture("成员上传.txt"),
    });
    assert.equal(memberResponse.status, 201);

    const adminResponse = await uploadViaRoute({
      actor: admin,
      projectId: projectAId,
      file: createMarkdownFixture("管理员上传.md"),
    });
    assert.equal(adminResponse.status, 201);

    const viewerResponse = await uploadViaRoute({
      actor: viewerA,
      projectId: projectAId,
      file: createTextFixture("viewer-denied.txt"),
    });
    assert.equal(viewerResponse.status, 403);
    assert.equal((await responseJson<ErrorResponse>(viewerResponse)).error.code, "FORBIDDEN");

    const anonymousResponse = await uploadViaRoute({
      projectId: projectAId,
      file: createTextFixture("anonymous-denied.txt"),
    });
    assert.equal(anonymousResponse.status, 401);
    assert.equal(
      (await responseJson<ErrorResponse>(anonymousResponse)).error.code,
      "UNAUTHENTICATED",
    );

    const crossProjectResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectBId,
      file: createTextFixture("cross-project-denied.txt"),
    });
    assert.equal(crossProjectResponse.status, 404);
    assert.equal(
      (await responseJson<ErrorResponse>(crossProjectResponse)).error.code,
      "NOT_FOUND",
    );
  });

  it("stores every supported format in real MinIO with validated metadata", async () => {
    const fixtures = [
      createOfficeFixture("docx"),
      createOfficeFixture("xlsx"),
      createOfficeFixture("pptx"),
      createMarkdownFixture(),
    ];
    for (const file of fixtures) {
      const response = await uploadViaRoute({
        actor: managerA,
        projectId: projectAId,
        file,
      });
      assert.equal(response.status, 201, `${file.name} should upload`);
      const payload = await responseJson<UploadResponse>(response);
      const [record] = await getDb()
        .select()
        .from(projectDocumentVersion)
        .where(eq(projectDocumentVersion.id, payload.version.id));
      assert.ok(record);
      assert.equal(record.storageStatus, "stored");
      assert.equal(record.sizeBytes, file.size);
      assert.equal(record.sha256, await fileSha256(file));
      const object = await storage.headObject(record.objectKey);
      assert.ok(object, "real MinIO object should exist");
      assert.equal(object.size, file.size);
      assert.equal(object.sha256, record.sha256);
      assertNoPrivateResponseFields(payload);
    }
  });

  it("rejects oversize, unsupported, signature-mismatched, and invalid OOXML files", async () => {
    const beforeRows = await getDb()
      .select({ id: projectDocumentVersion.id })
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.projectId, projectAId));
    const previousMax = process.env.MAX_UPLOAD_BYTES;
    try {
      process.env.MAX_UPLOAD_BYTES = "1024";
      const cases: Array<{ file: File; status: number; code: string }> = [
        {
          file: new File(["x".repeat(1025)], "too-large.txt", { type: "text/plain" }),
          status: 413,
          code: "FILE_TOO_LARGE",
        },
        {
          file: new File(["fictional"], "unsupported.exe", {
            type: "application/octet-stream",
          }),
          status: 415,
          code: "UNSUPPORTED_FILE_TYPE",
        },
        { file: createSignatureMismatchFixture(), status: 415, code: "FILE_SIGNATURE_MISMATCH" },
        { file: createInvalidOfficeFixture(), status: 415, code: "INVALID_OFFICE_CONTAINER" },
      ];
      for (const testCase of cases) {
        const response = await uploadViaRoute({
          actor: managerA,
          projectId: projectAId,
          file: testCase.file,
        });
        assert.equal(response.status, testCase.status);
        assert.equal(
          (await responseJson<ErrorResponse>(response)).error.code,
          testCase.code,
        );
      }
    } finally {
      if (previousMax === undefined) delete process.env.MAX_UPLOAD_BYTES;
      else process.env.MAX_UPLOAD_BYTES = previousMax;
    }
    const afterRows = await getDb()
      .select({ id: projectDocumentVersion.id })
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.projectId, projectAId));
    assert.equal(afterRows.length, beforeRows.length, "validation failures reserve no version");
  });

  it("audits a rejected new-version upload against its logical document", async () => {
    const createdResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createPdfFixture("新版本拒绝审计.pdf"),
    });
    const created = await responseJson<UploadResponse>(createdResponse);

    const rejected = await uploadVersionViaRoute({
      actor: managerA,
      projectId: projectAId,
      documentId: created.document.id,
      file: createSignatureMismatchFixture(),
    });
    assert.equal(rejected.status, 415);
    assert.equal(
      (await responseJson<ErrorResponse>(rejected)).error.code,
      "FILE_SIGNATURE_MISMATCH",
    );

    const events = await getDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.projectId, projectAId),
          eq(auditEvent.entityId, created.document.id),
          eq(auditEvent.eventType, "document_upload_failed"),
        ),
      );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.entityType, "project_document");
    assert.equal(events[0]?.result, "failed");
    assert.deepEqual(events[0]?.metadata, {
      failureCode: "FILE_SIGNATURE_MISMATCH",
    });
  });

  it("sanitizes traversal filenames and never derives object keys from user input", async () => {
    const response = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createTextFixture("../../虚构路径资料.txt"),
    });
    assert.equal(response.status, 201);
    const payload = await responseJson<UploadResponse>(response);
    assert.equal(payload.version.originalFilename.includes("/"), false);
    assert.equal(payload.version.originalFilename.includes("\\"), false);
    const [record] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.id, payload.version.id));
    assert.ok(record);
    assert.equal(record.objectKey.includes("虚构路径资料"), false);
    assert.match(
      record.objectKey,
      new RegExp(
        `^projects/${projectAId}/documents/${payload.document.id}/versions/${payload.version.id}/[0-9a-f-]{36}$`,
      ),
    );
    assertNoPrivateResponseFields(payload);
  });

  it("makes sequential and concurrent idempotent uploads converge on one version and object", async () => {
    const sequentialKey = crypto.randomUUID();
    const sequentialFile = createTextFixture("幂等顺序.txt", "stable-sequential-content");
    const firstResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: sequentialFile,
      idempotencyKey: sequentialKey,
    });
    const replayResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: sequentialFile,
      idempotencyKey: sequentialKey,
    });
    assert.equal(firstResponse.status, 201);
    assert.equal(replayResponse.status, 200);
    const first = await responseJson<UploadResponse>(firstResponse);
    const replay = await responseJson<UploadResponse>(replayResponse);
    assert.equal(replay.replayed, true);
    assert.equal(replay.document.id, first.document.id);
    assert.equal(replay.version.id, first.version.id);

    const conflictingReplay = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createTextFixture("幂等顺序.txt", "different-content-must-conflict"),
      idempotencyKey: sequentialKey,
    });
    assert.equal(conflictingReplay.status, 409);
    assert.equal(
      (await responseJson<{ error: { code: string } }>(conflictingReplay)).error.code,
      "UPLOAD_ALREADY_EXISTS",
    );

    const concurrentKey = crypto.randomUUID();
    const concurrentFile = createPdfFixture("幂等并发.pdf", "stable-concurrent-content");
    const responses = await Promise.all([
      uploadViaRoute({
        actor: memberA,
        projectId: projectAId,
        file: concurrentFile,
        idempotencyKey: concurrentKey,
      }),
      uploadViaRoute({
        actor: memberA,
        projectId: projectAId,
        file: concurrentFile,
        idempotencyKey: concurrentKey,
      }),
    ]);
    assert.equal(responses.some((response) => response.status === 201), true);
    assert.equal(
      responses.every((response) => [200, 201, 202].includes(response.status)),
      true,
    );
    const payloads = await Promise.all(
      responses.map((response) => responseJson<UploadResponse>(response)),
    );
    assert.equal(new Set(payloads.map((payload) => payload.document.id)).size, 1);
    assert.equal(new Set(payloads.map((payload) => payload.version.id)).size, 1);

    for (const payload of [first, ...payloads]) {
      const rows = await getDb()
        .select()
        .from(projectDocumentVersion)
        .where(eq(projectDocumentVersion.documentId, payload.document.id));
      assert.equal(rows.length, 1);
      assert.equal(
        (await storage.listObjects(`projects/${projectAId}/documents/${payload.document.id}/`))
          .length,
        1,
      );
    }
  });

  it("marks object failures, quarantines failed compensation, and retries the same reservation", async () => {
    const key = crypto.randomUUID();
    const file = createTextFixture("可重试失败.txt", "retry-identical-content");
    await assert.rejects(
      uploadDocument({
        principal: principal(managerA.user),
        projectId: projectAId,
        requestHeaders: serviceHeaders(),
        idempotencyKey: key,
        file,
        displayName: "可重试失败",
        storage: new PutFailureStorage(storage),
      }),
      (error: unknown) =>
        error instanceof FileOperationError &&
        error.status === 503 &&
        error.code === "UPLOAD_FAILED",
    );
    const [failed] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(
        and(
          eq(projectDocumentVersion.projectId, projectAId),
          eq(projectDocumentVersion.originalFilename, file.name),
        ),
      );
    assert.ok(failed);
    assert.equal(failed.storageStatus, "failed");
    assert.equal(await storage.headObject(failed.objectKey), null);

    const retried = await uploadDocument({
      principal: principal(managerA.user),
      projectId: projectAId,
      requestHeaders: serviceHeaders(),
      idempotencyKey: key,
      file,
      displayName: "可重试失败",
      storage,
    });
    assert.equal(retried.replayed, false);
    assert.equal(retried.version.id, failed.id);
    assert.equal(retried.version.storageStatus, "stored");
    assert.ok(await storage.headObject(failed.objectKey));

    const quarantineFile = createTextFixture("补偿失败.txt");
    await assert.rejects(
      uploadDocument({
        principal: principal(managerA.user),
        projectId: projectAId,
        requestHeaders: serviceHeaders(),
        idempotencyKey: crypto.randomUUID(),
        file: quarantineFile,
        displayName: null,
        storage: new PutFailureStorage(storage, true),
      }),
      (error: unknown) => error instanceof FileOperationError && error.status === 503,
    );
    const [quarantined] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.originalFilename, quarantineFile.name));
    assert.ok(quarantined);
    assert.equal(quarantined.storageStatus, "quarantined");
    assert.equal(quarantined.failureCode, "OBJECT_PUT_COMPENSATION_FAILED");
  });

  it("compensates a real MinIO object when PostgreSQL finalization fails", async () => {
    const triggerFilename = "db-finalize-trigger.txt";
    await dropFinalizeFailureTrigger();
    await getDb().execute(
      sql.raw(`
        create function projectai_test_reject_file_finalize()
        returns trigger language plpgsql as $$
        begin
          if new.project_id = '${projectAId}'
             and new.original_filename = '${triggerFilename}'
             and new.storage_status = 'stored' then
            raise exception 'injected file finalization failure';
          end if;
          return new;
        end;
        $$;
        create trigger projectai_test_reject_file_finalize
          before update of storage_status on project_document_versions
          for each row execute function projectai_test_reject_file_finalize();
      `),
    );
    try {
      await assert.rejects(
        uploadDocument({
          principal: principal(managerA.user),
          projectId: projectAId,
          requestHeaders: serviceHeaders(),
          idempotencyKey: crypto.randomUUID(),
          file: createTextFixture(triggerFilename),
          displayName: "数据库确认失败补偿",
          storage,
        }),
        (error: unknown) =>
          error instanceof FileOperationError &&
          error.status === 503 &&
          error.code === "UPLOAD_FAILED",
      );
    } finally {
      await dropFinalizeFailureTrigger();
    }
    const [failed] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.originalFilename, triggerFilename));
    assert.ok(failed);
    assert.equal(failed.storageStatus, "failed");
    assert.equal(failed.failureCode, "FINALIZE_FAILED");
    assert.equal(await storage.headObject(failed.objectKey), null);
  });

  it("preserves version history and resolves concurrent uploads and current switches", async () => {
    const v1Response = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createMarkdownFixture("并发版本.md", "v1"),
    });
    const v1 = await responseJson<UploadResponse>(v1Response);
    const concurrentResponses = await Promise.all([
      uploadVersionViaRoute({
        actor: managerA,
        projectId: projectAId,
        documentId: v1.document.id,
        file: createMarkdownFixture("并发版本.md", "v2"),
      }),
      uploadVersionViaRoute({
        actor: memberA,
        projectId: projectAId,
        documentId: v1.document.id,
        file: createMarkdownFixture("并发版本.md", "v3"),
      }),
    ]);
    assert.equal(concurrentResponses.every((response) => response.status === 201), true);
    const versionRows = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.documentId, v1.document.id));
    assert.deepEqual(
      versionRows.map((row) => row.versionNumber).sort((left, right) => left - right),
      [1, 2, 3],
    );
    assert.equal(new Set(versionRows.map((row) => row.objectKey)).size, 3);
    assert.equal(versionRows.filter((row) => row.isCurrent).length, 1);
    assert.equal(
      versionRows.find((row) => row.isCurrent)?.versionNumber,
      Math.max(...versionRows.map((row) => row.versionNumber)),
    );

    const switches = await Promise.all([
      setCurrentVersion(managerA, projectAId, v1.document.id, versionRows[0]!.id),
      setCurrentVersion(managerA, projectAId, v1.document.id, versionRows[1]!.id),
    ]);
    assert.equal(switches.every((response) => response.status === 200), true);
    const afterSwitch = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.documentId, v1.document.id));
    assert.equal(afterSwitch.filter((row) => row.isCurrent).length, 1);

    const historyResponse = await listVersions(managerA, projectAId, v1.document.id);
    assert.equal(historyResponse.status, 200);
    const history = await responseJson<{ document: DocumentDto; versions: VersionDto[] }>(
      historyResponse,
    );
    assert.deepEqual(
      history.versions.map((version) => version.versionNumber),
      [3, 2, 1],
    );
    assert.equal(history.versions.filter((version) => version.isCurrent).length, 1);
    assertNoPrivateResponseFields(history);
  });

  it("rejects failed versions as current and hides cross-project document/version IDs", async () => {
    const aResponse = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createTextFixture("项目A版本.txt"),
    });
    const a = await responseJson<UploadResponse>(aResponse);
    const failedFile = createTextFixture("项目A失败版本.txt");
    await assert.rejects(
      uploadDocument({
        principal: principal(managerA.user),
        projectId: projectAId,
        documentId: a.document.id,
        requestHeaders: serviceHeaders(),
        idempotencyKey: crypto.randomUUID(),
        file: failedFile,
        displayName: null,
        storage: new PutFailureStorage(storage),
      }),
      (error: unknown) => error instanceof FileOperationError && error.status === 503,
    );
    const [failedVersion] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(
        and(
          eq(projectDocumentVersion.documentId, a.document.id),
          eq(projectDocumentVersion.originalFilename, failedFile.name),
        ),
      );
    assert.ok(failedVersion);
    const failedCurrent = await setCurrentVersion(
      managerA,
      projectAId,
      a.document.id,
      failedVersion.id,
    );
    assert.equal(failedCurrent.status, 409);
    assert.equal(
      (await responseJson<ErrorResponse>(failedCurrent)).error.code,
      "VERSION_NOT_AVAILABLE",
    );

    const bResponse = await uploadViaRoute({
      actor: managerB,
      projectId: projectBId,
      file: createTextFixture("项目B隔离.txt"),
    });
    const b = await responseJson<UploadResponse>(bResponse);
    assert.equal(bResponse.status, 201);

    const inaccessibleProject = await getDocument(managerA, projectBId, b.document.id);
    assert.equal(inaccessibleProject.status, 404);
    assert.equal(
      (await responseJson<ErrorResponse>(inaccessibleProject)).error.code,
      "NOT_FOUND",
    );
    const mixedDocument = await getDocument(managerA, projectAId, b.document.id);
    assert.equal(mixedDocument.status, 404);
    assert.equal(
      (await responseJson<ErrorResponse>(mixedDocument)).error.code,
      "DOCUMENT_NOT_FOUND",
    );
    const mixedVersion = await downloadVersion(
      managerA,
      projectAId,
      a.document.id,
      b.version.id,
    );
    assert.equal(mixedVersion.status, 404);
    assert.equal(
      (await responseJson<ErrorResponse>(mixedVersion)).error.code,
      "VERSION_NOT_FOUND",
    );
  });

  it("downloads exact bytes for viewers with safe headers and no internal metadata", async () => {
    const file = createPdfFixture("中文 虚构下载.pdf", "download-integrity-marker");
    const uploadResponse = await uploadViaRoute({
      actor: memberA,
      projectId: projectAId,
      file,
    });
    const payload = await responseJson<UploadResponse>(uploadResponse);
    const response = await downloadVersion(
      viewerA,
      projectAId,
      payload.document.id,
      payload.version.id,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("content-length"), String(file.size));
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.match(response.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const downloaded = new File([await response.arrayBuffer()], "downloaded.pdf");
    assert.equal(await fileSha256(downloaded), await fileSha256(file));

    const detailResponse = await getDocument(
      viewerA,
      projectAId,
      payload.document.id,
    );
    assert.equal(detailResponse.status, 200);
    assertNoPrivateResponseFields(await responseJson<unknown>(detailResponse));
  });

  it("restricts archive/restore to managers while retaining viewer download and objects", async () => {
    const response = await uploadViaRoute({
      actor: memberA,
      projectId: projectAId,
      file: createTextFixture("归档保留.txt"),
    });
    const payload = await responseJson<UploadResponse>(response);
    const [record] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.id, payload.version.id));
    assert.ok(record);

    for (const actor of [memberA, viewerA]) {
      const denied = await mutateDocumentStatus(
        "archive",
        actor,
        projectAId,
        payload.document.id,
      );
      assert.equal(denied.status, 403);
    }
    const archived = await mutateDocumentStatus(
      "archive",
      managerA,
      projectAId,
      payload.document.id,
    );
    assert.equal(archived.status, 200);
    assert.equal(
      (await responseJson<{ document: DocumentDto }>(archived)).document.status,
      "archived",
    );
    const activeList = await responseJson<{ documents: DocumentDto[] }>(
      await listDocuments(viewerA, projectAId, "active"),
    );
    const archivedList = await responseJson<{ documents: DocumentDto[] }>(
      await listDocuments(viewerA, projectAId, "archived"),
    );
    assert.equal(activeList.documents.some((item) => item.id === payload.document.id), false);
    assert.equal(archivedList.documents.some((item) => item.id === payload.document.id), true);
    assert.ok(await storage.headObject(record.objectKey), "archive must retain object");
    assert.equal(
      (
        await downloadVersion(
          viewerA,
          projectAId,
          payload.document.id,
          payload.version.id,
        )
      ).status,
      200,
    );
    const restored = await mutateDocumentStatus(
      "restore",
      managerA,
      projectAId,
      payload.document.id,
    );
    assert.equal(restored.status, 200);
    assert.equal(
      (await responseJson<{ document: DocumentDto }>(restored)).document.status,
      "active",
    );
  });

  it("detects a missing object, fails download safely, and restores consistency", async () => {
    const file = createTextFixture("缺失对象检测.txt", "missing-object-marker");
    const response = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file,
    });
    const payload = await responseJson<UploadResponse>(response);
    const [record] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.id, payload.version.id));
    assert.ok(record);
    await storage.deleteObject(record.objectKey);
    try {
      const unavailable = await downloadVersion(
        viewerA,
        projectAId,
        payload.document.id,
        payload.version.id,
      );
      assert.equal(unavailable.status, 503);
      assert.equal(
        (await responseJson<ErrorResponse>(unavailable)).error.code,
        "STORAGE_UNAVAILABLE",
      );
      const verification = await verifyFileStorage({ storage });
      assert.equal(
        verification.findings.some(
          (finding) =>
            finding.kind === "missing_object" &&
            finding.projectId === projectAId &&
            finding.versionId === payload.version.id,
        ),
        true,
      );
    } finally {
      const bytes = await fileBytes(file);
      const restored = await storage.putObject({
        key: record.objectKey,
        body: bytes,
        contentType: record.detectedMimeType,
        sha256: record.sha256,
      });
      assert.equal(restored.etag, record.storageEtag);
    }
  });

  it("reports real orphan objects and keeps reconciliation dry-run non-destructive", async () => {
    const orphanKey = `projects/${projectAId}/orphan-test/${crypto.randomUUID()}`;
    const orphanFile = createTextFixture("孤儿对象.txt", "orphan-object-marker");
    await storage.putObject({
      key: orphanKey,
      body: await fileBytes(orphanFile),
      contentType: orphanFile.type,
      sha256: await fileSha256(orphanFile),
    });
    try {
      const verification = await verifyFileStorage({ storage });
      assert.equal(
        verification.findings.some(
          (finding) =>
            finding.kind === "orphan_object" && finding.objectKey === orphanKey,
        ),
        true,
      );
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--import", "tsx", "scripts/reconcile-file-storage.ts"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            ALLOW_STORAGE_RECONCILE_APPLY: "",
            OBJECT_STORAGE_BUCKET_CONFIRM: "",
          },
        },
      );
      assert.match(stdout, /"mode":"dry-run"/);
      assert.match(stdout, /Dry run only\. No objects were deleted\./);
      assert.equal(stdout.includes(orphanKey), false, "dry-run output must not expose object keys");
      assert.ok(await storage.headObject(orphanKey), "dry-run must retain orphan object");
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["--import", "tsx", "scripts/reconcile-file-storage.ts", "--apply"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NEXT_PUBLIC_APP_ENV: "Production",
              ALLOW_STORAGE_RECONCILE_APPLY: "1",
              OBJECT_STORAGE_BUCKET_CONFIRM: required("OBJECT_STORAGE_BUCKET"),
              RECONCILE_ORPHAN_MIN_AGE_SECONDS: "300",
            },
          },
        ),
        (error: unknown) => {
          const stderr =
            typeof error === "object" && error && "stderr" in error
              ? String(error.stderr)
              : "";
          assert.match(stderr, /Apply requires a non-production environment/);
          return true;
        },
      );
      assert.ok(
        await storage.headObject(orphanKey),
        "Production apply guard must retain orphan object",
      );
    } finally {
      await storage.deleteObject(orphanKey);
    }
  });

  it("fails verification when stored object SHA-256 metadata is missing", async () => {
    const response = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createTextFixture("对象校验元数据.txt", "sha-metadata-required"),
    });
    const payload = await responseJson<UploadResponse>(response);
    const [record] = await getDb()
      .select()
      .from(projectDocumentVersion)
      .where(eq(projectDocumentVersion.id, payload.version.id));
    assert.ok(record);

    const verification = await verifyFileStorage({
      storage: new MissingShaMetadataStorage(storage, record.objectKey),
    });
    assert.equal(verification.ok, false);
    assert.equal(
      verification.findings.some(
        (finding) =>
          finding.kind === "sha256_metadata_mismatch" &&
          finding.versionId === payload.version.id,
      ),
      true,
    );
  });

  it("fails closed with a provider-neutral error when object inventory is unavailable", async () => {
    await assert.rejects(
      verifyFileStorage({ storage: new InventoryFailureStorage(storage) }),
      (error: unknown) => {
        assert.equal(
          error instanceof Error ? error.message : "",
          "Object storage inventory is unavailable.",
        );
        return true;
      },
    );
  });

  it("enforces partial-current uniqueness and composite project/document foreign keys", async () => {
    const response = await uploadViaRoute({
      actor: managerA,
      projectId: projectAId,
      file: createTextFixture("数据库约束.txt"),
    });
    const payload = await responseJson<UploadResponse>(response);
    const base = {
      documentId: payload.document.id,
      originalFilename: "constraint.txt",
      normalizedExtension: "txt",
      declaredMimeType: "text/plain",
      detectedMimeType: "text/plain",
      sizeBytes: 1,
      sha256: "a".repeat(64),
      uploadedBy: managerA.user.id,
    } as const;

    await assert.rejects(
      getDb().insert(projectDocumentVersion).values({
        ...base,
        id: crypto.randomUUID(),
        projectId: projectAId,
        versionNumber: 1000,
        isCurrent: true,
        uploadId: crypto.randomUUID(),
        objectKey: `projects/${projectAId}/constraint/${crypto.randomUUID()}`,
        storageStatus: "stored",
        storageEtag: "constraint-etag",
        storedAt: new Date(),
      }),
      (error: unknown) => postgresErrorCode(error) === "23505",
    );

    await assert.rejects(
      getDb().insert(projectDocumentVersion).values({
        ...base,
        id: crypto.randomUUID(),
        projectId: projectBId,
        versionNumber: 1001,
        uploadId: crypto.randomUUID(),
        objectKey: `projects/${projectBId}/constraint/${crypto.randomUUID()}`,
        storageStatus: "failed",
        failureCode: "UPLOAD_FAILED",
      }),
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("records reviewable audits without object keys, endpoints, credentials, or sessions", async () => {
    const events = await getDb()
      .select()
      .from(auditEvent)
      .where(inArray(auditEvent.projectId, [projectAId, projectBId]));
    const eventTypes = new Set(events.map((event) => event.eventType));
    for (const expected of [
      "document_upload_started",
      "document_created",
      "document_version_stored",
      "document_upload_failed",
      "document_downloaded",
      "document_archived",
      "document_restored",
      "document_current_version_changed",
    ]) {
      assert.equal(eventTypes.has(expected), true, `missing audit event ${expected}`);
    }
    for (const event of events) {
      const serialized = JSON.stringify(event.metadata);
      assert.doesNotMatch(
        serialized,
        /object[_-]?key|storage[_-]?etag|endpoint|access[_-]?key|secret|password|session[_-]?token/i,
      );
      assert.equal(serialized.includes(required("OBJECT_STORAGE_SECRET_KEY")), false);
      assert.equal(serialized.includes(managerA.cookie), false);
    }
  });
});
