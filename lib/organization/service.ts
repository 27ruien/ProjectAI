import { and, asc, eq, inArray } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  department,
  departmentMember,
  knowledgeSpace,
  projectDocument,
  organization,
  organizationMember,
  user,
} from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";

async function requireKivisenseSuperAdmin(
  principal: AuthenticatedPrincipal,
  db: DatabaseExecutor = getDb(),
) {
  if (principal.user.productRole !== "super_admin") {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "页面不存在");
  }
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

async function validateHeads(input: {
  organizationId: string;
  headUserIds: string[];
  db: DatabaseExecutor;
}): Promise<void> {
  const uniqueIds = [...new Set(input.headUserIds)];
  if (uniqueIds.length !== input.headUserIds.length || uniqueIds.length > 20) {
    throw new KnowledgeManagementError(400, "INVALID_REQUEST", "部门负责人列表无效");
  }
  if (!uniqueIds.length) return;
  const rows = await input.db
    .select({ userId: organizationMember.userId })
    .from(organizationMember)
    .innerJoin(user, eq(user.id, organizationMember.userId))
    .where(
      and(
        eq(organizationMember.organizationId, input.organizationId),
        eq(organizationMember.isActive, true),
        eq(user.status, "active"),
        inArray(organizationMember.userId, uniqueIds),
      ),
    );
  if (rows.length !== uniqueIds.length) {
    throw new KnowledgeManagementError(400, "INVALID_REQUEST", "负责人必须是当前组织的有效成员");
  }
}

export async function getOrganizationTree(principal: AuthenticatedPrincipal) {
  const db = getDb();
  const currentOrganization = await requireKivisenseSuperAdmin(principal, db);
  const [departments, members] = await Promise.all([
    db
      .select()
      .from(department)
      .where(eq(department.organizationId, currentOrganization.id))
      .orderBy(asc(department.level), asc(department.sortOrder), asc(department.name)),
    db
      .select({ id: user.id, displayName: user.displayName, productRole: user.productRole })
      .from(organizationMember)
      .innerJoin(user, eq(user.id, organizationMember.userId))
      .where(
        and(
          eq(organizationMember.organizationId, currentOrganization.id),
          eq(organizationMember.isActive, true),
          eq(user.status, "active"),
        ),
      )
      .orderBy(asc(user.displayName)),
  ]);
  return { organization: currentOrganization, departments, members };
}

export async function createOrganizationDepartment(input: {
  principal: AuthenticatedPrincipal;
  parentDepartmentId: string | null;
  name: string;
  code: string;
  headUserIds: string[];
  sortOrder: number;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const currentOrganization = await requireKivisenseSuperAdmin(input.principal, tx);
    const [parent] = input.parentDepartmentId
      ? await tx
          .select()
          .from(department)
          .where(
            and(
              eq(department.id, input.parentDepartmentId),
              eq(department.organizationId, currentOrganization.id),
              eq(department.status, "active"),
            ),
          )
          .limit(1)
          .for("update", { of: department })
      : [];
    if (input.parentDepartmentId && !parent) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "上级部门不存在");
    }
    const level = parent ? parent.level + 1 : 1;
    if (level > 4) {
      throw new KnowledgeManagementError(409, "DEPARTMENT_DEPTH_EXCEEDED", "部门最多支持四级");
    }
    await validateHeads({
      organizationId: currentOrganization.id,
      headUserIds: input.headUserIds,
      db: tx,
    });
    const id = crypto.randomUUID();
    const [created] = await tx
      .insert(department)
      .values({
        id,
        organizationId: currentOrganization.id,
        parentDepartmentId: input.parentDepartmentId,
        level,
        name: input.name,
        code: input.code,
        description: "",
        status: "active",
        headUserIds: input.headUserIds,
        sortOrder: input.sortOrder,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx.insert(knowledgeSpace).values({
      id: `ks-department-${id}`,
      organizationId: currentOrganization.id,
      departmentId: id,
      type: "department",
      visibility: "department_shared",
      name: `${input.name} 共享空间`,
      description: "部门默认共享知识空间",
      createdBy: input.principal.user.id,
    });
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "department_created",
        entityType: "department",
        entityId: id,
        result: "succeeded",
        metadata: { level, parentDepartmentId: input.parentDepartmentId },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return created;
  });
}

function subtreeIds(
  rows: Array<typeof department.$inferSelect>,
  rootId: string,
): string[] {
  const ids = [rootId];
  for (let cursor = 0; cursor < ids.length; cursor += 1) {
    const parentId = ids[cursor];
    for (const row of rows) {
      if (row.parentDepartmentId === parentId && !ids.includes(row.id)) ids.push(row.id);
    }
  }
  return ids;
}

export async function updateOrganizationDepartment(input: {
  principal: AuthenticatedPrincipal;
  departmentId: string;
  parentDepartmentId?: string | null;
  name?: string;
  status?: "active" | "inactive";
  headUserIds?: string[];
  sortOrder?: number;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const currentOrganization = await requireKivisenseSuperAdmin(input.principal, tx);
    const departments = await tx
      .select()
      .from(department)
      .where(eq(department.organizationId, currentOrganization.id))
      .for("update", { of: department });
    const current = departments.find((item) => item.id === input.departmentId);
    if (!current) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "部门不存在");
    }
    const descendants = subtreeIds(departments, current.id);
    const targetParentId = input.parentDepartmentId === undefined
      ? current.parentDepartmentId
      : input.parentDepartmentId;
    if (targetParentId && descendants.includes(targetParentId)) {
      throw new KnowledgeManagementError(409, "DEPARTMENT_CYCLE", "部门不能移动到自身或子部门下");
    }
    const targetParent = targetParentId
      ? departments.find((item) => item.id === targetParentId && item.status === "active")
      : null;
    if (targetParentId && !targetParent) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "上级部门不存在");
    }
    const nextLevel = targetParent ? targetParent.level + 1 : 1;
    const levelDelta = nextLevel - current.level;
    const deepestLevel = Math.max(
      ...departments.filter((item) => descendants.includes(item.id)).map((item) => item.level + levelDelta),
    );
    if (deepestLevel > 4) {
      throw new KnowledgeManagementError(409, "DEPARTMENT_DEPTH_EXCEEDED", "移动后部门层级将超过四级");
    }
    if (input.status === "inactive") {
      const activeChild = departments.some(
        (item) => item.parentDepartmentId === current.id && item.status === "active",
      );
      const [[memberCount], activeSpaces] = await Promise.all([
        tx
          .select({ id: departmentMember.id })
          .from(departmentMember)
          .where(and(eq(departmentMember.departmentId, current.id), eq(departmentMember.isActive, true)))
          .limit(1),
        tx
          .select({ id: knowledgeSpace.id })
          .from(knowledgeSpace)
          .where(and(eq(knowledgeSpace.departmentId, current.id), eq(knowledgeSpace.isActive, true)))
      ]);
      const activeDocuments = activeSpaces.length
        ? await tx
            .select({ id: projectDocument.id })
            .from(projectDocument)
            .where(and(
              inArray(projectDocument.knowledgeSpaceId, activeSpaces.map((space) => space.id)),
              inArray(projectDocument.status, ["pending", "active"]),
            ))
            .limit(1)
        : [];
      const onlyEmptyDefaultSpace =
        activeSpaces.every((space) => space.id === `ks-department-${current.id}`) &&
        activeDocuments.length === 0;
      if (activeChild || memberCount || !onlyEmptyDefaultSpace) {
        throw new KnowledgeManagementError(
          409,
          "DEPARTMENT_NOT_EMPTY",
          "停用前需先处理子部门、成员和知识空间",
        );
      }
      if (activeSpaces.length) {
        await tx
          .update(knowledgeSpace)
          .set({ isActive: false, updatedAt: new Date() })
          .where(inArray(knowledgeSpace.id, activeSpaces.map((space) => space.id)));
      }
    }
    if (input.headUserIds) {
      await validateHeads({
        organizationId: currentOrganization.id,
        headUserIds: input.headUserIds,
        db: tx,
      });
    }
    if (levelDelta !== 0) {
      for (const item of departments.filter((row) => descendants.includes(row.id))) {
        await tx
          .update(department)
          .set({ level: item.level + levelDelta, updatedAt: new Date() })
          .where(eq(department.id, item.id));
      }
    }
    const [updated] = await tx
      .update(department)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: input.status, isActive: input.status === "active" }),
        ...(input.headUserIds === undefined ? {} : { headUserIds: input.headUserIds }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        parentDepartmentId: targetParentId,
        level: nextLevel,
        updatedAt: new Date(),
      })
      .where(eq(department.id, current.id))
      .returning();
    if (input.status === "active") {
      await tx
        .update(knowledgeSpace)
        .set({
          isActive: true,
          ...(input.name === undefined ? {} : { name: `${input.name} 共享空间` }),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSpace.id, `ks-department-${current.id}`));
    } else if (input.name !== undefined) {
      await tx
        .update(knowledgeSpace)
        .set({ name: `${input.name} 共享空间`, updatedAt: new Date() })
        .where(eq(knowledgeSpace.id, `ks-department-${current.id}`));
    }
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "department_updated",
        entityType: "department",
        entityId: current.id,
        result: "succeeded",
        metadata: {
          moved: targetParentId !== current.parentDepartmentId,
          status: updated.status,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return updated;
  });
}

export async function updateOrganizationMemberRole(input: {
  principal: AuthenticatedPrincipal;
  userId: string;
  productRole: "super_admin" | "admin" | "member";
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const currentOrganization = await requireKivisenseSuperAdmin(input.principal, tx);
    const [target] = await tx
      .select({ id: user.id, productRole: user.productRole })
      .from(organizationMember)
      .innerJoin(user, eq(user.id, organizationMember.userId))
      .where(and(
        eq(organizationMember.organizationId, currentOrganization.id),
        eq(organizationMember.userId, input.userId),
        eq(organizationMember.isActive, true),
        eq(user.status, "active"),
      ))
      .limit(1)
      .for("update", { of: user });
    if (!target) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "组织成员不存在");
    if (target.productRole === "super_admin" && input.productRole !== "super_admin") {
      const superAdmins = await tx
        .select({ id: user.id })
        .from(organizationMember)
        .innerJoin(user, eq(user.id, organizationMember.userId))
        .where(and(
          eq(organizationMember.organizationId, currentOrganization.id),
          eq(organizationMember.isActive, true),
          eq(user.status, "active"),
          eq(user.productRole, "super_admin"),
        ))
        .for("update", { of: user });
      if (superAdmins.length <= 1) {
        throw new KnowledgeManagementError(409, "LAST_ADMIN_PROTECTED", "必须保留至少一名超级管理员");
      }
    }
    const [updated] = await tx
      .update(user)
      .set({
        productRole: input.productRole,
        systemRole: input.productRole === "super_admin" ? "system_admin" : "standard_user",
        updatedAt: new Date(),
      })
      .where(eq(user.id, target.id))
      .returning({ id: user.id, productRole: user.productRole });
    await writeAuditEvent({
      actorUserId: input.principal.user.id,
      eventType: "organization_member_role_changed",
      entityType: "user",
      entityId: target.id,
      result: "succeeded",
      metadata: { before: target.productRole, after: input.productRole },
      ...getRequestAuditContext(input.requestHeaders),
    }, tx);
    return updated;
  });
}
