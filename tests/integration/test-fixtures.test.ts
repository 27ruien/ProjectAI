import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  dailyTimesheetDraft,
  department,
  knowledgeSpace,
  project,
  projectDocument,
  testFixture,
  timesheetAiExecution,
  timesheetSyncBatch,
  timesheetSyncItem,
  timesheetTask,
  type UserRecord,
  workLogRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import { listAuthorizedDocumentScope } from "../../lib/knowledge/authorization";
import {
  deleteRegisteredFixtureDepartment,
  deleteRegisteredFixtureProject,
  deleteRegisteredFixtureTimesheetRun,
  registerTestFixture,
  type FixtureContext,
} from "../../lib/test-fixtures/service";
import {
  setObjectStorageForTests,
  type ObjectStorage,
  type ObjectStorageEntry,
} from "../../lib/files/object-storage";

const prefix = "round1-fixture-integration-";
const projectId = `${prefix}project`;
const projectDocumentId = `${prefix}document`;
const departmentId = `${prefix}department`;
const departmentSpaceId = `${prefix}department-space`;
const timesheetReportDate = "2039-12-31";
const timesheetWorkLogId = `${prefix}work-log`;
const formalWorkLogId = `${prefix}formal-work-log`;
const timesheetExecutionId = `${prefix}execution`;
const timesheetDraftId = `${prefix}draft`;
const timesheetTaskId = `${prefix}task`;
const timesheetBatchId = `${prefix}batch`;
const timesheetSyncItemId = `${prefix}sync-item`;
const fixture: FixtureContext = {
  fixtureRunId: "uat-round1-fixture-integration",
  environment: "test",
  expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
};

let creator: UserRecord;
const deletedObjects: string[] = [];

const storage: ObjectStorage = {
  async putObject() {
    throw new Error("not used");
  },
  async getObject() {
    throw new Error("not used");
  },
  async headObject() {
    return null;
  },
  async deleteObject(key) {
    deletedObjects.push(key);
  },
  async listObjects(objectPrefix): Promise<ObjectStorageEntry[]> {
    if (objectPrefix !== `projects/${projectId}/`) return [];
    return [
      {
        key: `${objectPrefix}documents/synthetic/versions/1/object`,
        size: 9,
        etag: null,
        sha256: null,
      },
    ];
  },
};

async function cleanup(): Promise<void> {
  await getDb().execute(sql`
    delete from test_fixtures where entity_id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from timesheet_sync_items where id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from timesheet_sync_batches where id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from timesheet_tasks where id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from timesheet_ai_executions where id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from daily_timesheet_drafts where id like ${`${prefix}%`}
  `);
  await getDb().execute(sql`
    delete from work_log_records where id like ${`${prefix}%`}
  `);
  await getDb().execute(
    sql`delete from project_documents where project_id = ${projectId}`,
  );
  await getDb().execute(sql`
    delete from knowledge_spaces
    where project_id = ${projectId}
       or id = ${departmentSpaceId}
  `);
  await getDb().execute(sql`delete from projects where id = ${projectId}`);
  await getDb().execute(
    sql`delete from departments where id = ${departmentId}`,
  );
}

describe("Round 1 exact fixture cleanup", () => {
  before(async () => {
    const foundCreator = await findUserByEmail(
      process.env.SEED_ADMIN_EMAIL || "admin.ci@projectai.invalid",
    );
    assert.ok(foundCreator);
    creator = foundCreator;
    setObjectStorageForTests(storage);
    await cleanup();
  });

  after(async () => {
    await cleanup();
    setObjectStorageForTests(undefined);
    await closeDatabasePool();
  });

  it("deletes only the registered project graph and its exact object prefix", async () => {
    const baseline = await getDb().execute<{ count: string }>(sql`
      select count(*)::text as count from projects
    `);
    await getDb().insert(project).values({
      id: projectId,
      organizationId: "org-legacy-default",
      departmentId: "dept-legacy-default",
      name: "Product V2 ACL UAT 1234abcd",
      clientName: "[TEST] Synthetic fixture client",
      description: "[TEST] Round 1 exact cleanup",
      createdBy: creator.id,
    });
    const [createdSpace] = await getDb()
      .select({ id: knowledgeSpace.id })
      .from(knowledgeSpace)
      .where(eq(knowledgeSpace.projectId, projectId))
      .limit(1);
    assert.ok(createdSpace, "project trigger must create the default space");
    await getDb().insert(projectDocument).values({
      id: projectDocumentId,
      projectId,
      knowledgeSpaceId: createdSpace.id,
      displayName: "[TEST] AI fixture isolation.txt",
      status: "active",
      createdBy: creator.id,
    });
    const principal = {
      sessionId: `${prefix}creator-session`,
      user: creator,
    };
    assert.deepEqual(
      await listAuthorizedDocumentScope({
        principal,
        projectId,
        permission: "view",
      }),
      [
        {
          documentId: projectDocumentId,
          sourceProjectId: projectId,
          knowledgeSpaceId: createdSpace.id,
          sourceScope: "project",
        },
      ],
    );
    await registerTestFixture(
      { ...fixture, entityType: "project", entityId: projectId },
    );
    await registerTestFixture({
      ...fixture,
      entityType: "knowledge_space",
      entityId: createdSpace.id,
    });
    assert.deepEqual(
      await listAuthorizedDocumentScope({
        principal,
        projectId,
        permission: "view",
      }),
      [],
      "AI retrieval document scope must exclude a registered fixture project",
    );

    const result = await deleteRegisteredFixtureProject({
      ...fixture,
      projectId,
    });
    assert.deepEqual(result, {
      projects: 1,
      knowledgeSpaces: 1,
      objects: 1,
    });
    assert.deepEqual(deletedObjects, [
      `projects/${projectId}/documents/synthetic/versions/1/object`,
    ]);
    const afterCount = await getDb().execute<{ count: string }>(sql`
      select count(*)::text as count from projects
    `);
    assert.equal(afterCount.rows[0]?.count, baseline.rows[0]?.count);
    assert.equal(
      (
        await getDb()
          .select({ id: project.id })
          .from(project)
          .where(eq(project.id, "project-001"))
          .limit(1)
      ).length,
      1,
      "formal baseline project must remain",
    );
  });

  it("refuses an unregistered formal project", async () => {
    await assert.rejects(
      deleteRegisteredFixtureProject({
        ...fixture,
        projectId: "project-001",
      }),
      /TEST_FIXTURE_NOT_REGISTERED/u,
    );
    const [formalProject] = await getDb()
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, "project-001"))
      .limit(1);
    assert.equal(formalProject?.id, "project-001");
  });

  it("requires a registered department to be inactive and unused", async () => {
    await getDb().insert(department).values({
      id: departmentId,
      organizationId: "org-legacy-default",
      name: "Round 1 fixture department",
      code: "UAT-1234ABCD-1",
      status: "active",
      createdBy: creator.id,
    });
    await getDb().insert(knowledgeSpace).values({
      id: departmentSpaceId,
      organizationId: "org-legacy-default",
      departmentId,
      type: "department",
      visibility: "department_shared",
      name: "Round 1 fixture department space",
      createdBy: creator.id,
    });
    await registerTestFixture({
      ...fixture,
      entityType: "department",
      entityId: departmentId,
    });
    await registerTestFixture({
      ...fixture,
      entityType: "knowledge_space",
      entityId: departmentSpaceId,
    });

    await assert.rejects(
      deleteRegisteredFixtureDepartment({ ...fixture, departmentId }),
      /TEST_FIXTURE_DEPARTMENT_ACTIVE/u,
    );
    await getDb()
      .update(department)
      .set({ status: "inactive" })
      .where(
        and(
          eq(department.id, departmentId),
          eq(department.organizationId, "org-legacy-default"),
        ),
      );
    assert.deepEqual(
      await deleteRegisteredFixtureDepartment({ ...fixture, departmentId }),
      { departments: 1, knowledgeSpaces: 1 },
    );
    const residual = await getDb()
      .select({ id: testFixture.id })
      .from(testFixture)
      .where(eq(testFixture.fixtureRunId, fixture.fixtureRunId));
    assert.equal(residual.length, 0);
  });

  it("deletes an exact registered timesheet graph without touching an unregistered work log", async () => {
    await getDb().insert(workLogRecord).values([
      {
        id: timesheetWorkLogId,
        organizationId: "org-legacy-default",
        userId: creator.id,
        recordDate: timesheetReportDate,
        recordedAt: new Date("2039-12-31T04:00:00Z"),
        rawText: "[TEST] registered timesheet fixture",
      },
      {
        id: formalWorkLogId,
        organizationId: "org-legacy-default",
        userId: creator.id,
        recordDate: timesheetReportDate,
        recordedAt: new Date("2039-12-31T05:00:00Z"),
        rawText: "unregistered record that must remain",
      },
    ]);
    await getDb().insert(dailyTimesheetDraft).values({
      id: timesheetDraftId,
      organizationId: "org-legacy-default",
      userId: creator.id,
      reportDate: timesheetReportDate,
      status: "needs_review",
      totalHours: "1",
    });
    await getDb().insert(timesheetTask).values({
      id: timesheetTaskId,
      draftId: timesheetDraftId,
      description: "[TEST] registered task",
      hours: "1",
      overtimeHours: "0",
      confidence: {
        description: 1,
        project: 1,
        hours: 1,
        category: 1,
        status: 1,
      },
      sourceRecordIds: [timesheetWorkLogId],
      sortOrder: 0,
    });
    await getDb().insert(timesheetSyncBatch).values({
      id: timesheetBatchId,
      organizationId: "org-legacy-default",
      userId: creator.id,
      draftId: timesheetDraftId,
      syncBatchId: `${timesheetBatchId}-public`,
      requestId: `${timesheetBatchId}-request`,
      draftVersion: 1,
      confirmedAtSnapshot: new Date("2039-12-31T06:00:00Z"),
    });
    await getDb().insert(timesheetSyncItem).values({
      id: timesheetSyncItemId,
      batchId: timesheetBatchId,
      taskId: timesheetTaskId,
      idempotencyKey: `${timesheetSyncItemId}-key`,
    });
    await getDb().insert(timesheetAiExecution).values({
      id: timesheetExecutionId,
      organizationId: "org-legacy-default",
      userId: creator.id,
      draftId: timesheetDraftId,
      reportDate: timesheetReportDate,
      executionId: timesheetExecutionId,
      requestId: `${timesheetExecutionId}-request`,
      skillId: "pm-daily-timesheet-generation",
      modelProfileId: "test-timesheet-profile",
      promptVersion: "test-prompt",
      status: "completed",
      sourceSelectionDigest: "a".repeat(64),
      sourceCount: 1,
    });
    for (const fixtureEntity of [
      ["work_log_record", timesheetWorkLogId],
      ["timesheet_ai_execution", timesheetExecutionId],
      ["daily_timesheet_draft", timesheetDraftId],
    ] as const) {
      await registerTestFixture({
        ...fixture,
        entityType: fixtureEntity[0],
        entityId: fixtureEntity[1],
      });
    }

    assert.deepEqual(
      await deleteRegisteredFixtureTimesheetRun({
        ...fixture,
        userId: creator.id,
        reportDate: timesheetReportDate,
      }),
      {
        workLogs: 1,
        executions: 1,
        drafts: 1,
        tasks: 1,
        syncBatches: 1,
        syncItems: 1,
      },
    );
    const [formalRecord] = await getDb()
      .select({ id: workLogRecord.id })
      .from(workLogRecord)
      .where(eq(workLogRecord.id, formalWorkLogId));
    assert.equal(formalRecord?.id, formalWorkLogId);
    const residual = await getDb()
      .select({ id: testFixture.id })
      .from(testFixture)
      .where(eq(testFixture.fixtureRunId, fixture.fixtureRunId));
    assert.equal(residual.length, 0);
  });
});
