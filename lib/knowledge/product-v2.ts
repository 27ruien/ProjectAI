import { and, asc, eq, inArray } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  department,
  departmentMember,
  knowledgeSpace,
  knowledgeSpaceMember,
  organization,
  organizationMember,
  project,
  projectMember,
  user,
} from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { resolveProjectPermissions } from "@/lib/auth/authorization";
import { KnowledgeManagementError } from "./errors";

type SpaceAccess = "view" | "edit";

function isProductAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.user.productRole === "super_admin" || principal.user.productRole === "admin";
}

async function kivisenseOrganization(db: DatabaseExecutor = getDb()) {
  const [record] = await db
    .select()
    .from(organization)
    .where(and(eq(organization.slug, "kivisense"), eq(organization.isActive, true)))
    .limit(1);
  if (!record) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "Kivisense 组织尚未初始化");
  }
  return record;
}

export async function listProductKnowledgeSpaces(principal: AuthenticatedPrincipal) {
  const db = getDb();
  const currentOrganization = await kivisenseOrganization(db);
  const [organizationMembership, departments, spaces, projects, departmentMemberships, projectMemberships, directMemberships] = await Promise.all([
    db
      .select({ id: organizationMember.id })
      .from(organizationMember)
      .where(and(
        eq(organizationMember.organizationId, currentOrganization.id),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.isActive, true),
      ))
      .limit(1),
    db
      .select()
      .from(department)
      .where(and(eq(department.organizationId, currentOrganization.id), eq(department.isActive, true)))
      .orderBy(asc(department.level), asc(department.sortOrder), asc(department.name)),
    db
      .select()
      .from(knowledgeSpace)
      .where(and(eq(knowledgeSpace.organizationId, currentOrganization.id), eq(knowledgeSpace.isActive, true)))
      .orderBy(asc(knowledgeSpace.name)),
    db
      .select()
      .from(project)
      .where(eq(project.organizationId, currentOrganization.id))
      .orderBy(asc(project.name)),
    db
      .select()
      .from(departmentMember)
      .where(and(eq(departmentMember.userId, principal.user.id), eq(departmentMember.isActive, true))),
    db
      .select()
      .from(projectMember)
      .where(eq(projectMember.userId, principal.user.id)),
    db
      .select()
      .from(knowledgeSpaceMember)
      .where(and(eq(knowledgeSpaceMember.userId, principal.user.id), eq(knowledgeSpaceMember.isActive, true))),
  ]);
  if (!organizationMembership.length && !isProductAdmin(principal)) {
    return { organization: null, departments: [], knowledgeSpaces: [] };
  }

  const departmentById = new Map(departments.map((item) => [item.id, item]));
  const projectById = new Map(projects.map((item) => [item.id, item]));
  const departmentIds = new Set(departmentMemberships.map((item) => item.departmentId));
  const projectRoleById = new Map(projectMemberships.map((item) => [item.projectId, item.role]));
  const directAccessBySpaceId = new Map(directMemberships.map((item) => [item.knowledgeSpaceId, item.accessLevel]));
  const visibleProjects = isProductAdmin(principal)
    ? projects
    : projects.filter((item) =>
        item.createdBy === principal.user.id || projectRoleById.has(item.id));

  const summaries = spaces.flatMap((space) => {
    const currentProject = space.projectId ? projectById.get(space.projectId) : undefined;
    const effectiveDepartmentId = space.departmentId ?? currentProject?.departmentId ?? null;
    const currentDepartment = effectiveDepartmentId ? departmentById.get(effectiveDepartmentId) : undefined;
    const directAccess = directAccessBySpaceId.get(space.id);
    const storedProjectRole = space.projectId
      ? projectRoleById.get(space.projectId)
      : undefined;
    const projectRole = storedProjectRole ?? (
      directAccess === "edit"
        ? "project_member"
        : directAccess === "view"
          ? "viewer"
          : null
    );
    const hasProjectAccess = Boolean(
      currentProject && (
        isProductAdmin(principal) ||
        currentProject.createdBy === principal.user.id ||
        projectRole
      ),
    );
    const projectPermissions = currentProject && hasProjectAccess
      ? resolveProjectPermissions(principal, {
          createdBy: currentProject.createdBy,
          projectRole,
        })
      : null;
    const departmentAccess = Boolean(
      space.type === "department" &&
      space.visibility === "department_shared" &&
      effectiveDepartmentId &&
      departmentIds.has(effectiveDepartmentId),
    );
    const isDepartmentHead = Boolean(currentDepartment?.headUserIds.includes(principal.user.id));
    let accessLevel: SpaceAccess | null = null;
    if (space.type === "project" && projectPermissions) {
      accessLevel = projectPermissions.canEditProject ? "edit" : "view";
    } else if (isProductAdmin(principal)) accessLevel = "edit";
    else if (directAccess === "edit") accessLevel = "edit";
    else if (directAccess === "view") accessLevel = "view";
    else if (departmentAccess) accessLevel = isDepartmentHead ? "edit" : "view";
    if (!accessLevel || !["department", "project"].includes(space.type)) return [];

    const projectContext = currentProject ?? visibleProjects.find((item) => item.departmentId === effectiveDepartmentId);
    const canManageMembers = space.type === "project"
      ? Boolean(projectPermissions?.canManageMembers)
      : isProductAdmin(principal);
    return [{
      id: space.id,
      name: space.name,
      description: space.description,
      type: space.type as "department" | "project",
      visibility: space.visibility,
      departmentId: effectiveDepartmentId,
      departmentName: currentDepartment?.name ?? null,
      projectId: space.projectId,
      projectName: currentProject?.name ?? null,
      projectContextId: projectContext?.id ?? null,
      accessLevel,
      permissions: projectPermissions,
      canUpload: space.type === "project"
        ? Boolean(projectPermissions?.canUploadDocuments && projectContext)
        : accessLevel === "edit" && Boolean(projectContext),
      canManageMembers,
      createdBy: space.createdBy,
      updatedAt: space.updatedAt.toISOString(),
    }];
  });

  const visibleDepartmentIds = isProductAdmin(principal)
    ? new Set(departments.map((item) => item.id))
    : departmentIds;
  return {
    organization: { id: currentOrganization.id, name: currentOrganization.name },
    departments: departments
      .filter((item) => visibleDepartmentIds.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, level: item.level, parentDepartmentId: item.parentDepartmentId })),
    knowledgeSpaces: summaries,
  };
}

export async function resolveProjectCreationScope(input: {
  principal: AuthenticatedPrincipal;
  requestedDepartmentId?: string | null;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const currentOrganization = await kivisenseOrganization(db);
  const [membership] = await db
    .select({ id: organizationMember.id })
    .from(organizationMember)
    .where(and(
      eq(organizationMember.organizationId, currentOrganization.id),
      eq(organizationMember.userId, input.principal.user.id),
      eq(organizationMember.isActive, true),
    ))
    .limit(1);
  if (!membership && !isProductAdmin(input.principal)) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "组织不存在");
  }

  const allowedDepartments = isProductAdmin(input.principal)
    ? await db
        .select({ id: department.id })
        .from(department)
        .where(and(eq(department.organizationId, currentOrganization.id), eq(department.isActive, true)))
        .orderBy(asc(department.level), asc(department.sortOrder))
    : await db
        .select({ id: department.id })
        .from(departmentMember)
        .innerJoin(department, eq(department.id, departmentMember.departmentId))
        .where(and(
          eq(departmentMember.userId, input.principal.user.id),
          eq(departmentMember.isActive, true),
          eq(department.organizationId, currentOrganization.id),
          eq(department.isActive, true),
        ));
  const departmentId = input.requestedDepartmentId ?? allowedDepartments[0]?.id ?? null;
  if (!departmentId || !allowedDepartments.some((item) => item.id === departmentId)) {
    throw new KnowledgeManagementError(400, "DEPARTMENT_REQUIRED", "请选择自己所属的有效部门");
  }
  return { organizationId: currentOrganization.id, departmentId };
}

async function requireManageableSpace(input: {
  principal: AuthenticatedPrincipal;
  spaceId: string;
  db: DatabaseExecutor;
}) {
  const [record] = await input.db
    .select({ space: knowledgeSpace, projectRole: projectMember.role })
    .from(knowledgeSpace)
    .leftJoin(
      projectMember,
      and(
        eq(projectMember.projectId, knowledgeSpace.projectId),
        eq(projectMember.userId, input.principal.user.id),
      ),
    )
    .where(and(eq(knowledgeSpace.id, input.spaceId), eq(knowledgeSpace.isActive, true)))
    .limit(1)
    .for("update", { of: knowledgeSpace });
  if (
    !record ||
    !["department", "project"].includes(record.space.type) ||
    !(
      isProductAdmin(input.principal) ||
      (record.space.type === "project" &&
        Boolean(record.space.projectId) &&
        (record.space.createdBy === input.principal.user.id || record.projectRole === "project_manager"))
    )
  ) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "知识空间不存在");
  }
  return record.space;
}

export async function listProjectSpaceMembers(input: {
  principal: AuthenticatedPrincipal;
  spaceId: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const space = await requireManageableSpace({ ...input, db: tx });
    const [members, eligibleUsers] = await Promise.all([
      tx
        .select({
          userId: user.id,
          displayName: user.displayName,
          accessLevel: knowledgeSpaceMember.accessLevel,
          isActive: knowledgeSpaceMember.isActive,
          invitedBy: knowledgeSpaceMember.createdBy,
          updatedAt: knowledgeSpaceMember.updatedAt,
        })
        .from(knowledgeSpaceMember)
        .innerJoin(user, eq(user.id, knowledgeSpaceMember.userId))
        .where(and(eq(knowledgeSpaceMember.knowledgeSpaceId, space.id), eq(knowledgeSpaceMember.isActive, true)))
        .orderBy(asc(user.displayName)),
      tx
        .select({ userId: user.id, displayName: user.displayName, productRole: user.productRole })
        .from(organizationMember)
        .innerJoin(user, eq(user.id, organizationMember.userId))
        .where(and(
          eq(organizationMember.organizationId, space.organizationId),
          eq(organizationMember.isActive, true),
          eq(user.status, "active"),
        ))
        .orderBy(asc(user.displayName)),
    ]);
    return {
      space: { id: space.id, name: space.name, createdBy: space.createdBy },
      members: members.map((item) => ({
        ...item,
        isCreator: item.userId === space.createdBy,
        updatedAt: item.updatedAt.toISOString(),
      })),
      eligibleUsers,
    };
  });
}

export async function setProjectSpaceMember(input: {
  principal: AuthenticatedPrincipal;
  spaceId: string;
  userId: string;
  accessLevel: SpaceAccess;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const space = await requireManageableSpace({ principal: input.principal, spaceId: input.spaceId, db: tx });
    if (space.type === "project" && input.userId === space.createdBy && input.accessLevel !== "edit") {
      throw new KnowledgeManagementError(409, "CREATOR_ACCESS_REQUIRED", "创建者必须保留编辑权限");
    }
    const [subject] = await tx
      .select({ id: user.id })
      .from(organizationMember)
      .innerJoin(user, eq(user.id, organizationMember.userId))
      .where(and(
        eq(organizationMember.organizationId, space.organizationId),
        eq(organizationMember.userId, input.userId),
        eq(organizationMember.isActive, true),
        eq(user.status, "active"),
      ))
      .limit(1);
    if (!subject) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "组织成员不存在");
    const now = new Date();
    const [membership] = await tx
      .insert(knowledgeSpaceMember)
      .values({
        id: crypto.randomUUID(),
        knowledgeSpaceId: space.id,
        userId: input.userId,
        role: input.accessLevel === "edit" ? "editor" : "viewer",
        accessLevel: input.accessLevel,
        createdBy: input.principal.user.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [knowledgeSpaceMember.knowledgeSpaceId, knowledgeSpaceMember.userId],
        set: {
          role: input.accessLevel === "edit" ? "editor" : "viewer",
          accessLevel: input.accessLevel,
          isActive: true,
          updatedAt: now,
        },
      })
      .returning();
    if (space.type === "project" && space.projectId) {
      const [existingProjectMember] = await tx
        .select()
        .from(projectMember)
        .where(and(eq(projectMember.projectId, space.projectId), eq(projectMember.userId, input.userId)))
        .limit(1);
      if (existingProjectMember?.role === "project_manager" && input.accessLevel !== "edit") {
        throw new KnowledgeManagementError(409, "PROJECT_MANAGER_EDIT_REQUIRED", "项目经理必须保留编辑权限");
      }
      if (!existingProjectMember) {
        await tx.insert(projectMember).values({
          id: crypto.randomUUID(),
          projectId: space.projectId,
          userId: input.userId,
          role: input.accessLevel === "edit" ? "project_member" : "viewer",
          createdBy: input.principal.user.id,
        });
      } else if (existingProjectMember.role !== "project_manager") {
        await tx
          .update(projectMember)
          .set({ role: input.accessLevel === "edit" ? "project_member" : "viewer" })
          .where(eq(projectMember.id, existingProjectMember.id));
      }
    }
    await writeAuditEvent({
      actorUserId: input.principal.user.id,
      projectId: space.projectId,
      eventType: "knowledge_space_member_access_set",
      entityType: "knowledge_space_member",
      entityId: membership.id,
      result: "succeeded",
      metadata: { accessLevel: input.accessLevel, subjectUserId: input.userId },
      ...getRequestAuditContext(input.requestHeaders),
    }, tx);
    return { userId: input.userId, accessLevel: input.accessLevel };
  });
}

export async function removeProjectSpaceMember(input: {
  principal: AuthenticatedPrincipal;
  spaceId: string;
  userId: string;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const space = await requireManageableSpace({ principal: input.principal, spaceId: input.spaceId, db: tx });
    if (space.type === "project" && input.userId === space.createdBy) {
      throw new KnowledgeManagementError(409, "CREATOR_ACCESS_REQUIRED", "不能移除项目空间创建者");
    }
    const [projectMembership] = space.projectId
      ? await tx
          .select({ role: projectMember.role })
          .from(projectMember)
          .where(and(eq(projectMember.projectId, space.projectId), eq(projectMember.userId, input.userId)))
          .limit(1)
      : [];
    if (projectMembership?.role === "project_manager") {
      throw new KnowledgeManagementError(409, "PROJECT_MANAGER_EDIT_REQUIRED", "不能通过知识空间移除项目经理");
    }
    const now = new Date();
    const [membership] = await tx
      .update(knowledgeSpaceMember)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(knowledgeSpaceMember.knowledgeSpaceId, space.id), eq(knowledgeSpaceMember.userId, input.userId)))
      .returning({ id: knowledgeSpaceMember.id });
    if (!membership) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "空间成员不存在");
    if (space.projectId) {
      await tx
        .delete(projectMember)
        .where(and(
          eq(projectMember.projectId, space.projectId),
          eq(projectMember.userId, input.userId),
          inArray(projectMember.role, ["project_member", "viewer"]),
        ));
    }
    await writeAuditEvent({
      actorUserId: input.principal.user.id,
      projectId: space.projectId,
      eventType: "knowledge_space_member_removed",
      entityType: "knowledge_space_member",
      entityId: membership.id,
      result: "succeeded",
      metadata: { subjectUserId: input.userId },
      ...getRequestAuditContext(input.requestHeaders),
    }, tx);
    return { userId: input.userId, removed: true as const };
  });
}
