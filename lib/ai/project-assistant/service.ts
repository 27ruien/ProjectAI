import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import {
  getHybridRetrievalRuntimeConfig,
  finalizeFailedRetrievalRunForExecution,
  retrieveProjectEvidence,
  retrieveAuthorizedAssistantEvidence,
} from "@/lib/ai/retrieval";
import { resolveAssistantContextReferences } from "./context";
import type { AssistantContextReference } from "@/types/project-assistant";
import type {
  ProjectAssistantMessageResponse,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
} from "@/types/project-assistant";
import { requireAiAssistantEnabled } from "./config";
import { resolveGenerationScenario } from "@/lib/ai/model-management";
import {
  buildGeneralUserPrompt,
  buildCitationRepairPrompt,
  buildGroundedUserPrompt,
  GENERAL_ASSISTANT_SYSTEM_PROMPT,
  PROJECT_ASSISTANT_SYSTEM_PROMPT,
} from "./grounding";
import { validateAndMapCitations } from "./citations";
import { createProjectAssistantGateway, type AiGatewayResult } from "./gateway";
import { ProjectAssistantError } from "./errors";
import { classifyAssistantIntent } from "./intent-router";
import {
  archiveOwnedThread,
  deleteOwnedThread,
  createOwnedThread,
  finalizeGeneralSuccessfulExecution,
  finalizeFailedExecution,
  finalizeInsufficientEvidence,
  finalizeSuccessfulExecution,
  listOwnedThreadSummaries,
  loadConversationHistory,
  loadOwnedThread,
  refreshedExecution,
  reserveAssistantExecution,
  responseForExecution,
  resolveGeneralChatProjectId,
  getOwnedThreadGenerationModel,
  setOwnedThreadGenerationModel,
  updateExecutionPhase,
} from "./repository";
import { listEnabledGenerationModels } from "@/lib/ai/model-management";

const questionSchema = z
  .object({
    question: z.string().trim().min(2).max(2_000),
    modelProfileId: z.string().trim().min(1).max(120),
    sourceDocumentIds: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
    contextReferences: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("project"), projectId: z.string().min(1).max(200), label: z.string().min(1).max(200) }),
      z.object({ type: z.literal("document"), documentId: z.string().min(1).max(200), documentVersionId: z.string().min(1).max(200).optional(), sourceType: z.enum(["project", "company"]), label: z.string().min(1).max(200) }),
    ])).max(20).optional().default([]),
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

export async function deleteProjectAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  threadId: string;
  requestHeaders: Headers;
}): Promise<void> {
  requireAiAssistantEnabled();
  await deleteOwnedThread(input);
}

export async function createGeneralAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadDto> {
  requireAiAssistantEnabled();
  const projectId = await resolveGeneralChatProjectId(input.principal);
  const thread = await createOwnedThread({ ...input, projectId, scope: "general" });
  return loadOwnedThread({ ...input, projectId, threadId: thread.id, scope: "general" });
}

export async function listGeneralAssistantThreads(input: {
  principal: AuthenticatedPrincipal;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadSummaryDto[]> {
  requireAiAssistantEnabled();
  const projectId = await resolveGeneralChatProjectId(input.principal);
  return listOwnedThreadSummaries({ ...input, projectId, scope: "general" });
}

export async function getGeneralAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  threadId: string;
  requestHeaders: Headers;
}): Promise<ProjectAssistantThreadDto> {
  requireAiAssistantEnabled();
  const projectId = await resolveGeneralChatProjectId(input.principal);
  return loadOwnedThread({ ...input, projectId, scope: "general" });
}

export async function archiveGeneralAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  threadId: string;
  requestHeaders: Headers;
}): Promise<void> {
  requireAiAssistantEnabled();
  const projectId = await resolveGeneralChatProjectId(input.principal);
  await archiveOwnedThread({ ...input, projectId, scope: "general" });
}

export async function listGeneralAssistantModels(input: { principal: AuthenticatedPrincipal }) {
  if (input.principal.user.productRole !== "super_admin") return [];
  const projectId = await resolveGeneralChatProjectId(input.principal);
  return listEnabledGenerationModels({ projectId, actorId: input.principal.user.id });
}

export async function setGeneralAssistantThreadModel(input: { principal: AuthenticatedPrincipal; threadId: string; generationModelId: string | null; requestHeaders: Headers }) {
  const projectId = await resolveGeneralChatProjectId(input.principal);
  if (input.generationModelId) {
    const available = await listEnabledGenerationModels({ projectId, actorId: input.principal.user.id });
    if (!available.some((item) => item.id === input.generationModelId)) throw new ProjectAssistantError(404, "AI_MODEL_PROFILE_NOT_FOUND", "模型不存在或不可用");
  }
  await setOwnedThreadGenerationModel({ ...input, projectId, scope: "general" });
}

export async function deleteGeneralAssistantThread(input: {
  principal: AuthenticatedPrincipal;
  threadId: string;
  requestHeaders: Headers;
}): Promise<void> {
  requireAiAssistantEnabled();
  const projectId = await resolveGeneralChatProjectId(input.principal);
  await deleteOwnedThread({ ...input, projectId, scope: "general" });
}

export async function askGeneralAssistant(input: {
  principal: AuthenticatedPrincipal;
  threadId: string;
  requestHeaders: Headers;
  idempotencyKey: string | null;
  body: unknown;
}): Promise<ProjectAssistantMessageResponse> {
  const config = requireAiAssistantEnabled();
  const retrievalConfig = getHybridRetrievalRuntimeConfig();
  const parsed = questionSchema.safeParse(input.body);
  if (!parsed.success || parsed.data.sourceDocumentIds.length > 0) {
    throw new ProjectAssistantError(400, "AI_INVALID_REQUEST", "通用会话请求无效");
  }
  const projectId = await resolveGeneralChatProjectId(input.principal);
  const context = await resolveAssistantContextReferences({
    principal: input.principal,
    references: parsed.data.contextReferences as AssistantContextReference[],
  });
  const intent = classifyAssistantIntent({ question: parsed.data.question });
  const reservation = await reserveAssistantExecution({
    principal: input.principal,
    projectId,
    threadId: input.threadId,
    requestHeaders: input.requestHeaders,
    question: parsed.data.question,
    modelProfileId: parsed.data.modelProfileId,
    idempotencyKey: idempotencyKey(input.idempotencyKey),
    executionStaleAfterMs: config.executionStaleAfterMs,
    retrievalProfileId: retrievalConfig.profileId,
    retrievalMode: retrievalConfig.mode,
    sourceSelectionDigest: createHash("sha256").update(JSON.stringify(context.references)).digest("hex"),
    contextReferences: context.references,
    scope: "general",
  });
  if (reservation.replayed) {
    return responseForExecution({
      principal: input.principal,
      projectId,
      execution: reservation.execution,
      replayed: true,
      scope: "general",
    });
  }
  let consumedGatewayResult: AiGatewayResult | null = null;
  try {
    const generationModelId = await getOwnedThreadGenerationModel({ principal: input.principal, projectId, threadId: input.threadId, scope: "general" });
    const history = await loadConversationHistory({
      projectId,
      threadId: input.threadId,
      actorUserId: input.principal.user.id,
      excludeMessageId: reservation.execution.userMessageId,
    });
    if (intent === "general_chat" || intent === "artifact_request") {
      const scenario = await resolveGenerationScenario({
      projectId,
      actorId: input.principal.user.id,
      scenario: "general_chat",
      generationModelId,
      });
      const gateway = createProjectAssistantGateway(scenario.runtime);
      await updateExecutionPhase(reservation.execution.id, "calling_provider");
      consumedGatewayResult = await gateway.generate({
      purpose: "answer",
      model: scenario.modelId,
      systemPrompt: GENERAL_ASSISTANT_SYSTEM_PROMPT,
      userPrompt: buildGeneralUserPrompt({ question: parsed.data.question, history }),
      });
      const answer = consumedGatewayResult.text.trim();
      if (!answer) {
      throw new ProjectAssistantError(502, "AI_EXECUTION_FAILED", "AI 返回了空回答");
      }
      const disclosure = "本回答未使用项目或公司资料。";
      await finalizeGeneralSuccessfulExecution({
      execution: reservation.execution,
      answer: answer.includes(disclosure) ? answer : `${answer}\n\n${disclosure}`,
      gateway: consumedGatewayResult,
      requestHeaders: input.requestHeaders,
      });
      const execution = await refreshedExecution(reservation.execution.id);
      return responseForExecution({
      principal: input.principal,
      projectId,
      execution,
      replayed: false,
      scope: "general",
      });
    }
    await updateExecutionPhase(reservation.execution.id, "retrieving");
    const retrieval = await retrieveAuthorizedAssistantEvidence({
      principal: input.principal,
      projectIds: context.projectIds,
      sourceDocumentIds: context.documentIds,
      query: parsed.data.question,
      mode: retrievalConfig.mode,
      retrievalProfileId: retrievalConfig.profileId,
      execution: reservation.execution,
    });
    if (retrieval.evidence.length === 0) {
      await finalizeInsufficientEvidence({ execution: reservation.execution, requestHeaders: input.requestHeaders });
      return responseForExecution({
        principal: input.principal, projectId,
        execution: await refreshedExecution(reservation.execution.id), replayed: false, scope: "general",
      });
    }
    const scenario = await resolveGenerationScenario({ projectId, actorId: input.principal.user.id, scenario: "project_grounded_chat", generationModelId });
    const gateway = createProjectAssistantGateway(scenario.runtime);
    await updateExecutionPhase(reservation.execution.id, "calling_provider");
    consumedGatewayResult = await gateway.generate({
      purpose: "answer", model: scenario.modelId, systemPrompt: PROJECT_ASSISTANT_SYSTEM_PROMPT,
      userPrompt: buildGroundedUserPrompt({ question: parsed.data.question, history, evidence: retrieval.evidence }),
    });
    await updateExecutionPhase(reservation.execution.id, "validating");
    const validated = validateAndMapCitations(consumedGatewayResult.text, retrieval.evidence);
    if (!validated) throw new ProjectAssistantError(502, "AI_CITATION_VALIDATION_FAILED", "AI 回答未通过来源校验，请重试");
    await finalizeSuccessfulExecution({ execution: reservation.execution, answer: validated, gateway: consumedGatewayResult, evidenceCount: retrieval.evidence.length, requestHeaders: input.requestHeaders });
    return responseForExecution({ principal: input.principal, projectId, execution: await refreshedExecution(reservation.execution.id), replayed: false, scope: "general" });
  } catch (error) {
    const controlled = error instanceof ProjectAssistantError
      ? error
      : new ProjectAssistantError(503, "AI_EXECUTION_FAILED", "AI 回答暂时不可用，请稍后重试");
    await finalizeFailedExecution({
      executionId: reservation.execution.id,
      failureCode: controlled.code,
      gateway: consumedGatewayResult,
      evidenceCount: 0,
      requestHeaders: input.requestHeaders,
    }).catch(() => undefined);
    throw controlled;
  }
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
  const intent = classifyAssistantIntent({
    question: parsed.data.question,
    hasAssociatedProject: true,
  });
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

  // A linked project is available as context, not a mandatory retrieval gate.
  // General drafting, translation, and brainstorming still use the text model
  // directly and never claim that project facts were read.
  if (intent === "general_chat") {
    let gatewayResult: AiGatewayResult | null = null;
    try {
      const [history, scenario] = await Promise.all([
        loadConversationHistory({
          projectId: input.projectId,
          threadId: input.threadId,
          actorUserId: input.principal.user.id,
          excludeMessageId: reservation.execution.userMessageId,
        }),
        resolveGenerationScenario({
          projectId: input.projectId,
          actorId: input.principal.user.id,
          scenario: "general_chat",
        }),
      ]);
      const gateway = createProjectAssistantGateway(scenario.runtime);
      await updateExecutionPhase(reservation.execution.id, "calling_provider");
      gatewayResult = await gateway.generate({
        purpose: "answer",
        model: scenario.modelId,
        systemPrompt: GENERAL_ASSISTANT_SYSTEM_PROMPT,
        userPrompt: buildGeneralUserPrompt({ question: parsed.data.question, history }),
      });
      const disclosure = "本回答未使用项目或公司资料。";
      const answer = gatewayResult.text.trim();
      if (!answer) throw new ProjectAssistantError(502, "AI_EXECUTION_FAILED", "AI 返回了空回答");
      await finalizeGeneralSuccessfulExecution({
        execution: reservation.execution,
        answer: answer.includes(disclosure) ? answer : `${answer}\n\n${disclosure}`,
        gateway: gatewayResult,
        requestHeaders: input.requestHeaders,
      });
      return responseForExecution({
        principal: input.principal,
        projectId: input.projectId,
        execution: await refreshedExecution(reservation.execution.id),
        replayed: false,
      });
    } catch (error) {
      const controlled = error instanceof ProjectAssistantError
        ? error
        : new ProjectAssistantError(503, "AI_EXECUTION_FAILED", "AI 回答暂时不可用，请稍后重试");
      await finalizeFailedExecution({
        executionId: reservation.execution.id,
        failureCode: controlled.code,
        gateway: gatewayResult,
        evidenceCount: 0,
        requestHeaders: input.requestHeaders,
      }).catch(() => undefined);
      throw controlled;
    }
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

    const scenario = await resolveGenerationScenario({
      projectId: input.projectId,
      actorId: input.principal.user.id,
      scenario: "project_grounded_chat",
    });
    const gateway = createProjectAssistantGateway(scenario.runtime);
    await updateExecutionPhase(reservation.execution.id, "calling_provider");
    consumedGatewayResult = await gateway.generate({
      purpose: "answer",
      model: scenario.modelId,
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
        model: scenario.modelId,
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
