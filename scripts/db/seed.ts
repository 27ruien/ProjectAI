import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  account,
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

type SeedUserKey = "ADMIN" | "MANAGER_A" | "MANAGER_B" | "MEMBER_A" | "VIEWER_A";

type SeedUserSpec = {
  key: SeedUserKey;
  id: string;
  displayName: string;
  systemRole: SystemRole;
};

const seedUsers: SeedUserSpec[] = [
  { key: "ADMIN", id: "seed-admin", displayName: "系统管理员", systemRole: "system_admin" },
  { key: "MANAGER_A", id: "seed-manager-a", displayName: "项目经理 A", systemRole: "standard_user" },
  { key: "MANAGER_B", id: "seed-manager-b", displayName: "项目经理 B", systemRole: "standard_user" },
  { key: "MEMBER_A", id: "seed-member-a", displayName: "项目成员 A", systemRole: "standard_user" },
  { key: "VIEWER_A", id: "seed-viewer-a", displayName: "只读成员 A", systemRole: "standard_user" },
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
  { id: "seed-membership-b-manager", projectId: "project-002", userKey: "MANAGER_B", role: "project_manager", createdByKey: "ADMIN" },
  { id: "seed-membership-c-manager", projectId: "project-003", userKey: "ADMIN", role: "project_manager", createdByKey: "ADMIN" },
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
  const userIds = new Map<SeedUserKey, string>();
  for (const spec of seedUsers) {
    userIds.set(spec.key, await seedIdentity(spec));
  }

  const db = getDb();
  for (const item of seedProjects) {
    await db
      .insert(project)
      .values({
        id: item.id,
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
