import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { closeDatabasePool, getDb } from "@/lib/db/client";
import {
  account,
  organization,
  organizationMember,
  project,
  projectMember,
  user,
} from "@/lib/db/schema";

const credentialsSchema = z.object({
  accounts: z.array(z.object({
    key: z.enum(["admin", "pm-a", "pm-ab"]),
    email: z.string().email().transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
  })).length(3),
});

const expectedKeys = new Set(["admin", "pm-a", "pm-ab"]);
const credentialsFile = resolve(process.env.UAT_CREDENTIALS_FILE || "");
const databaseUrl = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (
  process.env.NEXT_PUBLIC_APP_ENV !== "staging" ||
  process.env.PROJECTAI_UAT_APPLY !== "true" ||
  databaseUrl.pathname !== "/projectai_slim_uat"
) {
  throw new Error("UAT_BOOTSTRAP_GUARD_REJECTED");
}
const details = await stat(credentialsFile);
if (!details.isFile() || (details.mode & 0o077) !== 0) {
  throw new Error("UAT_CREDENTIALS_FILE_PERMISSIONS_INVALID");
}
const credentials = credentialsSchema.parse(
  JSON.parse(await readFile(credentialsFile, "utf8")),
);
if (
  new Set(credentials.accounts.map((item) => item.key)).size !== 3 ||
  credentials.accounts.some((item) => !expectedKeys.has(item.key))
) {
  throw new Error("UAT_CREDENTIALS_SET_INVALID");
}

const specs = {
  admin: { id: "uat-user-admin", displayName: "UAT Admin", productRole: "admin" as const },
  "pm-a": { id: "uat-user-pm-a", displayName: "UAT Project Manager A", productRole: "member" as const },
  "pm-ab": { id: "uat-user-pm-ab", displayName: "UAT Project Manager AB", productRole: "member" as const },
};
const projects = [
  { id: "uat-project-a", name: "Project A", clientName: "UAT Client A" },
  { id: "uat-project-b", name: "Project B", clientName: "UAT Client B" },
  { id: "uat-project-c", name: "Project C", clientName: "UAT Client C" },
] as const;
const byKey = new Map(credentials.accounts.map((item) => [item.key, item]));
const db = getDb();

await db.transaction(async (tx) => {
  for (const [key, spec] of Object.entries(specs) as Array<[keyof typeof specs, (typeof specs)[keyof typeof specs]]>) {
    const credential = byKey.get(key)!;
    const [existing] = await tx.select().from(user).where(eq(user.email, credential.email)).limit(1);
    if (existing && existing.id !== spec.id) throw new Error(`UAT_USER_EMAIL_CONFLICT:${key}`);
    if (!existing) {
      await tx.insert(user).values({
        id: spec.id,
        email: credential.email,
        displayName: spec.displayName,
        emailVerified: true,
        systemRole: "standard_user",
        productRole: spec.productRole,
        status: "active",
      });
    }
    const [existingCredential] = await tx.select({ id: account.id }).from(account).where(
      and(eq(account.userId, spec.id), eq(account.providerId, "credential")),
    ).limit(1);
    if (!existingCredential) {
      await tx.insert(account).values({
        id: `credential-${spec.id}`,
        accountId: spec.id,
        providerId: "credential",
        userId: spec.id,
        passwordHash: await hashPassword(credential.password),
      });
    }
  }

  await tx.insert(organization).values({
    id: "org-projectai-uat",
    name: "Project AI UAT",
    slug: "kivisense",
    createdBy: specs.admin.id,
  }).onConflictDoNothing({ target: organization.id });

  for (const [key, spec] of Object.entries(specs) as Array<[keyof typeof specs, (typeof specs)[keyof typeof specs]]>) {
    await tx.insert(organizationMember).values({
      id: `uat-org-member-${key}`,
      organizationId: "org-projectai-uat",
      userId: spec.id,
      role: key === "admin" ? "organization_admin" : "organization_member",
      createdBy: specs.admin.id,
    }).onConflictDoNothing({
      target: [organizationMember.organizationId, organizationMember.userId],
    });
  }

  for (const item of projects) {
    await tx.insert(project).values({
      ...item,
      organizationId: "org-projectai-uat",
      description: `${item.name} synthetic staging acceptance project`,
      status: "active",
      stage: "testing",
      health: "healthy",
      knowledgeStatus: "pending",
      createdBy: specs.admin.id,
    }).onConflictDoNothing({ target: project.id });
  }

  const memberships = [
    ...projects.map((item) => ({ projectId: item.id, userId: specs.admin.id })),
    { projectId: "uat-project-a", userId: specs["pm-a"].id },
    { projectId: "uat-project-a", userId: specs["pm-ab"].id },
    { projectId: "uat-project-b", userId: specs["pm-ab"].id },
  ];
  for (const membership of memberships) {
    await tx.insert(projectMember).values({
      id: randomUUID(),
      ...membership,
      role: "project_manager",
      createdBy: specs.admin.id,
    }).onConflictDoNothing({
      target: [projectMember.projectId, projectMember.userId],
    });
  }
});

console.log(JSON.stringify({
  created: true,
  users: credentials.accounts.map(({ key, email }) => ({ key, email })),
  projects: projects.map(({ id, name }) => ({ id, name })),
  passwordContentEmitted: false,
}));
await closeDatabasePool();
