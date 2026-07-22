import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  account,
  aiModelProfile,
  aiRetrievalProfile,
  department,
  departmentMember,
  knowledgeSpace,
  organization,
  organizationMember,
  project,
  projectMember,
  user,
  type ProjectHealth,
  type ProjectRole,
  type ProjectStage,
  type ProjectStatus,
  type SystemRole,
} from "../../lib/db/schema";
import { normalizeEmail } from "../../lib/db/repositories/user-repository";

type SeedUserKey =
  | "ADMIN"
  | "ORG_ADMIN"
  | "DEPT_ADMIN"
  | "MANAGER_A"
  | "MANAGER_B"
  | "MEMBER_A"
  | "VIEWER_A"
  | "OTHER_DEPT"
  | "OUTSIDER";

type SeedUserSpec = {
  key: SeedUserKey;
  id: string;
  displayName: string;
  systemRole: SystemRole;
};

const seedUsers: SeedUserSpec[] = [
  { key: "ADMIN", id: "seed-admin", displayName: "[TEST] 系统管理员", systemRole: "system_admin" },
  { key: "ORG_ADMIN", id: "seed-org-admin", displayName: "[TEST] 组织管理员", systemRole: "standard_user" },
  { key: "DEPT_ADMIN", id: "seed-dept-admin", displayName: "[TEST] 部门管理员", systemRole: "standard_user" },
  { key: "MANAGER_A", id: "seed-manager-a", displayName: "[TEST] 项目经理 A", systemRole: "standard_user" },
  { key: "MANAGER_B", id: "seed-manager-b", displayName: "[TEST] 项目经理 B", systemRole: "standard_user" },
  { key: "MEMBER_A", id: "seed-member-a", displayName: "[TEST] 项目成员 A", systemRole: "standard_user" },
  { key: "VIEWER_A", id: "seed-viewer-a", displayName: "[TEST] 只读成员 A", systemRole: "standard_user" },
  { key: "OTHER_DEPT", id: "seed-other-dept", displayName: "[TEST] 其他部门用户", systemRole: "standard_user" },
  { key: "OUTSIDER", id: "seed-outsider", displayName: "[TEST] 组织外用户", systemRole: "standard_user" },
];

type SeedProject = {
  id: string;
  name: string;
  clientName: string;
  description: string;
  status: ProjectStatus;
  stage: ProjectStage;
  health: ProjectHealth;
  targetLaunchDate: string;
  createdByKey: SeedUserKey;
  departmentId: string;
};

const seedProjects: SeedProject[] = [
  {
    id: "project-001",
    name: "北美旗舰店 AI 互动活动",
    clientName: "澜屿国际美妆",
    description: "在纽约旗舰店上线可控、合规的 AI 互动体验。当前业务内容仍为 Mock。",
    status: "at_risk",
    stage: "development",
    health: "attention",
    targetLaunchDate: "2026-08-28",
    createdByKey: "MANAGER_A",
    departmentId: "dept-legacy-default",
  },
  {
    id: "project-002",
    name: "品牌官网重构",
    clientName: "曜石户外",
    description: "统一全球品牌表达并提升新品内容发布效率。当前业务内容仍为 Mock。",
    status: "active",
    stage: "development",
    health: "healthy",
    targetLaunchDate: "2026-09-18",
    createdByKey: "MANAGER_B",
    departmentId: "dept-legacy-default",
  },
  {
    id: "project-003",
    name: "会员系统升级",
    clientName: "青禾零售集团",
    description: "升级会员等级、积分和权益引擎。当前业务内容仍为 Mock。",
    status: "active",
    stage: "testing",
    health: "attention",
    targetLaunchDate: "2026-08-15",
    createdByKey: "ADMIN",
    departmentId: "dept-legacy-default",
  },
  {
    id: "project-004",
    name: "其他部门隔离验证项目",
    clientName: "虚构隔离客户",
    description: "用于 Staging 跨部门与跨项目隔离验证的虚构项目。",
    status: "active",
    stage: "planning",
    health: "healthy",
    targetLaunchDate: "2026-10-30",
    createdByKey: "OTHER_DEPT",
    departmentId: "dept-other-test",
  },
];

const memberships: Array<{
  id: string;
  projectId: string;
  userKey: SeedUserKey;
  role: ProjectRole;
  createdByKey: SeedUserKey;
}> = [
  { id: "seed-membership-a-manager", projectId: "project-001", userKey: "MANAGER_A", role: "project_manager", createdByKey: "ADMIN" },
  { id: "seed-membership-a-member", projectId: "project-001", userKey: "MEMBER_A", role: "project_member", createdByKey: "MANAGER_A" },
  { id: "seed-membership-a-viewer", projectId: "project-001", userKey: "VIEWER_A", role: "viewer", createdByKey: "MANAGER_A" },
  { id: "seed-membership-a-dept-admin", projectId: "project-001", userKey: "DEPT_ADMIN", role: "project_member", createdByKey: "MANAGER_A" },
  { id: "seed-membership-b-manager", projectId: "project-002", userKey: "MANAGER_B", role: "project_manager", createdByKey: "ADMIN" },
  { id: "seed-membership-c-manager", projectId: "project-003", userKey: "ADMIN", role: "project_manager", createdByKey: "ADMIN" },
  { id: "seed-membership-d-manager", projectId: "project-004", userKey: "OTHER_DEPT", role: "project_manager", createdByKey: "ADMIN" },
];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function credentialsFor(spec: SeedUserSpec) {
  const email = normalizeEmail(requiredEnvironment(`SEED_${spec.key}_EMAIL`));
  const password = requiredEnvironment(`SEED_${spec.key}_PASSWORD`);
  if (password.length < 12 || password.length > 128) {
    throw new Error(`SEED_${spec.key}_PASSWORD must be 12-128 characters.`);
  }
  return {
    email,
    password,
    displayName:
      process.env[`SEED_${spec.key}_DISPLAY_NAME`]?.trim() || spec.displayName,
  };
}

async function seedIdentity(spec: SeedUserSpec): Promise<string> {
  const db = getDb();
  const credentials = credentialsFor(spec);
  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, credentials.email))
    .limit(1);
  const userId = existingUser?.id ?? spec.id;

  if (!existingUser) {
    await db.insert(user).values({
      id: userId,
      email: credentials.email,
      displayName: credentials.displayName,
      emailVerified: true,
      systemRole: spec.systemRole,
      status: "active",
    });
  }

  const [credentialAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    )
    .limit(1);
  if (!credentialAccount) {
    await db.insert(account).values({
      id: `credential-${userId}`,
      userId,
      accountId: userId,
      providerId: "credential",
      passwordHash: await hashPassword(credentials.password),
    });
  }
  return userId;
}

async function main(): Promise<void> {
  const seedEnvironment = requiredEnvironment("PROJECTAI_SEED_ENVIRONMENT");
  if (
    !["test", "staging"].includes(seedEnvironment) ||
    process.env.NEXT_PUBLIC_APP_ENV === "production"
  ) {
    throw new Error("SEED_PRODUCTION_FORBIDDEN");
  }
  await getDb()
    .insert(aiRetrievalProfile)
    .values({
      id: "hybrid-rrf-v1",
      profileVersion: 1,
      lexicalCandidateLimit: 30,
      vectorCandidateLimit: 30,
      fusedCandidateLimit: 30,
      evidenceLimit: 10,
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      vectorMaxDistance: 0.55,
      minEmbeddingCoverageBps: 9_800,
      embeddingProfileId: "qwen-text-embedding-cn-v1",
      enabled: true,
    })
    .onConflictDoNothing({ target: aiRetrievalProfile.id });

  await getDb()
    .insert(aiModelProfile)
    .values({
      id: "qwen-project-assistant-cn-v1",
      provider: "qwen",
      purpose: "project_assistant",
      primaryModel: "qwen3.7-plus",
      fallbackModel: "qwen3.6-flash",
      region: "cn-beijing",
      enabled: true,
      gatewayVersion: "1",
    })
    .onConflictDoNothing({ target: aiModelProfile.id });

  const userIds = new Map<SeedUserKey, string>();
  for (const spec of seedUsers) {
    userIds.set(spec.key, await seedIdentity(spec));
  }

  const db = getDb();
  const organizationId = "org-legacy-default";
  const organizationCreator = userIds.get("ADMIN")!;
  await db
    .insert(organization)
    .values({
      id: organizationId,
      name: "ProjectAI Test Organization",
      slug: "projectai-test-organization",
      createdBy: organizationCreator,
    })
    .onConflictDoNothing({ target: organization.id });

  const organizationRoles: Array<{
    key: SeedUserKey;
    role: "organization_admin" | "organization_member";
  }> = seedUsers
    .filter((spec) => spec.key !== "OUTSIDER")
    .map((spec) => ({
      key: spec.key,
      role:
        spec.key === "ADMIN" || spec.key === "ORG_ADMIN"
          ? "organization_admin"
          : "organization_member",
    }));
  for (const membership of organizationRoles) {
    await db
      .insert(organizationMember)
      .values({
        id: `seed-org-member-${membership.key.toLowerCase()}`,
        organizationId,
        userId: userIds.get(membership.key)!,
        role: membership.role,
        createdBy: organizationCreator,
      })
      .onConflictDoNothing({
        target: [organizationMember.organizationId, organizationMember.userId],
      });
  }

  const seedDepartments = [
    {
      id: "dept-legacy-default",
      name: "交付与项目管理部",
      code: "DEFAULT-DELIVERY",
    },
    {
      id: "dept-other-test",
      name: "隔离验证部",
      code: "OTHER-TEST",
    },
  ] as const;
  for (const item of seedDepartments) {
    await db
      .insert(department)
      .values({
        ...item,
        organizationId,
        description: "仅用于非生产环境的虚构部门。",
        createdBy: organizationCreator,
      })
      .onConflictDoNothing({ target: department.id });
  }
  const departmentMemberships: Array<{
    id: string;
    departmentId: string;
    userKey: SeedUserKey;
    role: "department_admin" | "department_member";
  }> = [
    { id: "seed-dept-admin", departmentId: "dept-legacy-default", userKey: "DEPT_ADMIN", role: "department_admin" },
    { id: "seed-dept-manager-a", departmentId: "dept-legacy-default", userKey: "MANAGER_A", role: "department_member" },
    { id: "seed-dept-manager-b", departmentId: "dept-legacy-default", userKey: "MANAGER_B", role: "department_member" },
    { id: "seed-dept-member-a", departmentId: "dept-legacy-default", userKey: "MEMBER_A", role: "department_member" },
    { id: "seed-dept-viewer-a", departmentId: "dept-legacy-default", userKey: "VIEWER_A", role: "department_member" },
    { id: "seed-dept-other-admin", departmentId: "dept-other-test", userKey: "OTHER_DEPT", role: "department_admin" },
  ];
  for (const item of departmentMemberships) {
    await db
      .insert(departmentMember)
      .values({
        id: item.id,
        organizationId,
        departmentId: item.departmentId,
        userId: userIds.get(item.userKey)!,
        role: item.role,
        createdBy: organizationCreator,
      })
      .onConflictDoNothing({
        target: [departmentMember.departmentId, departmentMember.userId],
      });
  }

  const sharedSpaces = [
    {
      id: "ks-organization-shared-test",
      type: "organization" as const,
      visibility: "organization_shared" as const,
      name: "公司共享知识",
      departmentId: null,
    },
    {
      id: "ks-department-shared-test",
      type: "department" as const,
      visibility: "department_shared" as const,
      name: "交付部共享知识",
      departmentId: "dept-legacy-default",
    },
    {
      id: "ks-department-restricted-test",
      type: "restricted" as const,
      visibility: "restricted" as const,
      name: "交付部受限知识",
      departmentId: "dept-legacy-default",
    },
  ];
  for (const item of sharedSpaces) {
    await db
      .insert(knowledgeSpace)
      .values({
        id: item.id,
        organizationId,
        departmentId: item.departmentId,
        projectId: null,
        type: item.type,
        visibility: item.visibility,
        name: item.name,
        description: "仅使用虚构资料的非生产知识空间。",
        createdBy: organizationCreator,
      })
      .onConflictDoNothing({ target: knowledgeSpace.id });
  }

  for (const item of seedProjects) {
    await db
      .insert(project)
      .values({
        id: item.id,
        organizationId,
        departmentId: item.departmentId,
        name: item.name,
        clientName: item.clientName,
        description: item.description,
        status: item.status,
        stage: item.stage,
        health: item.health,
        targetLaunchDate: item.targetLaunchDate,
        createdBy: userIds.get(item.createdByKey)!,
      })
      .onConflictDoNothing({ target: project.id });
  }

  for (const item of memberships) {
    await db
      .insert(projectMember)
      .values({
        id: item.id,
        projectId: item.projectId,
        userId: userIds.get(item.userKey)!,
        role: item.role,
        createdBy: userIds.get(item.createdByKey)!,
      })
      .onConflictDoNothing({
        target: [projectMember.projectId, projectMember.userId],
      });
  }

  const zeroManagerProjects = await db.execute<{ id: string }>(sql`
    select p.id
    from projects p
    where not exists (
      select 1
      from project_members pm
      where pm.project_id = p.id and pm.role = 'project_manager'
    )
    order by p.id
  `);
  if (zeroManagerProjects.rows.length > 0) {
    throw new Error(
      `Seed refused to continue because these projects have no project_manager: ${zeroManagerProjects.rows
        .map((row) => row.id)
        .join(", ")}`,
    );
  }

  process.stdout.write("Insert-only Seed completed without changing existing records.\n");
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Database seed failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
