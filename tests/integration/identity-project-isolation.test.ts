import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { promisify } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  account,
  auditEvent,
  project,
  projectMember,
  rateLimit,
  session,
  user,
  type ProjectRole,
} from "../../lib/db/schema";
import {
  findAuthorizedProject,
  listAuthorizedProjects,
} from "../../lib/db/repositories/project-repository";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  requireProjectAccess,
  requireProjectRole,
} from "../../lib/auth/authorization";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
} from "../../lib/auth/session";
import { GET as getProjects, POST as createProject } from "../../app/api/projects/route";
import {
  GET as getProject,
  PATCH as patchProject,
} from "../../app/api/projects/[projectId]/route";
import { POST as addProjectMemberRoute } from "../../app/api/projects/[projectId]/members/route";
import {
  DELETE as deleteProjectMemberRoute,
  PATCH as patchProjectMemberRoute,
} from "../../app/api/projects/[projectId]/members/[memberId]/route";
import {
  GET as authGet,
  POST as authPost,
} from "../../app/api/auth/[...all]/route";
import { GET as getHealth } from "../../app/api/health/route";
import { sanitizeAuditMetadata } from "../../lib/db/repositories/audit-repository";

type SeedUser = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;
const execFileAsync = promisify(execFile);

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for integration tests.`);
  return value;
};

function trustedAuthOrigin(): string {
  return new URL(required("BETTER_AUTH_URL")).origin;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

function invalidPassword(): string {
  return `Not-A-Credential-${crypto.randomUUID()}!Aa1`;
}

let admin: SeedUser;
let managerA: SeedUser;
let managerB: SeedUser;
let viewerA: SeedUser;

function principal(currentUser: SeedUser): AuthenticatedPrincipal {
  return { sessionId: `test-session-${currentUser.id}`, user: currentUser };
}

async function signIn(
  email: string,
  password: string,
  ipAddress: string,
): Promise<{ cookie: string; response: Response }> {
  const authUrl = required("BETTER_AUTH_URL");
  const origin = trustedAuthOrigin();
  const response = await authPost(
    new Request(`${authUrl}/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": ipAddress,
        "user-agent": "project-ai-integration-test",
      },
      body: JSON.stringify({ email, password, callbackURL: "/dashboard" }),
    }),
  );
  const setCookies = response.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) => value.includes("session_token="));
  return {
    response,
    cookie: sessionCookie?.split(";", 1)[0] ?? "",
  };
}

async function patchMemberRole(
  cookie: string,
  projectId: string,
  memberId: string,
  role: ProjectRole,
): Promise<Response> {
  return patchProjectMemberRoute(
    new Request(
      `http://local.test/api/projects/${projectId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: trustedAuthOrigin(),
          "x-real-ip": "198.51.100.31",
          "user-agent": "project-ai-manager-invariant-test",
        },
        body: JSON.stringify({ role }),
      },
    ),
    { params: Promise.resolve({ projectId, memberId }) },
  );
}

async function deleteMember(
  cookie: string,
  projectId: string,
  memberId: string,
): Promise<Response> {
  return deleteProjectMemberRoute(
    new Request(
      `http://local.test/api/projects/${projectId}/members/${memberId}`,
      {
        method: "DELETE",
        headers: {
          cookie,
          origin: trustedAuthOrigin(),
          "x-real-ip": "198.51.100.32",
          "user-agent": "project-ai-manager-invariant-test",
        },
      },
    ),
    { params: Promise.resolve({ projectId, memberId }) },
  );
}

async function createInvariantTestProject(
  members: Array<{ currentUser: SeedUser; role: ProjectRole }>,
): Promise<{
  projectId: string;
  memberships: Map<string, string>;
}> {
  const projectId = `project-invariant-${crypto.randomUUID()}`;
  const memberships = new Map<string, string>();
  await getDb().transaction(async (tx) => {
    await tx.insert(project).values({
      id: projectId,
      name: "项目经理约束并发测试",
      clientName: "测试客户",
      description: "仅用于验证项目至少保留一名项目经理",
      createdBy: admin.id,
    });
    for (const { currentUser, role } of members) {
      const memberId = `membership-${crypto.randomUUID()}`;
      await tx.insert(projectMember).values({
        id: memberId,
        projectId,
        userId: currentUser.id,
        role,
        createdBy: admin.id,
      });
      memberships.set(currentUser.id, memberId);
    }
  });
  return { projectId, memberships };
}

async function projectManagerCount(projectId: string): Promise<number> {
  const result = await getDb().execute<{ count: string }>(sql`
    select count(*)::text as count
    from project_members
    where project_id = ${projectId} and role = 'project_manager'
  `);
  return Number(result.rows[0]?.count ?? 0);
}

before(async () => {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(
    databaseUrl.pathname,
    /test|ci/i,
    "integration tests must use a test/CI database",
  );
  assert.ok(
    ["127.0.0.1", "localhost", "postgres", "db"].includes(
      databaseUrl.hostname,
    ),
    "integration tests refuse remote database hosts",
  );
  await getDb().delete(session);
  await getDb().delete(rateLimit);
  await getDb().delete(auditEvent);
  [admin, managerA, managerB, viewerA] = await Promise.all([
    findUserByEmail(required("SEED_ADMIN_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
    findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
    findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
  ]).then((records) => {
    for (const record of records) assert.ok(record, "seed user should exist");
    return records as [SeedUser, SeedUser, SeedUser, SeedUser];
  });
});

after(async () => {
  await getDb().delete(session);
  await getDb().delete(rateLimit);
  await closeDatabasePool();
});

describe("project authorization boundary", () => {
  it("returns only projects authorized for each manager and all for admin", async () => {
    const [managerAProjects, managerBProjects, adminProjects] = await Promise.all([
      listAuthorizedProjects(managerA.id, managerA.systemRole),
      listAuthorizedProjects(managerB.id, managerB.systemRole),
      listAuthorizedProjects(admin.id, admin.systemRole),
    ]);
    assert.deepEqual(managerAProjects.map((item) => item.id), ["project-001"]);
    assert.deepEqual(managerBProjects.map((item) => item.id), ["project-002"]);
    assert.deepEqual(
      new Set(adminProjects.map((item) => item.id)),
      new Set(["project-001", "project-002", "project-003"]),
    );
  });

  it("uses the same 404 result for missing and cross-project IDs and audits denials", async () => {
    const requestHeaders = new Headers({
      "x-real-ip": "198.51.100.11",
      "user-agent": "project-ai-integration-test",
    });
    for (const projectId of ["project-002", "project-does-not-exist"]) {
      await assert.rejects(
        requireProjectAccess(principal(managerA), projectId, requestHeaders),
        (error: unknown) =>
          error instanceof AuthorizationError &&
          error.status === 404 &&
          error.code === "NOT_FOUND",
      );
    }
    const denied = await getDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.actorUserId, managerA.id),
          eq(auditEvent.eventType, "project_access_denied"),
        ),
      );
    assert.ok(denied.length >= 2);
    assert.ok(denied.every((event) => event.metadata.password === undefined));
  });

  it("allows viewer read but rejects every write role", async () => {
    const authorized = await findAuthorizedProject(
      viewerA.id,
      viewerA.systemRole,
      "project-001",
    );
    assert.equal(authorized?.projectRole, "viewer");
    await assert.rejects(
      requireProjectRole(principal(viewerA), "project-001", ["project_manager"]),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 403,
    );
  });

  it("removes sensitive values from nested audit metadata", () => {
    const sanitized = sanitizeAuditMetadata({
      reason: "authorization_check",
      password: "must-not-survive",
      nested: {
        sessionToken: "must-not-survive",
        apiKey: "must-not-survive",
        projectFileContent: "must-not-survive",
        allowed: "bounded diagnostic",
      },
    });
    assert.deepEqual(sanitized, {
      reason: "authorization_check",
      nested: { allowed: "bounded diagnostic" },
    });
  });
});

describe("database constraints", () => {
  it("exposes only a validated runtime SHA as health provenance", async () => {
    const previousSha = process.env.NEXT_PUBLIC_COMMIT_SHA;
    const runtimeSha = "a".repeat(40);
    process.env.NEXT_PUBLIC_COMMIT_SHA = runtimeSha;
    try {
      const response = await getHealth();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
      assert.equal(response.headers.get("x-projectai-commit-sha"), runtimeSha);
    } finally {
      if (previousSha === undefined) delete process.env.NEXT_PUBLIC_COMMIT_SHA;
      else process.env.NEXT_PUBLIC_COMMIT_SHA = previousSha;
    }
  });

  it("seeds every project with at least one project manager", async () => {
    const zeroManagerProjects = await getDb().execute<{ id: string }>(sql`
      select p.id
      from projects p
      where not exists (
        select 1
        from project_members pm
        where pm.project_id = p.id and pm.role = 'project_manager'
      )
    `);
    assert.deepEqual(zeroManagerProjects.rows, []);
  });

  it("fails Seed closed instead of overwriting a zero-manager project", async () => {
    const projectId = `project-seed-guard-${crypto.randomUUID()}`;
    const memberId = `membership-seed-guard-${crypto.randomUUID()}`;
    await getDb().insert(project).values({
      id: projectId,
      name: "Seed 后置条件测试",
      clientName: "测试客户",
      description: "现有角色不得被 Seed 覆盖",
      createdBy: admin.id,
    });
    await getDb().insert(projectMember).values({
      id: memberId,
      projectId,
      userId: admin.id,
      role: "viewer",
      createdBy: admin.id,
    });
    try {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          ["--import", "tsx", "scripts/db/seed.ts"],
          { cwd: process.cwd(), env: process.env },
        ),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("Seed refused to continue"),
      );
      const [unchanged] = await getDb()
        .select()
        .from(projectMember)
        .where(eq(projectMember.id, memberId));
      assert.equal(unchanged?.role, "viewer");
    } finally {
      await getDb().delete(project).where(eq(project.id, projectId));
    }
  });

  it("rejects duplicate memberships", async () => {
    await assert.rejects(
      getDb().insert(projectMember).values({
        id: crypto.randomUUID(),
        projectId: "project-001",
        userId: managerA.id,
        role: "project_manager",
        createdBy: admin.id,
      }),
      (error: unknown) => postgresErrorCode(error) === "23505",
    );
  });

  it("rejects invalid project roles at the PostgreSQL enum", async () => {
    await assert.rejects(
      getDb().execute(sql`
        insert into project_members (id, project_id, user_id, role, created_by)
        values (${crypto.randomUUID()}, 'project-001', ${managerB.id}, 'owner', ${admin.id})
      `),
      (error: unknown) => postgresErrorCode(error) === "22P02",
    );
  });

  it("restricts deletion of identities referenced by projects or memberships", async () => {
    await assert.rejects(
      getDb().delete(user).where(eq(user.id, managerA.id)),
      (error: unknown) => postgresErrorCode(error) === "23503",
    );
  });

  it("keeps existing identities, project edits, memberships, and hashes unchanged on Seed reruns", async () => {
    const [originalMembership] = await getDb()
      .select()
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, "project-001"),
          eq(projectMember.userId, viewerA.id),
        ),
      );
    const originalProjectResult = await getDb().execute<{
      name: string;
    }>(sql`select name from projects where id = 'project-001'`);
    const originalProject = originalProjectResult.rows[0];
    const [originalAccount] = await getDb()
      .select({ passwordHash: account.passwordHash })
      .from(account)
      .where(
        and(
          eq(account.userId, viewerA.id),
          eq(account.providerId, "credential"),
        ),
      );
    assert.ok(originalMembership && originalProject && originalAccount?.passwordHash);

    await getDb().update(user).set({ status: "disabled" }).where(eq(user.id, viewerA.id));
    await getDb()
      .update(projectMember)
      .set({ role: "project_member" })
      .where(eq(projectMember.id, originalMembership.id));
    await getDb().execute(
      sql`update projects set name = 'Seed must preserve this edit' where id = 'project-001'`,
    );
    try {
      await execFileAsync(
        process.execPath,
        ["--import", "tsx", "scripts/db/seed.ts"],
        { cwd: process.cwd(), env: process.env },
      );
      const currentUser = await findUserByEmail(required("SEED_VIEWER_A_EMAIL"));
      const [currentMembership] = await getDb()
        .select()
        .from(projectMember)
        .where(eq(projectMember.id, originalMembership.id));
      const currentProjectResult = await getDb().execute<{ name: string }>(
        sql`select name from projects where id = 'project-001'`,
      );
      const currentProject = currentProjectResult.rows[0];
      const [currentAccount] = await getDb()
        .select({ passwordHash: account.passwordHash })
        .from(account)
        .where(eq(account.userId, viewerA.id));
      assert.equal(currentUser?.status, "disabled");
      assert.equal(currentMembership.role, "project_member");
      assert.equal(currentProject.name, "Seed must preserve this edit");
      assert.equal(currentAccount.passwordHash, originalAccount.passwordHash);
    } finally {
      await getDb().update(user).set({ status: "active" }).where(eq(user.id, viewerA.id));
      await getDb()
        .update(projectMember)
        .set({ role: originalMembership.role })
        .where(eq(projectMember.id, originalMembership.id));
      await getDb().execute(
        sql`update projects set name = ${originalProject.name} where id = 'project-001'`,
      );
    }
  });
});

describe("database-backed authentication and API authorization", () => {
  it("creates a DB session, survives a session lookup, and signs out", async () => {
    const { response, cookie } = await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      required("SEED_MANAGER_A_PASSWORD"),
      "198.51.100.21",
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    const loginBody = await response.clone().json();
    assert.deepEqual(loginBody, { authenticated: true });
    assert.doesNotMatch(JSON.stringify(loginBody), /token/i);
    assert.ok(cookie, "secure HTTP-only session cookie should be returned");
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.includes("session_token="));
    assert.match(setCookie ?? "", /HttpOnly/i);
    assert.match(setCookie ?? "", /SameSite=Lax/i);
    assert.match(setCookie ?? "", /Path=\/tool\/projectai(?:;|$)/i);
    assert.equal(
      (setCookie ?? "").includes(required("SEED_MANAGER_A_PASSWORD")),
      false,
    );

    const sessionResponse = await authGet(
      new Request(`${required("BETTER_AUTH_URL")}/get-session`, {
        headers: { cookie, "x-real-ip": "198.51.100.21" },
      }),
    );
    assert.equal(sessionResponse.status, 200);
    assert.match(sessionResponse.headers.get("cache-control") ?? "", /no-store/i);
    const sessionBody = (await sessionResponse.json()) as { session?: { id: string } };
    assert.ok(sessionBody.session?.id);
    assert.doesNotMatch(JSON.stringify(sessionBody), /password|password_hash/i);
    assert.doesNotMatch(JSON.stringify(sessionBody), /token/i);
    const [storedSession] = await getDb()
      .select()
      .from(session)
      .where(eq(session.id, sessionBody.session!.id));
    assert.ok(storedSession);

    for (const [origin, contentType, expectedStatus] of [
      ["https://untrusted.projectai.invalid", "application/json", 403],
      [trustedAuthOrigin(), "text/plain", 415],
    ] as const) {
      const rejectedSignOut = await authPost(
        new Request(`${required("BETTER_AUTH_URL")}/sign-out`, {
          method: "POST",
          headers: {
            cookie,
            "content-type": contentType,
            origin,
            "x-real-ip": "198.51.100.21",
          },
          body: JSON.stringify({}),
        }),
      );
      assert.equal(rejectedSignOut.status, expectedStatus);
      const [sessionAfterRejectedRequest] = await getDb()
        .select()
        .from(session)
        .where(eq(session.id, storedSession.id));
      assert.ok(sessionAfterRejectedRequest);
    }

    const signOutResponse = await authPost(
      new Request(`${required("BETTER_AUTH_URL")}/sign-out`, {
        method: "POST",
        headers: {
          cookie,
          origin: new URL(required("BETTER_AUTH_URL")).origin,
          "content-type": "application/json",
          "x-real-ip": "198.51.100.21",
        },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(signOutResponse.status, 200);
    assert.match(signOutResponse.headers.get("cache-control") ?? "", /no-store/i);
    const [deletedSession] = await getDb()
      .select()
      .from(session)
      .where(eq(session.id, storedSession.id));
    assert.equal(deletedSession, undefined);
  });

  it("revokes an existing Session when the identity becomes disabled", async () => {
    const login = await signIn(
      required("SEED_VIEWER_A_EMAIL"),
      required("SEED_VIEWER_A_PASSWORD"),
      "198.51.100.25",
    );
    assert.equal(login.response.status, 200);
    assert.ok(login.cookie);
    await getDb().update(user).set({ status: "disabled" }).where(eq(user.id, viewerA.id));
    try {
      const lookup = await authGet(
        new Request(`${required("BETTER_AUTH_URL")}/get-session`, {
          headers: { cookie: login.cookie, "x-real-ip": "198.51.100.25" },
        }),
      );
      assert.equal(lookup.status, 200);
      assert.equal(await lookup.json(), null);
      assert.match(lookup.headers.get("cache-control") ?? "", /no-store/i);
      const remainingSessions = await getDb()
        .select()
        .from(session)
        .where(eq(session.userId, viewerA.id));
      assert.equal(remainingSessions.length, 0);
    } finally {
      await getDb().update(user).set({ status: "active" }).where(eq(user.id, viewerA.id));
    }
  });

  it("does not expose public registration", async () => {
    const authUrl = required("BETTER_AUTH_URL");
    const response = await authPost(
      new Request(`${authUrl}/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(authUrl).origin,
          "x-real-ip": "198.51.100.31",
        },
        body: JSON.stringify({
          email: "public-registration@example.test",
          password: invalidPassword(),
          name: "Public User",
        }),
      }),
    );
    assert.ok(response.status >= 400);
    const [registered] = await getDb()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "public-registration@example.test"));
    assert.equal(registered, undefined);
  });

  it("allowlists auth endpoints and never exposes Better Auth Session tokens", async () => {
    const authUrl = required("BETTER_AUTH_URL");
    const login = await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      required("SEED_MANAGER_A_PASSWORD"),
      "198.51.100.32",
    );
    assert.equal(login.response.status, 200);
    assert.ok(login.cookie);

    for (const route of ["/list-sessions", "/change-password"]) {
      const request = new Request(`${authUrl}${route}`, {
        method: route === "/list-sessions" ? "GET" : "POST",
        headers: {
          cookie: login.cookie,
          "content-type": "application/json",
          origin: new URL(authUrl).origin,
          "x-real-ip": "198.51.100.32",
        },
        body:
          route === "/change-password"
            ? JSON.stringify({
                currentPassword: required("SEED_MANAGER_A_PASSWORD"),
                newPassword: invalidPassword(),
                revokeOtherSessions: true,
              })
            : undefined,
      });
      const response = route === "/list-sessions" ? await authGet(request) : await authPost(request);
      assert.equal(response.status, 404);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.doesNotMatch(await response.clone().text(), /token/i);
    }
  });

  it("returns a generic failure and no session for a disabled user", async () => {
    await getDb().update(user).set({ status: "disabled" }).where(eq(user.id, viewerA.id));
    try {
      const { response } = await signIn(
        required("SEED_VIEWER_A_EMAIL"),
        required("SEED_VIEWER_A_PASSWORD"),
        "198.51.100.22",
      );
      assert.equal(response.status, 401);
      const disabledBody = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      assert.equal(disabledBody.error?.code, "INVALID_CREDENTIALS");
      assert.equal(disabledBody.error?.message, "邮箱或密码不正确");
      const activeSessions = await getDb()
        .select()
        .from(session)
        .where(eq(session.userId, viewerA.id));
      assert.equal(activeSessions.length, 0);
    } finally {
      await getDb().update(user).set({ status: "active" }).where(eq(user.id, viewerA.id));
    }
  });

  it("uses one generic error for unknown email and wrong password", async () => {
    const unknown = await signIn(
      "unknown-user@projectai.test",
      invalidPassword(),
      "198.51.100.41",
    );
    const wrongPassword = await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      invalidPassword(),
      "198.51.100.42",
    );
    assert.equal(unknown.response.status, 401);
    assert.equal(wrongPassword.response.status, 401);
    assert.deepEqual(
      await unknown.response.json(),
      await wrongPassword.response.json(),
    );
  });

  it("rate limits repeated login failures by the trusted client IP", async () => {
    const attempts: Response[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      attempts.push(
        (
          await signIn(
            required("SEED_MANAGER_A_EMAIL"),
            invalidPassword(),
            "198.51.100.99",
          )
        ).response,
      );
    }
    assert.equal(attempts.at(-1)?.status, 429);
    assert.ok(attempts.slice(0, 10).every((response) => response.status === 401));
  });

  it("rejects cross-project URL/body tampering and viewer writes in route handlers", async () => {
    const managerLogin = await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      required("SEED_MANAGER_A_PASSWORD"),
      "198.51.100.23",
    );
    const viewerLogin = await signIn(
      required("SEED_VIEWER_A_EMAIL"),
      required("SEED_VIEWER_A_PASSWORD"),
      "198.51.100.24",
    );
    assert.equal(managerLogin.response.status, 200);
    assert.equal(viewerLogin.response.status, 200);

    const managerProjectsResponse = await getProjects(
      new Request("http://local.test/api/projects", {
        headers: { cookie: managerLogin.cookie },
      }),
    );
    assert.equal(managerProjectsResponse.status, 200);
    const managerProjectsBody = (await managerProjectsResponse.json()) as {
      projects: Array<{ id: string }>;
    };
    assert.deepEqual(managerProjectsBody.projects.map((item) => item.id), ["project-001"]);

    const forbiddenProjectResponse = await getProject(
      new Request("http://local.test/api/projects/project-002", {
        headers: { cookie: managerLogin.cookie },
      }),
      { params: Promise.resolve({ projectId: "project-002" }) },
    );
    assert.equal(forbiddenProjectResponse.status, 404);

    const tamperedPatchResponse = await patchProject(
      new Request("http://local.test/api/projects/project-002", {
        method: "PATCH",
        headers: {
          cookie: managerLogin.cookie,
          "content-type": "application/json",
          origin: trustedAuthOrigin(),
        },
        body: JSON.stringify({ name: "不应写入", projectId: "project-001" }),
      }),
      { params: Promise.resolve({ projectId: "project-002" }) },
    );
    assert.equal(tamperedPatchResponse.status, 404);

    const viewerPatchResponse = await patchProject(
      new Request("http://local.test/api/projects/project-001", {
        method: "PATCH",
        headers: {
          cookie: viewerLogin.cookie,
          "content-type": "application/json",
          origin: trustedAuthOrigin(),
        },
        body: JSON.stringify({ name: "只读用户不应写入" }),
      }),
      { params: Promise.resolve({ projectId: "project-001" }) },
    );
    assert.equal(viewerPatchResponse.status, 403);

    const managerCreateResponse = await createProject(
      new Request("http://local.test/api/projects", {
        method: "POST",
        headers: {
          cookie: managerLogin.cookie,
          "content-type": "application/json",
          origin: trustedAuthOrigin(),
        },
        body: JSON.stringify({
          name: "不应创建",
          clientName: "测试客户",
          description: "权限测试",
        }),
      }),
    );
    assert.equal(managerCreateResponse.status, 403);

    const rejectedOrigin = await patchProject(
      new Request("http://local.test/api/projects/project-001", {
        method: "PATCH",
        headers: {
          cookie: managerLogin.cookie,
          "content-type": "application/json",
          origin: "https://untrusted.projectai.invalid",
        },
        body: JSON.stringify({ name: "跨源请求不应写入" }),
      }),
      { params: Promise.resolve({ projectId: "project-001" }) },
    );
    assert.equal(rejectedOrigin.status, 403);

    const rejectedMediaType = await patchProject(
      new Request("http://local.test/api/projects/project-001", {
        method: "PATCH",
        headers: {
          cookie: managerLogin.cookie,
          "content-type": "text/plain",
          origin: trustedAuthOrigin(),
        },
        body: JSON.stringify({ name: "非 JSON 请求不应写入" }),
      }),
      { params: Promise.resolve({ projectId: "project-001" }) },
    );
    assert.equal(rejectedMediaType.status, 415);
  });

  it("keeps member CRUD and memberId tampering inside the authorized project", async () => {
    const managerLogin = await signIn(
      required("SEED_MANAGER_A_EMAIL"),
      required("SEED_MANAGER_A_PASSWORD"),
      "198.51.100.26",
    );
    assert.equal(managerLogin.response.status, 200);
    let createdMemberId = "";
    try {
      const added = await addProjectMemberRoute(
        new Request("http://local.test/api/projects/project-001/members", {
          method: "POST",
          headers: {
            cookie: managerLogin.cookie,
            "content-type": "application/json",
            origin: trustedAuthOrigin(),
          },
          body: JSON.stringify({
            email: required("SEED_MANAGER_B_EMAIL"),
            role: "viewer",
          }),
        }),
        { params: Promise.resolve({ projectId: "project-001" }) },
      );
      assert.equal(added.status, 201);
      const addedBody = (await added.json()) as { member: { id: string } };
      createdMemberId = addedBody.member.id;

      const tampered = await patchProjectMemberRoute(
        new Request(
          `http://local.test/api/projects/project-002/members/${createdMemberId}`,
          {
            method: "PATCH",
            headers: {
              cookie: managerLogin.cookie,
              "content-type": "application/json",
              origin: trustedAuthOrigin(),
            },
            body: JSON.stringify({ role: "project_manager" }),
          },
        ),
        {
          params: Promise.resolve({
            projectId: "project-002",
            memberId: createdMemberId,
          }),
        },
      );
      assert.equal(tampered.status, 404);

      const changed = await patchProjectMemberRoute(
        new Request(
          `http://local.test/api/projects/project-001/members/${createdMemberId}`,
          {
            method: "PATCH",
            headers: {
              cookie: managerLogin.cookie,
              "content-type": "application/json",
              origin: trustedAuthOrigin(),
            },
            body: JSON.stringify({ role: "project_member" }),
          },
        ),
        {
          params: Promise.resolve({
            projectId: "project-001",
            memberId: createdMemberId,
          }),
        },
      );
      assert.equal(changed.status, 200);

      const removed = await deleteProjectMemberRoute(
        new Request(
          `http://local.test/api/projects/project-001/members/${createdMemberId}`,
          {
            method: "DELETE",
            headers: {
              cookie: managerLogin.cookie,
              origin: trustedAuthOrigin(),
            },
          },
        ),
        {
          params: Promise.resolve({
            projectId: "project-001",
            memberId: createdMemberId,
          }),
        },
      );
      assert.equal(removed.status, 204);
      createdMemberId = "";
    } finally {
      if (createdMemberId) {
        await getDb()
          .delete(projectMember)
          .where(eq(projectMember.id, createdMemberId));
      }
    }
  });

  it("rejects every last-manager downgrade or removal with the exact 409 contract and a committed denial audit", async () => {
    const [managerLogin, adminLogin] = await Promise.all([
      signIn(
        required("SEED_MANAGER_B_EMAIL"),
        required("SEED_MANAGER_B_PASSWORD"),
        "198.51.100.33",
      ),
      signIn(
        required("SEED_ADMIN_EMAIL"),
        required("SEED_ADMIN_PASSWORD"),
        "198.51.100.34",
      ),
    ]);
    assert.equal(managerLogin.response.status, 200);
    assert.equal(adminLogin.response.status, 200);
    const [onlyManager] = await getDb()
      .select()
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, "project-002"),
          eq(projectMember.userId, managerB.id),
        ),
      );
    assert.equal(onlyManager?.role, "project_manager");

    const beforeDenials = await getDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.projectId, "project-002"),
          eq(auditEvent.entityId, onlyManager.id),
          eq(auditEvent.eventType, "project_member_change_denied"),
        ),
      );
    const responses = [
      await patchMemberRole(
        managerLogin.cookie,
        "project-002",
        onlyManager.id,
        "project_member",
      ),
      await patchMemberRole(
        managerLogin.cookie,
        "project-002",
        onlyManager.id,
        "viewer",
      ),
      await deleteMember(managerLogin.cookie, "project-002", onlyManager.id),
      await deleteMember(adminLogin.cookie, "project-002", onlyManager.id),
    ];

    for (const response of responses) {
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: {
          code: "LAST_PROJECT_MANAGER",
          message: "项目必须至少保留一名项目经理",
        },
      });
    }
    const [unchanged] = await getDb()
      .select()
      .from(projectMember)
      .where(eq(projectMember.id, onlyManager.id));
    assert.equal(unchanged?.role, "project_manager");

    const afterDenials = await getDb()
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.projectId, "project-002"),
          eq(auditEvent.entityId, onlyManager.id),
          eq(auditEvent.eventType, "project_member_change_denied"),
        ),
      );
    const previousAuditIds = new Set(beforeDenials.map((event) => event.id));
    const newDenials = afterDenials.filter(
      (event) => !previousAuditIds.has(event.id),
    );
    assert.equal(newDenials.length, 4);
    assert.ok(
      newDenials.every(
        (event) =>
          event.result === "denied" &&
          event.metadata.reason === "last_project_manager" &&
          event.metadata.password === undefined &&
          event.metadata.sessionToken === undefined,
      ),
    );
  });

  it("allows a manager downgrade and deletion after another manager is added", async () => {
    const adminLogin = await signIn(
      required("SEED_ADMIN_EMAIL"),
      required("SEED_ADMIN_PASSWORD"),
      "198.51.100.35",
    );
    assert.equal(adminLogin.response.status, 200);
    const fixture = await createInvariantTestProject([
      { currentUser: admin, role: "project_manager" },
    ]);
    const adminMemberId = fixture.memberships.get(admin.id)!;
    try {
      const added = await addProjectMemberRoute(
        new Request(
          `http://local.test/api/projects/${fixture.projectId}/members`,
          {
            method: "POST",
            headers: {
              cookie: adminLogin.cookie,
              "content-type": "application/json",
              origin: trustedAuthOrigin(),
            },
            body: JSON.stringify({
              email: required("SEED_MANAGER_A_EMAIL"),
              role: "project_manager",
            }),
          },
        ),
        { params: Promise.resolve({ projectId: fixture.projectId }) },
      );
      assert.equal(added.status, 201);
      assert.equal(await projectManagerCount(fixture.projectId), 2);

      const downgraded = await patchMemberRole(
        adminLogin.cookie,
        fixture.projectId,
        adminMemberId,
        "viewer",
      );
      assert.equal(downgraded.status, 200);
      assert.equal(await projectManagerCount(fixture.projectId), 1);

      const restored = await patchMemberRole(
        adminLogin.cookie,
        fixture.projectId,
        adminMemberId,
        "project_manager",
      );
      assert.equal(restored.status, 200);
      assert.equal(await projectManagerCount(fixture.projectId), 2);

      const removed = await deleteMember(
        adminLogin.cookie,
        fixture.projectId,
        adminMemberId,
      );
      assert.equal(removed.status, 204);
      assert.equal(await projectManagerCount(fixture.projectId), 1);
    } finally {
      await getDb().delete(project).where(eq(project.id, fixture.projectId));
    }
  });

  it("serializes concurrent manager downgrades so they cannot reach zero managers", async () => {
    const [managerALogin, managerBLogin] = await Promise.all([
      signIn(
        required("SEED_MANAGER_A_EMAIL"),
        required("SEED_MANAGER_A_PASSWORD"),
        "198.51.100.36",
      ),
      signIn(
        required("SEED_MANAGER_B_EMAIL"),
        required("SEED_MANAGER_B_PASSWORD"),
        "198.51.100.37",
      ),
    ]);
    const fixture = await createInvariantTestProject([
      { currentUser: managerA, role: "project_manager" },
      { currentUser: managerB, role: "project_manager" },
    ]);
    try {
      const responses = await Promise.all([
        patchMemberRole(
          managerALogin.cookie,
          fixture.projectId,
          fixture.memberships.get(managerA.id)!,
          "viewer",
        ),
        patchMemberRole(
          managerBLogin.cookie,
          fixture.projectId,
          fixture.memberships.get(managerB.id)!,
          "project_member",
        ),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 409],
      );
      assert.deepEqual(await responses.find((response) => response.status === 409)!.json(), {
        error: {
          code: "LAST_PROJECT_MANAGER",
          message: "项目必须至少保留一名项目经理",
        },
      });
      assert.equal(await projectManagerCount(fixture.projectId), 1);
    } finally {
      await getDb().delete(project).where(eq(project.id, fixture.projectId));
    }
  });

  it("serializes concurrent manager removals so they cannot reach zero managers", async () => {
    const [managerALogin, managerBLogin] = await Promise.all([
      signIn(
        required("SEED_MANAGER_A_EMAIL"),
        required("SEED_MANAGER_A_PASSWORD"),
        "198.51.100.38",
      ),
      signIn(
        required("SEED_MANAGER_B_EMAIL"),
        required("SEED_MANAGER_B_PASSWORD"),
        "198.51.100.39",
      ),
    ]);
    const fixture = await createInvariantTestProject([
      { currentUser: managerA, role: "project_manager" },
      { currentUser: managerB, role: "project_manager" },
    ]);
    try {
      const responses = await Promise.all([
        deleteMember(
          managerALogin.cookie,
          fixture.projectId,
          fixture.memberships.get(managerA.id)!,
        ),
        deleteMember(
          managerBLogin.cookie,
          fixture.projectId,
          fixture.memberships.get(managerB.id)!,
        ),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [204, 409],
      );
      assert.deepEqual(await responses.find((response) => response.status === 409)!.json(), {
        error: {
          code: "LAST_PROJECT_MANAGER",
          message: "项目必须至少保留一名项目经理",
        },
      });
      assert.equal(await projectManagerCount(fixture.projectId), 1);
    } finally {
      await getDb().delete(project).where(eq(project.id, fixture.projectId));
    }
  });

  it("persists admin project creation with its manager membership and audit atomically", async () => {
    const adminLogin = await signIn(
      required("SEED_ADMIN_EMAIL"),
      required("SEED_ADMIN_PASSWORD"),
      "198.51.100.27",
    );
    assert.equal(adminLogin.response.status, 200);
    let projectId = "";
    try {
      const response = await createProject(
        new Request("http://local.test/api/projects", {
          method: "POST",
          headers: {
            cookie: adminLogin.cookie,
            "content-type": "application/json",
            origin: trustedAuthOrigin(),
          },
          body: JSON.stringify({
            name: "集成测试项目",
            clientName: "测试客户",
            description: "验证项目、成员关系与审计的同事务写入",
          }),
        }),
      );
      assert.equal(response.status, 201);
      const body = (await response.json()) as { project: { id: string } };
      projectId = body.project.id;
      const [membership] = await getDb()
        .select()
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, projectId),
            eq(projectMember.userId, admin.id),
          ),
        );
      const [audit] = await getDb()
        .select()
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.projectId, projectId),
            eq(auditEvent.eventType, "project_created"),
          ),
        );
      assert.equal(membership?.role, "project_manager");
      assert.equal(audit?.result, "succeeded");
    } finally {
      if (projectId) {
        await getDb().execute(sql`delete from projects where id = ${projectId}`);
      }
    }
  });

  it("stores only normalized credential hashes outside users", async () => {
    const [credential] = await getDb()
      .select({ passwordHash: account.passwordHash })
      .from(account)
      .where(
        and(
          eq(account.userId, managerA.id),
          eq(account.providerId, "credential"),
        ),
      );
    assert.ok(credential?.passwordHash);
    assert.notEqual(credential.passwordHash, required("SEED_MANAGER_A_PASSWORD"));
    const userColumns = await getDb().execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `);
    assert.equal(
      userColumns.rows.some((column) => column.column_name === "password_hash"),
      false,
    );
  });
});
