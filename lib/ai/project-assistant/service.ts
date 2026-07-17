import { z } from "zod";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { retrieveProjectEvidence } from "@/lib/documents/processing/search-service";
import type {
  ProjectAssistantMessageResponse,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
} from "@/types/project-assistant";
import {
  PROJECT_ASSISTANT_PROFILE_ID,
  requireAiAssistantEnabled,
} from "./config";
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
    modelProfileId: z.literal(PROJECT_ASSISTANT_PROFILE_ID),
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
  const parsed = questionSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new ProjectAssistantError(
      400,
      "AI_INVALID_REQUEST",
      "问题或模型配置无效",
    );
  }
  const reservation = await reserveAssistantExecution({
    principal: input.principal,
    projectId: input.projectId,
    threadId: input.threadId,
    requestHeaders: input.requestHeaders,
    question: parsed.data.question,
    modelProfileId: parsed.data.modelProfileId,
    idempotencyKey: idempotencyKey(input.idempotencyKey),
  });
  if (reservation.replayed) {
    return responseForExecution({
      principal: input.principal,
      projectId: input.projectId,
      execution: reservation.execution,
      replayed: true,
    });
  }

  try {
    await updateExecutionPhase(reservation.execution.id, "retrieving");
    const [history, evidence] = await Promise.all([
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
        candidateLimit: 30,
        evidenceLimit: 10,
        maxChars: 24_000,
      }),
    ]);
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
    let gatewayResult = await gateway.generate({
      purpose: "answer",
      systemPrompt: PROJECT_ASSISTANT_SYSTEM_PROMPT,
      userPrompt: buildGroundedUserPrompt({
        question: parsed.data.question,
        history,
        evidence,
      }),
    });
    await updateExecutionPhase(reservation.execution.id, "validating");
    let validated = validateAndMapCitations(gatewayResult.text, evidence);
    if (!validated) {
      const repaired = await gateway.generate({
        purpose: "repair",
        systemPrompt: PROJECT_ASSISTANT_SYSTEM_PROMPT,
        userPrompt: buildCitationRepairPrompt({
          answer: gatewayResult.text,
          evidence,
        }),
      });
      gatewayResult = combinedGatewayResult(gatewayResult, repaired);
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
      gateway: gatewayResult,
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
      requestHeaders: input.requestHeaders,
    }).catch(() => undefined);
    throw controlled;
  }
}
