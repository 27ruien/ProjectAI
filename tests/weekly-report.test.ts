import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthorizedProjectRecord } from "@/lib/db/repositories/project-repository";
import type { ProjectAliasRecord } from "@/lib/db/schema";
import type { RagflowClient } from "@/lib/ragflow";
import {
  getProjectTimeline,
  ProjectTimelineAccessError,
  type StructuredTimelineRepository,
  type StructuredTimelineTask,
} from "@/lib/timeline";
import {
  buildProjectWeeklyReportContext,
  groupFactsByMatchedProject,
  loadWeeklyReportSkill,
  matchProjects,
  normalizeProjectName,
  parseDailyReportFile,
  parseDailyReportSheets,
  projectStatusLabel,
  validateWeeklyReportMarkdown,
} from "@/lib/weekly-report";

function project(input: Partial<AuthorizedProjectRecord> & { id: string; name: string }): AuthorizedProjectRecord {
  const { id, name, ...overrides } = input;
  return {
    id,
    organizationId: "org-1",
    departmentId: null,
    name,
    clientName: input.clientName ?? "Client",
    description: "",
    isInternal: false,
    status: input.status ?? "active",
    stage: input.stage ?? "planning",
    health: input.health ?? "healthy",
    startDate: null,
    targetLaunchDate: null,
    ragflowDatasetId: null,
    knowledgeStatus: "pending",
    knowledgeFailureCode: null,
    createdBy: "user-1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-20T00:00:00Z"),
    projectRole: "project_manager",
    ...overrides,
  };
}

const REPORTING_PERIOD = {
  weekStart: "2026-08-17",
  weekEnd: "2026-08-21",
} as const;

function timelineRepository(
  projectId: string,
  tasks: StructuredTimelineTask[],
): StructuredTimelineRepository {
  return {
    async findProjectTimeline(requestedProjectId) {
      return requestedProjectId === projectId ? { projectId, tasks } : null;
    },
  };
}

test("daily report parser accepts aliases, carries project cells, and filters dates", () => {
  const parsed = parseDailyReportSheets({
    filename: "daily.csv",
    weekStart: "2026-08-17",
    weekEnd: "2026-08-21",
    sheets: [{
      sheet: "日报",
      data: [
        ["所属项目", "任务描述", "开始预计时间", "状态", "任务进度"],
        ["GP", "需求梳理", "2026-08-17", "完成", "100%"],
        [null, "客户需求确认", "8/18", "完成", "100%"],
        ["GP", "旧工作", "2026-08-10", "完成", "100%"],
      ],
    }],
  });
  assert.equal(parsed.facts.length, 2);
  assert.equal(parsed.facts[1].projectName, "GP");
  assert.equal(parsed.facts[1].date, "2026-08-18");
  assert.equal(parsed.skippedOutsideWeek, 1);
});

test("CSV parser preserves quoted content", async () => {
  const csv = [
    "Project Name,Description,Date",
    'GP,"确认需求, 更新线框",2026-08-18',
  ].join("\n");
  const parsed = await parseDailyReportFile({
    file: new File([csv], "daily.csv", { type: "text/csv" }),
    weekStart: "2026-08-17",
    weekEnd: "2026-08-21",
  });
  assert.equal(parsed.facts[0].task, "确认需求, 更新线框");
});

test("XLSX parser reads a real workbook", async () => {
  const base64 = "UEsDBBQAAAAIAEqNFV29XP2Q8gAAABwCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2RvU7DMBDHX8XyWsVOOyCEknQodASG8gCHc0ms+Es+t4S3x0kLAyqwMJ3s/8fvZFfbyRp2wkjau5qvRckZOuVb7fqavxz2xS3fNtXhPSCxbHVU8yGlcCclqQEtkPABXVY6Hy2kfIy9DKBG6FFuyvJGKu8SulSkuYM31T12cDSJPUz5+oyNaIiz3dk4s2oOIRitIGVdnlz7jVJcCCInFw8NOtAqG7i8SpiVnwGX3FN+h6hbZM8Q0yPY7JKTkW8+jq/ej+L3kitb+q7TCluvjjZHBIWI0NKAmKwRyxQWtFv9zV/MJJex/udFvvo/95DLdzcfUEsDBBQAAAAIAEqNFV0cSfe+pAAAABYBAAALAAAAX3JlbHMvLnJlbHONz8EOwiAMBuBXIb07pgdjzNguxmRXMx8AWcfIBiWAOt9ejs548Nj0/7+mVbPYmT0wRENOwLYogaFT1BunBVy78+YATV1dcJYpJ+JofGS54qKAMSV/5DyqEa2MBXl0eTNQsDLlMWjupZqkRr4ryz0PnwasTdb2AkLbb4F1L4//2DQMRuGJ1N2iSz9OfCWyLIPGJGCZ+ZPCdCOaiowCryu+erB+A1BLAwQUAAAACABKjRVdzsXKZbcAAAAKAQAADwAAAHhsL3dvcmtib29rLnhtbI2Pyw3CMAyGV4l8h7QcEKr6uCCk3mGA0Lpt1Cau7PCYgQWYgNWYg4jHnZPt3/Zn/3l1dZM6I4slX0C6TEChb6i1vi/gsN8tNlCV+YV4PBKNKk57KWAIYc60lmZAZ2RJM/rY6YidCbHkXsvMaFoZEIOb9CpJ1toZ6+FDyPgfBnWdbXBLzcmhDx8I42RC/FUGOwuU+fuCfKPyxmEBz/vjeXuAemt1G22B4szGhOs2BV3m+remf87KF1BLAwQUAAAACABKjRVd8KZigaYAAAAXAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc9LCsIwEADQq4TZ22ldiEjTbkToVuoBQjpNSpsPSfzd3uBCLLhwNczvDVO3D7OwG4U4OcuhKkpgZKUbJqs4XPrTZg9tU59pESlPRD35yPKKjRx0Sv6AGKUmI2LhPNncGV0wIuU0KPRCzkIRbstyh+HbgLXJuoFD6IYKWP/09I/txnGSdHTyasimHyfw7sIcNVHKqAiKEodPKeI7VEVWAZsaVx82L1BLAwQUAAAACABKjRVdac6wVg8BAAD8AQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbHWRv07DMBCHXyXynl6SoYqQ44o/ghUJeAArNY1FYke2RRkrJmDpyEAFCoI1olOFOvAyJG3fArdCEUjJ5vv5Pt8nHx7cZKlzzZTmUkTI73nIYSKWQy5GEbo4P3ZDNCB4LNWVThgzjm0XOkKJMfkegI4TllHdkzkT9uZSqowaW6oR6FwxOtxBWQqB5/Uho1wggnfZETWUYCXHjrJjbRpvD/s+ckyEuEi5YGdG2Zxrgg2p7yfV/HlTfK6eSgyGYNjmEP9yB13c93JZPRT1dLr++mjhDjvnPb7Xs5f/BFjbRjlolIOOJ05O20S7uqvytb5bbGaTen67Ksp1+dam20UHXtB3vdD1wzZl+PPj0KyS/ABQSwECFAMUAAAACABKjRVdvVz9kPIAAAAcAgAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAEqNFV0cSfe+pAAAABYBAAALAAAAAAAAAAAAAACAASMBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAEqNFV3OxcpltwAAAAoBAAAPAAAAAAAAAAAAAACAAfABAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACABKjRVd8KZigaYAAAAXAQAAGgAAAAAAAAAAAAAAgAHUAgAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAMUAAAACABKjRVdac6wVg8BAAD8AQAAGAAAAAAAAAAAAAAAgAGyAwAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAAFAAUARQEAAPcEAAAAAA==";
  const parsed = await parseDailyReportFile({
    file: new File([Buffer.from(base64, "base64")], "daily.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    weekStart: "2026-08-17",
    weekEnd: "2026-08-21",
  });
  assert.equal(parsed.facts.length, 1);
  assert.equal(parsed.facts[0].projectName, "GP");
  assert.equal(parsed.facts[0].task, "客户需求确认");
});

test("matcher uses exact alias without a model", () => {
  const official = project({ id: "PRJ_000123", name: "CHAGEE Valley Fair Campaign" });
  const alias: ProjectAliasRecord = {
    id: "alias-1",
    projectId: official.id,
    alias: "CHAGEE VF",
    normalizedAlias: normalizeProjectName("CHAGEE VF"),
    createdBy: "user-1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
  };
  const [match] = matchProjects({
    sourceProjectNames: ["CHAGEE VF"],
    authorizedProjects: [official],
    aliases: [alias],
  });
  assert.equal(match.status, "matched");
  assert.equal(match.method, "alias_exact");
  assert.equal(match.projectId, "PRJ_000123");
});

test("fuzzy matcher ranks GP Catalog above similar GP projects", () => {
  const projects = [
    project({ id: "catalog", name: "GP Catalog 小程序" }),
    project({ id: "crm", name: "GP & UN CRM" }),
    project({ id: "ciie", name: "GP CIIE" }),
  ];
  const [match] = matchProjects({
    sourceProjectNames: ["GP catalog"],
    authorizedProjects: projects,
    recentProjectIds: new Set(["catalog"]),
  });
  assert.equal(match.candidates[0].projectId, "catalog");
  assert.equal(match.status, "matched");
});

test("ambiguous fuzzy names require confirmation", () => {
  const [match] = matchProjects({
    sourceProjectNames: ["GP"],
    authorizedProjects: [
      project({ id: "crm", name: "GP CRM" }),
      project({ id: "ciie", name: "GP CIIE" }),
    ],
  });
  assert.notEqual(match.status, "matched");
  assert.equal(match.projectId, null);
});

test("multiple daily rows group into one Project and unmatched work continues", () => {
  const fact = (projectName: string | null, task: string, sourceRow: number) => ({
    sourceRow,
    sourceSheet: "日报",
    projectName,
    task,
    date: "2026-08-18",
    status: null,
    progress: null,
    owner: null,
  });
  const grouped = groupFactsByMatchedProject({
    facts: [
      fact("GP", "需求梳理", 2),
      fact("GP", "客户需求确认", 3),
      fact("临时售前咨询", "沟通初步需求", 4),
    ],
    projectIdBySource: new Map([[normalizeProjectName("GP"), "project-gp"]]),
  });
  assert.equal(grouped.byProject.size, 1);
  assert.equal(grouped.byProject.get("project-gp")?.length, 2);
  assert.equal(grouped.unmatched.length, 1);
});

test("project status labels preserve paused and launched states", () => {
  assert.equal(projectStatusLabel(project({ id: "p1", name: "P1", status: "paused" })), "暂停");
  assert.equal(projectStatusLabel(project({ id: "p2", name: "P2", stage: "operation" })), "已上线");
});

test("context builder keeps exact Timeline dates and rejects foreign evidence", async () => {
  const readyProject = project({
    id: "timeline-project",
    name: "GP Catalog 小程序",
    ragflowDatasetId: "dataset-1",
    knowledgeStatus: "ready",
  });
  const client = {
    retrieve: async ({ question }: { question: string }) => ({
      total: 2,
      latencyMs: 1,
      evidence: question.includes("Timeline")
        ? [
            {
              id: "timeline-chunk",
              datasetId: "dataset-1",
              documentId: "timeline-doc",
              documentName: "remote-name",
              content: "UAT 9/14\n上线 9/20",
              similarity: 0.95,
            },
            {
              id: "foreign-chunk",
              datasetId: "foreign-dataset",
              documentId: "timeline-doc",
              documentName: "foreign",
              content: "UAT 9/99",
              similarity: 1,
            },
          ]
        : [],
    }),
  } as unknown as RagflowClient;
  const context = await buildProjectWeeklyReportContext({
    project: readyProject,
    authorizedProjectIds: new Set([readyProject.id]),
    facts: [{
      sourceRow: 2,
      sourceSheet: "日报",
      projectName: "GP catalog",
      task: "完成需求确认",
      date: "2026-08-21",
      status: "完成",
      progress: "100%",
      owner: null,
    }],
    ...REPORTING_PERIOD,
    documents: [{
      projectId: readyProject.id,
      ragflowDocumentId: "timeline-doc",
      displayName: "Project Timeline.xlsx",
      contextKind: "timeline",
    }],
    client,
  });
  assert.equal(context.timeline.source, "document_fallback");
  assert.equal(context.timelineEvidence.length, 1);
  assert.equal(context.timelineEvidence[0].excerpt, "UAT 9/14\n上线 9/20");
  assert.doesNotMatch(JSON.stringify(context), /9\/99/u);
});

test("missing Timeline degrades without inventing milestones", async () => {
  const readyProject = project({
    id: "no-timeline",
    name: "Paused Project",
    status: "paused",
    ragflowDatasetId: "dataset-2",
    knowledgeStatus: "ready",
  });
  const context = await buildProjectWeeklyReportContext({
    project: readyProject,
    authorizedProjectIds: new Set([readyProject.id]),
    facts: [],
    documents: [],
    ...REPORTING_PERIOD,
    client: { retrieve: async () => ({ evidence: [], total: 0, latencyMs: 1 }) } as unknown as RagflowClient,
  });
  assert.equal(context.project.statusLabel, "暂停");
  assert.equal(context.timeline.source, "none");
  assert.deepEqual(context.timeline.milestones, []);
  assert.deepEqual(context.timelineEvidence, []);
  assert.match(context.contextWarnings.join(" "), /里程碑必须输出 \//u);
});

test("structured Timeline wins and skips Timeline document retrieval", async () => {
  const readyProject = project({
    id: "structured-project",
    name: "Structured Project",
    ragflowDatasetId: "dataset-structured",
    knowledgeStatus: "ready",
    status: "active",
    stage: "planning",
  });
  let timelineRetrievals = 0;
  const client = {
    retrieve: async ({ question }: { question: string }) => {
      if (question.includes("Timeline")) timelineRetrievals += 1;
      return { evidence: [], total: 0, latencyMs: 1 };
    },
  } as unknown as RagflowClient;
  const context = await buildProjectWeeklyReportContext({
    project: readyProject,
    authorizedProjectIds: new Set([readyProject.id]),
    facts: [],
    documents: [{
      projectId: readyProject.id,
      ragflowDocumentId: "legacy-timeline-doc",
      displayName: "Legacy Timeline.xlsx",
      contextKind: "timeline",
    }],
    ...REPORTING_PERIOD,
    client,
    structuredTimelineRepository: timelineRepository(readyProject.id, [{
      id: "task-design",
      stage: "Design",
      name: "UI Design",
      owners: ["Kivisense"],
      startDate: "2026-08-17",
      endDate: "2026-08-21",
      status: "in_progress",
    }]),
  });
  assert.equal(context.timeline.source, "structured");
  assert.equal(context.timeline.currentPhase, "Design");
  assert.equal(context.project.status, "active");
  assert.equal(context.project.stage, "planning");
  assert.deepEqual(context.timelineEvidence, []);
  assert.equal(timelineRetrievals, 0);
});

test("cross-week Timeline tasks appear in this week and next week", async () => {
  const timeline = await getProjectTimeline({
    projectId: "cross-week",
    authorizedProjectIds: new Set(["cross-week"]),
    period: REPORTING_PERIOD,
    structuredRepository: timelineRepository("cross-week", [{
      id: "development",
      stage: "Development",
      name: "Development",
      owners: ["Kivisense"],
      startDate: "2026-08-18",
      endDate: "2026-08-28",
      status: "in_progress",
    }]),
  });
  assert.deepEqual(timeline.plannedThisWeek.map((task) => task.id), ["development"]);
  assert.deepEqual(timeline.plannedNextWeek.map((task) => task.id), ["development"]);
  assert.equal(timeline.tasks.length, 1);
});

test("Timeline context bounds far future ordinary tasks", async () => {
  const timeline = await getProjectTimeline({
    projectId: "bounded",
    authorizedProjectIds: new Set(["bounded"]),
    period: REPORTING_PERIOD,
    structuredRepository: timelineRepository("bounded", [
      {
        id: "this-week",
        stage: "Design",
        name: "UI Design",
        owners: ["Kivisense"],
        startDate: "2026-08-17",
        endDate: "2026-08-21",
        status: "in_progress",
      },
      {
        id: "far-future",
        stage: "Operations",
        name: "Ordinary maintenance task",
        owners: ["Kivisense"],
        startDate: "2027-01-04",
        endDate: "2027-01-08",
        status: "todo",
      },
    ]),
  });
  assert.deepEqual(timeline.tasks.map((task) => task.id), ["this-week"]);
  assert.doesNotMatch(JSON.stringify(timeline), /Ordinary maintenance task/u);
});

test("Timeline milestone classification preserves the exact source date", async () => {
  const timeline = await getProjectTimeline({
    projectId: "milestone",
    authorizedProjectIds: new Set(["milestone"]),
    period: REPORTING_PERIOD,
    structuredRepository: timelineRepository("milestone", [{
      id: "uat",
      stage: "UAT",
      name: "UAT",
      owners: ["Brands"],
      startDate: "2026-09-14",
      endDate: "2026-09-14",
      status: "incomplete",
    }]),
  });
  assert.deepEqual(timeline.milestones, [{
    name: "UAT",
    date: "2026-09-14",
    stage: "UAT",
    status: "incomplete",
    basis: "name_rule",
  }]);
  assert.equal(timeline.futureMilestones[0].date, "2026-09-14");
});

test("Timeline service rejects Projects outside the authorized set before reading", async () => {
  let repositoryReads = 0;
  await assert.rejects(
    getProjectTimeline({
      projectId: "forbidden-project",
      authorizedProjectIds: new Set(["authorized-project"]),
      period: REPORTING_PERIOD,
      structuredRepository: {
        async findProjectTimeline() {
          repositoryReads += 1;
          return null;
        },
      },
    }),
    ProjectTimelineAccessError,
  );
  assert.equal(repositoryReads, 0);
});

test("Skill is versioned and carries Timeline and inference guardrails", async () => {
  const skill = await loadWeeklyReportSkill();
  assert.equal(skill.id, "project-weekly-report");
  assert.equal(skill.version, "1.2.0");
  assert.match(skill.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(skill.files["references/schema.md"]);
  assert.ok(skill.files["references/examples.md"]);
  assert.match(skill.content, /timeline\.milestones.*primary source of milestone dates/u);
  assert.match(skill.content, /timeline\.documentEvidence/u);
  assert.match(skill.content, /Timeline is PLAN, not ACTUAL/u);
  assert.match(skill.content, /INFERENCE_NEXT_STEP/u);
  assert.match(skill.content, /Factual plan/u);
  assert.match(skill.content, /Bounded inference/u);
  assert.match(skill.content, /Do not create a causal relationship/u);
  assert.match(skill.content, /Do not expose reasoning/u);
  assert.match(skill.content, /Do not use a code fence/u);
  assert.match(skill.content, /support is \/|Always output \/ for/u);
});

test("Markdown contract accepts a copyable six-column Feishu table", () => {
  const markdown = [
    "# 项目周报｜2026.08.17 - 2026.08.21",
    "",
    "| 项目 / 事项 | 本周进展 | 下周安排 | 里程碑 | 需要支持 | 好 / 不好 |",
    "|---|---|---|---|---|---|",
    "| **GP Catalog 小程序**<br><br>**项目状态：方案** | - 完成需求确认并更新线框。 | - 根据排期推进设计。 | - UAT，9/14<br>- 上线，9/20 | / | / |",
  ].join("\n");
  assert.deepEqual(validateWeeklyReportMarkdown({ markdown, expectedProjectRows: 1 }), []);
});

test("Weekly Report migrations are additive", async () => {
  const [coreMigration, timelineMigration] = await Promise.all([
    readFile(
      new URL("../drizzle/0035_fresh_alex_wilder.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0036_normal_sister_grimm.sql", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(coreMigration, /CREATE TABLE "project_aliases"/u);
  assert.match(coreMigration, /ADD COLUMN "context_kind"/u);
  assert.match(timelineMigration, /CREATE TABLE "project_timelines"/u);
  assert.match(timelineMigration, /UNIQUE INDEX "project_timelines_project_uidx"/u);
  assert.doesNotMatch(
    coreMigration + timelineMigration,
    /DROP TABLE|DROP COLUMN|DROP TYPE/u,
  );
});

test("runtime image includes portable Skill assets", async () => {
  const dockerfile = await readFile(
    new URL("../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(dockerfile, /\/app\/skills \.\/skills/u);
});
