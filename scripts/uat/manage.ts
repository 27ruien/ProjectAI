import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { closeDatabasePool, getDb, type DatabaseTransaction } from "../../lib/db/client";
import {
  account,
  aiModelProfile,
  dailyTimesheetDraft,
  department,
  departmentMember,
  organization,
  organizationMember,
  project,
  projectMember,
  session,
  timesheetAiExecution,
  timesheetSyncBatch,
  user,
  workLogRecord,
} from "../../lib/db/schema";

type Command = "seed" | "verify" | "cleanup";
type AccountKey = "admin" | "manager" | "restricted";
type CredentialFile = {
  version: 1;
  generatedAt: string;
  accounts: Record<AccountKey, { displayName: string; email: string; password: string }>;
};

const ROOT = process.cwd();
const CREDENTIAL_PATH = path.join(ROOT, ".local", "uat-credentials.json");
const ORGANIZATION_ID = "uat-org-projectai-v1";
const DEPARTMENT_ID = "uat-dept-project-management-v1";
const PROJECT_MAIN_ID = "uat-project-wecom-v1";
const PROJECT_RESTRICTED_ID = "uat-project-restricted-v1";
const USER_IDS: Record<AccountKey, string> = {
  admin: "uat-user-admin-v1",
  manager: "uat-user-manager-v1",
  restricted: "uat-user-restricted-v1",
};
const USER_SPECS: Record<AccountKey, { displayName: string; email: string }> = {
  admin: { displayName: "UAT Admin", email: "uat-admin@test.projectai.local" },
  manager: { displayName: "UAT Project Manager", email: "uat-manager@test.projectai.local" },
  restricted: { displayName: "UAT Restricted User", email: "uat-restricted@test.projectai.local" },
};
const PROJECT_IDS = [PROJECT_MAIN_ID, PROJECT_RESTRICTED_ID];
const UAT_MARKER = "[UAT]";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function validateSafety(command: Command): void {
  const environment = process.env.PROJECTAI_UAT_ENVIRONMENT?.trim().toLowerCase();
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_APP_ENV === "production") {
    throw new Error("UAT_PRODUCTION_FORBIDDEN");
  }
  if (environment !== "local" && environment !== "staging") {
    throw new Error("PROJECTAI_UAT_ENVIRONMENT must be local or staging.");
  }
  if (command === "seed" && process.env.ALLOW_UAT_SEED !== "true") {
    throw new Error("ALLOW_UAT_SEED_REQUIRED");
  }
  if (command === "cleanup" && process.env.ALLOW_UAT_CLEANUP !== "true") {
    throw new Error("ALLOW_UAT_CLEANUP_REQUIRED");
  }
  if (environment === "staging" && process.env.ALLOW_STAGING_UAT !== "true") {
    throw new Error("ALLOW_STAGING_UAT_REQUIRED");
  }

  const databaseUrl = new URL(required("DATABASE_URL"));
  const databaseName = databaseUrl.pathname.replace(/^\//, "").toLowerCase();
  const host = databaseUrl.hostname.toLowerCase();
  if (/(^|[-_.])(prod|production)([-_.]|$)/u.test(`${host}.${databaseName}`)) {
    throw new Error("UAT_PRODUCTION_TARGET_FORBIDDEN");
  }
  if (
    environment === "local" &&
    (!new Set(["127.0.0.1", "localhost", "::1"]).has(host) || databaseName !== "projectai_uat")
  ) {
    throw new Error("UAT_LOCAL_DATABASE_TARGET_INVALID");
  }
}

function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}

function validateCredentialFile(value: unknown): CredentialFile {
  if (!value || typeof value !== "object") throw new Error("UAT_CREDENTIAL_FILE_INVALID");
  const candidate = value as Partial<CredentialFile>;
  if (candidate.version !== 1 || !candidate.accounts) throw new Error("UAT_CREDENTIAL_FILE_INVALID");
  for (const key of Object.keys(USER_SPECS) as AccountKey[]) {
    const actual = candidate.accounts[key];
    const expected = USER_SPECS[key];
    if (
      !actual ||
      actual.email !== expected.email ||
      actual.displayName !== expected.displayName ||
      typeof actual.password !== "string" ||
      actual.password.length < 20 ||
      actual.password.length > 128
    ) {
      throw new Error("UAT_CREDENTIAL_FILE_INVALID");
    }
  }
  return candidate as CredentialFile;
}

async function loadOrCreateCredentials(create: boolean): Promise<CredentialFile> {
  try {
    const credentials = validateCredentialFile(JSON.parse(await readFile(CREDENTIAL_PATH, "utf8")));
    await chmod(CREDENTIAL_PATH, 0o600);
    return credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) throw new Error("UAT_CREDENTIAL_FILE_MISSING");
  }

  const credentials: CredentialFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    accounts: {
      admin: { ...USER_SPECS.admin, password: randomPassword() },
      manager: { ...USER_SPECS.manager, password: randomPassword() },
      restricted: { ...USER_SPECS.restricted, password: randomPassword() },
    },
  };
  await mkdir(path.dirname(CREDENTIAL_PATH), { recursive: true, mode: 0o700 });
  const file = await open(CREDENTIAL_PATH, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(credentials, null, 2)}\n`, "utf8");
  } finally {
    await file.close();
  }
  return credentials;
}

async function seedUser(tx: DatabaseTransaction, key: AccountKey, credentials: CredentialFile): Promise<void> {
  const expected = credentials.accounts[key];
  const [byId] = await tx.select().from(user).where(eq(user.id, USER_IDS[key])).limit(1);
  const [byEmail] = await tx.select().from(user).where(eq(user.email, expected.email)).limit(1);
  if (byId && (byId.email !== expected.email || byId.displayName !== expected.displayName)) {
    throw new Error(`UAT_USER_ID_CONFLICT:${key}`);
  }
  if (byEmail && byEmail.id !== USER_IDS[key]) throw new Error(`UAT_USER_EMAIL_CONFLICT:${key}`);
  if (!byId) {
    await tx.insert(user).values({
      id: USER_IDS[key],
      email: expected.email,
      displayName: expected.displayName,
      emailVerified: true,
      systemRole: "standard_user",
      status: "active",
    });
  } else if (byId.systemRole !== "standard_user" || byId.status !== "active") {
    throw new Error(`UAT_USER_STATE_CONFLICT:${key}`);
  }

  const [credential] = await tx
    .select({ id: account.id, passwordHash: account.passwordHash })
    .from(account)
    .where(and(eq(account.userId, USER_IDS[key]), eq(account.providerId, "credential")))
    .limit(1);
  if (!credential) {
    await tx.insert(account).values({
      id: `uat-credential-${key}-v1`,
      userId: USER_IDS[key],
      accountId: USER_IDS[key],
      providerId: "credential",
      passwordHash: await hashPassword(expected.password),
    });
  } else if (!credential.passwordHash || !(await verifyPassword({ hash: credential.passwordHash, password: expected.password }))) {
    throw new Error(`UAT_CREDENTIAL_CONFLICT:${key}`);
  }
}

async function seed(credentials: CredentialFile): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const key of Object.keys(USER_SPECS) as AccountKey[]) await seedUser(tx, key, credentials);

    await tx.insert(aiModelProfile).values({
      id: "qwen-project-assistant-cn-v1",
      provider: "qwen",
      purpose: "project_assistant",
      primaryModel: "qwen3.7-plus",
      fallbackModel: "qwen3.6-flash",
      region: "cn-beijing",
      enabled: true,
      gatewayVersion: "1",
    }).onConflictDoNothing({ target: aiModelProfile.id });

    await tx.insert(organization).values({
      id: ORGANIZATION_ID,
      name: "ProjectAI UAT",
      slug: "projectai-uat",
      createdBy: USER_IDS.admin,
    }).onConflictDoNothing({ target: organization.id });

    for (const [key, role] of [
      ["admin", "organization_admin"],
      ["manager", "organization_member"],
      ["restricted", "organization_member"],
    ] as const) {
      await tx.insert(organizationMember).values({
        id: `uat-org-member-${key}-v1`,
        organizationId: ORGANIZATION_ID,
        userId: USER_IDS[key],
        role,
        createdBy: USER_IDS.admin,
      }).onConflictDoNothing({ target: [organizationMember.organizationId, organizationMember.userId] });
    }

    await tx.insert(department).values({
      id: DEPARTMENT_ID,
      organizationId: ORGANIZATION_ID,
      name: "UAT Project Management",
      code: "UAT-PM",
      description: `${UAT_MARKER} Synthetic non-production department.`,
      createdBy: USER_IDS.admin,
    }).onConflictDoNothing({ target: department.id });

    for (const [key, role] of [
      ["admin", "department_admin"],
      ["manager", "department_member"],
      ["restricted", "department_member"],
    ] as const) {
      await tx.insert(departmentMember).values({
        id: `uat-dept-member-${key}-v1`,
        organizationId: ORGANIZATION_ID,
        departmentId: DEPARTMENT_ID,
        userId: USER_IDS[key],
        role,
        createdBy: USER_IDS.admin,
      }).onConflictDoNothing({ target: [departmentMember.departmentId, departmentMember.userId] });
    }

    for (const item of [
      { id: PROJECT_MAIN_ID, name: "ProjectAI WeCom UAT", clientName: "[UAT] Fictional Collaboration Client" },
      { id: PROJECT_RESTRICTED_ID, name: "ProjectAI Restricted UAT", clientName: "[UAT] Fictional Restricted Client" },
    ]) {
      await tx.insert(project).values({
        ...item,
        organizationId: ORGANIZATION_ID,
        departmentId: DEPARTMENT_ID,
        description: `${UAT_MARKER} Synthetic project for non-production acceptance only.`,
        status: "active",
        stage: "testing",
        health: "healthy",
        createdBy: USER_IDS.admin,
      }).onConflictDoNothing({ target: project.id });
    }

    for (const [id, projectId, userId] of [
      ["uat-membership-admin-main-v1", PROJECT_MAIN_ID, USER_IDS.admin],
      ["uat-membership-admin-restricted-v1", PROJECT_RESTRICTED_ID, USER_IDS.admin],
      ["uat-membership-manager-main-v1", PROJECT_MAIN_ID, USER_IDS.manager],
    ]) {
      await tx.insert(projectMember).values({ id, projectId, userId, role: "project_manager", createdBy: USER_IDS.admin })
        .onConflictDoNothing({ target: [projectMember.projectId, projectMember.userId] });
    }

  });
}

async function verify(credentials: CredentialFile): Promise<void> {
  const db = getDb();
  const users = await db.select().from(user).where(inArray(user.id, Object.values(USER_IDS)));
  if (users.length !== 3) throw new Error("UAT_VERIFY_USERS_FAILED");
  const [org] = await db.select().from(organization).where(eq(organization.id, ORGANIZATION_ID)).limit(1);
  if (!org || org.name !== "ProjectAI UAT" || org.slug !== "projectai-uat") throw new Error("UAT_VERIFY_ORGANIZATION_FAILED");
  const projects = await db.select().from(project).where(inArray(project.id, PROJECT_IDS));
  if (projects.length !== 2 || projects.some((item) => item.organizationId !== ORGANIZATION_ID)) throw new Error("UAT_VERIFY_PROJECTS_FAILED");
  const memberships = await db.select().from(projectMember).where(inArray(projectMember.projectId, PROJECT_IDS));
  const managerProjects = memberships.filter((item) => item.userId === USER_IDS.manager).map((item) => item.projectId);
  const restrictedProjects = memberships.filter((item) => item.userId === USER_IDS.restricted);
  if (managerProjects.length !== 1 || managerProjects[0] !== PROJECT_MAIN_ID || restrictedProjects.length !== 0) {
    throw new Error("UAT_VERIFY_PROJECT_ISOLATION_FAILED");
  }
  const logs = await db.select().from(workLogRecord).where(and(eq(workLogRecord.organizationId, ORGANIZATION_ID), eq(workLogRecord.userId, USER_IDS.manager)));
  if (logs.length !== 0) throw new Error("UAT_VERIFY_EMPTY_WORK_LOGS_FAILED");
  for (const key of Object.keys(USER_SPECS) as AccountKey[]) {
    const [credential] = await db.select({ hash: account.passwordHash }).from(account)
      .where(and(eq(account.userId, USER_IDS[key]), eq(account.providerId, "credential"))).limit(1);
    if (!credential?.hash || !(await verifyPassword({ hash: credential.hash, password: credentials.accounts[key].password }))) {
      throw new Error(`UAT_VERIFY_CREDENTIAL_FAILED:${key}`);
    }
  }
  const schemaVersion = await db.execute<{ id: number }>(sql`select id from drizzle.__drizzle_migrations order by id desc limit 1`);
  if (schemaVersion.rows.length !== 1 || Number(schemaVersion.rows[0].id) < 18) throw new Error("UAT_MIGRATION_0017_REQUIRED");
  process.stdout.write(`UAT verification passed: schema=0017; users=3; projects=2; seededWorkLogs=0; credentials=${path.relative(ROOT, CREDENTIAL_PATH)}.\n`);
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [org] = await tx.select().from(organization).where(eq(organization.id, ORGANIZATION_ID)).limit(1);
    if (!org) return;
    if (org.name !== "ProjectAI UAT" || org.slug !== "projectai-uat") throw new Error("UAT_CLEANUP_OWNERSHIP_MISMATCH");
    const projects = await tx.select().from(project).where(inArray(project.id, PROJECT_IDS));
    if (projects.some((item) => item.organizationId !== ORGANIZATION_ID || !item.description.startsWith(UAT_MARKER))) {
      throw new Error("UAT_CLEANUP_OWNERSHIP_MISMATCH");
    }
    const batches = await tx.select({ id: timesheetSyncBatch.id }).from(timesheetSyncBatch).where(eq(timesheetSyncBatch.organizationId, ORGANIZATION_ID));
    if (batches.length) await tx.delete(timesheetSyncBatch).where(inArray(timesheetSyncBatch.id, batches.map((item) => item.id)));
    await tx.delete(timesheetAiExecution).where(eq(timesheetAiExecution.organizationId, ORGANIZATION_ID));
    await tx.delete(dailyTimesheetDraft).where(eq(dailyTimesheetDraft.organizationId, ORGANIZATION_ID));
    await tx.delete(workLogRecord).where(eq(workLogRecord.organizationId, ORGANIZATION_ID));
    await tx.delete(project).where(inArray(project.id, PROJECT_IDS));
    await tx.delete(department).where(eq(department.id, DEPARTMENT_ID));
    await tx.delete(organization).where(eq(organization.id, ORGANIZATION_ID));
    await tx.delete(session).where(inArray(session.userId, Object.values(USER_IDS)));
    await tx.delete(account).where(inArray(account.userId, Object.values(USER_IDS)));
    await tx.delete(user).where(inArray(user.id, Object.values(USER_IDS)));
  });
  process.stdout.write("UAT-owned database records were removed; the local credential file was preserved.\n");
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !["seed", "verify", "cleanup"].includes(command)) throw new Error("Expected seed, verify, or cleanup.");
  validateSafety(command);
  const credentials = await loadOrCreateCredentials(command === "seed");
  if (command === "seed") await seed(credentials);
  if (command === "verify") await verify(credentials);
  if (command === "cleanup") await cleanup();
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(`UAT command failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    await closeDatabasePool();
    process.exitCode = 1;
  });
