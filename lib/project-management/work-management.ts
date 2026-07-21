import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import {
  requireProjectAccess,
  requireProjectRole,
} from "@/lib/auth/authorization";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import {
  createProjectAssistantGateway,
  requireAiAssistantEnabled,
} from "@/lib/ai/project-assistant";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  actionItem,
  actionItemDependency,
  actionItemDraft,
  actionItemHistory,
  actionItemReview,
  actionItemSource,
  projectManagementAudit,
  projectMember,
  requirement,
  risk,
  riskDraft,
  riskHistory,
  riskReview,
  riskSource,
  scopeDiffItem,
  weeklyReportDraft,
  weeklyReportVersion,
  type ActionSnapshot,
  type WeeklyReportSections,
} from "@/lib/db/schema";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import { ProjectManagementError } from "./errors";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const priority = z.enum(["low", "medium", "high", "critical"]);
export const actionFields = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().min(2).max(8_000),
  ownerUserId: z.string().min(1).max(200).nullable(),
  startDate: date,
  dueDate: date,
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]),
  priority,
  progress: z.number().int().min(0).max(100),
  blocker: z.string().trim().max(4_000),
  relatedRequirementId: z.string().min(1).max(200).nullable(),
  relatedScopeItemId: z.string().min(1).max(200).nullable(),
});
export const riskFields = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().min(2).max(8_000),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  ownerUserId: z.string().min(1).max(200).nullable(),
  mitigation: z.string().trim().min(1).max(8_000),
  trigger: z.string().trim().min(1).max(4_000),
  status: z.enum(["open", "monitoring", "mitigated", "closed"]),
  dueDate: date,
  relatedRequirementId: z.string().min(1).max(200).nullable(),
  relatedActionItemId: z.string().min(1).max(200).nullable(),
});
const aiActions = z.object({
  actions: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(240),
        description: z.string().trim().min(2).max(8_000),
        priority,
        blocker: z.string().trim().max(4_000),
        sourceIndex: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(50),
});
const aiRisks = z.object({
  risks: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(240),
        description: z.string().trim().min(2).max(8_000),
        probability: z.number().int().min(1).max(5),
        impact: z.number().int().min(1).max(5),
        mitigation: z.string().trim().min(1).max(8_000),
        trigger: z.string().trim().min(1).max(4_000),
        sourceIndex: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(50),
});
export const weeklySectionsSchema = z.object({
  completed: z.array(z.string().max(1_000)).max(100),
  inProgress: z.array(z.string().max(1_000)).max(100),
  nextWeek: z.array(z.string().max(1_000)).max(100),
  milestones: z.array(z.string().max(1_000)).max(100),
  blockers: z.array(z.string().max(1_000)).max(100),
  risks: z.array(z.string().max(1_000)).max(100),
  scopeChanges: z.array(z.string().max(1_000)).max(100),
  requirementChanges: z.array(z.string().max(1_000)).max(100),
  overdueActions: z.array(z.string().max(1_000)).max(100),
  decisionsNeeded: z.array(z.string().max(1_000)).max(100),
});

type Source = {
  type: "requirement" | "document";
  id: string;
  title: string;
  content: string;
  citation: Record<string, unknown>;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new ProjectManagementError(
      422,
      "AI_OUTPUT_INVALID",
      "AI 草稿格式无效",
    );
  }
}

function publicCitation(
  citation: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...citation };
  delete result.chunkId;
  return result;
}

async function validateOwner(
  projectId: string,
  ownerUserId: string | null,
  db: DatabaseExecutor,
) {
  if (!ownerUserId) return;
  const [member] = await db
    .select({ id: projectMember.id })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, ownerUserId),
      ),
    )
    .limit(1);
  if (!member)
    throw new ProjectManagementError(
      400,
      "INVALID_OWNER",
      "负责人必须是当前项目成员",
    );
}

async function validateRelations(input: {
  projectId: string;
  requirementId: string | null;
  scopeItemId?: string | null;
  actionItemId?: string | null;
  db: DatabaseExecutor;
}) {
  if (input.requirementId) {
    const [row] = await input.db
      .select({ id: requirement.id })
      .from(requirement)
      .where(
        and(
          eq(requirement.projectId, input.projectId),
          eq(requirement.id, input.requirementId),
        ),
      )
      .limit(1);
    if (!row)
      throw new ProjectManagementError(
        404,
        "RELATED_RESOURCE_NOT_FOUND",
        "关联资源不存在",
      );
  }
  if (input.scopeItemId) {
    const [row] = await input.db
      .select({ id: scopeDiffItem.id })
      .from(scopeDiffItem)
      .where(
        and(
          eq(scopeDiffItem.projectId, input.projectId),
          eq(scopeDiffItem.id, input.scopeItemId),
        ),
      )
      .limit(1);
    if (!row)
      throw new ProjectManagementError(
        404,
        "RELATED_RESOURCE_NOT_FOUND",
        "关联资源不存在",
      );
  }
  if (input.actionItemId) {
    const [row] = await input.db
      .select({ id: actionItem.id })
      .from(actionItem)
      .where(
        and(
          eq(actionItem.projectId, input.projectId),
          eq(actionItem.id, input.actionItemId),
        ),
      )
      .limit(1);
    if (!row)
      throw new ProjectManagementError(
        404,
        "RELATED_RESOURCE_NOT_FOUND",
        "关联资源不存在",
      );
  }
}

async function sources(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requirementIds: string[];
  documentIds: string[];
  db?: DatabaseExecutor;
}): Promise<Source[]> {
  const db = input.db ?? getDb();
  const requirementIds = [...new Set(input.requirementIds)];
  const documentIds = [...new Set(input.documentIds)];
  if (
    requirementIds.length !== input.requirementIds.length ||
    documentIds.length !== input.documentIds.length ||
    requirementIds.length + documentIds.length < 1 ||
    requirementIds.length > 50 ||
    documentIds.length > 20
  )
    throw new ProjectManagementError(
      400,
      "INVALID_SOURCE_SELECTION",
      "来源选择无效",
    );
  const result: Source[] = [];
  if (requirementIds.length) {
    const rows = await db
      .select()
      .from(requirement)
      .where(
        and(
          eq(requirement.projectId, input.projectId),
          inArray(requirement.id, requirementIds),
        ),
      );
    if (rows.length !== requirementIds.length)
      throw new ProjectManagementError(404, "SOURCE_NOT_FOUND", "来源不存在");
    result.push(
      ...rows.map((row) => ({
        type: "requirement" as const,
        id: row.id,
        title: `${row.code} ${row.title}`,
        content: row.description.slice(0, 2_000),
        citation: { requirementId: row.id, version: row.currentVersion },
      })),
    );
  }
  if (documentIds.length) {
    const authorized = new Set(
      (
        await listAuthorizedDocumentScope({
          principal: input.principal,
          projectId: input.projectId,
          permission: "view",
          db,
        })
      ).map((item) => item.documentId),
    );
    if (documentIds.some((id) => !authorized.has(id)))
      throw new ProjectManagementError(404, "SOURCE_NOT_FOUND", "来源不存在");
    const rows = await db.execute<{
      document_id: string;
      version_id: string;
      chunk_id: string;
      display_name: string;
      content: string;
      source_locator: Record<string, unknown>;
    }>(sql`
      select distinct on (c.document_id) c.document_id, c.version_id, c.id as chunk_id, d.display_name, c.content, c.source_locator
      from document_chunks c join project_documents d on d.id = c.document_id
      join project_document_versions v on v.id = c.version_id and v.is_current and v.storage_status = 'stored'
      join document_ingestion_jobs j on j.id = c.ingestion_job_id and j.status = 'succeeded' and j.generation = c.generation
      join projectai_authorized_documents(${input.principal.user.id}, ${input.projectId}, 'view'::knowledge_permission) a on a.document_id = c.document_id
      where c.document_id in (${sql.join(
        documentIds.map((id) => sql`${id}`),
        sql`, `,
      )}) and c.is_effective and d.document_status = 'active'
      order by c.document_id, c.chunk_index
    `);
    if (
      new Set(rows.rows.map((row) => row.document_id)).size !==
      documentIds.length
    )
      throw new ProjectManagementError(
        422,
        "INSUFFICIENT_EVIDENCE",
        "来源没有可用的当前索引内容",
      );
    result.push(
      ...rows.rows.map((row) => ({
        type: "document" as const,
        id: row.document_id,
        title: row.display_name,
        content: row.content.slice(0, 2_000),
        citation: {
          documentId: row.document_id,
          versionId: row.version_id,
          chunkId: row.chunk_id,
          sourceLocator: row.source_locator,
        },
      })),
    );
  }
  return result;
}

async function audit(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  requestHeaders: Headers;
  db: DatabaseExecutor;
}) {
  await input.db
    .insert(projectManagementAudit)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      actorUserId: input.principal.user.id,
      eventType: input.eventType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata ?? {},
    });
  await writeAuditEvent(
    {
      actorUserId: input.principal.user.id,
      projectId: input.projectId,
      eventType: input.eventType,
      entityType: input.resourceType,
      entityId: input.resourceId,
      result: "succeeded",
      metadata: input.metadata,
      ...getRequestAuditContext(input.requestHeaders),
    },
    input.db,
  );
}

function actionSnapshot(value: z.infer<typeof actionFields>): ActionSnapshot {
  return {
    title: value.title,
    description: value.description,
    ownerUserId: value.ownerUserId,
    startDate: value.startDate,
    dueDate: value.dueDate,
    status: value.status,
    priority: value.priority,
    progress: value.progress,
    blocker: value.blocker,
  };
}

export async function listActions(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  const access = await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const [items, drafts, dependencies, sourceRows, history] = await Promise.all([
    getDb()
      .select()
      .from(actionItem)
      .where(eq(actionItem.projectId, input.projectId))
      .orderBy(asc(actionItem.dueDate), asc(actionItem.code)),
    getDb()
      .select()
      .from(actionItemDraft)
      .where(eq(actionItemDraft.projectId, input.projectId))
      .orderBy(desc(actionItemDraft.createdAt)),
    getDb()
      .select()
      .from(actionItemDependency)
      .where(eq(actionItemDependency.projectId, input.projectId)),
    getDb()
      .select()
      .from(actionItemSource)
      .where(eq(actionItemSource.projectId, input.projectId)),
    getDb()
      .select()
      .from(actionItemHistory)
      .where(eq(actionItemHistory.projectId, input.projectId))
      .orderBy(desc(actionItemHistory.versionNumber)),
  ]);
  const authorizedDocs = new Set(
    (
      await listAuthorizedDocumentScope({
        principal: input.principal,
        projectId: input.projectId,
        permission: "view",
      })
    ).map((row) => row.documentId),
  );
  const canReview =
    input.principal.user.systemRole === "system_admin" ||
    access.projectRole === "project_manager";
  return {
    items,
    drafts: canReview
      ? drafts
          .filter(
            (draft) =>
              draft.sourceType !== "document" ||
              authorizedDocs.has(String(draft.sourceCitation.documentId ?? "")),
          )
          .map((draft) => ({
            ...draft,
            sourceCitation: publicCitation(draft.sourceCitation),
          }))
      : [],
    dependencies,
    sources: sourceRows
      .filter(
        (row) =>
          row.sourceType !== "document" || authorizedDocs.has(row.sourceId),
      )
      .map((row) => ({ ...row, citation: publicCitation(row.citation) })),
    history,
    projectRole: access.projectRole,
    actorUserId: input.principal.user.id,
  };
}

export async function generateActionDrafts(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requirementIds: string[];
  documentIds: string[];
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member"],
    input.requestHeaders,
  );
  const selected = await sources(input);
  const config = requireAiAssistantEnabled();
  const result = await createProjectAssistantGateway(config).generate({
    purpose: "action_generation",
    systemPrompt:
      "只根据编号来源输出 JSON actions 草稿，不得创建正式任务，不得分配未提供用户。",
    userPrompt: selected
      .map((source, index) => `[S${index}] ${source.title}\n${source.content}`)
      .join("\n\n"),
  });
  const parsed = aiActions.safeParse(parseJson(result.text));
  if (
    !parsed.success ||
    parsed.data.actions.some((item) => item.sourceIndex >= selected.length)
  )
    throw new ProjectManagementError(
      422,
      "AI_OUTPUT_INVALID",
      "AI Action 草稿格式无效",
    );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager", "project_member"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const created = [];
    for (const candidate of parsed.data.actions) {
      const source = selected[candidate.sourceIndex]!;
      const [draft] = await tx
        .insert(actionItemDraft)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          title: candidate.title,
          description: candidate.description,
          ownerUserId: null,
          startDate: null,
          dueDate: null,
          priority: candidate.priority,
          blocker: candidate.blocker,
          sourceType: source.type,
          sourceCitation: source.citation,
          relatedRequirementId:
            source.type === "requirement" ? source.id : null,
          relatedScopeItemId: null,
          createdBy: input.principal.user.id,
        })
        .returning();
      created.push(draft);
    }
    await audit({
      ...input,
      db: tx,
      eventType: "action_drafts_generated",
      resourceType: "action_item_draft",
      resourceId: created[0]!.id,
      metadata: { count: created.length },
    });
    return { drafts: created };
  });
}

export async function createManualAction(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  fields: z.infer<typeof actionFields>;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  const parsed = actionFields.safeParse(input.fields);
  if (!parsed.success)
    throw new ProjectManagementError(400, "INVALID_ACTION", "Action 字段无效");
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      scopeItemId: parsed.data.relatedScopeItemId,
      db: tx,
    });
    const [{ code }] = (
      await tx.execute<{ code: string }>(
        sql`select 'ACT-' || lpad((count(*) + 1)::text, 4, '0') as code from action_items where project_id = ${input.projectId}`,
      )
    ).rows;
    const [created] = await tx
      .insert(actionItem)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        code,
        ...parsed.data,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx
      .insert(actionItemHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        actionItemId: created.id,
        versionNumber: 1,
        snapshot: actionSnapshot(parsed.data),
        changeReason: "manual_create",
        actorUserId: input.principal.user.id,
      });
    await audit({
      ...input,
      db: tx,
      eventType: "action_item_created",
      resourceType: "action_item",
      resourceId: created.id,
    });
    return created;
  });
}

export async function reviewActionDraft(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  draftId: string;
  decision: "accept" | "edit_accept" | "reject";
  fields?: z.infer<typeof actionFields>;
  note: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [draft] = await tx
      .select()
      .from(actionItemDraft)
      .where(
        and(
          eq(actionItemDraft.projectId, input.projectId),
          eq(actionItemDraft.id, input.draftId),
        ),
      )
      .limit(1)
      .for("update", { of: actionItemDraft });
    if (!draft)
      throw new ProjectManagementError(
        404,
        "ACTION_DRAFT_NOT_FOUND",
        "Action 草稿不存在",
      );
    if (draft.status !== "pending_review")
      throw new ProjectManagementError(
        409,
        "DRAFT_ALREADY_REVIEWED",
        "草稿已审核",
      );
    if (draft.sourceType === "document")
      await sources({
        principal: input.principal,
        projectId: input.projectId,
        requirementIds: [],
        documentIds: [String(draft.sourceCitation.documentId)],
        db: tx,
      });
    if (input.decision === "reject") {
      await tx
        .insert(actionItemReview)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          draftId: draft.id,
          reviewerUserId: input.principal.user.id,
          decision: "reject",
          note: input.note,
        });
      await tx
        .update(actionItemDraft)
        .set({ status: "rejected", reviewedAt: new Date() })
        .where(eq(actionItemDraft.id, draft.id));
      await audit({
        ...input,
        db: tx,
        eventType: "action_draft_rejected",
        resourceType: "action_item_draft",
        resourceId: draft.id,
      });
      return { action: null };
    }
    const parsed = actionFields.safeParse(
      input.fields ?? {
        title: draft.title,
        description: draft.description,
        ownerUserId: draft.ownerUserId,
        startDate: draft.startDate,
        dueDate: draft.dueDate,
        status: "todo",
        priority: draft.priority,
        progress: 0,
        blocker: draft.blocker,
        relatedRequirementId: draft.relatedRequirementId,
        relatedScopeItemId: draft.relatedScopeItemId,
      },
    );
    if (!parsed.success)
      throw new ProjectManagementError(
        400,
        "INVALID_ACTION",
        "Action 字段无效",
      );
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      scopeItemId: parsed.data.relatedScopeItemId,
      db: tx,
    });
    const [{ code }] = (
      await tx.execute<{ code: string }>(
        sql`select 'ACT-' || lpad((count(*) + 1)::text, 4, '0') as code from action_items where project_id = ${input.projectId}`,
      )
    ).rows;
    const [created] = await tx
      .insert(actionItem)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        code,
        ...parsed.data,
        createdBy: input.principal.user.id,
      })
      .returning();
    const reviewId = crypto.randomUUID();
    await tx
      .insert(actionItemReview)
      .values({
        id: reviewId,
        projectId: input.projectId,
        draftId: draft.id,
        actionItemId: created.id,
        reviewerUserId: input.principal.user.id,
        decision: input.decision,
        note: input.note,
      });
    await tx
      .insert(actionItemHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        actionItemId: created.id,
        versionNumber: 1,
        snapshot: actionSnapshot(parsed.data),
        changeReason: "draft_accepted",
        actorUserId: input.principal.user.id,
      });
    await tx
      .insert(actionItemSource)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        actionItemId: created.id,
        sourceType: draft.sourceType,
        sourceId:
          draft.sourceType === "requirement"
            ? draft.relatedRequirementId!
            : String(draft.sourceCitation.documentId),
        citation: draft.sourceCitation,
      });
    await tx
      .update(actionItemDraft)
      .set({ status: "accepted", reviewedAt: new Date() })
      .where(eq(actionItemDraft.id, draft.id));
    await audit({
      ...input,
      db: tx,
      eventType: "action_draft_accepted",
      resourceType: "action_item",
      resourceId: created.id,
      metadata: { reviewId },
    });
    return { action: created };
  });
}

export async function updateAction(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  actionItemId: string;
  fields: z.infer<typeof actionFields>;
  changeReason: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member"],
    input.requestHeaders,
  );
  const parsed = actionFields.safeParse(input.fields);
  if (!parsed.success)
    throw new ProjectManagementError(400, "INVALID_ACTION", "Action 字段无效");
  return getDb().transaction(async (tx) => {
    const access = await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager", "project_member"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [current] = await tx
      .select()
      .from(actionItem)
      .where(
        and(
          eq(actionItem.projectId, input.projectId),
          eq(actionItem.id, input.actionItemId),
        ),
      )
      .limit(1)
      .for("update", { of: actionItem });
    if (!current)
      throw new ProjectManagementError(
        404,
        "ACTION_NOT_FOUND",
        "Action 不存在",
      );
    if (
      input.principal.user.systemRole !== "system_admin" &&
      access.projectRole === "project_member" &&
      current.ownerUserId !== input.principal.user.id
    )
      throw new ProjectManagementError(
        403,
        "ACTION_NOT_ASSIGNED",
        "只能更新分配给自己的 Action",
      );
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      scopeItemId: parsed.data.relatedScopeItemId,
      db: tx,
    });
    const version = current.currentVersion + 1;
    const [updated] = await tx
      .update(actionItem)
      .set({ ...parsed.data, currentVersion: version, updatedAt: new Date() })
      .where(eq(actionItem.id, current.id))
      .returning();
    await tx
      .insert(actionItemHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        actionItemId: current.id,
        versionNumber: version,
        snapshot: actionSnapshot(parsed.data),
        changeReason: input.changeReason,
        actorUserId: input.principal.user.id,
      });
    await audit({
      ...input,
      db: tx,
      eventType: "action_item_updated",
      resourceType: "action_item",
      resourceId: current.id,
      metadata: { version },
    });
    return updated;
  });
}

export async function bulkUpdateActionStatus(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  actionItemIds: string[];
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  requestHeaders: Headers;
}) {
  const uniqueIds = [...new Set(input.actionItemIds)];
  if (
    !uniqueIds.length ||
    uniqueIds.length > 100 ||
    uniqueIds.length !== input.actionItemIds.length
  )
    throw new ProjectManagementError(
      400,
      "INVALID_BULK_ACTION",
      "批量 Action 参数无效",
    );
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member"],
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    const access = await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager", "project_member"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const rows = await tx
      .select()
      .from(actionItem)
      .where(
        and(
          eq(actionItem.projectId, input.projectId),
          inArray(actionItem.id, uniqueIds),
        ),
      )
      .for("update", { of: actionItem });
    if (rows.length !== uniqueIds.length)
      throw new ProjectManagementError(
        404,
        "ACTION_NOT_FOUND",
        "Action 不存在",
      );
    if (
      input.principal.user.systemRole !== "system_admin" &&
      access.projectRole === "project_member" &&
      rows.some((row) => row.ownerUserId !== input.principal.user.id)
    )
      throw new ProjectManagementError(
        403,
        "ACTION_NOT_ASSIGNED",
        "批量操作包含未分配给自己的 Action",
      );
    const updated = [];
    for (const row of rows) {
      const version = row.currentVersion + 1;
      const [next] = await tx
        .update(actionItem)
        .set({
          status: input.status,
          progress: input.status === "done" ? 100 : row.progress,
          currentVersion: version,
          updatedAt: new Date(),
        })
        .where(eq(actionItem.id, row.id))
        .returning();
      await tx
        .insert(actionItemHistory)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          actionItemId: row.id,
          versionNumber: version,
          snapshot: actionSnapshot({
            ...row,
            status: input.status,
            progress: input.status === "done" ? 100 : row.progress,
          }),
          changeReason: "bulk_status_update",
          actorUserId: input.principal.user.id,
        });
      updated.push(next);
    }
    await audit({
      ...input,
      db: tx,
      eventType: "action_items_bulk_updated",
      resourceType: "action_item",
      resourceId: rows[0]!.id,
      metadata: { count: rows.length, status: input.status },
    });
    return updated;
  });
}

export async function addActionDependency(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  actionItemId: string;
  dependsOnActionItemId: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  if (input.actionItemId === input.dependsOnActionItemId)
    throw new ProjectManagementError(
      400,
      "DEPENDENCY_CYCLE",
      "Action 不能依赖自身",
    );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const rows = await tx
      .select({ id: actionItem.id })
      .from(actionItem)
      .where(
        and(
          eq(actionItem.projectId, input.projectId),
          inArray(actionItem.id, [
            input.actionItemId,
            input.dependsOnActionItemId,
          ]),
        ),
      );
    if (rows.length !== 2)
      throw new ProjectManagementError(
        404,
        "ACTION_NOT_FOUND",
        "Action 不存在",
      );
    const cycle = await tx.execute(
      sql`with recursive path(id) as (select depends_on_action_item_id from action_item_dependencies where project_id = ${input.projectId} and action_item_id = ${input.dependsOnActionItemId} union select d.depends_on_action_item_id from action_item_dependencies d join path p on d.action_item_id = p.id where d.project_id = ${input.projectId}) select 1 from path where id = ${input.actionItemId} limit 1`,
    );
    if (cycle.rows.length)
      throw new ProjectManagementError(
        400,
        "DEPENDENCY_CYCLE",
        "Action 依赖形成环",
      );
    const [created] = await tx
      .insert(actionItemDependency)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        actionItemId: input.actionItemId,
        dependsOnActionItemId: input.dependsOnActionItemId,
        createdBy: input.principal.user.id,
      })
      .onConflictDoNothing()
      .returning();
    if (created)
      await audit({
        ...input,
        db: tx,
        eventType: "action_dependency_added",
        resourceType: "action_item",
        resourceId: input.actionItemId,
        metadata: { dependsOnActionItemId: input.dependsOnActionItemId },
      });
    return created ?? null;
  });
}

export async function listRisks(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  const access = await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const [items, drafts, sourcesRows, history] = await Promise.all([
    getDb()
      .select()
      .from(risk)
      .where(eq(risk.projectId, input.projectId))
      .orderBy(desc(risk.severity), asc(risk.dueDate)),
    getDb()
      .select()
      .from(riskDraft)
      .where(eq(riskDraft.projectId, input.projectId))
      .orderBy(desc(riskDraft.createdAt)),
    getDb()
      .select()
      .from(riskSource)
      .where(eq(riskSource.projectId, input.projectId)),
    getDb()
      .select()
      .from(riskHistory)
      .where(eq(riskHistory.projectId, input.projectId))
      .orderBy(desc(riskHistory.versionNumber)),
  ]);
  const authorizedDocs = new Set(
    (
      await listAuthorizedDocumentScope({
        principal: input.principal,
        projectId: input.projectId,
        permission: "view",
      })
    ).map((row) => row.documentId),
  );
  const canReview =
    input.principal.user.systemRole === "system_admin" ||
    access.projectRole === "project_manager";
  return {
    items,
    drafts: canReview
      ? drafts
          .filter(
            (draft) =>
              draft.sourceType !== "document" ||
              authorizedDocs.has(String(draft.sourceCitation.documentId ?? "")),
          )
          .map((draft) => ({
            ...draft,
            sourceCitation: publicCitation(draft.sourceCitation),
          }))
      : [],
    sources: sourcesRows
      .filter(
        (row) =>
          row.sourceType !== "document" || authorizedDocs.has(row.sourceId),
      )
      .map((row) => ({ ...row, citation: publicCitation(row.citation) })),
    history,
  };
}

export async function generateRiskDrafts(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requirementIds: string[];
  documentIds: string[];
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager", "project_member"],
    input.requestHeaders,
  );
  const selected = await sources(input);
  const config = requireAiAssistantEnabled();
  const result = await createProjectAssistantGateway(config).generate({
    purpose: "risk_generation",
    systemPrompt: "只根据编号来源输出 JSON risks 草稿。不得创建正式风险。",
    userPrompt: selected
      .map((source, index) => `[S${index}] ${source.title}\n${source.content}`)
      .join("\n\n"),
  });
  const parsed = aiRisks.safeParse(parseJson(result.text));
  if (
    !parsed.success ||
    parsed.data.risks.some((item) => item.sourceIndex >= selected.length)
  )
    throw new ProjectManagementError(
      422,
      "AI_OUTPUT_INVALID",
      "AI Risk 草稿格式无效",
    );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager", "project_member"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const created = [];
    for (const candidate of parsed.data.risks) {
      const source = selected[candidate.sourceIndex]!;
      const [draft] = await tx
        .insert(riskDraft)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          title: candidate.title,
          description: candidate.description,
          probability: candidate.probability,
          impact: candidate.impact,
          ownerUserId: null,
          mitigation: candidate.mitigation,
          trigger: candidate.trigger,
          dueDate: null,
          sourceType: source.type,
          sourceCitation: source.citation,
          relatedRequirementId:
            source.type === "requirement" ? source.id : null,
          relatedActionItemId: null,
          createdBy: input.principal.user.id,
        })
        .returning();
      created.push(draft);
    }
    await audit({
      ...input,
      db: tx,
      eventType: "risk_drafts_generated",
      resourceType: "risk_draft",
      resourceId: created[0]!.id,
      metadata: { count: created.length },
    });
    return { drafts: created };
  });
}

export async function createManualRisk(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  fields: z.infer<typeof riskFields>;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  const parsed = riskFields.safeParse(input.fields);
  if (!parsed.success)
    throw new ProjectManagementError(400, "INVALID_RISK", "Risk 字段无效");
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      actionItemId: parsed.data.relatedActionItemId,
      db: tx,
    });
    const [{ code }] = (
      await tx.execute<{ code: string }>(
        sql`select 'RSK-' || lpad((count(*) + 1)::text, 4, '0') as code from risks where project_id = ${input.projectId}`,
      )
    ).rows;
    const [created] = await tx
      .insert(risk)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        code,
        ...parsed.data,
        severity: parsed.data.probability * parsed.data.impact,
        createdBy: input.principal.user.id,
      })
      .returning();
    await tx
      .insert(riskHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        riskId: created.id,
        versionNumber: 1,
        snapshot: parsed.data,
        changeReason: "manual_create",
        actorUserId: input.principal.user.id,
      });
    await audit({
      ...input,
      db: tx,
      eventType: "risk_created",
      resourceType: "risk",
      resourceId: created.id,
    });
    return created;
  });
}

export async function reviewRiskDraft(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  draftId: string;
  decision: "accept" | "edit_accept" | "reject";
  fields?: z.infer<typeof riskFields>;
  note: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [draft] = await tx
      .select()
      .from(riskDraft)
      .where(
        and(
          eq(riskDraft.projectId, input.projectId),
          eq(riskDraft.id, input.draftId),
        ),
      )
      .limit(1)
      .for("update", { of: riskDraft });
    if (!draft)
      throw new ProjectManagementError(
        404,
        "RISK_DRAFT_NOT_FOUND",
        "Risk 草稿不存在",
      );
    if (draft.status !== "pending_review")
      throw new ProjectManagementError(
        409,
        "DRAFT_ALREADY_REVIEWED",
        "草稿已审核",
      );
    if (draft.sourceType === "document")
      await sources({
        principal: input.principal,
        projectId: input.projectId,
        requirementIds: [],
        documentIds: [String(draft.sourceCitation.documentId)],
        db: tx,
      });
    if (input.decision === "reject") {
      await tx
        .insert(riskReview)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          draftId: draft.id,
          reviewerUserId: input.principal.user.id,
          decision: "reject",
          note: input.note,
        });
      await tx
        .update(riskDraft)
        .set({ status: "rejected", reviewedAt: new Date() })
        .where(eq(riskDraft.id, draft.id));
      await audit({
        ...input,
        db: tx,
        eventType: "risk_draft_rejected",
        resourceType: "risk_draft",
        resourceId: draft.id,
      });
      return { risk: null };
    }
    const parsed = riskFields.safeParse(
      input.fields ?? {
        title: draft.title,
        description: draft.description,
        probability: draft.probability,
        impact: draft.impact,
        ownerUserId: draft.ownerUserId,
        mitigation: draft.mitigation,
        trigger: draft.trigger,
        status: "open",
        dueDate: draft.dueDate,
        relatedRequirementId: draft.relatedRequirementId,
        relatedActionItemId: draft.relatedActionItemId,
      },
    );
    if (!parsed.success)
      throw new ProjectManagementError(400, "INVALID_RISK", "Risk 字段无效");
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      actionItemId: parsed.data.relatedActionItemId,
      db: tx,
    });
    const [{ code }] = (
      await tx.execute<{ code: string }>(
        sql`select 'RSK-' || lpad((count(*) + 1)::text, 4, '0') as code from risks where project_id = ${input.projectId}`,
      )
    ).rows;
    const [created] = await tx
      .insert(risk)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        code,
        ...parsed.data,
        severity: parsed.data.probability * parsed.data.impact,
        createdBy: input.principal.user.id,
      })
      .returning();
    const reviewId = crypto.randomUUID();
    await tx
      .insert(riskReview)
      .values({
        id: reviewId,
        projectId: input.projectId,
        draftId: draft.id,
        riskId: created.id,
        reviewerUserId: input.principal.user.id,
        decision: input.decision,
        note: input.note,
      });
    await tx
      .insert(riskHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        riskId: created.id,
        versionNumber: 1,
        snapshot: parsed.data,
        changeReason: "draft_accepted",
        actorUserId: input.principal.user.id,
      });
    await tx
      .insert(riskSource)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        riskId: created.id,
        sourceType: draft.sourceType,
        sourceId:
          draft.sourceType === "requirement"
            ? draft.relatedRequirementId!
            : String(draft.sourceCitation.documentId),
        citation: draft.sourceCitation,
      });
    await tx
      .update(riskDraft)
      .set({ status: "accepted", reviewedAt: new Date() })
      .where(eq(riskDraft.id, draft.id));
    await audit({
      ...input,
      db: tx,
      eventType: "risk_draft_accepted",
      resourceType: "risk",
      resourceId: created.id,
      metadata: { reviewId },
    });
    return { risk: created };
  });
}

export async function updateRisk(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  riskId: string;
  fields: z.infer<typeof riskFields>;
  changeReason: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  const parsed = riskFields.safeParse(input.fields);
  if (!parsed.success)
    throw new ProjectManagementError(400, "INVALID_RISK", "Risk 字段无效");
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [current] = await tx
      .select()
      .from(risk)
      .where(
        and(eq(risk.projectId, input.projectId), eq(risk.id, input.riskId)),
      )
      .limit(1)
      .for("update", { of: risk });
    if (!current)
      throw new ProjectManagementError(404, "RISK_NOT_FOUND", "Risk 不存在");
    await validateOwner(input.projectId, parsed.data.ownerUserId, tx);
    await validateRelations({
      projectId: input.projectId,
      requirementId: parsed.data.relatedRequirementId,
      actionItemId: parsed.data.relatedActionItemId,
      db: tx,
    });
    const version = current.currentVersion + 1;
    const [updated] = await tx
      .update(risk)
      .set({
        ...parsed.data,
        severity: parsed.data.probability * parsed.data.impact,
        currentVersion: version,
        updatedAt: new Date(),
      })
      .where(eq(risk.id, current.id))
      .returning();
    await tx
      .insert(riskHistory)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        riskId: current.id,
        versionNumber: version,
        snapshot: parsed.data,
        changeReason: input.changeReason,
        actorUserId: input.principal.user.id,
      });
    await audit({
      ...input,
      db: tx,
      eventType: "risk_updated",
      resourceType: "risk",
      resourceId: current.id,
      metadata: { version },
    });
    return updated;
  });
}

function markdown(
  sections: WeeklyReportSections,
  periodStart: string,
  periodEnd: string,
): string {
  const groups: Array<[keyof WeeklyReportSections, string]> = [
    ["completed", "本周完成"],
    ["inProgress", "进行中"],
    ["nextWeek", "下周计划"],
    ["milestones", "Milestones"],
    ["blockers", "Blockers"],
    ["risks", "Risks"],
    ["scopeChanges", "Scope Changes"],
    ["requirementChanges", "新增或变更需求"],
    ["overdueActions", "逾期 Action Items"],
    ["decisionsNeeded", "需要决策事项"],
  ];
  return [
    `# ProjectAI 周报`,
    ``,
    `周期：${periodStart} — ${periodEnd}`,
    ``,
    ...groups.flatMap(([key, label]) => [
      `## ${label}`,
      ``,
      ...(sections[key].length
        ? sections[key].map((item) => `- ${item}`)
        : ["- 无"]),
      ``,
    ]),
  ].join("\n");
}

export async function listWeeklyReports(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  const access = await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const [drafts, versions] = await Promise.all([
    getDb()
      .select()
      .from(weeklyReportDraft)
      .where(eq(weeklyReportDraft.projectId, input.projectId))
      .orderBy(desc(weeklyReportDraft.createdAt)),
    getDb()
      .select()
      .from(weeklyReportVersion)
      .where(eq(weeklyReportVersion.projectId, input.projectId))
      .orderBy(desc(weeklyReportVersion.versionNumber)),
  ]);
  const canReview =
    input.principal.user.systemRole === "system_admin" ||
    access.projectRole === "project_manager";
  return { drafts: canReview ? drafts : [], versions };
}

export async function generateWeeklyReport(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.periodStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd) ||
    input.periodStart > input.periodEnd
  )
    throw new ProjectManagementError(
      400,
      "INVALID_REPORT_PERIOD",
      "周报周期无效",
    );
  const [requirements, scopeItems, actions, risks] = await Promise.all([
    getDb()
      .select({
        id: requirement.id,
        code: requirement.code,
        title: requirement.title,
        status: requirement.status,
        updatedAt: requirement.updatedAt,
      })
      .from(requirement)
      .where(eq(requirement.projectId, input.projectId)),
    getDb()
      .select({
        id: scopeDiffItem.id,
        title: scopeDiffItem.title,
        diffType: scopeDiffItem.diffType,
        reviewStatus: scopeDiffItem.reviewStatus,
      })
      .from(scopeDiffItem)
      .where(eq(scopeDiffItem.projectId, input.projectId)),
    getDb()
      .select({
        id: actionItem.id,
        code: actionItem.code,
        title: actionItem.title,
        status: actionItem.status,
        progress: actionItem.progress,
        dueDate: actionItem.dueDate,
      })
      .from(actionItem)
      .where(eq(actionItem.projectId, input.projectId)),
    getDb()
      .select({
        id: risk.id,
        code: risk.code,
        title: risk.title,
        status: risk.status,
        severity: risk.severity,
      })
      .from(risk)
      .where(eq(risk.projectId, input.projectId)),
  ]);
  const sourceManifest = {
    requirementIds: requirements.map((row) => row.id),
    scopeItemIds: scopeItems.map((row) => row.id),
    actionItemIds: actions.map((row) => row.id),
    riskIds: risks.map((row) => row.id),
  };
  const config = requireAiAssistantEnabled();
  const result = await createProjectAssistantGateway(config).generate({
    purpose: "weekly_report",
    systemPrompt: "仅根据正式项目数据摘要输出周报 JSON，不得补充无来源事实。",
    userPrompt: JSON.stringify({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      requirements,
      scopeItems,
      actions,
      risks,
    }),
  });
  const parsed = weeklySectionsSchema.safeParse(parseJson(result.text));
  if (!parsed.success)
    throw new ProjectManagementError(
      422,
      "AI_OUTPUT_INVALID",
      "AI 周报草稿格式无效",
    );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [draft] = await tx
      .insert(weeklyReportDraft)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sections: parsed.data,
        sourceManifest,
        modelProfileId: config.profileId,
        createdBy: input.principal.user.id,
      })
      .returning();
    await audit({
      ...input,
      db: tx,
      eventType: "weekly_report_draft_generated",
      resourceType: "weekly_report_draft",
      resourceId: draft.id,
      metadata: {
        counts: Object.fromEntries(
          Object.entries(sourceManifest).map(([key, ids]) => [key, ids.length]),
        ),
      },
    });
    return draft;
  });
}

export async function publishWeeklyReport(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  draftId: string;
  sections?: WeeklyReportSections;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  return getDb().transaction(async (tx) => {
    await requireProjectRole(
      input.principal,
      input.projectId,
      ["project_manager"],
      input.requestHeaders,
      { db: tx, lockForUpdate: true },
    );
    const [draft] = await tx
      .select()
      .from(weeklyReportDraft)
      .where(
        and(
          eq(weeklyReportDraft.projectId, input.projectId),
          eq(weeklyReportDraft.id, input.draftId),
        ),
      )
      .limit(1)
      .for("update", { of: weeklyReportDraft });
    if (!draft)
      throw new ProjectManagementError(
        404,
        "REPORT_DRAFT_NOT_FOUND",
        "周报草稿不存在",
      );
    if (draft.status !== "pending_review")
      throw new ProjectManagementError(
        409,
        "REPORT_ALREADY_REVIEWED",
        "周报草稿已审核",
      );
    const parsed = weeklySectionsSchema.safeParse(
      input.sections ?? draft.sections,
    );
    if (!parsed.success)
      throw new ProjectManagementError(400, "INVALID_REPORT", "周报内容无效");
    const [{ next_version: version }] = (
      await tx.execute<{ next_version: number }>(
        sql`select coalesce(max(version_number), 0) + 1 as next_version from weekly_report_versions where project_id = ${input.projectId}`,
      )
    ).rows;
    const [published] = await tx
      .insert(weeklyReportVersion)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        draftId: draft.id,
        versionNumber: Number(version),
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        sections: parsed.data,
        sourceManifest: draft.sourceManifest,
        markdown: markdown(parsed.data, draft.periodStart, draft.periodEnd),
        publishedBy: input.principal.user.id,
      })
      .returning();
    await tx
      .update(weeklyReportDraft)
      .set({
        status: "published",
        reviewedAt: new Date(),
        sections: parsed.data,
      })
      .where(eq(weeklyReportDraft.id, draft.id));
    await audit({
      ...input,
      db: tx,
      eventType: "weekly_report_published",
      resourceType: "weekly_report_version",
      resourceId: published.id,
      metadata: { version: published.versionNumber },
    });
    return published;
  });
}

export async function exportWeeklyReport(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  versionId: string;
  requestHeaders: Headers;
}) {
  await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const [row] = await getDb()
    .select({
      markdown: weeklyReportVersion.markdown,
      versionNumber: weeklyReportVersion.versionNumber,
    })
    .from(weeklyReportVersion)
    .where(
      and(
        eq(weeklyReportVersion.projectId, input.projectId),
        eq(weeklyReportVersion.id, input.versionId),
      ),
    )
    .limit(1);
  if (!row)
    throw new ProjectManagementError(404, "REPORT_NOT_FOUND", "周报不存在");
  return row;
}

export async function projectDashboard(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const now = new Date().toISOString().slice(0, 10);
  const result = await getDb().execute<{
    requirement_count: number;
    requirement_done: number;
    scope_changes: number;
    action_count: number;
    action_done: number;
    overdue_actions: number;
    open_risks: number;
    latest_report_id: string | null;
    latest_report_version: number | null;
  }>(
    sql`select (select count(*)::int from requirements where project_id = ${input.projectId}) requirement_count, (select count(*)::int from requirements where project_id = ${input.projectId} and status = 'done') requirement_done, (select count(*)::int from scope_diff_items where project_id = ${input.projectId} and diff_type <> 'unchanged' and review_status <> 'dismissed') scope_changes, (select count(*)::int from action_items where project_id = ${input.projectId} and status <> 'cancelled') action_count, (select count(*)::int from action_items where project_id = ${input.projectId} and status = 'done') action_done, (select count(*)::int from action_items where project_id = ${input.projectId} and due_date < ${now} and status not in ('done','cancelled')) overdue_actions, (select count(*)::int from risks where project_id = ${input.projectId} and status in ('open','monitoring')) open_risks, (select id from weekly_report_versions where project_id = ${input.projectId} order by version_number desc limit 1) latest_report_id, (select version_number from weekly_report_versions where project_id = ${input.projectId} order by version_number desc limit 1) latest_report_version`,
  );
  return result.rows[0];
}

export async function listProjectManagementAudits(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  await requireProjectRole(
    input.principal,
    input.projectId,
    ["project_manager"],
    input.requestHeaders,
  );
  return getDb()
    .select()
    .from(projectManagementAudit)
    .where(eq(projectManagementAudit.projectId, input.projectId))
    .orderBy(desc(projectManagementAudit.createdAt))
    .limit(500);
}
