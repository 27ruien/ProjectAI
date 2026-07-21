import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { requireProjectRole } from "@/lib/auth/authorization";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  department,
  departmentMember,
  documentGrant,
  knowledgeSpace,
  knowledgeSpaceGrant,
  knowledgeSpaceMember,
  organization,
  organizationMember,
  permissionAudit,
  projectDocument,
  projectKnowledgeSource,
  projectMember,
  user,
  type DepartmentRole,
  type GrantEffect,
  type GrantSubjectType,
  type KnowledgePermission,
  type KnowledgeSpaceType,
  type KnowledgeVisibility,
  type OrganizationRole,
} from "@/lib/db/schema";
import { KnowledgeManagementError } from "./errors";
import { findAuthorizedDocument } from "./authorization";
import { listAuthorizedDocumentScope } from "./authorization";

type AuditInput = {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  projectId?: string | null;
  eventType: string;
  resourceType: string;
  resourceId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  requestHeaders: Headers;
  db: DatabaseExecutor;
};

async function requireValidGrantSubject(input: {
  organizationId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
  db: DatabaseExecutor;
}): Promise<void> {
  const result = await input.db.execute<{ valid: boolean }>(sql`
    select case ${input.subjectType}::grant_subject_type
      when 'organization' then exists (
        select 1 from organizations
        where id = ${input.subjectId} and id = ${input.organizationId} and is_active
      )
      when 'department' then exists (
        select 1 from departments
        where id = ${input.subjectId}
          and organization_id = ${input.organizationId}
          and is_active
      )
      when 'project' then exists (
        select 1 from projects
        where id = ${input.subjectId}
          and organization_id = ${input.organizationId}
      )
      when 'user' then exists (
        select 1
        from organization_members membership
        join users subject_user on subject_user.id = membership.user_id
        where membership.organization_id = ${input.organizationId}
          and membership.user_id = ${input.subjectId}
          and membership.is_active
          and subject_user.status = 'active'
      )
      when 'role' then ${input.subjectId} in (
        'organization_admin', 'organization_member',
        'department_admin', 'department_member',
        'project_manager', 'project_member', 'viewer'
      )
      else false
    end as valid
  `);
  if (!result.rows[0]?.valid) {
    throw new KnowledgeManagementError(
      404,
      "RESOURCE_NOT_FOUND",
      "授权对象不存在",
    );
  }
}

async function canMountKnowledgeSpace(input: {
  principal: AuthenticatedPrincipal;
  target: Awaited<ReturnType<typeof requireProjectRole>>;
  space: typeof knowledgeSpace.$inferSelect;
  db: DatabaseExecutor;
}): Promise<boolean> {
  const [orgMembership] = await input.db
    .select()
    .from(organizationMember)
    .where(
      and(
        eq(organizationMember.organizationId, input.target.organizationId),
        eq(organizationMember.userId, input.principal.user.id),
        eq(organizationMember.isActive, true),
      ),
    )
    .limit(1);
  const [deptMembership] = input.target.departmentId
    ? await input.db
        .select()
        .from(departmentMember)
        .where(
          and(
            eq(departmentMember.departmentId, input.target.departmentId),
            eq(departmentMember.userId, input.principal.user.id),
            eq(departmentMember.isActive, true),
          ),
        )
        .limit(1)
    : [];
  const [spaceMembership] = await input.db
    .select()
    .from(knowledgeSpaceMember)
    .where(
      and(
        eq(knowledgeSpaceMember.knowledgeSpaceId, input.space.id),
        eq(knowledgeSpaceMember.userId, input.principal.user.id),
        eq(knowledgeSpaceMember.isActive, true),
      ),
    )
    .limit(1);
  const grants = await input.db
    .select()
    .from(knowledgeSpaceGrant)
    .where(
      and(
        eq(knowledgeSpaceGrant.knowledgeSpaceId, input.space.id),
        eq(knowledgeSpaceGrant.permission, "view"),
      ),
    );
  const roles = new Set<string>(
    [input.target.projectRole, orgMembership?.role, deptMembership?.role].filter(
      Boolean,
    ) as string[],
  );
  const matching = grants.filter((grant) => {
    switch (grant.subjectType) {
      case "organization":
        return grant.subjectId === input.target.organizationId;
      case "department":
        return grant.subjectId === input.target.departmentId;
      case "project":
        return grant.subjectId === input.target.id;
      case "user":
        return grant.subjectId === input.principal.user.id;
      case "role":
        return roles.has(grant.subjectId);
    }
  });
  if (matching.some((grant) => grant.effect === "deny")) return false;
  if (input.principal.user.systemRole === "system_admin") return true;
  if (!orgMembership) return false;
  if (
    orgMembership.role === "organization_admin" ||
    input.space.projectId === input.target.id ||
    spaceMembership
  ) {
    return true;
  }
  if (matching.some((grant) => grant.effect === "allow")) return true;
  if (input.space.visibility === "organization_shared") return true;
  return (
    input.space.visibility === "department_shared" &&
    Boolean(input.target.departmentId) &&
    input.space.departmentId === input.target.departmentId
  );
}

async function listMountableKnowledgeSpaceIds(input: {
  principal: AuthenticatedPrincipal;
  target: Awaited<ReturnType<typeof requireProjectRole>>;
  db: DatabaseExecutor;
}): Promise<Set<string>> {
  const result = await input.db.execute<{ id: string }>(sql`
    select distinct space.id
    from project_knowledge_sources source
    join knowledge_spaces space
      on space.id = source.knowledge_space_id
      and space.organization_id = ${input.target.organizationId}
      and space.is_active
    where source.project_id = ${input.target.id}
      and source.source_type = 'knowledge_space'
      and source.is_active
      and not exists (
        select 1
        from knowledge_space_grants denied
        where denied.knowledge_space_id = space.id
          and denied.permission = 'view'
          and denied.effect = 'deny'
          and (
            (denied.subject_type = 'organization' and denied.subject_id = ${input.target.organizationId})
            or (denied.subject_type = 'department' and denied.subject_id = ${input.target.departmentId})
            or (denied.subject_type = 'project' and denied.subject_id = ${input.target.id})
            or (denied.subject_type = 'user' and denied.subject_id = ${input.principal.user.id})
            or (
              denied.subject_type = 'role'
              and (
                denied.subject_id = ${input.target.projectRole}
                or exists (
                  select 1 from organization_members deny_org_role
                  where deny_org_role.organization_id = ${input.target.organizationId}
                    and deny_org_role.user_id = ${input.principal.user.id}
                    and deny_org_role.is_active
                    and deny_org_role.role::text = denied.subject_id
                )
                or exists (
                  select 1 from department_members deny_dept_role
                  where deny_dept_role.organization_id = ${input.target.organizationId}
                    and deny_dept_role.department_id = ${input.target.departmentId}
                    and deny_dept_role.user_id = ${input.principal.user.id}
                    and deny_dept_role.is_active
                    and deny_dept_role.role::text = denied.subject_id
                )
              )
            )
          )
      )
      and (
        ${input.principal.user.systemRole} = 'system_admin'
        or space.project_id = ${input.target.id}
        or exists (
          select 1 from organization_members mount_org_admin
          where mount_org_admin.organization_id = ${input.target.organizationId}
            and mount_org_admin.user_id = ${input.principal.user.id}
            and mount_org_admin.role = 'organization_admin'
            and mount_org_admin.is_active
        )
        or exists (
          select 1 from knowledge_space_members mount_space_member
          where mount_space_member.knowledge_space_id = space.id
            and mount_space_member.user_id = ${input.principal.user.id}
            and mount_space_member.is_active
        )
        or exists (
          select 1
          from knowledge_space_grants allowed
          where allowed.knowledge_space_id = space.id
            and allowed.permission = 'view'
            and allowed.effect = 'allow'
            and (
              (allowed.subject_type = 'organization' and allowed.subject_id = ${input.target.organizationId})
              or (allowed.subject_type = 'department' and allowed.subject_id = ${input.target.departmentId})
              or (allowed.subject_type = 'project' and allowed.subject_id = ${input.target.id})
              or (allowed.subject_type = 'user' and allowed.subject_id = ${input.principal.user.id})
              or (
                allowed.subject_type = 'role'
                and (
                  allowed.subject_id = ${input.target.projectRole}
                  or exists (
                    select 1 from organization_members allow_org_role
                    where allow_org_role.organization_id = ${input.target.organizationId}
                      and allow_org_role.user_id = ${input.principal.user.id}
                      and allow_org_role.is_active
                      and allow_org_role.role::text = allowed.subject_id
                  )
                  or exists (
                    select 1 from department_members allow_dept_role
                    where allow_dept_role.organization_id = ${input.target.organizationId}
                      and allow_dept_role.department_id = ${input.target.departmentId}
                      and allow_dept_role.user_id = ${input.principal.user.id}
                      and allow_dept_role.is_active
                      and allow_dept_role.role::text = allowed.subject_id
                  )
                )
              )
            )
        )
        or space.visibility = 'organization_shared'
        or (
          space.visibility = 'department_shared'
          and space.department_id = ${input.target.departmentId}
        )
      )
  `);
  return new Set(result.rows.map((row) => row.id));
}

async function auditPermissionMutation(input: AuditInput): Promise<void> {
  await input.db.insert(permissionAudit).values({
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    actorUserId: input.principal.user.id,
    eventType: input.eventType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
  });
  await writeAuditEvent(
    {
      actorUserId: input.principal.user.id,
      projectId: input.projectId ?? null,
      eventType: input.eventType,
      entityType: input.resourceType,
      entityId: input.resourceId,
      result: "succeeded",
      metadata: {
        organizationId: input.organizationId,
        changedFields: Object.keys(input.afterState ?? {}),
      },
      ...getRequestAuditContext(input.requestHeaders),
    },
    input.db,
  );
}

async function findOrganizationAccess(
  principal: AuthenticatedPrincipal,
  organizationId: string,
  db: DatabaseExecutor = getDb(),
) {
  const [record] = await db
    .select({
      organization,
      role: organizationMember.role,
    })
    .from(organization)
    .leftJoin(
      organizationMember,
      and(
        eq(organizationMember.organizationId, organization.id),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.isActive, true),
      ),
    )
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (
    !record ||
    (principal.user.systemRole !== "system_admin" && !record.role)
  ) {
    throw new KnowledgeManagementError(
      404,
      "RESOURCE_NOT_FOUND",
      "组织不存在",
    );
  }
  return record;
}

async function requireOrganizationAdmin(
  principal: AuthenticatedPrincipal,
  organizationId: string,
  db: DatabaseExecutor = getDb(),
) {
  const access = await findOrganizationAccess(principal, organizationId, db);
  if (
    principal.user.systemRole !== "system_admin" &&
    access.role !== "organization_admin"
  ) {
    throw new KnowledgeManagementError(403, "FORBIDDEN", "无权管理组织");
  }
  return access;
}

async function findDepartmentAccess(
  principal: AuthenticatedPrincipal,
  departmentId: string,
  db: DatabaseExecutor = getDb(),
) {
  const [record] = await db
    .select({
      department,
      organizationRole: organizationMember.role,
      departmentRole: departmentMember.role,
    })
    .from(department)
    .leftJoin(
      organizationMember,
      and(
        eq(organizationMember.organizationId, department.organizationId),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.isActive, true),
      ),
    )
    .leftJoin(
      departmentMember,
      and(
        eq(departmentMember.departmentId, department.id),
        eq(departmentMember.userId, principal.user.id),
        eq(departmentMember.isActive, true),
      ),
    )
    .where(eq(department.id, departmentId))
    .limit(1);
  if (
    !record ||
    (principal.user.systemRole !== "system_admin" &&
      !record.organizationRole &&
      !record.departmentRole)
  ) {
    throw new KnowledgeManagementError(
      404,
      "RESOURCE_NOT_FOUND",
      "部门不存在",
    );
  }
  return record;
}

async function requireDepartmentAdmin(
  principal: AuthenticatedPrincipal,
  departmentId: string,
  db: DatabaseExecutor = getDb(),
) {
  const access = await findDepartmentAccess(principal, departmentId, db);
  const allowed =
    principal.user.systemRole === "system_admin" ||
    access.organizationRole === "organization_admin" ||
    access.departmentRole === "department_admin";
  if (!allowed) {
    throw new KnowledgeManagementError(403, "FORBIDDEN", "无权管理部门");
  }
  return access;
}

export async function listKnowledgeAdministration(
  principal: AuthenticatedPrincipal,
) {
  const db = getDb();
  const organizations =
    principal.user.systemRole === "system_admin"
      ? await db.select().from(organization).orderBy(asc(organization.name))
      : await db
          .select({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            isActive: organization.isActive,
            createdBy: organization.createdBy,
            createdAt: organization.createdAt,
            updatedAt: organization.updatedAt,
          })
          .from(organizationMember)
          .innerJoin(
            organization,
            eq(organization.id, organizationMember.organizationId),
          )
          .where(
            and(
              eq(organizationMember.userId, principal.user.id),
              eq(organizationMember.isActive, true),
            ),
          )
          .orderBy(asc(organization.name));
  const organizationIds = organizations.map((item) => item.id);
  if (organizationIds.length === 0) {
    return {
      organizations: [],
      departments: [],
      knowledgeSpaces: [],
      grants: [],
      permissionAudits: [],
    };
  }
  if (principal.user.systemRole === "system_admin") {
    const [departments, spaces, grants, permissionAudits] = await Promise.all([
      db
        .select()
        .from(department)
        .where(inArray(department.organizationId, organizationIds))
        .orderBy(asc(department.name)),
      db
        .select()
        .from(knowledgeSpace)
        .where(inArray(knowledgeSpace.organizationId, organizationIds))
        .orderBy(asc(knowledgeSpace.name)),
      db
        .select()
        .from(knowledgeSpaceGrant)
        .where(inArray(knowledgeSpaceGrant.organizationId, organizationIds))
        .orderBy(asc(knowledgeSpaceGrant.createdAt)),
      db
        .select()
        .from(permissionAudit)
        .where(inArray(permissionAudit.organizationId, organizationIds))
        .orderBy(sql`${permissionAudit.createdAt} desc`)
        .limit(200),
    ]);
    return {
      organizations,
      departments,
      knowledgeSpaces: spaces,
      grants,
      permissionAudits,
    };
  }
  const [orgMemberships, departmentMemberships, projectMemberships, spaceMemberships] =
    await Promise.all([
      db
        .select()
        .from(organizationMember)
        .where(
          and(
            eq(organizationMember.userId, principal.user.id),
            eq(organizationMember.isActive, true),
          ),
        ),
      db
        .select()
        .from(departmentMember)
        .where(
          and(
            eq(departmentMember.userId, principal.user.id),
            eq(departmentMember.isActive, true),
          ),
        ),
      db
        .select({ projectId: projectMember.projectId, role: projectMember.role })
        .from(projectMember)
        .where(eq(projectMember.userId, principal.user.id)),
      db
        .select()
        .from(knowledgeSpaceMember)
        .where(
          and(
            eq(knowledgeSpaceMember.userId, principal.user.id),
            eq(knowledgeSpaceMember.isActive, true),
          ),
        ),
    ]);
  const adminOrganizationIds = orgMemberships
    .filter((item) => item.role === "organization_admin")
    .map((item) => item.organizationId);
  const departmentIds = departmentMemberships.map((item) => item.departmentId);
  const projectIds = projectMemberships.map((item) => item.projectId);
  const directSpaceIds = spaceMemberships.map((item) => item.knowledgeSpaceId);
  const departments = await db
    .select()
    .from(department)
    .where(
      or(
        adminOrganizationIds.length
          ? inArray(department.organizationId, adminOrganizationIds)
          : sql`false`,
        departmentIds.length ? inArray(department.id, departmentIds) : sql`false`,
        projectIds.length
          ? sql`exists (
              select 1 from projects visible_project
              where visible_project.id in (${sql.join(
                projectIds.map((id) => sql`${id}`),
                sql`, `,
              )})
                and visible_project.department_id = ${department.id}
            )`
          : sql`false`,
      ),
    )
    .orderBy(asc(department.name));
  const visibleDepartmentIds = departments.map((item) => item.id);
  const spaces = await db
    .select()
    .from(knowledgeSpace)
    .where(
      and(
        inArray(knowledgeSpace.organizationId, organizationIds),
        or(
          adminOrganizationIds.length
            ? inArray(knowledgeSpace.organizationId, adminOrganizationIds)
            : sql`false`,
          eq(knowledgeSpace.visibility, "organization_shared"),
          visibleDepartmentIds.length
            ? and(
                inArray(knowledgeSpace.departmentId, visibleDepartmentIds),
                inArray(knowledgeSpace.visibility, [
                  "department_shared",
                  "organization_shared",
                ]),
              )
            : sql`false`,
          projectIds.length
            ? inArray(knowledgeSpace.projectId, projectIds)
            : sql`false`,
          directSpaceIds.length
            ? inArray(knowledgeSpace.id, directSpaceIds)
            : sql`false`,
          sql`exists (
            select 1 from knowledge_space_grants visible_grant
            where visible_grant.knowledge_space_id = ${knowledgeSpace.id}
              and visible_grant.permission = 'view'
              and visible_grant.effect = 'allow'
              and visible_grant.subject_type = 'user'
              and visible_grant.subject_id = ${principal.user.id}
              and not exists (
                select 1 from knowledge_space_grants denied_grant
                where denied_grant.knowledge_space_id = ${knowledgeSpace.id}
                  and denied_grant.permission = 'view'
                  and denied_grant.effect = 'deny'
                  and denied_grant.subject_type = 'user'
                  and denied_grant.subject_id = ${principal.user.id}
              )
          )`,
        ),
      ),
    )
    .orderBy(asc(knowledgeSpace.name));
  const departmentAdminIds = departmentMemberships
    .filter((item) => item.role === "department_admin")
    .map((item) => item.departmentId);
  const managedProjectIds = projectMemberships
    .filter((item) => item.role === "project_manager")
    .map((item) => item.projectId);
  const managedSpaceIds = spaces
    .filter(
      (space) =>
        adminOrganizationIds.includes(space.organizationId) ||
        Boolean(
          space.departmentId && departmentAdminIds.includes(space.departmentId),
        ) ||
        Boolean(space.projectId && managedProjectIds.includes(space.projectId)),
    )
    .map((space) => space.id);
  const grants = managedSpaceIds.length
    ? await db
        .select()
        .from(knowledgeSpaceGrant)
        .where(inArray(knowledgeSpaceGrant.knowledgeSpaceId, managedSpaceIds))
        .orderBy(asc(knowledgeSpaceGrant.createdAt))
    : [];
  const permissionAudits = adminOrganizationIds.length
    ? await db
        .select()
        .from(permissionAudit)
        .where(inArray(permissionAudit.organizationId, adminOrganizationIds))
        .orderBy(sql`${permissionAudit.createdAt} desc`)
        .limit(200)
    : [];
  return {
    organizations,
    departments,
    knowledgeSpaces: spaces,
    grants,
    permissionAudits,
  };
}

export async function listUploadableKnowledgeSpaces(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
  db?: DatabaseExecutor;
}) {
  const db = input.db ?? getDb();
  const target = await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member"],
    input.requestHeaders,
    { db },
  );
  const matchingGrant = (effect: GrantEffect) => sql`
    exists (
      select 1
      from knowledge_space_grants upload_grant
      where upload_grant.knowledge_space_id = ${knowledgeSpace.id}
        and upload_grant.permission = 'upload'
        and upload_grant.effect = ${effect}::grant_effect
        and (
          (upload_grant.subject_type = 'organization' and upload_grant.subject_id = ${target.organizationId})
          or (upload_grant.subject_type = 'project' and upload_grant.subject_id = ${target.id})
          or (upload_grant.subject_type = 'user' and upload_grant.subject_id = ${input.principal.user.id})
          or (
            upload_grant.subject_type = 'department'
            and upload_grant.subject_id = ${target.departmentId}
          )
          or (
            upload_grant.subject_type = 'role'
            and (
              ${knowledgeSpace.departmentId} is null
              or ${knowledgeSpace.departmentId} = ${target.departmentId}
            )
            and (
              upload_grant.subject_id = ${target.projectRole}
              or exists (
                select 1 from organization_members upload_organization_member
                where upload_organization_member.organization_id = ${target.organizationId}
                  and upload_organization_member.user_id = ${input.principal.user.id}
                  and upload_organization_member.is_active
                  and upload_organization_member.role::text = upload_grant.subject_id
              )
              or exists (
                select 1 from department_members upload_department_role
                where upload_department_role.organization_id = ${target.organizationId}
                  and upload_department_role.department_id = ${target.departmentId}
                  and upload_department_role.user_id = ${input.principal.user.id}
                  and upload_department_role.is_active
                  and upload_department_role.role::text = upload_grant.subject_id
              )
            )
          )
        )
    )
  `;
  return db
    .select({
      id: knowledgeSpace.id,
      name: knowledgeSpace.name,
      type: knowledgeSpace.type,
      visibility: knowledgeSpace.visibility,
      departmentId: knowledgeSpace.departmentId,
      projectId: knowledgeSpace.projectId,
    })
    .from(knowledgeSpace)
    .where(
      and(
        eq(knowledgeSpace.organizationId, target.organizationId),
        eq(knowledgeSpace.isActive, true),
        sql`(
          ${knowledgeSpace.departmentId} is null
          or ${knowledgeSpace.departmentId} = ${target.departmentId}
        )`,
        sql`not (${matchingGrant("deny")})`,
        or(
          eq(knowledgeSpace.projectId, target.id),
          input.principal.user.systemRole === "system_admin" ? sql`true` : sql`false`,
          sql`exists (
            select 1 from organization_members upload_org_admin
            where upload_org_admin.organization_id = ${target.organizationId}
              and upload_org_admin.user_id = ${input.principal.user.id}
              and upload_org_admin.role = 'organization_admin'
              and upload_org_admin.is_active
          )`,
          sql`exists (
            select 1 from department_members upload_dept_admin
            where upload_dept_admin.department_id = ${knowledgeSpace.departmentId}
              and upload_dept_admin.user_id = ${input.principal.user.id}
              and upload_dept_admin.role = 'department_admin'
              and upload_dept_admin.is_active
          )`,
          sql`exists (
            select 1 from knowledge_space_members upload_space_member
            where upload_space_member.knowledge_space_id = ${knowledgeSpace.id}
              and upload_space_member.user_id = ${input.principal.user.id}
              and upload_space_member.role in ('manager', 'editor')
              and upload_space_member.is_active
          )`,
          matchingGrant("allow"),
        ),
      ),
    )
    .orderBy(asc(knowledgeSpace.name));
}

export async function requireUploadableKnowledgeSpace(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  knowledgeSpaceId: string | null;
  requestHeaders: Headers;
  db?: DatabaseExecutor;
}) {
  const spaces = await listUploadableKnowledgeSpaces(input);
  const selected = input.knowledgeSpaceId
    ? spaces.find((space) => space.id === input.knowledgeSpaceId)
    : spaces.find((space) => space.projectId === input.projectId);
  if (!selected) {
    throw new KnowledgeManagementError(
      404,
      "RESOURCE_NOT_FOUND",
      "知识空间不存在或不可上传",
    );
  }
  return selected;
}

export async function createOrganization(input: {
  principal: AuthenticatedPrincipal;
  name: string;
  slug: string;
  requestHeaders: Headers;
}) {
  if (input.principal.user.systemRole !== "system_admin") {
    throw new KnowledgeManagementError(403, "FORBIDDEN", "无权创建组织");
  }
  return getDb().transaction(async (tx) => {
    const id = crypto.randomUUID();
    const [created] = await tx
      .insert(organization)
      .values({
        id,
        name: input.name,
        slug: input.slug,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx.insert(organizationMember).values({
      id: crypto.randomUUID(),
      organizationId: id,
      userId: input.principal.user.id,
      role: "organization_admin",
      createdBy: input.principal.user.id,
    });
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: id,
      eventType: "organization_created",
      resourceType: "organization",
      resourceId: id,
      afterState: { name: input.name, slug: input.slug },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function upsertOrganizationMember(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    await requireOrganizationAdmin(input.principal, input.organizationId, tx);
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, input.userId), eq(user.status, "active")))
      .limit(1);
    if (!target) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "用户不存在");
    }
    const [existing] = await tx
      .select()
      .from(organizationMember)
      .where(
        and(
          eq(organizationMember.organizationId, input.organizationId),
          eq(organizationMember.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update", { of: organizationMember });
    if (
      existing?.role === "organization_admin" &&
      input.role !== "organization_admin"
    ) {
      const [admins] = await tx
        .select({ total: count() })
        .from(organizationMember)
        .where(
          and(
            eq(organizationMember.organizationId, input.organizationId),
            eq(organizationMember.role, "organization_admin"),
            eq(organizationMember.isActive, true),
          ),
        );
      if (Number(admins?.total ?? 0) <= 1) {
        throw new KnowledgeManagementError(
          409,
          "LAST_ADMIN_PROTECTED",
          "不能移除最后一名组织管理员",
        );
      }
    }
    const [record] = existing
      ? await tx
          .update(organizationMember)
          .set({ role: input.role, isActive: true, updatedAt: new Date() })
          .where(eq(organizationMember.id, existing.id))
          .returning()
      : await tx
          .insert(organizationMember)
          .values({
            id: crypto.randomUUID(),
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role,
            createdBy: input.principal.user.id,
          })
          .returning();
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: input.organizationId,
      eventType: "organization_membership_changed",
      resourceType: "organization_membership",
      resourceId: record.id,
      beforeState: existing
        ? { role: existing.role, isActive: existing.isActive }
        : null,
      afterState: { userId: input.userId, role: input.role, isActive: true },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return record;
  });
}

export async function createDepartment(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    await requireOrganizationAdmin(input.principal, input.organizationId, tx);
    const id = crypto.randomUUID();
    const [created] = await tx
      .insert(department)
      .values({
        id,
        organizationId: input.organizationId,
        name: input.name,
        code: input.code,
        description: input.description,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx.insert(departmentMember).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      departmentId: id,
      userId: input.principal.user.id,
      role: "department_admin",
      createdBy: input.principal.user.id,
    });
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: input.organizationId,
      eventType: "department_created",
      resourceType: "department",
      resourceId: id,
      afterState: { name: input.name, code: input.code },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function upsertDepartmentMember(input: {
  principal: AuthenticatedPrincipal;
  departmentId: string;
  userId: string;
  role: DepartmentRole;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const access = await requireDepartmentAdmin(
      input.principal,
      input.departmentId,
      tx,
    );
    const [organizationMembership] = await tx
      .select({ id: organizationMember.id })
      .from(organizationMember)
      .where(
        and(
          eq(organizationMember.organizationId, access.department.organizationId),
          eq(organizationMember.userId, input.userId),
          eq(organizationMember.isActive, true),
        ),
      )
      .limit(1);
    if (!organizationMembership) {
      throw new KnowledgeManagementError(
        404,
        "RESOURCE_NOT_FOUND",
        "用户不属于当前组织",
      );
    }
    const [existing] = await tx
      .select()
      .from(departmentMember)
      .where(
        and(
          eq(departmentMember.departmentId, input.departmentId),
          eq(departmentMember.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update", { of: departmentMember });
    if (
      existing?.role === "department_admin" &&
      input.role !== "department_admin"
    ) {
      const [admins] = await tx
        .select({ total: count() })
        .from(departmentMember)
        .where(
          and(
            eq(departmentMember.departmentId, input.departmentId),
            eq(departmentMember.role, "department_admin"),
            eq(departmentMember.isActive, true),
          ),
        );
      if (Number(admins?.total ?? 0) <= 1) {
        throw new KnowledgeManagementError(
          409,
          "LAST_ADMIN_PROTECTED",
          "不能移除最后一名部门管理员",
        );
      }
    }
    const [record] = existing
      ? await tx
          .update(departmentMember)
          .set({ role: input.role, isActive: true, updatedAt: new Date() })
          .where(eq(departmentMember.id, existing.id))
          .returning()
      : await tx
          .insert(departmentMember)
          .values({
            id: crypto.randomUUID(),
            organizationId: access.department.organizationId,
            departmentId: input.departmentId,
            userId: input.userId,
            role: input.role,
            createdBy: input.principal.user.id,
          })
          .returning();
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: access.department.organizationId,
      eventType: "department_membership_changed",
      resourceType: "department_membership",
      resourceId: record.id,
      beforeState: existing ? { role: existing.role } : null,
      afterState: { userId: input.userId, role: input.role },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return record;
  });
}

export async function createKnowledgeSpace(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  departmentId?: string | null;
  projectId?: string | null;
  type: KnowledgeSpaceType;
  visibility: KnowledgeVisibility;
  name: string;
  description: string;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const validScope =
      (input.type === "organization" && !input.departmentId && !input.projectId) ||
      (input.type === "department" && Boolean(input.departmentId) && !input.projectId) ||
      (input.type === "project" && Boolean(input.projectId) && !input.departmentId) ||
      (input.type === "restricted" && !(input.departmentId && input.projectId));
    if (!validScope) {
      throw new KnowledgeManagementError(
        400,
        "INVALID_REQUEST",
        "知识空间范围无效",
      );
    }
    if (
      (input.type === "department" || input.type === "restricted") &&
      input.departmentId
    ) {
      const access = await requireDepartmentAdmin(
        input.principal,
        input.departmentId,
        tx,
      );
      if (access.department.organizationId !== input.organizationId) {
        throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "部门不存在");
      }
    } else if (
      (input.type === "project" || input.type === "restricted") &&
      input.projectId
    ) {
      const projectAccess = await requireProjectRole(
        input.principal,
        input.projectId,
        ["project_manager"],
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
      if (projectAccess.organizationId !== input.organizationId) {
        throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "项目不存在");
      }
    } else {
      await requireOrganizationAdmin(input.principal, input.organizationId, tx);
    }
    const id = crypto.randomUUID();
    const [created] = await tx
      .insert(knowledgeSpace)
      .values({
        id,
        organizationId: input.organizationId,
        departmentId: input.departmentId ?? null,
        projectId: input.projectId ?? null,
        type: input.type,
        visibility: input.visibility,
        name: input.name,
        description: input.description,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx.insert(knowledgeSpaceMember).values({
      id: crypto.randomUUID(),
      knowledgeSpaceId: id,
      userId: input.principal.user.id,
      role: "manager",
      createdBy: input.principal.user.id,
    });
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: "knowledge_space_created",
      resourceType: "knowledge_space",
      resourceId: id,
      afterState: {
        type: input.type,
        visibility: input.visibility,
        departmentId: input.departmentId ?? null,
        projectId: input.projectId ?? null,
      },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function createKnowledgeGrant(input: {
  principal: AuthenticatedPrincipal;
  knowledgeSpaceId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
  permission: KnowledgePermission;
  effect: GrantEffect;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const [space] = await tx
      .select()
      .from(knowledgeSpace)
      .where(eq(knowledgeSpace.id, input.knowledgeSpaceId))
      .limit(1);
    if (!space) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "知识空间不存在");
    }
    const denyResult = await tx.execute<{ denied: boolean }>(sql`
      select exists (
        select 1
        from knowledge_space_grants denied
        where denied.knowledge_space_id = ${space.id}
          and denied.permission = 'manage_permissions'
          and denied.effect = 'deny'
          and (
            (denied.subject_type = 'organization' and denied.subject_id = ${space.organizationId})
            or (denied.subject_type = 'user' and denied.subject_id = ${input.principal.user.id})
            or (
              denied.subject_type = 'department'
              and exists (
                select 1 from department_members denied_department_member
                where denied_department_member.organization_id = ${space.organizationId}
                  and denied_department_member.department_id = denied.subject_id
                  and denied_department_member.user_id = ${input.principal.user.id}
                  and denied_department_member.is_active
              )
            )
            or (
              denied.subject_type = 'project'
              and exists (
                select 1
                from project_members denied_project_member
                join projects denied_project
                  on denied_project.id = denied_project_member.project_id
                  and denied_project.organization_id = ${space.organizationId}
                where denied_project_member.project_id = denied.subject_id
                  and denied_project_member.user_id = ${input.principal.user.id}
              )
            )
            or (
              denied.subject_type = 'role'
              and (
                exists (
                  select 1 from organization_members denied_org_role
                  where denied_org_role.organization_id = ${space.organizationId}
                    and denied_org_role.user_id = ${input.principal.user.id}
                    and denied_org_role.is_active
                    and denied_org_role.role::text = denied.subject_id
                )
                or exists (
                  select 1 from department_members denied_dept_role
                  where denied_dept_role.organization_id = ${space.organizationId}
                    and denied_dept_role.user_id = ${input.principal.user.id}
                    and denied_dept_role.is_active
                    and denied_dept_role.role::text = denied.subject_id
                )
                or exists (
                  select 1
                  from project_members denied_project_role
                  join projects denied_role_project
                    on denied_role_project.id = denied_project_role.project_id
                    and denied_role_project.organization_id = ${space.organizationId}
                  where denied_project_role.user_id = ${input.principal.user.id}
                    and denied_project_role.role::text = denied.subject_id
                )
              )
            )
          )
      ) as denied
    `);
    if (denyResult.rows[0]?.denied) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "知识空间不存在");
    }
    if (space.departmentId) {
      await requireDepartmentAdmin(input.principal, space.departmentId, tx);
    } else if (space.projectId) {
      await requireProjectRole(
        input.principal,
        space.projectId,
        ["project_manager"],
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
    } else {
      await requireOrganizationAdmin(input.principal, space.organizationId, tx);
    }
    await requireValidGrantSubject({
      organizationId: space.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      db: tx,
    });
    const [created] = await tx
      .insert(knowledgeSpaceGrant)
      .values({
        id: crypto.randomUUID(),
        organizationId: space.organizationId,
        knowledgeSpaceId: space.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permission: input.permission,
        effect: input.effect,
        createdBy: input.principal.user.id,
      })
      .returning();
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: space.organizationId,
      projectId: space.projectId,
      eventType: "knowledge_space_grant_created",
      resourceType: "knowledge_space_grant",
      resourceId: created.id,
      afterState: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permission: input.permission,
        effect: input.effect,
      },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function listProjectKnowledgeSources(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  const target = await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member", "viewer"],
    input.requestHeaders,
  );
  const db = getDb();
  const rows = await db
    .select({
      source: projectKnowledgeSource,
      spaceName: knowledgeSpace.name,
      spaceType: knowledgeSpace.type,
      spaceVisibility: knowledgeSpace.visibility,
    })
    .from(projectKnowledgeSource)
    .leftJoin(
      knowledgeSpace,
      eq(knowledgeSpace.id, projectKnowledgeSource.knowledgeSpaceId),
    )
    .where(
      and(
        eq(projectKnowledgeSource.projectId, input.projectId),
        eq(projectKnowledgeSource.isActive, true),
      ),
    )
    .orderBy(asc(projectKnowledgeSource.createdAt));
  const [spaceIds, documentScope] = await Promise.all([
    listMountableKnowledgeSpaceIds({
      principal: input.principal,
      target,
      db,
    }),
    listAuthorizedDocumentScope({
      principal: input.principal,
      projectId: target.id,
      permission: "view",
    }),
  ]);
  const documentIds = new Set(documentScope.map((scope) => scope.documentId));
  return rows.filter((row) =>
    row.source.sourceType === "knowledge_space"
      ? Boolean(
          row.source.knowledgeSpaceId &&
            spaceIds.has(row.source.knowledgeSpaceId),
        )
      : Boolean(row.source.documentId && documentIds.has(row.source.documentId)),
  );
}

export async function mountProjectKnowledgeSource(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  sourceType: "knowledge_space" | "document";
  knowledgeSpaceId?: string | null;
  documentId?: string | null;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const target = await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    if (input.sourceType === "knowledge_space") {
      const [space] = await tx
        .select()
        .from(knowledgeSpace)
        .where(
          and(
            eq(knowledgeSpace.id, input.knowledgeSpaceId ?? ""),
            eq(knowledgeSpace.organizationId, target.organizationId),
            eq(knowledgeSpace.isActive, true),
          ),
        )
        .limit(1);
      if (
        !space ||
        !(await canMountKnowledgeSpace({
          principal: input.principal,
          target,
          space,
          db: tx,
        }))
      ) {
        throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "知识空间不存在");
      }
    } else {
      const authorized = await findAuthorizedDocument({
        principal: input.principal,
        projectId: input.projectId,
        documentId: input.documentId ?? "",
        permission: "view",
        db: tx,
      });
      if (!authorized) {
        throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "资料不存在");
      }
    }
    const [inserted] = await tx
      .insert(projectKnowledgeSource)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        sourceType: input.sourceType,
        knowledgeSpaceId: input.knowledgeSpaceId ?? null,
        documentId: input.documentId ?? null,
        createdBy: input.principal.user.id,
      })
      .onConflictDoNothing()
      .returning();
    const [created] = inserted
      ? [inserted]
      : await tx
          .update(projectKnowledgeSource)
          .set({ isActive: true })
          .where(
            and(
              eq(projectKnowledgeSource.projectId, input.projectId),
              input.sourceType === "knowledge_space"
                ? eq(
                    projectKnowledgeSource.knowledgeSpaceId,
                    input.knowledgeSpaceId ?? "",
                  )
                : eq(
                    projectKnowledgeSource.documentId,
                    input.documentId ?? "",
                  ),
            ),
          )
          .returning();
    if (!created) {
      throw new KnowledgeManagementError(
        409,
        "SOURCE_CONFLICT",
        "知识来源状态冲突",
      );
    }
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: target.organizationId,
      projectId: input.projectId,
      eventType: "project_knowledge_source_mounted",
      resourceType: "project_knowledge_source",
      resourceId: created.id,
      afterState: {
        sourceType: input.sourceType,
        knowledgeSpaceId: input.knowledgeSpaceId ?? null,
        documentId: input.documentId ?? null,
      },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function setDocumentGrant(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
  permission: KnowledgePermission;
  effect: GrantEffect;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    const target = await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [ownedDocument] = await tx
      .select({ id: projectDocument.id })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.id, input.documentId),
          eq(projectDocument.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!ownedDocument) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "资料不存在");
    }
    const authorized = await findAuthorizedDocument({
      principal: input.principal,
      projectId: input.projectId,
      documentId: input.documentId,
      permission: "manage_permissions",
      db: tx,
    });
    if (!authorized) {
      throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "资料不存在");
    }
    await requireValidGrantSubject({
      organizationId: target.organizationId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      db: tx,
    });
    const [created] = await tx
      .insert(documentGrant)
      .values({
        id: crypto.randomUUID(),
        organizationId: target.organizationId,
        projectId: input.projectId,
        documentId: input.documentId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permission: input.permission,
        effect: input.effect,
        createdBy: input.principal.user.id,
      })
      .returning();
    await auditPermissionMutation({
      principal: input.principal,
      organizationId: target.organizationId,
      projectId: input.projectId,
      eventType: "document_grant_created",
      resourceType: "document_grant",
      resourceId: created.id,
      afterState: {
        documentId: input.documentId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        permission: input.permission,
        effect: input.effect,
      },
      requestHeaders: input.requestHeaders,
      db: tx,
    });
    return created;
  });
}

export async function listDocumentGrants(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  requestHeaders: Headers;
}) {
  const db = getDb();
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  const authorized = await findAuthorizedDocument({
    principal: input.principal,
    projectId: input.projectId,
    documentId: input.documentId,
    permission: "manage_permissions",
    db,
  });
  if (!authorized || authorized.document.projectId !== input.projectId) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "资料不存在");
  }
  return db
    .select({
      id: documentGrant.id,
      subjectType: documentGrant.subjectType,
      subjectId: documentGrant.subjectId,
      permission: documentGrant.permission,
      effect: documentGrant.effect,
      createdAt: documentGrant.createdAt,
    })
    .from(documentGrant)
    .where(
      and(
        eq(documentGrant.projectId, input.projectId),
        eq(documentGrant.documentId, input.documentId),
      ),
    )
    .orderBy(asc(documentGrant.createdAt));
}
