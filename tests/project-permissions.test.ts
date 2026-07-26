import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProjectPermissions } from "../lib/auth/authorization";
import type { AuthenticatedPrincipal } from "../lib/auth/session";

function principal(
  id: string,
  productRole: "super_admin" | "admin" | "member",
): AuthenticatedPrincipal {
  return {
    sessionId: `session-${id}`,
    user: {
      id,
      productRole,
    },
  } as AuthenticatedPrincipal;
}

const expectedEditor = {
  canViewProject: true,
  canManageProject: true,
  canEditProject: true,
  canUploadDocuments: true,
};

describe("server-computed project permissions", () => {
  it("gives Super Admin and Admin global edit and member-management permissions", () => {
    for (const role of ["super_admin", "admin"] as const) {
      const permissions = resolveProjectPermissions(principal(role, role), {
        createdBy: "someone-else",
        projectRole: null,
      });
      assert.deepEqual(permissions, {
        ...expectedEditor,
        canManageMembers: true,
        canDeleteProject: true,
        canInviteMembers: true,
        canManageDocuments: true,
        canViewAudit: true,
      });
    }
  });

  it("keeps creator authority independent of a membership row", () => {
    const permissions = resolveProjectPermissions(principal("creator", "member"), {
      createdBy: "creator",
      projectRole: null,
    });
    assert.deepEqual(permissions, {
      ...expectedEditor,
      canManageMembers: true,
      canDeleteProject: true,
      canInviteMembers: true,
      canManageDocuments: true,
      canViewAudit: true,
    });
  });

  it("maps edit membership to content editing without member management", () => {
    const permissions = resolveProjectPermissions(principal("editor", "member"), {
      createdBy: "creator",
      projectRole: "project_member",
    });
    assert.deepEqual(permissions, {
      ...expectedEditor,
      canManageMembers: false,
      canDeleteProject: false,
      canInviteMembers: false,
      canManageDocuments: false,
      canViewAudit: false,
    });
  });

  it("maps view membership to read-only access", () => {
    assert.deepEqual(
      resolveProjectPermissions(principal("viewer", "member"), {
        createdBy: "creator",
        projectRole: "viewer",
      }),
      {
        canViewProject: true,
        canManageProject: false,
        canEditProject: false,
        canManageMembers: false,
        canDeleteProject: false,
        canUploadDocuments: false,
        canInviteMembers: false,
        canManageDocuments: false,
        canViewAudit: false,
      },
    );
  });
});
