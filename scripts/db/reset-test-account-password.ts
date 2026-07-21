import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import { account, user } from "../../lib/db/schema";
import { normalizeEmail } from "../../lib/db/repositories/user-repository";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const environment = required("PROJECTAI_SEED_ENVIRONMENT");
  if (
    !["test", "staging"].includes(environment) ||
    process.env.NEXT_PUBLIC_APP_ENV === "production"
  ) {
    throw new Error("TEST_ACCOUNT_RESET_PRODUCTION_FORBIDDEN");
  }
  const email = normalizeEmail(required("TEST_ACCOUNT_EMAIL"));
  if (!email.endsWith("@test.projectai.local")) {
    throw new Error("TEST_ACCOUNT_EMAIL must use the controlled test domain.");
  }
  const password = required("TEST_ACCOUNT_NEW_PASSWORD");
  if (password.length < 12 || password.length > 128) {
    throw new Error("TEST_ACCOUNT_NEW_PASSWORD must be 12-128 characters.");
  }
  const [target] = await getDb()
    .select({ id: user.id, displayName: user.displayName })
    .from(user)
    .where(and(eq(user.email, email), eq(user.status, "active")))
    .limit(1);
  if (!target || !target.displayName.startsWith("[TEST]")) {
    throw new Error("Controlled test account not found.");
  }
  const result = await getDb()
    .update(account)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(
      and(eq(account.userId, target.id), eq(account.providerId, "credential")),
    )
    .returning({ id: account.id });
  if (result.length !== 1) throw new Error("Credential account not found.");
  process.stdout.write(`Test account password reset completed for ${email}.\n`);
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Test account password reset failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
