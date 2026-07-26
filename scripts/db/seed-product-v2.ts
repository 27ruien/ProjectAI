import { and, eq } from "drizzle-orm";
import { closeDatabasePool, getDb, type DatabaseExecutor } from "../../lib/db/client";
import {
  account,
  department,
  departmentMember,
  knowledgeSpace,
  knowledgeSpaceMember,
  organization,
  organizationMember,
  project,
  projectMember,
  user,
} from "../../lib/db/schema";
import { MOCK_WECOM_IDENTITIES } from "../../lib/auth/providers";

const ORGANIZATION_ID = "org-legacy-default";
const MEMBER_DEPARTMENT_ID = "kivisense-dept-product-management";
const MEMBER_PROJECT_ID = "kivisense-project-product-management-uat";

function assertEnvironment(): void {
  const environment = (process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (!new Set(["development", "test", "staging"]).has(environment)) {
    throw new Error("PRODUCT_V2_SEED_NON_PRODUCTION_ONLY");
  }
  if (process.env.AUTH_PROVIDER !== "mock-wecom" || process.env.ALLOW_MOCK_WECOM_AUTH !== "true") {
    throw new Error("PRODUCT_V2_SEED_REQUIRES_MOCK_WECOM");
  }
}

async function seedIdentity(
  db: DatabaseExecutor,
  key: keyof typeof MOCK_WECOM_IDENTITIES,
): Promise<void> {
  const identity = MOCK_WECOM_IDENTITIES[key];
  const [existing] = await db.select().from(user).where(eq(user.id, identity.userId)).limit(1);
  if (!existing) {
    await db.insert(user).values({
      id: identity.userId,
      email: `${key}@mock-wecom.invalid`,
      displayName: identity.displayName,
      emailVerified: false,
      systemRole: identity.productRole === "super_admin" ? "system_admin" : "standard_user",
      productRole: identity.productRole,
      status: "active",
    });
  } else if (existing.productRole !== identity.productRole || existing.status !== "active") {
    throw new Error(`MOCK_IDENTITY_CONFLICT:${key}`);
  }

  const [existingAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, "mock-wecom"),
        eq(account.accountId, identity.providerSubject),
      ),
    )
    .limit(1);
  if (!existingAccount) {
    await db.insert(account).values({
      id: `mock-wecom-${key}`,
      accountId: identity.providerSubject,
      providerId: "mock-wecom",
      userId: identity.userId,
    });
  } else if (existingAccount.userId !== identity.userId) {
    throw new Error(`MOCK_ACCOUNT_CONFLICT:${key}`);
  }
}

async function main(): Promise<void> {
  assertEnvironment();
  await getDb().transaction(async (tx) => {
    for (const key of Object.keys(MOCK_WECOM_IDENTITIES) as Array<keyof typeof MOCK_WECOM_IDENTITIES>) {
      await seedIdentity(tx, key);
    }
    const superAdminId = MOCK_WECOM_IDENTITIES["super-admin"].userId;
    const adminId = MOCK_WECOM_IDENTITIES.admin.userId;
    const memberId = MOCK_WECOM_IDENTITIES.member.userId;

    const [existingOrganization] = await tx
      .select()
      .from(organization)
      .where(eq(organization.id, ORGANIZATION_ID))
      .limit(1);
    if (!existingOrganization) {
      await tx.insert(organization).values({
        id: ORGANIZATION_ID,
        name: "Kivisense",
        slug: "kivisense",
        createdBy: superAdminId,
      });
    } else if (existingOrganization.name !== "Kivisense") {
      throw new Error("KIVISENSE_ORGANIZATION_CONFLICT");
    }

    for (const [key, userId, role] of [
      ["super-admin", superAdminId, "organization_admin"],
      ["admin", adminId, "organization_admin"],
      ["member", memberId, "organization_member"],
    ] as const) {
      await tx.insert(organizationMember).values({
        id: `kivisense-org-member-${key}`,
        organizationId: ORGANIZATION_ID,
        userId,
        role,
        createdBy: superAdminId,
      }).onConflictDoNothing({
        target: [organizationMember.organizationId, organizationMember.userId],
      });
    }

    const departments = [
      ["kivisense-dept-product", null, 1, "Product", "PRODUCT", 10],
      ["kivisense-dept-product-design", "kivisense-dept-product", 2, "Product Design", "PRODUCT-DESIGN", 10],
      [MEMBER_DEPARTMENT_ID, "kivisense-dept-product", 2, "Product Management", "PRODUCT-MANAGEMENT", 20],
      ["kivisense-dept-technology", null, 1, "Technology", "TECHNOLOGY", 20],
      ["kivisense-dept-frontend", "kivisense-dept-technology", 2, "Frontend", "FRONTEND", 10],
      ["kivisense-dept-backend", "kivisense-dept-technology", 2, "Backend", "BACKEND", 20],
      ["kivisense-dept-delivery", null, 1, "Delivery", "DELIVERY", 30],
    ] as const;
    for (const [id, parentDepartmentId, level, name, code, sortOrder] of departments) {
      await tx.insert(department).values({
        id,
        organizationId: ORGANIZATION_ID,
        parentDepartmentId,
        level,
        name,
        code,
        description: "ProjectAI Product V2 非生产虚构组织数据。",
        status: "active",
        headUserIds: id === MEMBER_DEPARTMENT_ID ? [memberId] : [],
        sortOrder,
        createdBy: superAdminId,
      }).onConflictDoNothing({ target: department.id });
      await tx.insert(knowledgeSpace).values({
        id: `ks-department-${id}`,
        organizationId: ORGANIZATION_ID,
        departmentId: id,
        type: "department",
        visibility: "department_shared",
        name: `${name} 共享空间`,
        description: "部门默认共享知识空间",
        createdBy: superAdminId,
      }).onConflictDoNothing({ target: knowledgeSpace.id });
    }
    await tx.insert(departmentMember).values({
      id: "kivisense-dept-member-product-management",
      organizationId: ORGANIZATION_ID,
      departmentId: MEMBER_DEPARTMENT_ID,
      userId: memberId,
      role: "department_member",
      createdBy: superAdminId,
    }).onConflictDoNothing({
      target: [departmentMember.departmentId, departmentMember.userId],
    });

    await tx.insert(project).values({
      id: MEMBER_PROJECT_ID,
      organizationId: ORGANIZATION_ID,
      departmentId: MEMBER_DEPARTMENT_ID,
      name: "Product Management UAT",
      clientName: "Kivisense Internal",
      description: "ProjectAI Product V2 非生产虚构项目空间。",
      status: "active",
      createdBy: memberId,
    }).onConflictDoNothing({ target: project.id });
    const [memberProject] = await tx
      .select({ organizationId: project.organizationId, departmentId: project.departmentId, createdBy: project.createdBy })
      .from(project)
      .where(eq(project.id, MEMBER_PROJECT_ID))
      .limit(1);
    if (
      memberProject?.organizationId !== ORGANIZATION_ID ||
      memberProject.departmentId !== MEMBER_DEPARTMENT_ID ||
      memberProject.createdBy !== memberId
    ) {
      throw new Error("PRODUCT_V2_MEMBER_PROJECT_CONFLICT");
    }
    await tx.insert(projectMember).values({
      id: `kivisense-member-${MEMBER_PROJECT_ID}`,
      projectId: MEMBER_PROJECT_ID,
      userId: memberId,
      role: "project_manager",
      createdBy: superAdminId,
    }).onConflictDoNothing({ target: [projectMember.projectId, projectMember.userId] });
    const [memberProjectSpace] = await tx
      .select({ id: knowledgeSpace.id, projectId: knowledgeSpace.projectId, createdBy: knowledgeSpace.createdBy })
      .from(knowledgeSpace)
      .where(eq(knowledgeSpace.projectId, MEMBER_PROJECT_ID))
      .limit(1);
    if (memberProjectSpace?.projectId !== MEMBER_PROJECT_ID || memberProjectSpace.createdBy !== memberId) {
      throw new Error("PRODUCT_V2_MEMBER_PROJECT_SPACE_CONFLICT");
    }
    await tx
      .update(knowledgeSpace)
      .set({
        departmentId: MEMBER_DEPARTMENT_ID,
        name: "Product Management UAT",
        description: "ProjectAI Product V2 非生产虚构项目知识空间。",
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSpace.id, memberProjectSpace.id));
    await tx.insert(knowledgeSpaceMember).values({
      id: "kivisense-space-member-product-management-uat",
      knowledgeSpaceId: memberProjectSpace.id,
      userId: memberId,
      role: "manager",
      accessLevel: "edit",
      createdBy: memberId,
    }).onConflictDoNothing({
      target: [knowledgeSpaceMember.knowledgeSpaceId, knowledgeSpaceMember.userId],
    });

    await tx.insert(knowledgeSpaceMember).values({
      id: "kivisense-space-member-product-management",
      knowledgeSpaceId: `ks-department-${MEMBER_DEPARTMENT_ID}`,
      userId: memberId,
      role: "editor",
      accessLevel: "edit",
      createdBy: superAdminId,
    }).onConflictDoNothing({
      target: [knowledgeSpaceMember.knowledgeSpaceId, knowledgeSpaceMember.userId],
    });
  });
  process.stdout.write("Product V2 Mock WeCom identities and Kivisense organization are ready.\n");
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "PRODUCT_V2_SEED_FAILED"}\n`);
    await closeDatabasePool();
    process.exitCode = 1;
  });
