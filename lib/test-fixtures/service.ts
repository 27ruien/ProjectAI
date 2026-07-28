import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  auditEvent,
  dailyTimesheetDraft,
  testFixture,
  timesheetAiExecution,
  timesheetSyncBatch,
  timesheetSyncItem,
  timesheetTask,
  workLogRecord,
} from "@/lib/db/schema";
import { getObjectStorage } from "@/lib/files/object-storage";

export const FIXTURE_RUN_HEADER = "x-projectai-fixture-run-id";
export const FIXTURE_EXPIRY_HEADER = "x-projectai-fixture-expires-at";

const MAX_FIXTURE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
const ALLOWED_ENTITY_TYPES = new Set([
  "organization",
  "department",
  "project",
  "knowledge_space",
  "daily_timesheet_draft",
  "timesheet_ai_execution",
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

export function fixtureCleanupContextFromHeaders(
  headers: Headers,
): FixtureContext | null {
  const environment = runtimeEnvironment();
  if (!environment) return null;
  const fixtureRunId = headers.get(FIXTURE_RUN_HEADER)?.trim() || "";
  if (!/^uat-[a-z0-9][a-z0-9._:-]{2,180}$/iu.test(fixtureRunId)) return null;
  const expiresAt = new Date(headers.get(FIXTURE_EXPIRY_HEADER)?.trim() || "");
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() - Date.now() > MAX_FIXTURE_LIFETIME_MS
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

export async function registeredFixtureContext(
  entityType: string,
  entityId: string,
  db: DatabaseExecutor = getDb(),
): Promise<FixtureContext | null> {
  const [record] = await db
    .select({
      fixtureRunId: testFixture.fixtureRunId,
      environment: testFixture.environment,
      expiresAt: testFixture.expiresAt,
    })
    .from(testFixture)
    .where(
      and(
        eq(testFixture.entityType, entityType),
        eq(testFixture.entityId, entityId),
        eq(testFixture.isTestFixture, true),
      ),
    )
    .limit(1);
  return record
    ? {
        fixtureRunId: record.fixtureRunId,
        environment: record.environment as FixtureContext["environment"],
        expiresAt: record.expiresAt,
      }
    : null;
}

async function lockFixture(
  input: FixtureContext & {
    entityType: "project" | "department";
    entityId: string;
  },
  db: DatabaseExecutor,
): Promise<void> {
  const [record] = await db
    .select({ id: testFixture.id })
    .from(testFixture)
    .where(
      and(
        eq(testFixture.entityType, input.entityType),
        eq(testFixture.entityId, input.entityId),
        eq(testFixture.fixtureRunId, input.fixtureRunId),
        eq(testFixture.environment, input.environment),
        sql`date_trunc('milliseconds', ${testFixture.expiresAt}) = ${input.expiresAt}`,
        eq(testFixture.isTestFixture, true),
      ),
    )
    .limit(1)
    .for("update", { of: testFixture });
  if (!record) throw new Error("TEST_FIXTURE_NOT_REGISTERED");
}

export async function deleteRegisteredFixtureProject(
  input: FixtureContext & { projectId: string },
): Promise<{ projects: number; knowledgeSpaces: number; objects: number }> {
  const databaseResult = await getDb().transaction(async (tx) => {
    await lockFixture(
      { ...input, entityType: "project", entityId: input.projectId },
      tx,
    );
    const projectRows = await tx.execute<{ id: string }>(sql`
      select id from projects where id = ${input.projectId} for update
    `);
    const spaces = await tx.execute<{ id: string }>(sql`
      select id from knowledge_spaces where project_id = ${input.projectId}
    `);
    const versions = await tx.execute<{ object_key: string }>(sql`
      select object_key
      from project_document_versions
      where project_id = ${input.projectId}
    `);

    if (projectRows.rows.length > 0) {
      await tx.execute(sql`
        delete from timesheet_sync_items
        where task_id in (
          select id from timesheet_tasks where project_id = ${input.projectId}
        )
      `);
      await tx.execute(
        sql`delete from timesheet_tasks where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from weekly_report_versions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from weekly_report_drafts where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from risk_sources where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from risk_history where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from risk_reviews where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from risks where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from risk_drafts where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_item_dependencies where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_item_sources where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_item_history where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_item_reviews where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_items where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from action_item_drafts where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from project_management_ai_executions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from project_management_audits where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from scope_diff_reviews where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from scope_diff_items where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from scope_comparison_runs where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from scope_versions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirement_sources where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirement_versions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirement_reviews where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirement_drafts where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirement_audits where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from requirements where project_id = ${input.projectId}`,
      );
      const optionalAheadSchema = await tx.execute<{
        workflow_runs: boolean;
      }>(sql`
        select to_regclass('public.workflow_runs') is not null as workflow_runs
      `);
      if (optionalAheadSchema.rows[0]?.workflow_runs) {
        await tx.execute(
          sql`delete from workflow_runs where project_id = ${input.projectId}`,
        );
      }
      await tx.execute(
        sql`delete from requirement_extraction_runs where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_message_citations where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_retrieval_candidates where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_retrieval_query_embedding_calls where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_retrieval_runs where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_executions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_messages where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from ai_threads where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_chunk_embeddings where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_embedding_provider_calls where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_embedding_batches where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_embedding_jobs where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_chunks where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_sections where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from document_ingestion_jobs where project_id = ${input.projectId}`,
      );
      await tx.execute(sql`
        delete from permission_audits
        where project_id = ${input.projectId}
           or resource_id = ${input.projectId}
      `);
      await tx.execute(sql`
        delete from audit_events
        where project_id = ${input.projectId}
           or entity_id = ${input.projectId}
      `);
      await tx.execute(
        sql`delete from document_grants where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from project_knowledge_sources where project_id = ${input.projectId}`,
      );
      await tx.execute(sql`
        delete from knowledge_space_grants
        where subject_type = 'project'
          and subject_id = ${input.projectId}
      `);
      await tx.execute(
        sql`delete from project_document_versions where project_id = ${input.projectId}`,
      );
      await tx.execute(
        sql`delete from project_documents where project_id = ${input.projectId}`,
      );
    }
    return {
      projects: projectRows.rows.length,
      knowledgeSpaceIds: spaces.rows.map((row) => row.id),
      objectKeys: versions.rows.map((row) => row.object_key).filter(Boolean),
    };
  });

  const storage = getObjectStorage();
  const objectKeys = new Set(databaseResult.objectKeys);
  for (const object of await storage.listObjects(`projects/${input.projectId}/`)) {
    objectKeys.add(object.key);
  }
  for (const key of objectKeys) await storage.deleteObject(key);

  await getDb().transaction(async (tx) => {
    await lockFixture(
      { ...input, entityType: "project", entityId: input.projectId },
      tx,
    );
    await tx.execute(
      sql`delete from project_members where project_id = ${input.projectId}`,
    );
    await tx.execute(
      sql`delete from projects where id = ${input.projectId}`,
    );
    if (databaseResult.knowledgeSpaceIds.length > 0) {
      await tx.execute(sql`
        delete from test_fixtures
        where entity_type = 'knowledge_space'
          and entity_id in (${sql.join(
            databaseResult.knowledgeSpaceIds.map((id) => sql`${id}`),
            sql`, `,
          )})
          and fixture_run_id = ${input.fixtureRunId}
          and environment = ${input.environment}
      `);
    }
    await tx.delete(testFixture).where(
      and(
        eq(testFixture.entityType, "project"),
        eq(testFixture.entityId, input.projectId),
        eq(testFixture.fixtureRunId, input.fixtureRunId),
        eq(testFixture.environment, input.environment),
      ),
    );
  });
  return {
    projects: databaseResult.projects,
    knowledgeSpaces: databaseResult.knowledgeSpaceIds.length,
    objects: objectKeys.size,
  };
}

export async function deleteRegisteredFixtureDepartment(
  input: FixtureContext & { departmentId: string },
): Promise<{ departments: number; knowledgeSpaces: number }> {
  return getDb().transaction(async (tx) => {
    await lockFixture(
      { ...input, entityType: "department", entityId: input.departmentId },
      tx,
    );
    const rows = await tx.execute<{ id: string; status: string }>(sql`
      select id, status
      from departments
      where id = ${input.departmentId}
      for update
    `);
    if (rows.rows.length === 0) {
      await tx.delete(testFixture).where(
        and(
          eq(testFixture.entityType, "department"),
          eq(testFixture.entityId, input.departmentId),
          eq(testFixture.fixtureRunId, input.fixtureRunId),
          eq(testFixture.environment, input.environment),
        ),
      );
      return { departments: 0, knowledgeSpaces: 0 };
    }
    if (rows.rows[0]?.status !== "inactive") {
      throw new Error("TEST_FIXTURE_DEPARTMENT_ACTIVE");
    }
    const blockers = await tx.execute<{ count: number }>(sql`
      select (
        (select count(*) from departments where parent_department_id = ${input.departmentId})
        + (select count(*) from projects where department_id = ${input.departmentId})
      )::int as count
    `);
    if (Number(blockers.rows[0]?.count) !== 0) {
      throw new Error("TEST_FIXTURE_DEPARTMENT_IN_USE");
    }
    const spaces = await tx.execute<{ id: string }>(sql`
      select id from knowledge_spaces where department_id = ${input.departmentId}
    `);
    if (spaces.rows.length > 0) {
      const ids = sql.join(spaces.rows.map((row) => sql`${row.id}`), sql`, `);
      const references = await tx.execute<{ count: number }>(sql`
        select (
          (select count(*) from project_documents where knowledge_space_id in (${ids}))
          + (select count(*) from project_knowledge_sources where knowledge_space_id in (${ids}))
        )::int as count
      `);
      if (Number(references.rows[0]?.count) !== 0) {
        throw new Error("TEST_FIXTURE_DEPARTMENT_IN_USE");
      }
      await tx.execute(
        sql`delete from permission_audits where resource_id in (${ids})`,
      );
      await tx.execute(
        sql`delete from audit_events where entity_id in (${ids})`,
      );
      await tx.execute(
        sql`delete from knowledge_space_grants where knowledge_space_id in (${ids})`,
      );
      await tx.execute(
        sql`delete from knowledge_space_members where knowledge_space_id in (${ids})`,
      );
      await tx.execute(
        sql`delete from knowledge_spaces where id in (${ids})`,
      );
      await tx.execute(sql`
        delete from test_fixtures
        where entity_type = 'knowledge_space'
          and entity_id in (${ids})
          and fixture_run_id = ${input.fixtureRunId}
          and environment = ${input.environment}
      `);
    }
    await tx.execute(
      sql`delete from permission_audits where resource_id = ${input.departmentId}`,
    );
    await tx.execute(
      sql`delete from audit_events where entity_id = ${input.departmentId}`,
    );
    await tx.execute(
      sql`delete from department_members where department_id = ${input.departmentId}`,
    );
    await tx.execute(
      sql`delete from departments where id = ${input.departmentId}`,
    );
    await tx.delete(testFixture).where(
      and(
        eq(testFixture.entityType, "department"),
        eq(testFixture.entityId, input.departmentId),
        eq(testFixture.fixtureRunId, input.fixtureRunId),
        eq(testFixture.environment, input.environment),
      ),
    );
    return { departments: 1, knowledgeSpaces: spaces.rows.length };
  });
}

export async function deleteRegisteredFixtureTimesheetRun(
  input: FixtureContext & { userId: string; reportDate: string },
): Promise<{
  workLogs: number;
  executions: number;
  drafts: number;
  tasks: number;
  syncBatches: number;
  syncItems: number;
}> {
  return getDb().transaction(async (tx) => {
    const fixtures = await tx
      .select({
        id: testFixture.id,
        entityType: testFixture.entityType,
        entityId: testFixture.entityId,
      })
      .from(testFixture)
      .where(
        and(
          eq(testFixture.fixtureRunId, input.fixtureRunId),
          eq(testFixture.environment, input.environment),
          eq(testFixture.expiresAt, input.expiresAt),
          eq(testFixture.isTestFixture, true),
          inArray(testFixture.entityType, [
            "work_log_record",
            "timesheet_ai_execution",
            "daily_timesheet_draft",
          ]),
        ),
      )
      .for("update", { of: testFixture });
    if (fixtures.length === 0) {
      throw new Error("TEST_FIXTURE_TIMESHEET_RUN_NOT_REGISTERED");
    }

    const ids = (entityType: string) =>
      fixtures
        .filter((fixture) => fixture.entityType === entityType)
        .map((fixture) => fixture.entityId);
    const workLogIds = ids("work_log_record");
    const executionIds = ids("timesheet_ai_execution");
    const draftIds = ids("daily_timesheet_draft");

    const workLogs = workLogIds.length
      ? await tx
          .select({
            id: workLogRecord.id,
            userId: workLogRecord.userId,
            reportDate: workLogRecord.recordDate,
          })
          .from(workLogRecord)
          .where(inArray(workLogRecord.id, workLogIds))
      : [];
    const executions = executionIds.length
      ? await tx
          .select({
            id: timesheetAiExecution.id,
            userId: timesheetAiExecution.userId,
            reportDate: timesheetAiExecution.reportDate,
          })
          .from(timesheetAiExecution)
          .where(inArray(timesheetAiExecution.id, executionIds))
      : [];
    const drafts = draftIds.length
      ? await tx
          .select({
            id: dailyTimesheetDraft.id,
            userId: dailyTimesheetDraft.userId,
            reportDate: dailyTimesheetDraft.reportDate,
          })
          .from(dailyTimesheetDraft)
          .where(inArray(dailyTimesheetDraft.id, draftIds))
      : [];
    if (
      [...workLogs, ...executions, ...drafts].some(
        (record) =>
          record.userId !== input.userId ||
          record.reportDate !== input.reportDate,
      )
    ) {
      throw new Error("TEST_FIXTURE_TIMESHEET_SCOPE_MISMATCH");
    }

    const existingDraftIds = drafts.map((draft) => draft.id);
    const tasks = existingDraftIds.length
      ? await tx
          .select({ id: timesheetTask.id })
          .from(timesheetTask)
          .where(inArray(timesheetTask.draftId, existingDraftIds))
      : [];
    const batches = existingDraftIds.length
      ? await tx
          .select({ id: timesheetSyncBatch.id })
          .from(timesheetSyncBatch)
          .where(inArray(timesheetSyncBatch.draftId, existingDraftIds))
      : [];
    const taskIds = tasks.map((task) => task.id);
    const batchIds = batches.map((batch) => batch.id);
    const syncItems =
      taskIds.length || batchIds.length
        ? await tx
            .delete(timesheetSyncItem)
            .where(
              or(
                taskIds.length
                  ? inArray(timesheetSyncItem.taskId, taskIds)
                  : sql`false`,
                batchIds.length
                  ? inArray(timesheetSyncItem.batchId, batchIds)
                  : sql`false`,
              ),
            )
            .returning({ id: timesheetSyncItem.id })
        : [];
    if (batchIds.length) {
      await tx
        .delete(timesheetSyncBatch)
        .where(inArray(timesheetSyncBatch.id, batchIds));
    }
    if (taskIds.length) {
      await tx.delete(timesheetTask).where(inArray(timesheetTask.id, taskIds));
    }
    if (executionIds.length) {
      await tx
        .delete(timesheetAiExecution)
        .where(inArray(timesheetAiExecution.id, executionIds));
    }
    if (existingDraftIds.length) {
      await tx
        .delete(dailyTimesheetDraft)
        .where(inArray(dailyTimesheetDraft.id, existingDraftIds));
    }
    if (workLogIds.length) {
      await tx
        .delete(workLogRecord)
        .where(inArray(workLogRecord.id, workLogIds));
    }
    const resourceIds = [...workLogIds, ...executionIds, ...draftIds];
    if (resourceIds.length) {
      await tx
        .delete(auditEvent)
        .where(inArray(auditEvent.entityId, resourceIds));
    }
    await tx
      .delete(testFixture)
      .where(inArray(testFixture.id, fixtures.map((fixture) => fixture.id)));

    return {
      workLogs: workLogs.length,
      executions: executions.length,
      drafts: drafts.length,
      tasks: tasks.length,
      syncBatches: batches.length,
      syncItems: syncItems.length,
    };
  });
}
