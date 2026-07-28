import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  department,
  organization,
  project,
  testFixture,
} from "../lib/db/schema";
import { getObjectStorage } from "../lib/files/object-storage";
import {
  deleteRegisteredFixtureDepartment,
  deleteRegisteredFixtureProject,
  type FixtureContext,
} from "../lib/test-fixtures/service";

type Command = "inventory" | "cleanup";

const LEGACY_ORGANIZATION_ID = "uat-org-projectai-v1";
const syntheticProjectName =
  /^(?:Member Creator UAT [a-f0-9]{8}(?: 已更新)?|Product V2 ACL UAT [a-f0-9]{8}|需求结果空间 [a-f0-9]{8})$/iu;
const syntheticDepartmentCode = /^UAT-[A-F0-9]{8}-[1-5]$/u;

function validateRuntime(command: Command): void {
  const environment = (
    process.env.PROJECTAI_UAT_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_APP_ENV ||
    ""
  )
    .trim()
    .toLowerCase();
  if (
    process.env.NODE_ENV === "production" &&
    environment !== "staging"
  ) {
    throw new Error("STAGING_FIXTURE_PRODUCTION_FORBIDDEN");
  }
  if (environment !== "staging") {
    throw new Error("STAGING_FIXTURE_ENVIRONMENT_REQUIRED");
  }
  const databaseUrl = new URL(process.env.DATABASE_URL || "");
  if (/(^|[-_.])(prod|production)([-_.]|$)/iu.test(
    `${databaseUrl.hostname}.${databaseUrl.pathname}`,
  )) {
    throw new Error("STAGING_FIXTURE_PRODUCTION_TARGET_FORBIDDEN");
  }
  if (
    command === "cleanup" &&
    process.env.ALLOW_STAGING_FIXTURE_CLEANUP !== "true"
  ) {
    throw new Error("ALLOW_STAGING_FIXTURE_CLEANUP_REQUIRED");
  }
}

async function inventory(): Promise<Record<string, number>> {
  const database = await getDb().execute<{
    fixtures: number;
    fixture_projects: number;
    fixture_departments: number;
    legacy_organizations: number;
    organizations: number;
    projects: number;
    documents: number;
  }>(sql`
    select
      (select count(*)::int from test_fixtures) as fixtures,
      (select count(*)::int from test_fixtures where entity_type = 'project') as fixture_projects,
      (select count(*)::int from test_fixtures where entity_type = 'department') as fixture_departments,
      (select count(*)::int from organizations where id = ${LEGACY_ORGANIZATION_ID}) as legacy_organizations,
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from projects) as projects,
      (select count(*)::int from project_documents) as documents
  `);
  const objects = await getObjectStorage().listObjects("");
  const row = database.rows[0]!;
  return {
    fixtures: Number(row.fixtures),
    fixtureProjects: Number(row.fixture_projects),
    fixtureDepartments: Number(row.fixture_departments),
    legacyOrganizations: Number(row.legacy_organizations),
    organizations: Number(row.organizations),
    projects: Number(row.projects),
    documents: Number(row.documents),
    objects: objects.length,
  };
}

async function cleanup(): Promise<void> {
  const projectFixtures = await getDb()
    .select({
      entityId: testFixture.entityId,
      fixtureRunId: testFixture.fixtureRunId,
      environment: testFixture.environment,
      expiresAt: testFixture.expiresAt,
      name: project.name,
      organizationId: project.organizationId,
    })
    .from(testFixture)
    .innerJoin(
      project,
      and(
        eq(testFixture.entityType, "project"),
        eq(testFixture.entityId, project.id),
      ),
    )
    .where(
      and(
        eq(testFixture.isTestFixture, true),
        eq(testFixture.environment, "staging"),
      ),
    );
  for (const fixture of projectFixtures) {
    if (
      fixture.organizationId !== LEGACY_ORGANIZATION_ID &&
      !syntheticProjectName.test(fixture.name)
    ) {
      throw new Error("STAGING_FIXTURE_PROJECT_REVIEW_REQUIRED");
    }
    await deleteRegisteredFixtureProject({
      projectId: fixture.entityId,
      fixtureRunId: fixture.fixtureRunId,
      environment: fixture.environment as FixtureContext["environment"],
      expiresAt: fixture.expiresAt,
    });
  }

  const departmentFixtures = await getDb()
    .select({
      entityId: testFixture.entityId,
      fixtureRunId: testFixture.fixtureRunId,
      environment: testFixture.environment,
      expiresAt: testFixture.expiresAt,
      organizationId: department.organizationId,
      code: department.code,
    })
    .from(testFixture)
    .innerJoin(
      department,
      and(
        eq(testFixture.entityType, "department"),
        eq(testFixture.entityId, department.id),
      ),
    )
    .where(
      and(
        eq(testFixture.isTestFixture, true),
        eq(testFixture.environment, "staging"),
      ),
    )
    .orderBy(desc(department.level));
  for (const fixture of departmentFixtures) {
    if (
      fixture.organizationId !== LEGACY_ORGANIZATION_ID &&
      !syntheticDepartmentCode.test(fixture.code)
    ) {
      throw new Error("STAGING_FIXTURE_DEPARTMENT_REVIEW_REQUIRED");
    }
    await getDb()
      .update(department)
      .set({ status: "inactive" })
      .where(
        and(
          eq(department.id, fixture.entityId),
          eq(department.organizationId, fixture.organizationId),
        ),
      );
    await deleteRegisteredFixtureDepartment({
      departmentId: fixture.entityId,
      fixtureRunId: fixture.fixtureRunId,
      environment: fixture.environment as FixtureContext["environment"],
      expiresAt: fixture.expiresAt,
    });
  }

  const [legacyOrganization] = await getDb()
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(eq(organization.id, LEGACY_ORGANIZATION_ID))
    .limit(1);
  if (legacyOrganization) {
    if (
      !["ProjectAI UAT", "ProjectAI Staging UAT"].includes(
        legacyOrganization.name,
      ) ||
      !["projectai-uat", "projectai-staging-uat"].includes(
        legacyOrganization.slug,
      )
    ) {
      throw new Error("STAGING_FIXTURE_LEGACY_ORGANIZATION_REVIEW_REQUIRED");
    }
    const blockers = await getDb().execute<{ count: number }>(sql`
      select count(*)::int as count
      from projects
      where organization_id = ${LEGACY_ORGANIZATION_ID}
    `);
    if (Number(blockers.rows[0]?.count) !== 0) {
      throw new Error("STAGING_FIXTURE_LEGACY_PROJECTS_REMAIN");
    }
    const scopedFixtures = await getDb().execute<{ id: string }>(sql`
      select f.id
      from test_fixtures f
      where f.entity_type = 'organization'
        and f.entity_id = ${LEGACY_ORGANIZATION_ID}
      union
      select f.id
      from test_fixtures f
      join knowledge_spaces s on f.entity_type = 'knowledge_space'
                             and f.entity_id = s.id
      where s.organization_id = ${LEGACY_ORGANIZATION_ID}
    `);
    await getDb()
      .delete(organization)
      .where(eq(organization.id, LEGACY_ORGANIZATION_ID));
    const fixtureIds = scopedFixtures.rows.map((row) => row.id);
    if (fixtureIds.length > 0) {
      await getDb()
        .delete(testFixture)
        .where(inArray(testFixture.id, fixtureIds));
    }
  }
}

async function main(): Promise<void> {
  const command = (process.argv[2] || "inventory") as Command;
  if (!["inventory", "cleanup"].includes(command)) {
    throw new Error("Expected inventory or cleanup.");
  }
  validateRuntime(command);
  const before = await inventory();
  if (command === "cleanup") await cleanup();
  const after = await inventory();
  process.stdout.write(
    `${JSON.stringify({ command, before, after })}\n`,
  );
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `Staging fixture lifecycle failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    await closeDatabasePool();
    process.exitCode = 1;
  });
