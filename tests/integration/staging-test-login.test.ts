import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { GET as getSession, POST as authPost } from "../../app/api/auth/[...all]/route";
import { GET as listProjects } from "../../app/api/projects/route";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { auditEvent, session } from "../../lib/db/schema";

const origin = "https://gridworks.cn";
const basePath = "/tool/projectai-staging";

function authRequest(path: string, init: RequestInit = {}) {
  return new Request(`${origin}${basePath}${path}`, {
    ...init,
    headers: {
      host: "gridworks.cn",
      origin,
      "content-type": "application/json",
      "x-forwarded-host": "gridworks.cn",
      "x-forwarded-proto": "https",
      ...init.headers,
    },
  });
}

function cookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

after(async () => {
  await closeDatabasePool();
});

describe("Staging-only test login", () => {
  it("rejects caller-supplied identity and role fields", async () => {
    for (const payload of [
      { userId: "kivisense-mock-super-admin" },
      { role: "super_admin" },
      { identity: "super-admin" },
      { organizationId: "org-legacy-default" },
      { projectId: "kivisense-project-projectai-product" },
    ]) {
      const response = await authPost(
        authRequest("/api/auth/sign-in/staging-test", {
          method: "POST",
          body: JSON.stringify(payload),
        }),
      );
      assert.equal(response.status, 400);
      assert.equal(
        (await response.json() as { error: { code: string } }).error.code,
        "STAGING_TEST_LOGIN_PAYLOAD_INVALID",
      );
    }
  });

  it("creates a normal Admin Session, authorizes projects, audits, and logs out", async () => {
    const login = await authPost(
      authRequest("/api/auth/sign-in/staging-test", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { authenticated: true });
    const setCookie = login.headers.getSetCookie().join("; ");
    assert.match(setCookie, /HttpOnly/iu);
    assert.match(setCookie, /Secure/iu);
    assert.match(setCookie, /SameSite=Lax/iu);
    assert.match(setCookie, /Path=\/tool\/projectai-staging/iu);
    const sessionCookie = cookie(login);

    const sessionResponse = await getSession(
      authRequest("/api/auth/get-session", {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(sessionResponse.status, 200);
    const sessionBody = await sessionResponse.json() as {
      session: { id: string };
      user: { id: string; productRole: string };
    };
    assert.equal(sessionBody.user.id, "kivisense-mock-admin");
    assert.equal(sessionBody.user.productRole, "admin");
    assert.doesNotMatch(JSON.stringify(sessionBody), /token/iu);

    const projectsResponse = await listProjects(
      authRequest("/api/projects", {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(projectsResponse.status, 200);
    const projects = (await projectsResponse.json() as {
      projects: Array<{
        permissions: {
          canViewProject: boolean;
          canEditProject: boolean;
          canManageMembers: boolean;
        };
      }>;
    }).projects;
    assert.ok(projects.length > 0);
    for (const project of projects) {
      assert.deepEqual(
        {
          canViewProject: project.permissions.canViewProject,
          canEditProject: project.permissions.canEditProject,
          canManageMembers: project.permissions.canManageMembers,
        },
        {
          canViewProject: true,
          canEditProject: true,
          canManageMembers: true,
        },
      );
    }

    const [loginAudit] = await getDb()
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.actorUserId, sessionBody.user.id),
          eq(auditEvent.entityId, sessionBody.session.id),
          eq(auditEvent.eventType, "login_succeeded"),
        ),
      )
      .limit(1);
    assert.ok(loginAudit);

    const logout = await authPost(
      authRequest("/api/auth/sign-out", {
        method: "POST",
        headers: { cookie: sessionCookie },
        body: JSON.stringify({}),
      }),
    );
    assert.equal(logout.status, 200);
    const [deletedSession] = await getDb()
      .select({ id: session.id })
      .from(session)
      .where(eq(session.id, sessionBody.session.id))
      .limit(1);
    assert.equal(deletedSession, undefined);

    const denied = await listProjects(
      authRequest("/api/projects", {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
    );
    assert.equal(denied.status, 401);
  });
});
