import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");
test("AI Action and Risk generation only insert drafts", async () => {
  const code = await source("lib/project-management/work-management.ts");
  const action = code.slice(
    code.indexOf("export async function generateActionDrafts"),
    code.indexOf("export async function createManualAction"),
  );
  const risk = code.slice(
    code.indexOf("export async function generateRiskDrafts"),
    code.indexOf("export async function createManualRisk"),
  );
  assert.match(action, /insert\(actionItemDraft\)/);
  assert.doesNotMatch(action, /insert\(actionItem\)\./);
  assert.match(risk, /insert\(riskDraft\)/);
  assert.doesNotMatch(risk, /insert\(risk\)\./);
});
test("weekly publishing is immutable and project-bound", async () => {
  const schema = await source("lib/db/schema/work-management.ts");
  const service = await source("lib/project-management/work-management.ts");
  assert.match(schema, /weekly_report_versions_draft_uidx/);
  assert.match(
    service,
    /eq\(weeklyReportVersion\.projectId, input\.projectId\)/,
  );
  assert.doesNotMatch(
    service.slice(
      service.indexOf("export async function publishWeeklyReport"),
      service.indexOf("export async function exportWeeklyReport"),
    ),
    /update\(weeklyReportVersion\)/,
  );
});
test("bulk Action and export paths enforce server authorization", async () => {
  const service = await source("lib/project-management/work-management.ts");
  assert.match(service, /bulkUpdateActionStatus/);
  assert.match(service, /ACTION_NOT_ASSIGNED/);
  assert.match(service, /exportWeeklyReport[\s\S]*requireProjectAccess/);
});
test("dependency graph rejects self and recursive cycles", async () => {
  const schema = await source("lib/db/schema/work-management.ts");
  const service = await source("lib/project-management/work-management.ts");
  assert.match(schema, /action_item_dependencies_no_self_check/);
  assert.match(service, /with recursive path/);
  assert.match(service, /DEPENDENCY_CYCLE/);
});
