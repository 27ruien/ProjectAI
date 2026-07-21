import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import {
  getHybridRetrievalRuntimeConfig,
  finalizeFailedRetrievalRunForExecution,
  retrieveProjectEvidence,
} from "@/lib/ai/retrieval";
import type {
  ProjectAssistantMessageResponse,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
} from "@/types/project-assistant";
import { requireAiAssistantEnabled } from "./config";
import {
  buildCitationRepairPrompt,
  buildGroundedUserPrompt,
  PROJECT_ASSISTANT_SYSTEM_PROMPT,
} from "./grounding";
import { validateAndMapCitations } from "./citations";
import { createProjectAssistantGateway, type AiGatewayResult } from "./gateway";
import { ProjectAssistantError } from "./errors";
import {
  archiveOwnedThread,
  createOwnedThread,
  finalizeFailedExecution,
  finalizeInsufficientEvidence,
  finalizeSuccessfulExecution,
  listOwnedThreadSummaries,
  loadConversationHistory,
  loadOwnedThread,
  refreshedExecution,
  reserveAssistantExecution,
  responseForExecution,
  updateExecutionPhase,
} from "./repository";

const questionSchema = z
  .object({
    question: z.string().trim().min(2).max(2_000),
    modelProfileId: z.string().trim().min(1).max(120),
    sourceDocumentIds: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
  })
  .strict();

function idempotencyKey(value: string | null): string {
  const key = value?.trim() || "";
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ProjectAssistantError(
      400,
      "AI_INVALID_REQUEST",
      "缺少有效的 Idempotency-Key",
    );
  }
  return key;
}

function combinedGatewayResult(
  first: AiGatewayResult,
  second: AiGatewayResult,
): AiGatewayResult {
  const add = (left: number | null, right: number | null) =>
    left === null || right === null ? null : left + right;
  return {
    provider: second.provider,
    requestedModel: first.requestedModel,
    actualModel: second.actualModel,
    fallbackUsed: first.fallbackUsed || second.fallbackUsed,
    text: second.text,
    inputTokens: add(first.inputTokens, second.inputTokens),
    outputTokens: add(first.outputTokens, second.outputTokens),
    totalTokens: add(first.totalTokens, second.totalTokens),
    providerRequestId: second.providerRequestId,
    latencyMs: first.latencyMs + second.latencyMs,
  };
}

export async function createProjectAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadDto> {
  requireAiAssistantEnabled();
  const thread = await createOwnedThread(input);
  return loadOwnedThread({
    ...input,
    threadId: thread.id,
  });
}

export async function listProjectAssistantThreads(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadSummaryDto[]> {
  requireAiAssistantEnabled();
  return listOwnedThreadSummaries(input);
}

export async function getProjectAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadDto> {
  requireAiAssistantEnabled();
  return loadOwnedThread(input);
}

export async function archiveProjectAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
}): Promise<void> {
  requireAiAssistantEnabled();
  await archiveOwnedThread(input);
}

export async function askProjectAssistant(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
  idempotencyKey: string | null;
  body: unknown;
}): Promise<ProjectAssistantMessageResponse> {
  const config = requireAiAssistantEnabled();
  const retrievalConfig = getHybridRetrievalRuntimeConfig();
  const parsed = questionSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new ProjectAssistantError(
      400,
      "AI_INVALID_REQUEST",
      "问题或模型配置无效",
    );
  }
  const selectedSourceIds = [...new Set(parsed.data.sourceDocumentIds)].sort();
  if (selectedSourceIds.length !== parsed.data.sourceDocumentIds.length) {
    throw new ProjectAssistantError(400, "AI_INVALID_REQUEST", "知识来源选择存在重复项");
  }
  if (selectedSourceIds.length) {
    const authorized = new Set(
      (
        await listAuthorizedDocumentScope({
          principal: input.principal,
          projectId: input.projectId,
          permission: "view",
        })
      ).map((item) => item.documentId),
    );
    if (selectedSourceIds.some((documentId) => !authorized.has(documentId))) {
      throw new ProjectAssistantError(404, "AI_SOURCE_NOT_FOUND", "知识来源不存在");
    }
  }
  const sourceSelectionDigest = createHash("sha256")
    .update(selectedSourceIds.join("\n"))
    .digest("hex");
  const reservation = await reserveAssistantExecution({
    principal: input.principal,
    projectId: input.projectId,
    threadId: input.threadId,
    requestHeaders: input.requestHeaders,
    question: parsed.data.question,
    modelProfileId: parsed.data.modelProfileId,
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    executionStaleAfterMs: config.executionStaleAfterMs,
    retrievalProfileId: retrievalConfig.profileId,
    retrievalMode: retrievalConfig.mode,
    sourceSelectionDigest,
  });
  if (reservation.replayed) {
    return responseForExecution({
      principal: input.principal,
      projectId: input.projectId,
      execution: reservation.execution,
      replayed: true,
    });
  }

  let consumedGatewayResult: AiGatewayResult | null = null;
  let evidenceCount = 0;
  try {
    await updateExecutionPhase(reservation.execution.id, "retrieving");
    const [history, retrieval] = await Promise.all([
      loadConversationHistory({
        projectId: input.projectId,
        threadId: input.threadId,
        actorUserId: input.principal.user.id,
        excludeMessageId: reservation.execution.userMessageId,
      }),
      retrieveProjectEvidence({
        principal: input.principal,
        projectId: input.projectId,
        requestHeaders: input.requestHeaders,
        query: parsed.data.question,
        mode: retrievalConfig.mode,
        retrievalProfileId: retrievalConfig.profileId,
        execution: reservation.execution,
        sourceDocumentIds: selectedSourceIds,
      }),
    ]);
    const evidence = retrieval.evidence;
    evidenceCount = evidence.length;
    if (evidence.length === 0) {
      await finalizeInsufficientEvidence({
        execution: reservation.execution,
        requestHeaders: input.requestHeaders,
      });
      const execution = await refreshedExecution(reservation.execution.id);
      return responseForExecution({
        principal: input.principal,
        projectId: input.projectId,
        execution,
        replayed: false,
      });
    }

    const gateway = createProjectAssistantGateway(config);
    await updateExecutionPhase(reservation.execution.id, "calling_provider");
    consumedGatewayResult = await gateway.generate({
      purpose: "answer",
      systemPrompt: PROJECT_ASSISTANT_SYSTEM_PROMPT,
      userPrompt: buildGroundedUserPrompt({
        question: parsed.data.question,
        history,
        evidence,
      }),
    });
    await updateExecutionPhase(reservation.execution.id, "validating");
    let validated = validateAndMapCitations(
      consumedGatewayResult.text,
      evidence,
    );
    if (!validated) {
      const repaired = await gateway.generate({
        purpose: "repair",
        systemPrompt: PROJECT_ASSISTANT_SYSTEM_PROMPT,
        userPrompt: buildCitationRepairPrompt({
          answer: consumedGatewayResult.text,
          evidence,
        }),
      });
      consumedGatewayResult = combinedGatewayResult(
        consumedGatewayResult,
        repaired,
      );
      validated = validateAndMapCitations(repaired.text, evidence);
    }
    if (!validated) {
      throw new ProjectAssistantError(
        502,
        "AI_CITATION_VALIDATION_FAILED",
        "AI 回答未通过来源校验，请重试",
      );
    }
    await finalizeSuccessfulExecution({
      execution: reservation.execution,
      answer: validated,
      gateway: consumedGatewayResult,
      evidenceCount: evidence.length,
      requestHeaders: input.requestHeaders,
    });
    const execution = await refreshedExecution(reservation.execution.id);
    return responseForExecution({
      principal: input.principal,
      projectId: input.projectId,
      execution,
      replayed: false,
    });
  } catch (error) {
    await finalizeFailedRetrievalRunForExecution(
      reservation.execution.id,
    ).catch(() => undefined);
    const controlled =
      error instanceof ProjectAssistantError
        ? error
        : new ProjectAssistantError(
            503,
            "AI_EXECUTION_FAILED",
            "AI 回答暂时不可用，请稍后重试",
          );
    await finalizeFailedExecution({
      executionId: reservation.execution.id,
      failureCode: controlled.code,
      gateway: consumedGatewayResult,
      evidenceCount,
      requestHeaders: input.requestHeaders,
    }).catch(() => undefined);
    throw controlled;
  }
}
