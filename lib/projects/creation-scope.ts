import { and, asc, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { isProductAdmin } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  department,
  departmentMember,
  organization,
  organizationMember,
} from "@/lib/db/schema";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";

export async function resolveProjectCreationScope(input: {
  principal: AuthenticatedPrincipal;
  requestedDepartmentId?: string | null;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const [currentOrganization] = await db
    .select()
    .from(organization)
    .where(and(eq(organization.slug, "kivisense"), eq(organization.isActive, true)))
    .limit(1);
  if (!currentOrganization) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "组织不存在");
  }
  const [membership] = await db
    .select({ id: organizationMember.id })
    .from(organizationMember)
    .where(and(
      eq(organizationMember.organizationId, currentOrganization.id),
      eq(organizationMember.userId, input.principal.user.id),
      eq(organizationMember.isActive, true),
    ))
    .limit(1);
  if (!membership && !isProductAdmin(input.principal.user.productRole)) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "组织不存在");
  }
  const allowedDepartments = isProductAdmin(input.principal.user.productRole)
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
    throw new KnowledgeManagementError(400, "DEPARTMENT_REQUIRED", "当前账号没有可用部门");
  }
  return { organizationId: currentOrganization.id, departmentId };
}
