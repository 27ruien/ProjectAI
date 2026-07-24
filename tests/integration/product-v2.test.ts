import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { GET as getSession, POST as authPost } from "../../app/api/auth/[...all]/route";
import { GET as getDepartments } from "../../app/api/organization/departments/route";
import { PATCH as patchOrganizationMemberRole } from "../../app/api/organization/members/route";
import { GET as getSpaces } from "../../app/api/knowledge-spaces/route";
import { DELETE as deleteSpaceMember, PUT as putSpaceMember } from "../../app/api/knowledge-spaces/[spaceId]/members/route";
import {
  GET as listProjects,
  POST as createProject,
} from "../../app/api/projects/route";
import {
  GET as getProject,
  PATCH as patchProject,
} from "../../app/api/projects/[projectId]/route";
import {
  POST as addProjectMember,
} from "../../app/api/projects/[projectId]/members/route";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { project, projectMember } from "../../lib/db/schema";
import { resetAuthForTests } from "../../lib/auth/config";

const origin = "http://127.0.0.1:3200";
const basePath = "/tool/projectai";

function cookie(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function login(identity: "super-admin" | "admin" | "member") {
  const response = await authPost(new Request(`${origin}${basePath}/api/auth/sign-in/mock-wecom`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ identity }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true });
  return cookie(response);
}

function request(pathname: string, cookieHeader: string, init: RequestInit = {}) {
  return new Request(`${origin}${basePath}${pathname}`, {
    ...init,
    headers: { cookie: cookieHeader, origin, ...init.headers },
  });
}

type ProjectPermissions = {
  canViewProject: boolean;
  canEditProject: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
  canUploadDocuments: boolean;
  canInviteMembers: boolean;
};

function assertPermissions(
  actual: ProjectPermissions,
  expected: Partial<ProjectPermissions>,
) {
  assert.ok(actual, "project permissions contract is required");
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key as keyof ProjectPermissions], value, key);
  }
}

before(() => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  process.env.AUTH_PROVIDER = "mock-wecom";
  process.env.ALLOW_MOCK_WECOM_AUTH = "true";
  resetAuthForTests();
});

after(async () => {
  await closeDatabasePool();
});

describe("Product V2 database-backed identity and ACL", () => {
  it("creates sanitized Mock WeCom sessions and reserves organization management for Super Admin", async () => {
    const [superCookie, adminCookie, memberCookie] = await Promise.all([
      login("super-admin"),
      login("admin"),
      login("member"),
    ]);
    const session = await getSession(request("/api/auth/get-session", adminCookie));
    assert.equal(session.status, 200);
    const sessionBody = await session.json() as { user: { productRole: string } };
    assert.equal(sessionBody.user.productRole, "admin");
    assert.doesNotMatch(JSON.stringify(sessionBody), /token/iu);

    assert.equal((await getDepartments(request("/api/organization/departments", superCookie))).status, 200);
    assert.equal((await getDepartments(request("/api/organization/departments", adminCookie))).status, 404);
    assert.equal((await getDepartments(request("/api/organization/departments", memberCookie))).status, 404);
  });

  it("serializes global project permissions for Super Admin and Admin", async () => {
    for (const identity of ["super-admin", "admin"] as const) {
      const identityCookie = await login(identity);
      const response = await listProjects(request("/api/projects", identityCookie));
      assert.equal(response.status, 200);
      const projects = (await response.json() as {
        projects: Array<{ permissions: ProjectPermissions }>;
      }).projects;
      assert.ok(projects.length > 0);
      for (const item of projects) {
        assertPermissions(item.permissions, {
          canViewProject: true,
          canEditProject: true,
          canManageMembers: true,
          canDeleteProject: true,
          canUploadDocuments: true,
          canInviteMembers: true,
        });
      }
    }
  });

  it("keeps Member creator permissions consistent across create, list, detail, update, and invite", async () => {
    const memberCookie = await login("member");
    const forbidden = await createProject(request("/api/projects", memberCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Product V2 forbidden department",
        clientName: "Kivisense Internal",
        departmentId: "kivisense-dept-technology",
      }),
    }));
    assert.equal(forbidden.status, 400);
    assert.equal((await forbidden.json() as { error: { code: string } }).error.code, "DEPARTMENT_REQUIRED");

    const allowed = await createProject(request("/api/projects", memberCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Product V2 member integration",
        clientName: "Kivisense Internal",
        departmentId: "kivisense-dept-product-management",
      }),
    }));
    assert.equal(allowed.status, 201);
    const body = await allowed.json() as {
      project: { id: string; permissions: ProjectPermissions };
      knowledgeSpaceId: string;
    };
    assert.ok(body.knowledgeSpaceId);
    assertPermissions(body.project.permissions, {
      canViewProject: true,
      canEditProject: true,
      canManageMembers: true,
      canDeleteProject: true,
      canUploadDocuments: true,
      canInviteMembers: true,
    });
    const routeContext = {
      params: Promise.resolve({ projectId: body.project.id }),
    };
    try {
      const list = await listProjects(request("/api/projects", memberCookie));
      const listed = (await list.json() as {
        projects: Array<{ id: string; permissions: ProjectPermissions }>;
      }).projects.find((item) => item.id === body.project.id);
      assertPermissions(listed!.permissions, body.project.permissions);

      const detail = await getProject(
        request(`/api/projects/${body.project.id}`, memberCookie),
        routeContext,
      );
      assert.equal(detail.status, 200);
      const detailed = (await detail.json() as {
        project: { permissions: ProjectPermissions };
      }).project;
      assertPermissions(detailed.permissions, body.project.permissions);

      const updated = await patchProject(
        request(`/api/projects/${body.project.id}`, memberCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "创建者权限契约回归" }),
        }),
        routeContext,
      );
      assert.equal(updated.status, 200);
      assertPermissions(
        (await updated.json() as { project: { permissions: ProjectPermissions } })
          .project.permissions,
        body.project.permissions,
      );

      const invited = await addProjectMember(
        request(`/api/projects/${body.project.id}/members`, memberCookie, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "admin@mock-wecom.invalid",
            role: "viewer",
          }),
        }),
        routeContext,
      );
      assert.equal(invited.status, 201);
      assertPermissions(
        (await invited.json() as {
          project: { permissions: ProjectPermissions };
        }).project.permissions,
        body.project.permissions,
      );

      await getDb().delete(projectMember).where(and(
        eq(projectMember.projectId, body.project.id),
        eq(projectMember.userId, "kivisense-mock-member"),
      ));
      const creatorWithoutInvite = await listProjects(
        request("/api/projects", memberCookie),
      );
      const creatorProject = (await creatorWithoutInvite.json() as {
        projects: Array<{
          id: string;
          projectRole: string | null;
          permissions: ProjectPermissions;
        }>;
      }).projects.find((item) => item.id === body.project.id);
      assert.equal(creatorProject?.projectRole, "project_manager");
      assertPermissions(creatorProject!.permissions, body.project.permissions);

      const creatorUpdate = await patchProject(
        request(`/api/projects/${body.project.id}`, memberCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "创建者不依赖邀请表" }),
        }),
        routeContext,
      );
      assert.equal(creatorUpdate.status, 200);
    } finally {
      await getDb().delete(project).where(eq(project.id, body.project.id));
    }
  });

  it("lets an Admin share a department space without exposing organization editing", async () => {
    const [adminCookie, memberCookie] = await Promise.all([login("admin"), login("member")]);
    const spaceId = "ks-department-kivisense-dept-technology";
    const routeContext = { params: Promise.resolve({ spaceId }) };
    const before = await getSpaces(request("/api/knowledge-spaces", memberCookie));
    assert.equal(
      (await before.json() as { knowledgeSpaces: Array<{ id: string }> }).knowledgeSpaces.some((space) => space.id === spaceId),
      false,
    );
    try {
      const granted = await putSpaceMember(request(`/api/knowledge-spaces/${spaceId}/members`, adminCookie, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-member", accessLevel: "view" }),
      }), routeContext);
      assert.equal(granted.status, 200);
      const after = await getSpaces(request("/api/knowledge-spaces", memberCookie));
      assert.equal(
        (await after.json() as { knowledgeSpaces: Array<{ id: string; accessLevel: string }> }).knowledgeSpaces
          .find((space) => space.id === spaceId)?.accessLevel,
        "view",
      );
    } finally {
      const removed = await deleteSpaceMember(request(`/api/knowledge-spaces/${spaceId}/members`, adminCookie, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-member" }),
      }), routeContext);
      assert.ok([200, 404].includes(removed.status));
    }
  });

  it("enforces project-space view, edit, and revoke across identities", async () => {
    const [adminCookie, memberCookie] = await Promise.all([login("admin"), login("member")]);
    const created = await createProject(request("/api/projects", adminCookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Product V2 ACL integration",
        clientName: "Kivisense Internal",
        departmentId: "kivisense-dept-product-management",
      }),
    }));
    assert.equal(created.status, 201);
    const body = await created.json() as { project: { id: string }; knowledgeSpaceId: string };
    const routeContext = { params: Promise.resolve({ spaceId: body.knowledgeSpaceId }) };
    const projectRouteContext = { params: Promise.resolve({ projectId: body.project.id }) };
    try {
      const uninvitedList = await listProjects(request("/api/projects", memberCookie));
      assert.equal(
        (await uninvitedList.json() as { projects: Array<{ id: string }> })
          .projects.some((item) => item.id === body.project.id),
        false,
      );
      assert.equal((await getProject(
        request(`/api/projects/${body.project.id}`, memberCookie),
        projectRouteContext,
      )).status, 404);

      const view = await putSpaceMember(request(`/api/knowledge-spaces/${body.knowledgeSpaceId}/members`, adminCookie, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-member", accessLevel: "view" }),
      }), routeContext);
      assert.equal(view.status, 200);
      let memberSpaces = await getSpaces(request("/api/knowledge-spaces", memberCookie));
      let listed = (await memberSpaces.json() as {
        knowledgeSpaces: Array<{
          id: string;
          accessLevel: string;
          permissions: ProjectPermissions | null;
        }>;
      }).knowledgeSpaces;
      assert.equal(listed.find((space) => space.id === body.knowledgeSpaceId)?.accessLevel, "view");
      assertPermissions(
        listed.find((space) => space.id === body.knowledgeSpaceId)!.permissions!,
        {
          canViewProject: true,
          canEditProject: false,
          canManageMembers: false,
          canDeleteProject: false,
          canUploadDocuments: false,
          canInviteMembers: false,
        },
      );
      const viewDetail = await getProject(
        request(`/api/projects/${body.project.id}`, memberCookie),
        projectRouteContext,
      );
      assert.equal(viewDetail.status, 200);
      assertPermissions(
        (await viewDetail.json() as {
          project: { permissions: ProjectPermissions };
        }).project.permissions,
        listed.find((space) => space.id === body.knowledgeSpaceId)!.permissions!,
      );
      assert.equal((await patchProject(
        request(`/api/projects/${body.project.id}`, memberCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "viewer must be rejected" }),
        }),
        projectRouteContext,
      )).status, 403);

      const edit = await putSpaceMember(request(`/api/knowledge-spaces/${body.knowledgeSpaceId}/members`, adminCookie, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-member", accessLevel: "edit" }),
      }), routeContext);
      assert.equal(edit.status, 200);
      memberSpaces = await getSpaces(request("/api/knowledge-spaces", memberCookie));
      listed = (await memberSpaces.json() as {
        knowledgeSpaces: Array<{
          id: string;
          accessLevel: string;
          permissions: ProjectPermissions | null;
        }>;
      }).knowledgeSpaces;
      assert.equal(listed.find((space) => space.id === body.knowledgeSpaceId)?.accessLevel, "edit");
      assertPermissions(
        listed.find((space) => space.id === body.knowledgeSpaceId)!.permissions!,
        {
          canViewProject: true,
          canEditProject: true,
          canManageMembers: false,
          canDeleteProject: false,
          canUploadDocuments: true,
          canInviteMembers: false,
        },
      );
      const editUpdate = await patchProject(
        request(`/api/projects/${body.project.id}`, memberCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: "edit membership accepted" }),
        }),
        projectRouteContext,
      );
      assert.equal(editUpdate.status, 200);

      const removed = await deleteSpaceMember(request(`/api/knowledge-spaces/${body.knowledgeSpaceId}/members`, adminCookie, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-member" }),
      }), routeContext);
      assert.equal(removed.status, 200);
      memberSpaces = await getSpaces(request("/api/knowledge-spaces", memberCookie));
      listed = (await memberSpaces.json() as {
        knowledgeSpaces: Array<{
          id: string;
          accessLevel: string;
          permissions: ProjectPermissions | null;
        }>;
      }).knowledgeSpaces;
      assert.equal(listed.some((space) => space.id === body.knowledgeSpaceId), false);
      assert.equal((await getProject(
        request(`/api/projects/${body.project.id}`, memberCookie),
        projectRouteContext,
      )).status, 404);
    } finally {
      await getDb().delete(project).where(eq(project.id, body.project.id));
    }
  });

  it("prevents demoting the last Super Admin", async () => {
    const superCookie = await login("super-admin");
    const tree = await getDepartments(request("/api/organization/departments", superCookie));
    const otherSuperAdmins = (await tree.json() as { members: Array<{ id: string; productRole: string }> }).members
      .filter((member) => member.productRole === "super_admin" && member.id !== "kivisense-mock-super-admin")
      .map((member) => member.id);
    try {
      for (const userId of otherSuperAdmins) {
        const demoted = await patchOrganizationMemberRole(request("/api/organization/members", superCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, productRole: "admin" }),
        }));
        assert.equal(demoted.status, 200);
      }
      const response = await patchOrganizationMemberRole(request("/api/organization/members", superCookie, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "kivisense-mock-super-admin", productRole: "admin" }),
      }));
      assert.equal(response.status, 409);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "LAST_ADMIN_PROTECTED");
    } finally {
      for (const userId of otherSuperAdmins) {
        const restored = await patchOrganizationMemberRole(request("/api/organization/members", superCookie, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, productRole: "super_admin" }),
        }));
        assert.equal(restored.status, 200);
      }
    }
  });
});
