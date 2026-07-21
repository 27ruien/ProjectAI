import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  department,
  documentGrant,
  knowledgeSpaceGrant,
  knowledgeSpace,
  organization,
  organizationMember,
  project,
  projectDocument,
  projectKnowledgeSource,
  projectMember,
  type KnowledgePermission,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import {
  listUploadableKnowledgeSpaces,
  mountProjectKnowledgeSource,
  upsertOrganizationMember,
} from "../../lib/knowledge/management";
import { KnowledgeManagementError } from "../../lib/knowledge/errors";

const prefix = "phase1-acl-test-";
const secondaryOrganizationId = `${prefix}organization`;
const secondaryProjectId = `${prefix}project`;
const privateDocumentId = `${prefix}private-document`;
const sharedDocumentId = `${prefix}shared-document`;
const restrictedDocumentId = `${prefix}restricted-document`;
const secondaryDocumentId = `${prefix}secondary-document`;
const maliciousSourceId = `${prefix}malicious-source`;
const headers = new Headers({
  origin: "http://127.0.0.1:3000",
  "user-agent": "projectai-phase1-authorization-test",
  "x-real-ip": "198.51.100.91",
});

let manager: UserRecord;
let managerB: UserRecord;
let systemAdmin: UserRecord;
let viewer: UserRecord;
let outsider: UserRecord;
let otherDepartment: UserRecord;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Phase 1 integration tests.`);
  return value;
}

function principal(currentUser: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `${prefix}${currentUser.id}`, user: currentUser };
}

async function scope(
  currentUser: UserRecord,
  projectId: string,
  permission: KnowledgePermission,
): Promise<Set<string>> {
  const result = await getDb().execute<{ document_id: string }>(sql`
    select document_id
    from projectai_authorized_documents(
      ${currentUser.id},
      ${projectId},
      ${permission}::knowledge_permission
    )
  `);
  return new Set(result.rows.map((row) => row.document_id));
}

describe("Phase 1 default-deny authorization matrix", () => {
  before(async () => {
    const users = await Promise.all([
      findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
      findUserByEmail(required("SEED_MANAGER_B_EMAIL")),
      findUserByEmail(required("SEED_ADMIN_EMAIL")),
      findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
      findUserByEmail(required("SEED_OUTSIDER_EMAIL")),
      findUserByEmail(required("SEED_OTHER_DEPT_EMAIL")),
    ]);
    assert.ok(users.every(Boolean));
    [manager, managerB, systemAdmin, viewer, outsider, otherDepartment] =
      users as UserRecord[];

    await getDb().transaction(async (tx) => {
      await tx.insert(projectDocument).values([
        {
          id: privateDocumentId,
          projectId: "project-001",
          displayName: "虚构项目私有资料",
          status: "active",
          createdBy: manager.id,
        },
        {
          id: sharedDocumentId,
          projectId: "project-001",
          knowledgeSpaceId: "ks-department-shared-test",
          visibility: "department_shared",
          displayName: "虚构部门共享资料",
          status: "active",
          createdBy: manager.id,
        },
        {
          id: restrictedDocumentId,
          projectId: "project-001",
          knowledgeSpaceId: "ks-department-restricted-test",
          visibility: "restricted",
          displayName: "虚构受限资料",
          status: "active",
          createdBy: manager.id,
        },
      ]);
      await tx.insert(documentGrant).values({
        id: `${prefix}viewer-download-deny`,
        organizationId: "org-legacy-default",
        projectId: "project-001",
        documentId: privateDocumentId,
        subjectType: "user",
        subjectId: viewer.id,
        permission: "download",
        effect: "deny",
        createdBy: manager.id,
      });

      await tx.insert(organization).values({
        id: secondaryOrganizationId,
        name: "虚构隔离组织",
        slug: `${prefix}organization`,
        createdBy: outsider.id,
      });
      await tx.insert(organizationMember).values({
        id: `${prefix}org-member`,
        organizationId: secondaryOrganizationId,
        userId: outsider.id,
        role: "organization_admin",
        createdBy: outsider.id,
      });
      await tx.insert(project).values({
        id: secondaryProjectId,
        organizationId: secondaryOrganizationId,
        name: "虚构隔离组织项目",
        clientName: "虚构客户",
        createdBy: outsider.id,
      });
      await tx.insert(projectMember).values({
        id: `${prefix}project-member`,
        projectId: secondaryProjectId,
        userId: outsider.id,
        role: "project_manager",
        createdBy: outsider.id,
      });
      await tx.insert(projectDocument).values({
        id: secondaryDocumentId,
        projectId: secondaryProjectId,
        displayName: "跨组织不可见资料",
        status: "active",
        createdBy: outsider.id,
      });
      const [secondarySpace] = await tx
        .select({ id: knowledgeSpace.id })
        .from(knowledgeSpace)
        .where(eq(knowledgeSpace.projectId, secondaryProjectId))
        .limit(1);
      assert.ok(secondarySpace);
      await tx.insert(projectKnowledgeSource).values({
        id: maliciousSourceId,
        projectId: "project-001",
        sourceType: "knowledge_space",
        knowledgeSpaceId: secondarySpace.id,
        createdBy: manager.id,
      });
    });
  });

  after(async () => {
    await getDb().transaction(async (tx) => {
      await tx.delete(documentGrant).where(sql`${documentGrant.id} like ${`${prefix}%`}`);
      await tx
        .delete(knowledgeSpaceGrant)
        .where(sql`${knowledgeSpaceGrant.id} like ${`${prefix}%`}`);
      await tx.delete(projectDocument).where(sql`${projectDocument.id} like ${`${prefix}%`}`);
      await tx
        .delete(projectKnowledgeSource)
        .where(
          sql`${projectKnowledgeSource.id} = ${maliciousSourceId} or ${projectKnowledgeSource.projectId} = ${secondaryProjectId}`,
        );
      await tx.delete(projectMember).where(eq(projectMember.projectId, secondaryProjectId));
      await tx.delete(knowledgeSpace).where(eq(knowledgeSpace.projectId, secondaryProjectId));
      await tx.delete(project).where(eq(project.id, secondaryProjectId));
      await tx
        .delete(organizationMember)
        .where(eq(organizationMember.organizationId, secondaryOrganizationId));
      await tx.delete(department).where(eq(department.organizationId, secondaryOrganizationId));
      await tx.delete(organization).where(eq(organization.id, secondaryOrganizationId));
    });
    await closeDatabasePool();
  });

  it("separates view and download for Viewer", async () => {
    assert.equal((await scope(viewer, "project-001", "view")).has(privateDocumentId), true);
    assert.equal((await scope(viewer, "project-001", "download")).has(privateDocumentId), false);
    assert.equal((await scope(manager, "project-001", "download")).has(privateDocumentId), true);
  });

  it("shares only explicitly department-shared documents", async () => {
    assert.equal((await scope(managerB, "project-002", "view")).has(sharedDocumentId), true);
    assert.equal((await scope(outsider, "project-004", "view")).has(sharedDocumentId), false);
    assert.equal((await scope(managerB, "project-002", "view")).has(privateDocumentId), false);
  });

  it("requires an explicit grant for restricted documents and gives deny priority", async () => {
    assert.equal((await scope(viewer, "project-001", "view")).has(restrictedDocumentId), false);
    await getDb().insert(documentGrant).values({
      id: `${prefix}restricted-allow`,
      organizationId: "org-legacy-default",
      projectId: "project-001",
      documentId: restrictedDocumentId,
      subjectType: "project",
      subjectId: "project-001",
      permission: "view",
      effect: "allow",
      createdBy: manager.id,
    });
    assert.equal((await scope(viewer, "project-001", "view")).has(restrictedDocumentId), true);
    await getDb().insert(documentGrant).values({
      id: `${prefix}restricted-deny`,
      organizationId: "org-legacy-default",
      projectId: "project-001",
      documentId: restrictedDocumentId,
      subjectType: "user",
      subjectId: viewer.id,
      permission: "view",
      effect: "deny",
      createdBy: manager.id,
    });
    assert.equal((await scope(viewer, "project-001", "view")).has(restrictedDocumentId), false);
  });

  it("does not let system administrators bypass an explicit content deny", async () => {
    await getDb().insert(documentGrant).values({
      id: `${prefix}system-admin-view-deny`,
      organizationId: "org-legacy-default",
      projectId: "project-001",
      documentId: privateDocumentId,
      subjectType: "user",
      subjectId: systemAdmin.id,
      permission: "view",
      effect: "deny",
      createdBy: manager.id,
    });
    assert.equal(
      (await scope(systemAdmin, "project-001", "view")).has(privateDocumentId),
      false,
    );
  });

  it("does not let privileged membership bypass a space deny while mounting", async () => {
    await getDb().insert(knowledgeSpaceGrant).values({
      id: `${prefix}manager-mount-deny`,
      organizationId: "org-legacy-default",
      knowledgeSpaceId: "ks-department-shared-test",
      subjectType: "user",
      subjectId: managerB.id,
      permission: "view",
      effect: "deny",
      createdBy: manager.id,
    });
    await assert.rejects(
      mountProjectKnowledgeSource({
        principal: principal(managerB),
        projectId: "project-002",
        sourceType: "knowledge_space",
        knowledgeSpaceId: "ks-department-shared-test",
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof KnowledgeManagementError &&
        error.code === "RESOURCE_NOT_FOUND",
    );
  });

  it("does not accept a cross-organization source even if a row is injected", async () => {
    assert.equal((await scope(manager, "project-001", "view")).has(secondaryDocumentId), false);
    assert.equal((await scope(outsider, secondaryProjectId, "view")).has(secondaryDocumentId), true);
  });

  it("does not treat an administrator role from another department as an upload grant", async () => {
    await getDb().insert(knowledgeSpaceGrant).values([
      {
        id: `${prefix}department-admin-upload`,
        organizationId: "org-legacy-default",
        knowledgeSpaceId: "ks-department-shared-test",
        subjectType: "role",
        subjectId: "department_admin",
        permission: "upload",
        effect: "allow",
        createdBy: manager.id,
      },
      {
        id: `${prefix}cross-department-project-upload`,
        organizationId: "org-legacy-default",
        knowledgeSpaceId: "ks-department-shared-test",
        subjectType: "project",
        subjectId: "project-004",
        permission: "upload",
        effect: "allow",
        createdBy: manager.id,
      },
    ]);
    const destinations = await listUploadableKnowledgeSpaces({
      principal: principal(otherDepartment),
      projectId: "project-004",
      requestHeaders: headers,
    });
    assert.equal(
      destinations.some((space) => space.id === "ks-department-shared-test"),
      false,
    );
  });

  it("protects the last organization administrator", async () => {
    await assert.rejects(
      upsertOrganizationMember({
        principal: principal(outsider),
        organizationId: secondaryOrganizationId,
        userId: outsider.id,
        role: "organization_member",
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof KnowledgeManagementError &&
        error.code === "LAST_ADMIN_PROTECTED",
    );
  });
});
