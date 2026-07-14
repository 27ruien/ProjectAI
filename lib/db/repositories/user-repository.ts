import { eq } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import { session, user, type UserRecord, type UserStatus } from "../schema";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserById(
  userId: string,
  db: DatabaseExecutor = getDb(),
): Promise<UserRecord | null> {
  const [record] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  return record ?? null;
}

export async function findUserByEmail(
  email: string,
  db: DatabaseExecutor = getDb(),
): Promise<UserRecord | null> {
  const [record] = await db
    .select()
    .from(user)
    .where(eq(user.email, normalizeEmail(email)))
    .limit(1);
  return record ?? null;
}

export async function updateLastLoginAt(
  userId: string,
  db: DatabaseExecutor = getDb(),
): Promise<void> {
  const now = new Date();
  await db
    .update(user)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(user.id, userId));
}

export async function updateUserStatus(
  userId: string,
  status: UserStatus,
  db?: DatabaseExecutor,
): Promise<void> {
  const update = async (executor: DatabaseExecutor) => {
    await executor
      .update(user)
      .set({ status, updatedAt: new Date() })
      .where(eq(user.id, userId));
    if (status === "disabled") {
      await executor.delete(session).where(eq(session.userId, userId));
    }
  };
  if (db) await update(db);
  else await getDb().transaction(update);
}
