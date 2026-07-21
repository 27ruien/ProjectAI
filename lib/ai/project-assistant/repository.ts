import { createHash } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import { requireProjectAccess } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  aiExecution,
  aiMessage,
  aiMessageCitation,
  aiRetrievalQueryEmbeddingCall,
  aiRetrievalRun,
  aiThread,
  type AiExecutionRecord,
  type AiRetrievalMode,
} from "@/lib/db/schema";
import { validateSourceLocator } from "@/lib/documents/processing/source-locator";
import type {
  ProjectAssistantMessageResponse,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
} from "@/types/project-assistant";
import {
  AI_GATEWAY_VERSION,
  PROJECT_ASSISTANT_PRIMARY_MODEL,
  PROJECT_ASSISTANT_PROMPT_VERSION,
  PROJECT_ASSISTANT_RETRIEVAL_VERSION,
} from "./config";
import { ProjectAssistantError } from "./errors";
import { requireProjectAssistantProfile } from "./profiles";
import type { ProjectAssistantHistoryMessage } from "./grounding";
import type { ValidatedGroundedAnswer } from "./citations";
import type { AiGatewayResult } from "./gateway";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";

const RUNNING_EXECUTION_STATUSES = [
  "reserved",
  "retrieving",
  "calling_provider",
  "validating",
] as const;

const limits = {
  perUserMinute: 6,
  userDailyTokens: 100_000,
  projectDailyTokens: 500_000,
  globalConcurrent: 3,
} as const;

function titleFrom(question: string): string {
  return question.replace(/\s+/g, " ").trim().slice(0, 80) || "新对话";
}

function questionHash(question: string): string {
  return createHash("sha256").update(question).digest("hex");
}

function assistantErrorForLimit(
  code:
    | "AI_RATE_LIMITED"
    | "AI_USER_DAILY_LIMIT_REACHED"
    | "AI_PROJECT_DAILY_LIMIT_REACHED"
    | "AI_CONCURRENCY_LIMIT_REACHED",
): ProjectAssistantError {
  const messages = {
    AI_RATE_LIMITED: "请求过于频繁，请稍后重试",
    AI_USER_DAILY_LIMIT_REACHED: "今日个人 AI 用量已达上限",
    AI_PROJECT_DAILY_LIMIT_REACHED: "今日项目 AI 用量已达上限",
    AI_CONCURRENCY_LIMIT_REACHED: "AI 服务繁忙，请稍后重试",
  } as const;
  return new ProjectAssistantError(429, code, messages[code]);
}

async function ownedThread(
  db: DatabaseExecutor,
  principal: AuthenticatedPrincipal,
  projectId: string,
  threadId: string,
  lockForUpdate = false,
) {
  const query = db
    .select()
    .from(aiThread)
    .where(
      and(
        eq(aiThread.id, threadId),
        eq(aiThread.projectId, projectId),
        eq(aiThread.createdBy, principal.user.id),
      ),
    )
    .limit(1);
  const [thread] = lockForUpdate
    ? await query.for("update", { of: aiThread })
    : await query;
  return thread ?? null;
}

export async function createOwnedThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}) {
  return getDb().transaction(async (tx) => {
    try {
      await requireProjectAccess(
        input.principal,
        input.projectId,
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
    } catch (error) {
      if (error instanceof AuthorizationError) return { error } as const;
      throw error;
    }
    const [thread] = await tx
      .insert(aiThread)
      .values({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        createdBy: input.principal.user.id,
        title: "新对话",
        status: "active",
      })
      .returning();
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "ai_thread_created",
        entityType: "ai_thread",
        entityId: thread.id,
        result: "succeeded",
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return { thread } as const;
  }).then((result) => {
    if ("error" in result) throw result.error;
    return result.thread;
  });
}

export async function listOwnedThreadSummaries(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadSummaryDto[]> {
  await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const rows = await getDb()
    .select({
      id: aiThread.id,
      title: aiThread.title,
      status: aiThread.status,
      createdAt: aiThread.createdAt,
      updatedAt: aiThread.updatedAt,
      archivedAt: aiThread.archivedAt,
      messageCount: count(aiMessage.id).mapWith(Number),
    })
    .from(aiThread)
    .leftJoin(
      aiMessage,
      and(
        eq(aiMessage.threadId, aiThread.id),
        eq(aiMessage.projectId, aiThread.projectId),
      ),
    )
    .where(
      and(
        eq(aiThread.projectId, input.projectId),
        eq(aiThread.createdBy, input.principal.user.id),
      ),
    )
    .groupBy(
      aiThread.id,
      aiThread.title,
      aiThread.status,
      aiThread.createdAt,
      aiThread.updatedAt,
      aiThread.archivedAt,
    )
    .orderBy(desc(aiThread.updatedAt), desc(aiThread.createdAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    messageCount: row.messageCount,
  }));
}

export async function loadOwnedThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders?: Headers;
}): Promise<ProjectAssistantThreadDto> {
  if (input.requestHeaders) {
    await requireProjectAccess(
      input.principal,
      input.projectId,
      input.requestHeaders,
    );
  }
  const thread = await ownedThread(
    getDb(),
    input.principal,
    input.projectId,
    input.threadId,
  );
  if (!thread) {
    throw new ProjectAssistantError(
      404,
      "AI_THREAD_NOT_FOUND",
      "对话不存在",
    );
  }
  const authorizedDocuments = new Map(
    (
      await listAuthorizedDocumentScope({
        principal: input.principal,
        projectId: input.projectId,
        permission: "view",
      })
    ).map((item) => [item.documentId, item] as const),
  );
  const [messages, citations, executions] = await Promise.all([
    getDb()
      .select()
      .from(aiMessage)
      .where(
        and(
          eq(aiMessage.projectId, input.projectId),
          eq(aiMessage.threadId, input.threadId),
          eq(aiMessage.createdBy, input.principal.user.id),
        ),
      )
      .orderBy(asc(aiMessage.createdAt), asc(aiMessage.id)),
    getDb()
      .select()
      .from(aiMessageCitation)
      .where(
        and(
          eq(aiMessageCitation.projectId, input.projectId),
          eq(aiMessageCitation.threadId, input.threadId),
        ),
      )
      .orderBy(
        asc(aiMessageCitation.assistantMessageId),
        asc(aiMessageCitation.citationIndex),
      ),
    getDb()
      .select({
        assistantMessageId: aiExecution.assistantMessageId,
        fallbackUsed: aiExecution.fallbackUsed,
      })
      .from(aiExecution)
      .where(
        and(
          eq(aiExecution.projectId, input.projectId),
          eq(aiExecution.threadId, input.threadId),
          eq(aiExecution.actorUserId, input.principal.user.id),
        ),
      ),
  ]);
  const citationsByMessage = new Map<
    string,
    typeof citations
  >();
  const revokedCitationMessages = new Set<string>();
  for (const citation of citations) {
    if (!authorizedDocuments.has(citation.documentId)) {
      revokedCitationMessages.add(citation.assistantMessageId);
      continue;
    }
    const values = citationsByMessage.get(citation.assistantMessageId) ?? [];
    values.push(citation);
    citationsByMessage.set(citation.assistantMessageId, values);
  }
  const fallbackByMessage = new Map(
    executions.map((execution) => [
      execution.assistantMessageId,
      execution.fallbackUsed,
    ]),
  );
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    archivedAt: thread.archivedAt?.toISOString() ?? null,
    messageCount: messages.length,
    messages: messages.map((message) => {
      const revoked = revokedCitationMessages.has(message.id);
      return {
        id: message.id,
        role: message.role,
        status: revoked ? "failed" as const : message.status,
        content: revoked
          ? "该历史回答的部分来源权限已变化，内容已隐藏。请重新提问。"
          : message.content,
        createdAt: message.createdAt.toISOString(),
        fallbackUsed: fallbackByMessage.get(message.id) ?? false,
        citations: revoked
          ? []
          : (citationsByMessage.get(message.id) ?? []).map(
              (citation) => ({
                index: citation.citationIndex,
                displayName: citation.displayName,
                versionNumber: citation.versionNumber,
                mimeType: citation.mimeType,
                headingPath: Array.isArray(citation.headingPath)
                  ? citation.headingPath
                  : [],
                source: validateSourceLocator(citation.sourceLocator),
                excerpt: citation.excerpt,
                documentId: citation.documentId,
                versionId: citation.versionId,
              }),
            ).map((citation) => ({
              ...citation,
              knowledgeSpaceId: authorizedDocuments.get(citation.documentId)!.knowledgeSpaceId,
              sourceScope: authorizedDocuments.get(citation.documentId)!.sourceScope,
            })),
      };
    }),
  };
}

export async function archiveOwnedThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
}): Promise<void> {
  const result = await getDb().transaction(async (tx) => {
    try {
      await requireProjectAccess(
        input.principal,
        input.projectId,
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
    } catch (error) {
      if (error instanceof AuthorizationError) return { error } as const;
      throw error;
    }
    const thread = await ownedThread(
      tx,
      input.principal,
      input.projectId,
      input.threadId,
      true,
    );
    if (!thread) {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "ai_thread_access_denied",
          entityType: "ai_thread",
          entityId: input.threadId,
          result: "denied",
          metadata: { reason: "not_authorized_or_not_found" },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return {
        error: new ProjectAssistantError(
          404,
          "AI_THREAD_NOT_FOUND",
          "对话不存在",
        ),
      } as const;
    }
    if (thread.status === "active") {
      await tx
        .update(aiThread)
        .set({
          status: "archived",
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiThread.id, thread.id));
    }
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "ai_thread_archived",
        entityType: "ai_thread",
        entityId: thread.id,
        result: "succeeded",
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return { ok: true } as const;
  });
  if ("error" in result) throw result.error;
}

type Reservation = {
  execution: AiExecutionRecord;
  replayed: boolean;
};

export async function reserveAssistantExecution(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
  question: string;
  modelProfileId: string;
  idempotencyKey: string;
  executionStaleAfterMs: number;
  retrievalProfileId: string;
  retrievalMode: AiRetrievalMode;
  sourceSelectionDigest: string;
}): Promise<Reservation> {
  const scope = [
    input.projectId,
    input.principal.user.id,
    input.threadId,
    input.idempotencyKey,
  ].join(":");
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
    );
    try {
      await requireProjectAccess(
        input.principal,
        input.projectId,
        input.requestHeaders,
        { db: tx, lockForUpdate: true },
      );
    } catch (error) {
      if (error instanceof AuthorizationError) return { error } as const;
      throw error;
    }
    const thread = await ownedThread(
      tx,
      input.principal,
      input.projectId,
      input.threadId,
      true,
    );
    if (!thread || thread.status !== "active") {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "ai_thread_access_denied",
          entityType: "ai_thread",
          entityId: input.threadId,
          result: "denied",
          metadata: { reason: "not_authorized_or_not_found" },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return {
        error: new ProjectAssistantError(
          404,
          "AI_THREAD_NOT_FOUND",
          "对话不存在",
        ),
      } as const;
    }

    const incomingQuestionHash = questionHash(input.question);
    const [existing] = await tx
      .select()
      .from(aiExecution)
      .where(
        and(
          eq(aiExecution.projectId, input.projectId),
          eq(aiExecution.actorUserId, input.principal.user.id),
          eq(aiExecution.threadId, input.threadId),
          eq(aiExecution.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      const modelProfileMatched =
        existing.modelProfileId === input.modelProfileId;
      const retrievalProfileMatched =
        existing.retrievalProfileId === input.retrievalProfileId;
      const sourceSelectionMatched =
        existing.sourceSelectionDigest === input.sourceSelectionDigest;
      if (
        existing.questionSha256 !== incomingQuestionHash ||
        !modelProfileMatched ||
        !retrievalProfileMatched ||
        !sourceSelectionMatched
      ) {
        await writeAuditEvent(
          {
            actorUserId: input.principal.user.id,
            projectId: input.projectId,
            eventType: "ai_execution_idempotency_conflict",
            entityType: "ai_execution",
            entityId: existing.id,
            result: "denied",
            metadata: {
              existingExecutionId: existing.id,
              existingQuestionHash: existing.questionSha256,
              incomingQuestionHash,
              modelProfileMatched,
              retrievalProfileMatched,
              sourceSelectionMatched,
            },
            ...getRequestAuditContext(input.requestHeaders),
          },
          tx,
        );
        return {
          error: new ProjectAssistantError(
            409,
            "AI_IDEMPOTENCY_CONFLICT",
            "Idempotency-Key 已用于不同请求",
          ),
        } as const;
      }
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "ai_execution_replayed",
          entityType: "ai_execution",
          entityId: existing.id,
          result: "succeeded",
          metadata: { executionStatus: existing.status },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return { execution: existing, replayed: true } as const;
    }
    await requireProjectAssistantProfile(tx, input.modelProfileId);

    const minuteBoundary = new Date(Date.now() - 60_000);
    const dayBoundary = new Date();
    dayBoundary.setUTCHours(0, 0, 0, 0);
    const [rateRow] = await tx
      .select({ value: count(aiExecution.id).mapWith(Number) })
      .from(aiExecution)
      .where(
        and(
          eq(aiExecution.actorUserId, input.principal.user.id),
          sql`${aiExecution.createdAt} >= ${minuteBoundary}`,
        ),
      );
    let limitCode:
      | "AI_RATE_LIMITED"
      | "AI_USER_DAILY_LIMIT_REACHED"
      | "AI_PROJECT_DAILY_LIMIT_REACHED"
      | "AI_CONCURRENCY_LIMIT_REACHED"
      | null =
      (rateRow?.value ?? 0) >= limits.perUserMinute
        ? "AI_RATE_LIMITED"
        : null;

    const dailyUsage = await tx.execute<{
      user_tokens: string | number;
      project_tokens: string | number;
    }>(sql`
      select
        coalesce(sum(total_token_count) filter (
          where actor_user_id = ${input.principal.user.id}
        ), 0) as user_tokens,
        coalesce(sum(total_token_count) filter (
          where project_id = ${input.projectId}
        ), 0) as project_tokens
      from ai_executions
      where created_at >= ${dayBoundary}
        and total_token_count is not null
    `);
    const usage = dailyUsage.rows[0];
    if (!limitCode && Number(usage?.user_tokens ?? 0) >= limits.userDailyTokens) {
      limitCode = "AI_USER_DAILY_LIMIT_REACHED";
    }
    if (
      !limitCode &&
      Number(usage?.project_tokens ?? 0) >= limits.projectDailyTokens
    ) {
      limitCode = "AI_PROJECT_DAILY_LIMIT_REACHED";
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('projectai-ai-global-concurrency', 0))`,
    );
    const staleBefore = new Date(Date.now() - input.executionStaleAfterMs);
    const staleExecutions = await tx
      .select()
      .from(aiExecution)
      .where(
        and(
          inArray(aiExecution.status, RUNNING_EXECUTION_STATUSES),
          sql`${aiExecution.startedAt} <= ${staleBefore}`,
        ),
      )
      .for("update", { of: aiExecution });
    const recoveredAt = new Date();
    for (const staleExecution of staleExecutions) {
      const [failedMessage] = await tx
        .update(aiMessage)
        .set({
          status: "failed",
          content: "上一次回答因服务中断未完成，请重新发送问题。",
        })
        .where(
          and(
            eq(aiMessage.id, staleExecution.assistantMessageId),
            eq(aiMessage.projectId, staleExecution.projectId),
            eq(aiMessage.threadId, staleExecution.threadId),
            eq(aiMessage.status, "pending"),
          ),
        )
        .returning({ id: aiMessage.id });
      if (!failedMessage) {
        throw new ProjectAssistantError(
          503,
          "AI_EXECUTION_FAILED",
          "AI 回答状态暂时不可用",
        );
      }
      await tx
        .update(aiExecution)
        .set({
          status: "failed",
          failureCode: "AI_EXECUTION_STALE",
          completedAt: recoveredAt,
        })
        .where(eq(aiExecution.id, staleExecution.id));
      const [staleRetrievalRun] = await tx
        .select()
        .from(aiRetrievalRun)
        .where(eq(aiRetrievalRun.aiExecutionId, staleExecution.id))
        .limit(1)
        .for("update", { of: aiRetrievalRun });
      if (staleRetrievalRun?.status === "running") {
        await tx
          .update(aiRetrievalQueryEmbeddingCall)
          .set({
            status: "unknown",
            dispatchClassification: "post_dispatch",
            failureCode: "PROVIDER_RESULT_UNKNOWN",
            completedAt: recoveredAt,
            updatedAt: recoveredAt,
          })
          .where(
            and(
              eq(
                aiRetrievalQueryEmbeddingCall.retrievalRunId,
                staleRetrievalRun.id,
              ),
              eq(aiRetrievalQueryEmbeddingCall.status, "calling"),
            ),
          );
        await tx
          .update(aiRetrievalQueryEmbeddingCall)
          .set({
            status: "failed_confirmed_no_charge",
            dispatchClassification: "pre_dispatch",
            failureCode: "QUERY_EMBEDDING_STALE_PRE_DISPATCH",
            completedAt: recoveredAt,
            updatedAt: recoveredAt,
          })
          .where(
            and(
              eq(
                aiRetrievalQueryEmbeddingCall.retrievalRunId,
                staleRetrievalRun.id,
              ),
              eq(aiRetrievalQueryEmbeddingCall.status, "reserved"),
            ),
          );
        await tx
          .update(aiRetrievalRun)
          .set({
            status: "failed",
            effectiveMode: "lexical",
            fallbackReason: "RETRIEVAL_STALE",
            totalLatencyMs: Math.max(
              0,
              recoveredAt.getTime() - staleRetrievalRun.startedAt.getTime(),
            ),
            completedAt: recoveredAt,
          })
          .where(eq(aiRetrievalRun.id, staleRetrievalRun.id));
        await tx
          .update(aiExecution)
          .set({
            retrievalRunId: staleRetrievalRun.id,
            effectiveRetrievalMode: "lexical",
            retrievalFallbackReason: "RETRIEVAL_STALE",
          })
          .where(eq(aiExecution.id, staleExecution.id));
      }
      await tx
        .update(aiThread)
        .set({ updatedAt: recoveredAt })
        .where(
          and(
            eq(aiThread.id, staleExecution.threadId),
            eq(aiThread.projectId, staleExecution.projectId),
            eq(aiThread.createdBy, staleExecution.actorUserId),
          ),
        );
      await writeAuditEvent(
        {
          actorUserId: staleExecution.actorUserId,
          projectId: staleExecution.projectId,
          eventType: "ai_execution_stale_recovered",
          entityType: "ai_execution",
          entityId: staleExecution.id,
          result: "succeeded",
          metadata: {
            previousStatus: staleExecution.status,
            staleAfterMs: input.executionStaleAfterMs,
          },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
    }
    const [concurrency] = await tx
      .select({ value: count(aiExecution.id).mapWith(Number) })
      .from(aiExecution)
      .where(inArray(aiExecution.status, RUNNING_EXECUTION_STATUSES));
    if (
      !limitCode &&
      (concurrency?.value ?? 0) >= limits.globalConcurrent
    ) {
      limitCode = "AI_CONCURRENCY_LIMIT_REACHED";
    }
    if (limitCode) {
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "ai_execution_rate_limited",
          entityType: "ai_thread",
          entityId: input.threadId,
          result: "denied",
          metadata: { failureCode: limitCode },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return { error: assistantErrorForLimit(limitCode) } as const;
    }

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    await tx.insert(aiMessage).values([
      {
        id: userMessageId,
        projectId: input.projectId,
        threadId: input.threadId,
        createdBy: input.principal.user.id,
        role: "user",
        status: "completed",
        content: input.question,
      },
      {
        id: assistantMessageId,
        projectId: input.projectId,
        threadId: input.threadId,
        createdBy: input.principal.user.id,
        role: "assistant",
        status: "pending",
        content: "",
      },
    ]);
    const [execution] = await tx
      .insert(aiExecution)
      .values({
        id: executionId,
        projectId: input.projectId,
        threadId: input.threadId,
        userMessageId,
        assistantMessageId,
        actorUserId: input.principal.user.id,
        modelProfileId: input.modelProfileId,
        provider: "qwen",
        requestedModel: PROJECT_ASSISTANT_PRIMARY_MODEL,
        status: "reserved",
        promptVersion: PROJECT_ASSISTANT_PROMPT_VERSION,
        retrievalVersion: PROJECT_ASSISTANT_RETRIEVAL_VERSION,
        requestedRetrievalMode: input.retrievalMode,
        retrievalProfileId: input.retrievalProfileId,
        gatewayVersion: AI_GATEWAY_VERSION,
        questionSha256: incomingQuestionHash,
        sourceSelectionDigest: input.sourceSelectionDigest,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    await tx
      .update(aiMessage)
      .set({ executionId })
      .where(inArray(aiMessage.id, [userMessageId, assistantMessageId]));
    await tx
      .update(aiThread)
      .set({
        title:
          thread.title === "新对话" ? titleFrom(input.question) : thread.title,
        updatedAt: new Date(),
      })
      .where(eq(aiThread.id, thread.id));
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "ai_execution_reserved",
        entityType: "ai_execution",
        entityId: execution.id,
        result: "succeeded",
        metadata: {
          questionHash: execution.questionSha256,
          questionLength: input.question.length,
          modelProfileId: input.modelProfileId,
          retrievalProfileId: input.retrievalProfileId,
          requestedRetrievalMode: input.retrievalMode,
          sourceSelectionDigest: input.sourceSelectionDigest,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
    return { execution, replayed: false } as const;
  });
  if ("error" in result) throw result.error;
  return result;
}

export async function updateExecutionPhase(
  executionId: string,
  status: "retrieving" | "calling_provider" | "validating",
): Promise<void> {
  await getDb()
    .update(aiExecution)
    .set({ status })
    .where(
      and(
        eq(aiExecution.id, executionId),
        inArray(aiExecution.status, RUNNING_EXECUTION_STATUSES),
      ),
    );
}

export async function loadConversationHistory(input: {
  projectId: string;
  threadId: string;
  actorUserId: string;
  excludeMessageId: string;
}): Promise<ProjectAssistantHistoryMessage[]> {
  const rows = await getDb()
    .select({
      role: aiMessage.role,
      content: aiMessage.content,
      createdAt: aiMessage.createdAt,
    })
    .from(aiMessage)
    .where(
      and(
        eq(aiMessage.projectId, input.projectId),
        eq(aiMessage.threadId, input.threadId),
        eq(aiMessage.createdBy, input.actorUserId),
        ne(aiMessage.id, input.excludeMessageId),
        inArray(aiMessage.status, ["completed", "insufficient_evidence"]),
      ),
    )
    .orderBy(desc(aiMessage.createdAt), desc(aiMessage.id))
    .limit(20);
  const selected: ProjectAssistantHistoryMessage[] = [];
  let characters = 0;
  for (const row of rows) {
    if (selected.length >= 6) break;
    const remaining = 12_000 - characters;
    if (remaining <= 0) break;
    const content = row.content.slice(-remaining);
    if (!content) continue;
    selected.push({ role: row.role, content });
    characters += content.length;
  }
  return selected.reverse();
}

export async function finalizeInsufficientEvidence(input: {
  execution: AiExecutionRecord;
  requestHeaders: Headers;
}): Promise<void> {
  const completedAt = new Date();
  await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(aiExecution)
      .where(eq(aiExecution.id, input.execution.id))
      .limit(1)
      .for("update", { of: aiExecution });
    if (!locked || !RUNNING_EXECUTION_STATUSES.includes(locked.status as never)) {
      return;
    }
    await tx
      .update(aiMessage)
      .set({
        status: "insufficient_evidence",
        content: "现有项目资料中没有足够信息支持明确结论。",
      })
      .where(eq(aiMessage.id, locked.assistantMessageId));
    await tx
      .update(aiExecution)
      .set({
        status: "insufficient_evidence",
        evidenceCount: 0,
        completedAt,
        failureCode: null,
      })
      .where(eq(aiExecution.id, locked.id));
    await tx
      .update(aiThread)
      .set({ updatedAt: completedAt })
      .where(eq(aiThread.id, locked.threadId));
    await writeAuditEvent(
      {
        actorUserId: locked.actorUserId,
        projectId: locked.projectId,
        eventType: "ai_execution_insufficient_evidence",
        entityType: "ai_execution",
        entityId: locked.id,
        result: "succeeded",
        metadata: { evidenceCount: 0 },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
  });
}

export async function finalizeSuccessfulExecution(input: {
  execution: AiExecutionRecord;
  answer: ValidatedGroundedAnswer;
  gateway: AiGatewayResult;
  evidenceCount: number;
  requestHeaders: Headers;
}): Promise<void> {
  const completedAt = new Date();
  await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(aiExecution)
      .where(eq(aiExecution.id, input.execution.id))
      .limit(1)
      .for("update", { of: aiExecution });
    if (!locked || !RUNNING_EXECUTION_STATUSES.includes(locked.status as never)) {
      return;
    }
    const expectedDocumentIds = [
      ...new Set(input.answer.citations.map(({ evidence }) => evidence.documentId)),
    ];
    const authorizedResult = await tx.execute<{ document_id: string }>(sql`
      select document_id
      from projectai_authorized_documents(
        ${locked.actorUserId},
        ${locked.projectId},
        'view'::knowledge_permission
      )
      where document_id in (${sql.join(
        expectedDocumentIds.map((documentId) => sql`${documentId}`),
        sql`, `,
      )})
    `);
    if (authorizedResult.rows.length !== expectedDocumentIds.length) {
      throw new ProjectAssistantError(
        409,
        "AI_CITATION_VALIDATION_FAILED",
        "来源权限已变化，请重新提问",
      );
    }
    await tx
      .update(aiMessage)
      .set({ status: "completed", content: input.answer.text })
      .where(eq(aiMessage.id, locked.assistantMessageId));
    await tx.insert(aiMessageCitation).values(
      input.answer.citations.map(({ index, evidence }) => ({
        id: crypto.randomUUID(),
        projectId: locked.projectId,
        threadId: locked.threadId,
        assistantMessageId: locked.assistantMessageId,
        citationIndex: index,
        evidenceLabel: evidence.label,
        chunkId: evidence.chunkId,
        documentId: evidence.documentId,
        versionId: evidence.versionId,
        displayName: evidence.displayName,
        versionNumber: evidence.versionNumber,
        mimeType: evidence.mimeType,
        headingPath: evidence.headingPath,
        sourceLocator: evidence.source,
        excerpt: evidence.content
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 900),
        contentSha256: evidence.contentSha256,
        retrievalScore: evidence.score,
      })),
    );
    await tx
      .update(aiExecution)
      .set({
        provider: input.gateway.provider,
        actualModel: input.gateway.actualModel,
        fallbackUsed: input.gateway.fallbackUsed,
        status: "succeeded",
        evidenceCount: input.evidenceCount,
        inputTokenCount: input.gateway.inputTokens,
        outputTokenCount: input.gateway.outputTokens,
        totalTokenCount: input.gateway.totalTokens,
        latencyMs: input.gateway.latencyMs,
        providerRequestId: input.gateway.providerRequestId,
        failureCode: null,
        completedAt,
      })
      .where(eq(aiExecution.id, locked.id));
    await tx
      .update(aiThread)
      .set({ updatedAt: completedAt })
      .where(eq(aiThread.id, locked.threadId));
    await writeAuditEvent(
      {
        actorUserId: locked.actorUserId,
        projectId: locked.projectId,
        eventType: "ai_execution_succeeded",
        entityType: "ai_execution",
        entityId: locked.id,
        result: "succeeded",
        metadata: {
          modelProfileId: locked.modelProfileId,
          provider: input.gateway.provider,
          requestedModel: locked.requestedModel,
          actualModel: input.gateway.actualModel,
          fallbackUsed: input.gateway.fallbackUsed,
          evidenceCount: input.evidenceCount,
          inputTokenCount: input.gateway.inputTokens,
          outputTokenCount: input.gateway.outputTokens,
          totalTokenCount: input.gateway.totalTokens,
          latencyMs: input.gateway.latencyMs,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
  });
}

export async function finalizeFailedExecution(input: {
  executionId: string;
  failureCode: string;
  gateway: AiGatewayResult | null;
  evidenceCount: number;
  requestHeaders: Headers;
}): Promise<void> {
  const completedAt = new Date();
  await getDb().transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(aiExecution)
      .where(eq(aiExecution.id, input.executionId))
      .limit(1)
      .for("update", { of: aiExecution });
    if (!locked || !RUNNING_EXECUTION_STATUSES.includes(locked.status as never)) {
      return;
    }
    await tx
      .update(aiMessage)
      .set({
        status: "failed",
        content: "回答生成失败，请使用新的请求重试。",
      })
      .where(eq(aiMessage.id, locked.assistantMessageId));
    await tx
      .update(aiExecution)
      .set({
        provider: input.gateway?.provider ?? locked.provider,
        actualModel: input.gateway?.actualModel ?? locked.actualModel,
        fallbackUsed: input.gateway?.fallbackUsed ?? locked.fallbackUsed,
        status: "failed",
        evidenceCount: input.evidenceCount,
        inputTokenCount: input.gateway
          ? input.gateway.inputTokens
          : locked.inputTokenCount,
        outputTokenCount: input.gateway
          ? input.gateway.outputTokens
          : locked.outputTokenCount,
        totalTokenCount: input.gateway
          ? input.gateway.totalTokens
          : locked.totalTokenCount,
        latencyMs: input.gateway?.latencyMs ?? locked.latencyMs,
        providerRequestId:
          input.gateway?.providerRequestId ?? locked.providerRequestId,
        failureCode: input.failureCode.slice(0, 80),
        completedAt,
      })
      .where(eq(aiExecution.id, locked.id));
    await tx
      .update(aiThread)
      .set({ updatedAt: completedAt })
      .where(eq(aiThread.id, locked.threadId));
    await writeAuditEvent(
      {
        actorUserId: locked.actorUserId,
        projectId: locked.projectId,
        eventType: "ai_execution_failed",
        entityType: "ai_execution",
        entityId: locked.id,
        result: "failed",
        metadata: {
          failureCode: input.failureCode,
          provider: input.gateway?.provider ?? locked.provider,
          actualModel: input.gateway?.actualModel ?? locked.actualModel,
          fallbackUsed: input.gateway?.fallbackUsed ?? locked.fallbackUsed,
          evidenceCount: input.evidenceCount,
          inputTokenCount: input.gateway?.inputTokens ?? null,
          outputTokenCount: input.gateway?.outputTokens ?? null,
          totalTokenCount: input.gateway?.totalTokens ?? null,
          latencyMs: input.gateway?.latencyMs ?? null,
        },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
  });
}

export async function responseForExecution(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  execution: AiExecutionRecord;
  replayed: boolean;
}): Promise<ProjectAssistantMessageResponse> {
  const thread = await loadOwnedThread({
    principal: input.principal,
    projectId: input.projectId,
    threadId: input.execution.threadId,
  });
  const userMessage = thread.messages.find(
    (message) => message.id === input.execution.userMessageId,
  );
  const assistantMessage = thread.messages.find(
    (message) => message.id === input.execution.assistantMessageId,
  );
  if (!userMessage || !assistantMessage) {
    throw new ProjectAssistantError(
      503,
      "AI_EXECUTION_FAILED",
      "AI 回答状态暂时不可用",
    );
  }
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      status: thread.status,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      messageCount: thread.messageCount,
    },
    userMessage,
    assistantMessage,
    execution: {
      id: input.execution.id,
      status: input.execution.status,
      replayed: input.replayed,
      fallbackUsed: input.execution.fallbackUsed,
    },
  };
}

export async function refreshedExecution(
  executionId: string,
): Promise<AiExecutionRecord> {
  const [execution] = await getDb()
    .select()
    .from(aiExecution)
    .where(eq(aiExecution.id, executionId))
    .limit(1);
  if (!execution) {
    throw new ProjectAssistantError(
      503,
      "AI_EXECUTION_FAILED",
      "AI 回答状态暂时不可用",
    );
  }
  return execution;
}
