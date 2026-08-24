import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthorizedProjectRecord } from "@/lib/db/repositories/project-repository";
import type { ProjectAliasRecord } from "@/lib/db/schema";
import {
  getProjectTimeline,
  type StructuredTimelineRepository,
  type StructuredTimelineTask,
} from "@/lib/timeline";
import {
  confirmationRequiredAuditEvent,
  groupFactsByMatchedProject,
  matchConfirmationRequired,
  matchProjects,
  normalizeProjectName,
  parseDailyReportFile,
  resolveMatchOverrides,
  loadWeeklyReportSkill,
  WeeklyReportError,
} from "@/lib/weekly-report";
import { WEEKLY_REPORT_EVAL_CASES, evalCaseById } from "./cases/cases";
import { codexReferenceRun } from "./expected/codex-reference-runs";
import { evaluateWeeklyReportRun } from "./helpers/evaluator";

function project(id: string, name: string): AuthorizedProjectRecord {
  return {
    id,
    organizationId: "eval-org",
    departmentId: null,
    name,
    clientName: "Synthetic Client",
    description: "Synthetic weekly report eval project",
    isInternal: false,
    status: "active",
    stage: "planning",
    health: "healthy",
    startDate: null,
    targetLaunchDate: null,
    ragflowDatasetId: null,
    knowledgeStatus: "pending",
    knowledgeFailureCode: null,
    createdBy: "eval-user",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
    projectRole: "project_manager",
  };
}

function repository(projectId: string, tasks: StructuredTimelineTask[]): StructuredTimelineRepository {
  return {
    async findProjectTimeline(requestedProjectId) {
      return requestedProjectId === projectId ? { projectId, tasks } : null;
    },
  };
}

test("all formal Eval cases declare semantic truth sources and notes", () => {
  assert.equal(WEEKLY_REPORT_EVAL_CASES.length, 12);
  for (const evalCase of WEEKLY_REPORT_EVAL_CASES) {
    assert.ok(evalCase.inputFixtures.length > 0, `${evalCase.id} inputFixtures`);
    assert.ok(evalCase.requiredSections.length > 0, `${evalCase.id} requiredSections`);
    assert.ok(evalCase.evaluationNotes.length > 0, `${evalCase.id} evaluationNotes`);
    assert.ok(Array.isArray(evalCase.expectedFacts));
    assert.ok(Array.isArray(evalCase.forbiddenClaims));
    assert.ok(Array.isArray(evalCase.optionalClaims));
  }
});

test("v1.2 Cross-Agent fixtures retain facts while sharing the current Skill and instruction", async () => {
  const skill = await loadWeeklyReportSkill();
  const directories = [
    "case-01-normal",
    "case-02-plan-vs-actual",
    "case-03-next-step",
    "case-04-multi-project",
  ];
  const instruction = [
    "Read SKILL.md first.",
    "Then use only execution-package.json as the factual source.",
    "Follow all rules in SKILL.md.",
    "Do not use external project knowledge.",
    "Do not invent missing facts.",
    "Return only the final weekly report in Markdown.",
  ].join("\n") + "\n";
  const expectedProjectCounts = [1, 1, 1, 3];
  for (const [index, directory] of directories.entries()) {
    const root = new URL(`../weekly-report-cross-agent/${directory}/`, import.meta.url);
    const [copiedSkill, copiedInstruction, packageText] = await Promise.all([
      readFile(new URL("SKILL.md", root), "utf8"),
      readFile(new URL("RUN_INSTRUCTION.txt", root), "utf8"),
      readFile(new URL("execution-package.json", root), "utf8"),
    ]);
    const executionPackage = JSON.parse(packageText);
    assert.equal(copiedSkill, skill.content);
    assert.equal(copiedInstruction, instruction);
    assert.equal(executionPackage.skill.version, "1.2.0");
    assert.equal(executionPackage.skill.sha256, skill.sha256);
    assert.equal(executionPackage.skill.content, skill.content);
    assert.deepEqual(executionPackage.skill.files, skill.files);
    assert.equal(executionPackage.projects.length, expectedProjectCounts[index]);
    assert.ok(executionPackage.matches.every(
      (match: { status: string }) => match.status === "matched",
    ));
  }
});

for (const evalCase of WEEKLY_REPORT_EVAL_CASES) {
  test(`${evalCase.id} Codex reference output satisfies semantic Eval`, () => {
    const result = evaluateWeeklyReportRun(evalCase, codexReferenceRun(evalCase.id));
    assert.deepEqual(result.issues, [], JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, "PASS");
  });
}

test("semantic evaluator rejects PLAN written as ACTUAL without exact-output matching", () => {
  const evalCase = evalCaseById("WR-EVAL-02");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "持续修改技术方案，本周尚未完成",
    "技术方案已完成",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "FORBIDDEN_CLAIM"));
  assert.ok(result.issues.some((item) => item.code === "MISSING_EXPECTED_FACT"));
});

test("semantic evaluator rejects invented milestone dates", () => {
  const evalCase = evalCaseById("WR-EVAL-06");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replaceAll("2026-08-21", "2026-08-22");
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "UNSUPPORTED_DATE"));
});

test("semantic evaluator rejects generic assessment without evidence", () => {
  const evalCase = evalCaseById("WR-EVAL-10");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "| / | / | / | / |",
    "| / | / | / | 进展良好 |",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "GENERIC_ASSESSMENT"));
});

test("semantic evaluator rejects forbidden Project Knowledge capability requests", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.capabilityRequests.push("query_ragflow");
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "FORBIDDEN_CAPABILITY"));
});

test("semantic evaluator rejects final-output preamble and postamble", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = "我已读取执行包。\n" + run.markdown + "\n已完成。";
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "FINAL_ONLY_PREAMBLE"));
  assert.ok(result.issues.some((item) => item.code === "FINAL_ONLY_EXTRA_TEXT"));
});

test("semantic evaluator rejects code fences and duplicate reports", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const reference = codexReferenceRun(evalCase.id).markdown!;
  const fenced = structuredClone(codexReferenceRun(evalCase.id));
  fenced.markdown = "```md\n" + reference + "\n```";
  const fencedResult = evaluateWeeklyReportRun(evalCase, fenced);
  assert.equal(fencedResult.status, "FAIL");
  assert.ok(fencedResult.issues.some((item) => item.code === "FINAL_ONLY_CODE_FENCE"));

  const duplicate = structuredClone(codexReferenceRun(evalCase.id));
  duplicate.markdown = reference + "\n\n" + reference;
  const duplicateResult = evaluateWeeklyReportRun(evalCase, duplicate);
  assert.equal(duplicateResult.status, "FAIL");
  assert.ok(duplicateResult.issues.some((item) => item.code === "FINAL_ONLY_DUPLICATE"));
});

test("semantic evaluator rejects unsupported causal relation", () => {
  const evalCase = evalCaseById("WR-EVAL-05");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "等待客户反馈后继续修改；接口联调尚未完成。",
    "由于等待客户反馈，导致接口联调延期。",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "UNSUPPORTED_CAUSAL_RELATION"));
});

test("semantic evaluator rejects unsupported planned wording", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "| / | / | / | / |",
    "| - 按计划推进设计。 | / | / | / |",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "UNSUPPORTED_PLANNED_WORDING"));
});

test("semantic evaluator rejects strong certainty in bounded inference", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "| / | / | / | / |",
    "| - 下周完成设计。 | / | / | / |",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some((item) => item.code === "UNSUPPORTED_INFERENCE_CERTAINTY"));
  assert.ok(result.issues.some((item) => item.code === "INFERENCE_LANGUAGE_NOT_CAUTIONARY"));
});

test("semantic evaluator rejects unsupported Good/Bad interpretation", () => {
  const evalCase = evalCaseById("WR-EVAL-01");
  const run = structuredClone(codexReferenceRun(evalCase.id));
  run.markdown = run.markdown!.replace(
    "| / | / | / | / |",
    "| / | / | / | 好：项目进入执行准备阶段。 |",
  );
  const result = evaluateWeeklyReportRun(evalCase, run);
  assert.equal(result.status, "FAIL");
  assert.ok(result.issues.some(
    (item) => item.code === "UNSUPPORTED_ASSESSMENT_INTERPRETATION",
  ));
});

test("same Timeline recomputes historical, current, and future windows", async () => {
  const projectId = "window-project";
  const tasks: StructuredTimelineTask[] = [
    { id: "historical", stage: "Discovery", name: "Historical task", owners: [], startDate: "2026-08-03", endDate: "2026-08-07", status: "done" },
    { id: "current", stage: "Build", name: "Current task", owners: [], startDate: "2026-08-17", endDate: "2026-08-21", status: "incomplete" },
    { id: "next", stage: "Test", name: "Next task", owners: [], startDate: "2026-08-24", endDate: "2026-08-28", status: "incomplete" },
    { id: "future", stage: "Launch", name: "Future task", owners: [], startDate: "2026-09-07", endDate: "2026-09-11", status: "incomplete" },
    { id: "uat", stage: "Test", name: "UAT", owners: [], startDate: "2026-08-20", endDate: "2026-08-20", status: "incomplete" },
    { id: "launch", stage: "Launch", name: "Launch", owners: [], startDate: "2026-09-10", endDate: "2026-09-10", status: "incomplete" },
  ];
  const structuredRepository = repository(projectId, tasks);
  const load = (weekStart: string, weekEnd: string) => getProjectTimeline({
    projectId,
    authorizedProjectIds: new Set([projectId]),
    period: { weekStart, weekEnd },
    structuredRepository,
  });
  const [historical, current, future] = await Promise.all([
    load("2026-08-03", "2026-08-09"),
    load("2026-08-17", "2026-08-23"),
    load("2026-09-07", "2026-09-13"),
  ]);
  assert.deepEqual(historical.plannedThisWeek.map((task) => task.id), ["historical"]);
  assert.deepEqual(current.plannedThisWeek.map((task) => task.id), ["current", "uat"]);
  assert.deepEqual(current.plannedNextWeek.map((task) => task.id), ["next"]);
  assert.deepEqual(future.plannedThisWeek.map((task) => task.id), ["future", "launch"]);
  assert.deepEqual(current.currentMilestones.map((item) => item.date), ["2026-08-20"]);
  assert.deepEqual(future.currentMilestones.map((item) => item.date), ["2026-09-10"]);
  assert.equal(Object.hasOwn(tasks[0], "plannedThisWeek"), false, "derived fields are not persisted");
});

test("cross-week task overlaps Sunday/Monday and month boundary", async () => {
  const projectId = "month-boundary";
  const structuredRepository = repository(projectId, [{
    id: "cross-boundary",
    stage: "Integration",
    name: "Cross-boundary integration",
    owners: [],
    startDate: "2026-08-30",
    endDate: "2026-09-02",
    status: "incomplete",
  }]);
  const timeline = await getProjectTimeline({
    projectId,
    authorizedProjectIds: new Set([projectId]),
    period: { weekStart: "2026-08-24", weekEnd: "2026-08-30" },
    structuredRepository,
  });
  assert.deepEqual(timeline.plannedThisWeek.map((task) => task.id), ["cross-boundary"]);
  assert.deepEqual(timeline.plannedNextWeek.map((task) => task.id), ["cross-boundary"]);
});

test("all CHAGEE aliases deterministically match one authorized Project", () => {
  const official = project("chagee-vf", "CHAGEE Valley Fair Campaign");
  const aliases: ProjectAliasRecord[] = ["CHAGEE", "CHAGEE VF", "茶姬", "Valley Fair"].map(
    (alias, index) => ({
      id: `alias-${index + 1}`,
      projectId: official.id,
      alias,
      normalizedAlias: normalizeProjectName(alias),
      createdBy: "eval-user",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    }),
  );
  const matches = matchProjects({
    sourceProjectNames: aliases.map((alias) => alias.alias),
    authorizedProjects: [official],
    aliases,
  });
  assert.equal(matches.length, 4);
  assert.ok(matches.every((match) =>
    match.status === "matched" &&
    match.method === "alias_exact" &&
    match.projectId === official.id,
  ));
});

test("ambiguous Project stays needs_confirmation and Eval forbids final output", () => {
  const matches = matchProjects({
    sourceProjectNames: ["Project Alpha"],
    authorizedProjects: [
      project("project-alpha-cn", "Project Alpha East"),
      project("project-alpha-global", "Project Alpha West"),
    ],
  });
  assert.equal(matches[0].status, "needs_confirmation");
  assert.equal(matches[0].projectId, null);
  const result = evaluateWeeklyReportRun(
    evalCaseById("WR-EVAL-09"),
    codexReferenceRun("WR-EVAL-09"),
  );
  assert.equal(result.status, "PASS");
});

test("WR-EVAL-09 confirmation payload contains only unresolved Match data", () => {
  const matches = matchProjects({
    sourceProjectNames: ["Project Alpha"],
    authorizedProjects: [
      project("project-alpha-cn", "Project Alpha East"),
      project("project-alpha-global", "Project Alpha West"),
    ],
  });
  const result = matchConfirmationRequired(matches);
  assert.equal(result?.status, "needs_confirmation");
  assert.equal(result?.confirmationRequired, true);
  assert.equal(result?.unresolvedMatches.length, 1);
  assert.equal(result?.unresolvedMatches[0].sourceProjectName, "Project Alpha");
  assert.equal(result?.unresolvedMatches[0].candidates.length, 2);
  assert.doesNotMatch(
    JSON.stringify(result),
    /executionPackage|output|projects|timeline|knowledge|evidence/iu,
  );
});

test("WR-EVAL-09 confirmation Audit is non-final and not succeeded", () => {
  const matches = matchProjects({
    sourceProjectNames: ["Project Alpha"],
    authorizedProjects: [
      project("project-alpha-cn", "Project Alpha East"),
      project("project-alpha-global", "Project Alpha West"),
    ],
  });
  const confirmation = matchConfirmationRequired(matches);
  assert.ok(confirmation);
  const audit = confirmationRequiredAuditEvent({
    actorUserId: "eval-user",
    filename: "ambiguous.csv",
    sourceSizeBytes: 128,
    parsedFactCount: 1,
    unresolvedMatches: confirmation.unresolvedMatches,
  });
  assert.equal(audit.eventType, "weekly_report_match_confirmation_required");
  assert.equal(audit.result, "denied");
  assert.notEqual(audit.result as string, "succeeded");
  assert.equal(audit.metadata.unresolvedMatchCount, 1);
  assert.equal(audit.metadata.candidateCount, 2);
  assert.doesNotMatch(JSON.stringify(audit.metadata), /Project Alpha|ambiguous\.csv/u);
});

test("WR-EVAL-09 gate runs before Alias, Context, Timeline, Knowledge, and final Audit", async () => {
  const source = await readFile(
    new URL("../../lib/weekly-report/service.ts", import.meta.url),
    "utf8",
  );
  const matchIndex = source.indexOf("const matches = matchProjects");
  const gateIndex = source.indexOf("matchConfirmationRequired(matches)", matchIndex);
  const confirmationAuditIndex = source.indexOf(
    "writeAuditEvent(confirmationRequiredAuditEvent",
    gateIndex,
  );
  const returnIndex = source.indexOf("return confirmation", confirmationAuditIndex);
  const aliasIndex = source.indexOf("await saveConfirmedAliases", returnIndex);
  const groupingIndex = source.indexOf("const projectIdBySource", returnIndex);
  const contextIndex = source.indexOf("buildProjectWeeklyReportContext", groupingIndex);
  const finalAuditIndex = source.indexOf('eventType: "weekly_report_context_built"', groupingIndex);
  assert.ok(matchIndex >= 0);
  assert.ok(matchIndex < gateIndex);
  assert.ok(gateIndex < confirmationAuditIndex);
  assert.ok(confirmationAuditIndex < returnIndex);
  assert.ok(returnIndex < aliasIndex);
  assert.ok(returnIndex < groupingIndex);
  assert.ok(returnIndex < contextIndex);
  assert.ok(returnIndex < finalAuditIndex);
});

test("WR-EVAL-09 HTTP contract discriminates confirmation from finalized output", async () => {
  const source = await readFile(
    new URL("../../app/api/skills/project-weekly-report/context/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /return jsonResponse\(result/u);
  assert.match(source, /result\.status === "finalized" \? 201 : 200/u);
  assert.doesNotMatch(source, /executionPackage:\s*result/u);
});

test("WR-EVAL-09 explicit authorized confirmation resolves and permits finalization", () => {
  const projects = [
    project("project-alpha-cn", "Project Alpha East"),
    project("project-alpha-global", "Project Alpha West"),
  ];
  const overrides = resolveMatchOverrides({
    overrides: [{
      sourceProjectName: "Project Alpha",
      projectId: "project-alpha-cn",
      saveAlias: false,
    }],
    projectsById: new Map(projects.map((item) => [item.id, item])),
    sourceNames: new Set([normalizeProjectName("Project Alpha")]),
  });
  const matches = matchProjects({
    sourceProjectNames: ["Project Alpha"],
    authorizedProjects: projects,
    overrides,
  });
  assert.equal(matches[0].status, "matched");
  assert.equal(matches[0].method, "override");
  assert.equal(matches[0].projectId, "project-alpha-cn");
  assert.equal(matchConfirmationRequired(matches), null);
});

test("WR-EVAL-09 unauthorized Project override keeps 404 anti-enumeration semantics", () => {
  const authorized = project("project-a", "Project A");
  assert.throws(
    () => resolveMatchOverrides({
      overrides: [{
        sourceProjectName: "Project Alpha",
        projectId: "project-b",
        saveAlias: false,
      }],
      projectsById: new Map([[authorized.id, authorized]]),
      sourceNames: new Set([normalizeProjectName("Project Alpha")]),
    }),
    (error) =>
      error instanceof WeeklyReportError &&
      error.status === 404 &&
      error.code === "PROJECT_NOT_FOUND",
  );
});

test("multi-project CSV parses, matches, and groups canaries without crossing Projects", async () => {
  const csv = [
    "Project,Task,Date",
    "Project A,完成 A_ONLY 需求确认,2026-08-18",
    "Project B,完成 B_ONLY 接口联调,2026-08-19",
    "Project C,完成 C_ONLY UAT 准备,2026-08-20",
  ].join("\n");
  const parsed = await parseDailyReportFile({
    file: new File([csv], "multi-project.csv", { type: "text/csv" }),
    weekStart: "2026-08-17",
    weekEnd: "2026-08-21",
  });
  const projects = [
    project("project-a", "Project A"),
    project("project-b", "Project B"),
    project("project-c", "Project C"),
  ];
  const matches = matchProjects({
    sourceProjectNames: parsed.facts.flatMap((fact) => fact.projectName ? [fact.projectName] : []),
    authorizedProjects: projects,
  });
  const grouped = groupFactsByMatchedProject({
    facts: parsed.facts,
    projectIdBySource: new Map(matches.flatMap((match) =>
      match.status === "matched" && match.projectId
        ? [[normalizeProjectName(match.sourceProjectName), match.projectId] as const]
        : [],
    )),
  });
  assert.match(grouped.byProject.get("project-a")?.[0].task ?? "", /A_ONLY/u);
  assert.match(grouped.byProject.get("project-b")?.[0].task ?? "", /B_ONLY/u);
  assert.match(grouped.byProject.get("project-c")?.[0].task ?? "", /C_ONLY/u);
  assert.equal(grouped.unmatched.length, 0);
});
