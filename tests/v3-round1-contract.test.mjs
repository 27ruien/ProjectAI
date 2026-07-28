import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Round 1 navigation restores projects and authorized global search", async () => {
  const [sidebar, workspace, search] = await Promise.all([
    read("components/layout/sidebar.tsx"),
    read("components/workspace.tsx"),
    read("components/search/global-search-page.tsx"),
  ]);
  assert.match(sidebar, /label: "项目", href: "\/projects"/);
  assert.match(sidebar, /label: "全局搜索", href: "\/search"/);
  assert.doesNotMatch(sidebar, /href: "\/(?:skills|reviews)"/);
  assert.match(workspace, /section === "search"/);
  assert.match(workspace, /<GlobalSearchPage viewer=\{viewer\}/);
  assert.match(search, /viewer\.projects/);
  assert.match(search, /只搜索服务端已授权/);
});

test("Round 1 daily-report generation is a durable leased job", async () => {
  const [schema, jobs, service, enqueueRoute, ui, worker] = await Promise.all([
    read("lib/db/schema/timesheets.ts"),
    read("lib/timesheets/ai-jobs.ts"),
    read("lib/timesheets/service.ts"),
    read("app/api/timesheets/drafts/generate/route.ts"),
    read("components/timesheet/daily-report-page.tsx"),
    read("scripts/timesheet-ai-worker.ts"),
  ]);
  for (const field of [
    "requestId",
    "leaseToken",
    "leaseExpiresAt",
    "heartbeatAt",
    "providerDispatchedAt",
    "queueDurationMs",
    "retrievalDurationMs",
    "providerDurationMs",
    "parseDurationMs",
    "persistenceDurationMs",
  ]) assert.match(schema, new RegExp(`${field}:`));
  assert.match(schema, /timesheet_ai_executions_active_owner_date_uidx/);
  assert.match(jobs, /for update skip locked/);
  assert.match(jobs, /TIMESHEET_PROVIDER_RESULT_UNKNOWN/);
  assert.match(jobs, /eq\(timesheetAiExecution\.userId, input\.principal\.user\.id\)/);
  assert.match(service, /sourceSelectionDigest/);
  assert.match(service, /providerDispatchedAt/);
  assert.match(service, /db\.transaction/);
  assert.match(enqueueRoute, /status: result\.created \? 202 : 200/);
  assert.match(ui, /\/api\/timesheets\/ai-jobs/);
  assert.match(ui, /cancelled|queued/);
  assert.match(ui, /requestId/);
  assert.match(worker, /runTimesheetAiWorker/);
});

test("Round 1 fixture registry keeps synthetic UAT records out of product lists", async () => {
  const [
    fixtureSchema,
    fixtureService,
    projects,
    knowledge,
    knowledgeManagement,
    departmentRoute,
    organizationService,
    stagingUat,
    authorization,
    migration,
    productSeed,
    timesheetFixtureRoute,
  ] = await Promise.all([
    read("lib/db/schema/test-fixtures.ts"),
    read("lib/test-fixtures/service.ts"),
    read("lib/db/repositories/project-repository.ts"),
    read("lib/knowledge/product-v2.ts"),
    read("lib/knowledge/management.ts"),
    read("app/api/organization/departments/route.ts"),
    read("lib/organization/service.ts"),
    read("tests/product-v2-staging-e2e/product-v2.spec.ts"),
    read("lib/knowledge/authorization.ts"),
    read("drizzle/0025_marvelous_stephen_strange.sql"),
    read("scripts/db/seed-product-v2.ts"),
    read("app/api/test-fixtures/timesheets/route.ts"),
  ]);
  assert.match(fixtureSchema, /uniqueIndex\("test_fixtures_entity_uidx"\)/);
  assert.match(fixtureSchema, /expiresAt/);
  assert.match(fixtureService, /if \(value === "production"\) return null/);
  assert.match(fixtureService, /PROJECTAI_INCLUDE_TEST_FIXTURES === "true"/);
  assert.match(fixtureService, /MAX_FIXTURE_LIFETIME_MS/);
  assert.match(projects, /notExists/);
  assert.match(projects, /eq\(testFixture\.entityType, "project"\)/);
  assert.match(knowledge, /includeTestFixturesInProductQueries/);
  assert.match(knowledge, /notExists/);
  assert.match(knowledge, /eq\(testFixture\.entityType, "knowledge_space"\)/);
  assert.match(knowledgeManagement, /options: \{ activeOnly\?: boolean \}/);
  assert.match(knowledgeManagement, /eq\(testFixture\.entityType, "department"\)/);
  assert.match(departmentRoute, /fixtureContextFromHeaders\(request\.headers\)/);
  assert.match(departmentRoute, /deleteRegisteredFixtureDepartment/);
  assert.match(organizationService, /entityType: "department"/);
  assert.match(organizationService, /entityType: "knowledge_space"/);
  assert.match(stagingUat, /x-projectai-fixture-run-id/);
  assert.match(stagingUat, /x-projectai-fixture-expires-at/);
  assert.match(authorization, /filterFixtureDocumentScopes/);
  assert.match(authorization, /knowledge_space:\$\{scope\.knowledgeSpaceId\}/);
  assert.match(migration, /uat-legacy-import-0025/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "test_fixtures"/);
  assert.doesNotMatch(migration, /slug like '%uat%'/);
  assert.match(fixtureService, /deleteRegisteredFixtureProject/);
  assert.match(fixtureService, /deleteRegisteredFixtureTimesheetRun/);
  assert.match(fixtureService, /TEST_FIXTURE_TIMESHEET_SCOPE_MISMATCH/);
  assert.match(fixtureService, /to_regclass\('public\.workflow_runs'\)/);
  assert.ok(
    fixtureService.indexOf("delete from workflow_runs") <
      fixtureService.indexOf("delete from requirement_extraction_runs"),
    "ahead-schema fixture rows must be deleted before their restricted legacy run",
  );
  assert.doesNotMatch(fixtureService, /@\/lib\/db\/schema\/workflows/);
  assert.match(timesheetFixtureRoute, /timesheetDateSchema/);
  assert.match(timesheetFixtureRoute, /deleteRegisteredFixtureTimesheetRun/);
  assert.doesNotMatch(productSeed, /kivisense-project-product-management-uat/);
  assert.match(productSeed, /kivisense-project-projectai-product/);
});

test("Round 1 knowledge requests isolate stale responses and visible errors", async () => {
  const [page, sourcesPanel, client] = await Promise.all([
    read("components/system/global-knowledge-page.tsx"),
    read("components/knowledge/ProjectKnowledgeSourcesPanel.tsx"),
    read("lib/documents/client.ts"),
  ]);
  assert.match(page, /projectRequest\.current\?\.abort\(\)/);
  assert.match(page, /isAbortError/);
  assert.match(page, /documentErrors/);
  assert.match(page, /selectedProjectError \?/);
  assert.match(page, /文件列表加载失败/);
  assert.match(page, />重试<\/button>/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(sourcesPanel, /loadRequest\.current\?\.abort\(\)/);
  assert.match(sourcesPanel, /signal: controller\.signal/);
  assert.match(sourcesPanel, /if \(controller\.signal\.aborted\) return/);
  assert.match(sourcesPanel, /if \(isAbortError\(caught\)\) return/);
  assert.match(client, /HTTP_\$\{response\.status\}/);
  assert.match(client, /error\.name === "AbortError"/);
});

test("Round 1 daily-report terminal Toast is actionable and consumed once", async () => {
  const [toast, page, terminalToast] = await Promise.all([
    read("components/common/toast.tsx"),
    read("components/timesheet/daily-report-page.tsx"),
    read("lib/timesheets/terminal-toast.ts"),
  ]);
  assert.match(toast, /type ToastTone = "success" \| "info" \| "error"/);
  assert.match(toast, /item\.action\.label/);
  assert.match(page, /label: "查看并确认"/);
  assert.match(page, /label: "重试"/);
  assert.match(page, /hasConsumedTerminalToast/);
  assert.match(page, /consumeTerminalToast/);
  assert.match(terminalToast, /脱敏 requestId/);
  assert.match(terminalToast, /pendingCount/);
});

test("Round 1 Staging fixture maintenance is inventory-first and Production-forbidden", async () => {
  const lifecycle = await read("scripts/staging-fixture-lifecycle.ts");
  assert.match(lifecycle, /STAGING_FIXTURE_PRODUCTION_FORBIDDEN/);
  assert.match(lifecycle, /ALLOW_STAGING_FIXTURE_CLEANUP_REQUIRED/);
  assert.match(lifecycle, /LEGACY_ORGANIZATION_ID = "uat-org-projectai-v1"/);
  assert.match(lifecycle, /deleteRegisteredFixtureProject/);
  assert.match(lifecycle, /deleteRegisteredFixtureDepartment/);
  assert.match(lifecycle, /deleteRegisteredFixtureTimesheetRun/);
  assert.match(lifecycle, /fixtureTimesheets/);
  assert.match(lifecycle, /const before = await inventory\(\)/);
  assert.match(lifecycle, /const after = await inventory\(\)/);
});
