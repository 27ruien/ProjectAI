import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  AuthorizationError,
  type AuthenticatedPrincipal,
} from "../../lib/auth/session";
import { closeDatabasePool, getDb } from "../../lib/db/client";
import {
  actionItem,
  actionItemDependency,
  actionItemDraft,
  actionItemHistory,
  actionItemReview,
  actionItemSource,
  projectManagementAudit,
  requirement,
  risk,
  riskDraft,
  riskHistory,
  riskReview,
  riskSource,
  weeklyReportDraft,
  weeklyReportVersion,
  type UserRecord,
} from "../../lib/db/schema";
import { findUserByEmail } from "../../lib/db/repositories/user-repository";
import { ProjectManagementError } from "../../lib/project-management/errors";
import {
  addActionDependency,
  bulkUpdateActionStatus,
  createManualAction,
  exportWeeklyReport,
  generateActionDrafts,
  generateRiskDrafts,
  generateWeeklyReport,
  listActions,
  listProjectManagementAudits,
  publishWeeklyReport,
  reviewActionDraft,
  reviewRiskDraft,
  updateAction,
} from "../../lib/project-management/work-management";

const projectId = "project-001";
const requirementId = "phase1-r3-requirement";
const headers = new Headers({
  origin: "http://127.0.0.1:3200",
  "user-agent": "phase1-round3-integration",
});
let manager: UserRecord;
let member: UserRecord;
let viewer: UserRecord;
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} required`);
  return value;
}
function principal(user: UserRecord): AuthenticatedPrincipal {
  return { sessionId: `phase1-r3-${user.id}`, user };
}
const actionFields = (title: string, ownerUserId: string | null = null) => ({
  title,
  description: `${title} 的虚构描述`,
  ownerUserId,
  startDate: null,
  dueDate: "2099-12-31",
  status: "todo" as const,
  priority: "high" as const,
  progress: 0,
  blocker: "",
  relatedRequirementId: requirementId,
  relatedScopeItemId: null,
});

async function clear() {
  await getDb().transaction(async (tx) => {
    await tx
      .delete(weeklyReportVersion)
      .where(eq(weeklyReportVersion.projectId, projectId));
    await tx
      .delete(weeklyReportDraft)
      .where(eq(weeklyReportDraft.projectId, projectId));
    await tx.delete(riskSource).where(eq(riskSource.projectId, projectId));
    await tx.delete(riskHistory).where(eq(riskHistory.projectId, projectId));
    await tx.delete(riskReview).where(eq(riskReview.projectId, projectId));
    await tx.delete(risk).where(eq(risk.projectId, projectId));
    await tx.delete(riskDraft).where(eq(riskDraft.projectId, projectId));
    await tx
      .delete(actionItemDependency)
      .where(eq(actionItemDependency.projectId, projectId));
    await tx
      .delete(actionItemSource)
      .where(eq(actionItemSource.projectId, projectId));
    await tx
      .delete(actionItemHistory)
      .where(eq(actionItemHistory.projectId, projectId));
    await tx
      .delete(actionItemReview)
      .where(eq(actionItemReview.projectId, projectId));
    await tx.delete(actionItem).where(eq(actionItem.projectId, projectId));
    await tx
      .delete(actionItemDraft)
      .where(eq(actionItemDraft.projectId, projectId));
    await tx
      .delete(projectManagementAudit)
      .where(eq(projectManagementAudit.projectId, projectId));
    await tx.delete(requirement).where(eq(requirement.id, requirementId));
  });
}

describe("Phase 1 Round 3 work management", () => {
  before(async () => {
    const users = await Promise.all([
      findUserByEmail(required("SEED_MANAGER_A_EMAIL")),
      findUserByEmail(required("SEED_MEMBER_A_EMAIL")),
      findUserByEmail(required("SEED_VIEWER_A_EMAIL")),
    ]);
    assert.ok(users[0] && users[1] && users[2]);
    [manager, member, viewer] = users as UserRecord[];
    await clear();
    await getDb()
      .insert(requirement)
      .values({
        id: requirementId,
        projectId,
        code: "REQ-R3-0001",
        title: "虚构正式需求",
        description: "用于验证 Action、Risk 和周报来源边界。",
        type: "functional",
        priority: "high",
        status: "approved",
        ownerUserId: null,
        acceptanceCriteria: ["人工验收"],
        assumptions: [],
        openQuestions: [],
        createdBy: manager.id,
      });
  });
  after(async () => {
    await clear();
    await closeDatabasePool();
  });

  it("keeps generated Action in draft until review and enforces assigned-member updates", async () => {
    const generated = await generateActionDrafts({
      principal: principal(manager),
      projectId,
      requirementIds: [requirementId],
      documentIds: [],
      requestHeaders: headers,
    });
    assert.equal(generated.drafts.length, 1);
    assert.equal(
      (
        await getDb()
          .select()
          .from(actionItem)
          .where(eq(actionItem.projectId, projectId))
      ).length,
      0,
    );
    const accepted = await reviewActionDraft({
      principal: principal(manager),
      projectId,
      draftId: generated.drafts[0]!.id,
      decision: "edit_accept",
      fields: actionFields("人工确认 Action", member.id),
      note: "虚构审核",
      requestHeaders: headers,
    });
    assert.ok(accepted.action);
    const updated = await updateAction({
      principal: principal(member),
      projectId,
      actionItemId: accepted.action!.id,
      fields: {
        ...actionFields("人工确认 Action", member.id),
        status: "in_progress",
        progress: 30,
      },
      changeReason: "member_progress",
      requestHeaders: headers,
    });
    assert.equal(updated.progress, 30);
    const unassigned = await createManualAction({
      principal: principal(manager),
      projectId,
      fields: actionFields("未分配 Action"),
      requestHeaders: headers,
    });
    await assert.rejects(
      updateAction({
        principal: principal(member),
        projectId,
        actionItemId: unassigned.id,
        fields: actionFields("越权更新"),
        changeReason: "idor",
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof ProjectManagementError &&
        error.code === "ACTION_NOT_ASSIGNED",
    );
  });

  it("rejects dependency cycles", async () => {
    const [first, second] = await Promise.all([
      createManualAction({
        principal: principal(manager),
        projectId,
        fields: actionFields("依赖节点 A"),
        requestHeaders: headers,
      }),
      createManualAction({
        principal: principal(manager),
        projectId,
        fields: actionFields("依赖节点 B"),
        requestHeaders: headers,
      }),
    ]);
    await addActionDependency({
      principal: principal(manager),
      projectId,
      actionItemId: first.id,
      dependsOnActionItemId: second.id,
      requestHeaders: headers,
    });
    await assert.rejects(
      addActionDependency({
        principal: principal(manager),
        projectId,
        actionItemId: second.id,
        dependsOnActionItemId: first.id,
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof ProjectManagementError &&
        error.code === "DEPENDENCY_CYCLE",
    );
  });

  it("rejects cross-project, viewer, audit, and bulk ownership bypasses", async () => {
    await assert.rejects(
      createManualAction({
        principal: principal(manager),
        projectId: "project-002",
        fields: actionFields("跨项目写入"),
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 404,
    );
    await assert.rejects(
      generateActionDrafts({
        principal: principal(viewer),
        projectId,
        requirementIds: [requirementId],
        documentIds: [],
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 403,
    );
    const viewerList = await listActions({
      principal: principal(viewer),
      projectId,
      requestHeaders: headers,
    });
    assert.deepEqual(viewerList.drafts, []);
    await assert.rejects(
      listProjectManagementAudits({
        principal: principal(viewer),
        projectId,
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof AuthorizationError && error.status === 403,
    );
    const assigned = await createManualAction({
      principal: principal(manager),
      projectId,
      fields: actionFields("批量所属 Action", member.id),
      requestHeaders: headers,
    });
    const other = await createManualAction({
      principal: principal(manager),
      projectId,
      fields: actionFields("批量越权 Action"),
      requestHeaders: headers,
    });
    await assert.rejects(
      bulkUpdateActionStatus({
        principal: principal(member),
        projectId,
        actionItemIds: [assigned.id, other.id],
        status: "done",
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof ProjectManagementError &&
        error.code === "ACTION_NOT_ASSIGNED",
    );
    const unchanged = await getDb()
      .select()
      .from(actionItem)
      .where(eq(actionItem.id, assigned.id));
    assert.equal(unchanged[0]?.status, "todo");
  });

  it("keeps generated Risk in draft until review and computes probability times impact", async () => {
    const generated = await generateRiskDrafts({
      principal: principal(manager),
      projectId,
      requirementIds: [requirementId],
      documentIds: [],
      requestHeaders: headers,
    });
    assert.equal(
      (await getDb().select().from(risk).where(eq(risk.projectId, projectId)))
        .length,
      0,
    );
    const accepted = await reviewRiskDraft({
      principal: principal(manager),
      projectId,
      draftId: generated.drafts[0]!.id,
      decision: "accept",
      note: "虚构审核",
      requestHeaders: headers,
    });
    assert.ok(accepted.risk);
    assert.equal(
      accepted.risk!.severity,
      accepted.risk!.probability * accepted.risk!.impact,
    );
  });

  it("publishes an immutable weekly version and exports bounded Markdown", async () => {
    const draft = await generateWeeklyReport({
      principal: principal(manager),
      projectId,
      periodStart: "2026-07-13",
      periodEnd: "2026-07-19",
      requestHeaders: headers,
    });
    assert.equal(draft.status, "pending_review");
    const published = await publishWeeklyReport({
      principal: principal(manager),
      projectId,
      draftId: draft.id,
      requestHeaders: headers,
    });
    assert.equal(published.versionNumber, 1);
    await assert.rejects(
      publishWeeklyReport({
        principal: principal(manager),
        projectId,
        draftId: draft.id,
        requestHeaders: headers,
      }),
      (error: unknown) =>
        error instanceof ProjectManagementError &&
        error.code === "REPORT_ALREADY_REVIEWED",
    );
    const exported = await exportWeeklyReport({
      principal: principal(member),
      projectId,
      versionId: published.id,
      requestHeaders: headers,
    });
    assert.match(exported.markdown, /^# ProjectAI 周报/m);
    assert.doesNotMatch(
      exported.markdown,
      /sourceManifest|requirementId|API[_ -]?KEY/i,
    );
  });

  it("records project-bound audits without generated source text", async () => {
    const rows = await getDb()
      .select()
      .from(projectManagementAudit)
      .where(eq(projectManagementAudit.projectId, projectId));
    assert.ok(rows.some((row) => row.eventType === "action_draft_accepted"));
    assert.ok(rows.some((row) => row.eventType === "risk_draft_accepted"));
    assert.ok(rows.some((row) => row.eventType === "weekly_report_published"));
    assert.doesNotMatch(
      JSON.stringify(rows),
      /用于验证 Action、Risk 和周报来源边界/,
    );
  });
});
