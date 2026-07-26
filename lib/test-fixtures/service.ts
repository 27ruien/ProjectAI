import { and, eq, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { testFixture } from "@/lib/db/schema";

export const FIXTURE_RUN_HEADER = "x-projectai-fixture-run-id";
export const FIXTURE_EXPIRY_HEADER = "x-projectai-fixture-expires-at";

const MAX_FIXTURE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const ALLOWED_ENTITY_TYPES = new Set([
  "organization",
  "department",
  "project",
  "knowledge_space",
  "workflow_run",
  "workflow_artifact",
  "daily_timesheet_draft",
  "work_log_record",
]);

export type FixtureContext = {
  fixtureRunId: string;
  environment: "local" | "test" | "ci" | "staging";
  expiresAt: Date;
};

function runtimeEnvironment(): FixtureContext["environment"] | null {
  const value = (
    process.env.PROJECTAI_UAT_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    ""
  ).trim().toLowerCase();
  if (value === "production") return null;
  if (value === "development" || value === "local") return "local";
  if (value === "test") return "test";
  if (value === "ci") return "ci";
  if (value === "staging") return "staging";
  return null;
}

export function includeTestFixturesInProductQueries(): boolean {
  return (
    runtimeEnvironment() !== null &&
    process.env.PROJECTAI_INCLUDE_TEST_FIXTURES === "true"
  );
}

export function fixtureContextFromHeaders(headers: Headers): FixtureContext | null {
  const environment = runtimeEnvironment();
  if (!environment) return null;
  const fixtureRunId = headers.get(FIXTURE_RUN_HEADER)?.trim() || "";
  if (!/^uat-[a-z0-9][a-z0-9._:-]{2,180}$/iu.test(fixtureRunId)) return null;
  const expiresAtValue = headers.get(FIXTURE_EXPIRY_HEADER)?.trim() || "";
  const expiresAt = new Date(expiresAtValue);
  const now = Date.now();
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now ||
    expiresAt.getTime() - now > MAX_FIXTURE_LIFETIME_MS
  ) {
    return null;
  }
  return { fixtureRunId, environment, expiresAt };
}

export async function registerTestFixture(
  input: FixtureContext & { entityType: string; entityId: string },
  db: DatabaseExecutor = getDb(),
): Promise<void> {
  if (!ALLOWED_ENTITY_TYPES.has(input.entityType)) {
    throw new Error("TEST_FIXTURE_ENTITY_TYPE_INVALID");
  }
  await db
    .insert(testFixture)
    .values({
      id: crypto.randomUUID(),
      entityType: input.entityType,
      entityId: input.entityId,
      fixtureRunId: input.fixtureRunId,
      environment: input.environment,
      expiresAt: input.expiresAt,
    })
    .onConflictDoUpdate({
      target: [testFixture.entityType, testFixture.entityId],
      set: {
        fixtureRunId: input.fixtureRunId,
        environment: input.environment,
        expiresAt: input.expiresAt,
        isTestFixture: true,
      },
    });
}

export async function isRegisteredFixture(
  entityType: string,
  entityId: string,
  db: DatabaseExecutor = getDb(),
): Promise<boolean> {
  const [record] = await db
    .select({ id: testFixture.id })
    .from(testFixture)
    .where(
      and(
        eq(testFixture.entityType, entityType),
        eq(testFixture.entityId, entityId),
        eq(testFixture.isTestFixture, true),
        sql`${testFixture.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return Boolean(record);
}
