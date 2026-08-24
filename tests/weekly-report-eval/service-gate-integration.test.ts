import assert from "node:assert/strict";
import test from "node:test";
import { asc, eq } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { closeDatabasePool, getDb } from "@/lib/db/client";
import {
  auditEvent,
  organization,
  project,
  projectAlias,
  projectMember,
  user,
} from "@/lib/db/schema";
import type { RagflowClient } from "@/lib/ragflow";
import {
  buildWeeklyReportExecutionPackage,
  WeeklyReportError,
} from "@/lib/weekly-report";

const databaseUrl = process.env.DATABASE_URL?.trim();

test("WR-EVAL-09 service gate blocks finalization, permits confirmed retry, and rejects unauthorized override", {
  skip: databaseUrl ? false : "DATABASE_URL is required for isolated service integration",
}, async () => {
  const db = getDb();
  let timelineReads = 0;
  let knowledgeReads = 0;
  try {
    const [owner, employee] = await db.insert(user).values([
      {
        id: "wr-eval-owner",
        email: "wr-eval-owner@test.local",
        displayName: "WR Eval Owner",
        productRole: "member",
      },
      {
        id: "wr-eval-employee",
        email: "wr-eval-employee@test.local",
        displayName: "WR Eval Employee",
        productRole: "member",
      },
    ]).returning();
    await db.insert(organization).values({
      id: "wr-eval-org",
      name: "WR Eval Organization",
      slug: "wr-eval-organization",
      createdBy: owner.id,
    });
    await db.insert(project).values([
      {
        id: "wr-eval-alpha-east",
        organizationId: "wr-eval-org",
        name: "Project Alpha East",
        clientName: "Synthetic Client",
        status: "active",
        stage: "planning",
        createdBy: owner.id,
      },
      {
        id: "wr-eval-alpha-west",
        organizationId: "wr-eval-org",
        name: "Project Alpha West",
        clientName: "Synthetic Client",
        status: "active",
        stage: "planning",
        createdBy: owner.id,
      },
      {
        id: "wr-eval-secret-b",
        organizationId: "wr-eval-org",
        name: "Secret Project B",
        clientName: "Synthetic Client",
        status: "active",
        stage: "planning",
        createdBy: owner.id,
      },
    ]);
    await db.insert(projectMember).values([
      {
        id: "wr-eval-member-east",
        projectId: "wr-eval-alpha-east",
        userId: employee.id,
        role: "project_manager",
        createdBy: owner.id,
      },
      {
        id: "wr-eval-member-west",
        projectId: "wr-eval-alpha-west",
        userId: employee.id,
        role: "project_manager",
        createdBy: owner.id,
      },
    ]);

    const principal: AuthenticatedPrincipal = {
      sessionId: "wr-eval-session",
      user: employee,
    };
    const file = new File([
      "Project,Task,Date\nProject Alpha,技术方案仍在修改,2026-08-19\n",
    ], "wr-eval-ambiguous.csv", { type: "text/csv" });
    const common = {
      principal,
      file,
      weekStart: "2026-08-17",
      weekEnd: "2026-08-21",
      ragflowClient: {
        async retrieve() {
          knowledgeReads += 1;
          return { evidence: [], total: 0, latencyMs: 1 };
        },
      } as unknown as RagflowClient,
      structuredTimelineRepository: {
        async findProjectTimeline() {
          timelineReads += 1;
          return null;
        },
      },
    };

    const confirmation = await buildWeeklyReportExecutionPackage(common);
    assert.equal(confirmation.status, "needs_confirmation");
    assert.equal(confirmation.confirmationRequired, true);
    assert.equal(confirmation.unresolvedMatches.length, 1);
    assert.equal("executionPackage" in confirmation, false);
    assert.equal(timelineReads, 0, "Timeline must not run before confirmation");
    assert.equal(knowledgeReads, 0, "Knowledge must not run before confirmation");
    assert.equal((await db.select().from(projectAlias)).length, 0);

    const confirmationAudits = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, employee.id))
      .orderBy(asc(auditEvent.createdAt));
    assert.equal(confirmationAudits.length, 1);
    assert.equal(confirmationAudits[0].eventType, "weekly_report_match_confirmation_required");
    assert.equal(confirmationAudits[0].result, "denied");
    assert.equal(
      confirmationAudits.some((event) =>
        event.eventType === "weekly_report_context_built" && event.result === "succeeded",
      ),
      false,
    );

    const finalized = await buildWeeklyReportExecutionPackage({
      ...common,
      matchOverrides: [{
        sourceProjectName: "Project Alpha",
        projectId: "wr-eval-alpha-east",
        saveAlias: false,
      }],
    });
    assert.equal(finalized.status, "finalized");
    if (finalized.status !== "finalized") assert.fail("confirmed retry must finalize");
    assert.equal(finalized.executionPackage.projects.length, 1);
    assert.equal(finalized.executionPackage.projects[0].project.id, "wr-eval-alpha-east");
    assert.equal(finalized.executionPackage.output.format, "markdown");
    assert.equal(timelineReads, 1);
    assert.equal(knowledgeReads, 0);

    const finalAudits = await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, employee.id));
    assert.equal(
      finalAudits.filter((event) =>
        event.eventType === "weekly_report_context_built" && event.result === "succeeded",
      ).length,
      1,
    );

    await assert.rejects(
      buildWeeklyReportExecutionPackage({
        ...common,
        matchOverrides: [{
          sourceProjectName: "Project Alpha",
          projectId: "wr-eval-secret-b",
          saveAlias: false,
        }],
      }),
      (error) =>
        error instanceof WeeklyReportError &&
        error.status === 404 &&
        error.code === "PROJECT_NOT_FOUND",
    );
  } finally {
    await closeDatabasePool();
  }
});
