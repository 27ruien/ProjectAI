import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { createProjectAssistantGateway, ProjectAssistantError } from "@/lib/ai/project-assistant";
import { resolveGenerationScenario } from "@/lib/ai/model-management";
import { getDb } from "@/lib/db/client";
import { guidedRequirementOverview, guidedRequirementOverviewCitation, type RequirementOverviewItem, type RequirementOverviewQuestion } from "@/lib/db/schema";
import { ProjectManagementError } from "@/lib/project-management/errors";
import { collectRequirementEvidence, requirementSha256, syncRequirementSource, type RequirementEvidence } from "./requirement-documents";

export const REQUIREMENT_OVERVIEW_SKILL_ID = "generate_requirement_overview";
type OverviewStatus = "confirmed" | "user_confirmed" | "inferred" | "missing" | "conflict" | "not_applicable";
const updateSchema = z.object({ answers: z.array(z.object({ id: z.string().min(1).max(100), answer: z.string().max(5000), notApplicable: z.boolean().optional() })).max(50) }).strict();

function digest(evidence: RequirementEvidence[]) { return requirementSha256(evidence.map((item) => `${item.documentId}:${item.versionId}:${item.chunkId}:${item.contentSha256}`).join("\n")); }
function initialItems(evidence: RequirementEvidence[]): RequirementOverviewItem[] {
  const projectEvidence = evidence.filter((item) => item.sourceScope === "project");
  const first = projectEvidence[0];
  const labels = projectEvidence.map((item) => item.label);
  const text = first?.content.replace(/\s+/g, " ").trim().slice(0, 700) ?? "";
  return [
    { id: "project_background", label: "项目背景", status: first ? "confirmed" : "missing", value: text || "缺少可解析的项目背景资料。", citationLabels: first ? [first.label] : [] },
    { id: "goals", label: "目标与成功标准", status: labels.length ? "inferred" : "missing", value: labels.length ? "已从当前项目资料中预填，需项目经理确认成功标准。" : "缺少目标与成功标准。", citationLabels: labels.slice(0, 2) },
    { id: "scope", label: "范围与交付物", status: labels.length ? "inferred" : "missing", value: labels.length ? "已从项目资料提取候选范围，需确认边界与交付物。" : "缺少范围说明。", citationLabels: labels.slice(0, 2) },
    { id: "users", label: "用户与关键场景", status: "missing", value: "尚未确认关键用户、使用场景与优先级。", citationLabels: [] },
    { id: "dependencies", label: "依赖、风险与待确认事项", status: "missing", value: "尚未确认外部依赖、风险负责人和关键时间点。", citationLabels: [] },
  ];
}
function initialQuestions(items: RequirementOverviewItem[]): RequirementOverviewQuestion[] {
  return [
    { id: "goals", group: "目标与范围", prompt: "请确认项目目标、成功标准，以及不包含在本期范围内的内容。", required: true, answer: "", status: "pending", citationLabels: items.find((item) => item.id === "goals")?.citationLabels ?? [] },
    { id: "users", group: "用户与场景", prompt: "谁是主要用户？请列出最关键的使用场景和优先级。", required: true, answer: "", status: "pending", citationLabels: [] },
    { id: "acceptance", group: "交付与验收", prompt: "请确认交付物、验收人、验收标准和目标时间。", required: true, answer: "", status: "pending", citationLabels: [] },
    { id: "dependencies", group: "依赖与风险", prompt: "请确认外部依赖、已知风险、待决事项及负责人。", required: false, answer: "", status: "pending", citationLabels: [] },
  ];
}
function overviewMarkdown(projectName: string, overview: { versionNumber: number; items: RequirementOverviewItem[]; questions: RequirementOverviewQuestion[] }, modelSummary?: string) {
  const byStatus = (status: OverviewStatus) => overview.items.filter((item) => item.status === status);
  const section = (title: string, rows: RequirementOverviewItem[]) => [
    `## ${title}`, "", ...(rows.length ? rows.map((item) => `- **${item.label}**：${item.value}${item.citationLabels.length ? `（来源：${item.citationLabels.map((label) => `[${label}]`).join(" ")}）` : ""}`) : ["- 无"]), "",
  ];
  return [
    `# ${projectName} 需求概览`, "", `> ProjectAI 引导式需求概览 v${overview.versionNumber}。状态与来源均需由项目经理复核。`, "",
    ...section("已确认", byStatus("confirmed").concat(byStatus("user_confirmed"))),
    ...section("AI 推断（待确认）", byStatus("inferred")),
    ...section("信息缺口与冲突", byStatus("missing").concat(byStatus("conflict"))),
    "## 项目经理确认", "", ...overview.questions.map((question) => `- **${question.group} / ${question.prompt}**：${question.status === "not_applicable" ? "不适用" : question.answer || "待确认"}`), "",
    "## 结构化摘要", "", modelSummary?.trim() || "- 本概览基于当前有效资料和项目经理确认内容生成。", "",
  ].join("\n");
}
function statusFor(questions: RequirementOverviewQuestion[]) { return questions.some((question) => question.required && question.status === "pending") ? "needs_confirmation" : "ready" as const; }

export async function createRequirementOverview(input: { principal: AuthenticatedPrincipal; projectId: string; requestHeaders: Headers }) {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const evidence = await collectRequirementEvidence(input);
  const db = getDb();
  const [latest] = await db.select({ versionNumber: guidedRequirementOverview.versionNumber }).from(guidedRequirementOverview).where(eq(guidedRequirementOverview.projectId, input.projectId)).orderBy(desc(guidedRequirementOverview.versionNumber)).limit(1);
  const items = initialItems(evidence);
  const questions = initialQuestions(items);
  const id = crypto.randomUUID();
  const [overview] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(guidedRequirementOverview).values({ id, projectId: input.projectId, versionNumber: (latest?.versionNumber ?? 0) + 1, status: statusFor(questions), items, questions, sourceDigest: digest(evidence), sourceSnapshotAt: new Date(), createdBy: input.principal.user.id, updatedBy: input.principal.user.id }).returning();
    if (evidence.length) {
      await tx.insert(guidedRequirementOverviewCitation).values(evidence.map((item) => ({ id: crypto.randomUUID(), overviewId: id, label: item.label, documentId: item.documentId, versionId: item.versionId, chunkId: item.chunkId, sourceScope: item.sourceScope, displayName: item.displayName, excerpt: item.content.slice(0, 800), sourceLocator: item.sourceLocator })));
    }
    return [created];
  });
  return publicOverview(input, overview);
}

export async function listRequirementOverviews(input: { principal: AuthenticatedPrincipal; projectId: string; requestHeaders: Headers }) {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const rows = await getDb().select().from(guidedRequirementOverview).where(eq(guidedRequirementOverview.projectId, input.projectId)).orderBy(desc(guidedRequirementOverview.versionNumber));
  return Promise.all(rows.map((item) => publicOverview(input, item)));
}

export async function updateRequirementOverview(input: { principal: AuthenticatedPrincipal; projectId: string; overviewId: string; payload: unknown; requestHeaders: Headers }) {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const parsed = updateSchema.parse(input.payload);
  const [current] = await getDb().select().from(guidedRequirementOverview).where(and(eq(guidedRequirementOverview.id, input.overviewId), eq(guidedRequirementOverview.projectId, input.projectId))).limit(1);
  if (!current || current.status === "generated") throw new ProjectManagementError(404, "REQUIREMENT_NOT_FOUND", "需求概览不存在");
  const updates = new Map(parsed.answers.map((answer) => [answer.id, answer]));
  const questions = current.questions.map((question) => {
    const update = updates.get(question.id); if (!update) return question;
    return { ...question, answer: update.answer.trim(), status: update.notApplicable ? "not_applicable" as const : update.answer.trim() ? "answered" as const : "pending" as const };
  });
  const items = current.items.map((item) => {
    const question = questions.find((entry) => entry.id === item.id);
    return question?.status === "answered" ? { ...item, status: "user_confirmed" as const, value: question.answer } : question?.status === "not_applicable" ? { ...item, status: "not_applicable" as const, value: "不适用" } : item;
  });
  const [updated] = await getDb().update(guidedRequirementOverview).set({ questions, items, status: statusFor(questions), updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, current.id)).returning();
  return publicOverview(input, updated);
}

export async function generateRequirementOverviewMarkdown(input: { principal: AuthenticatedPrincipal; projectId: string; overviewId: string; requestHeaders: Headers }) {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const [current] = await getDb().select().from(guidedRequirementOverview).where(and(eq(guidedRequirementOverview.id, input.overviewId), eq(guidedRequirementOverview.projectId, input.projectId))).limit(1);
  if (!current) throw new ProjectManagementError(404, "REQUIREMENT_NOT_FOUND", "需求概览不存在");
  if (statusFor(current.questions) !== "ready") throw new ProjectManagementError(409, "REQUIREMENT_CONFIRMATION_REQUIRED", "请先完成必填确认项");
  const sources = await collectRequirementEvidence(input);
  if (digest(sources) !== current.sourceDigest) throw new ProjectManagementError(409, "SOURCE_CHANGED", "资料已更新，请重新生成需求概览");
  try {
    const scenario = await resolveGenerationScenario({ projectId: input.projectId, actorId: input.principal.user.id, scenario: "requirement_markdown_generation" });
    const result = await createProjectAssistantGateway(scenario.runtime).generate({ model: scenario.modelId, purpose: "requirement_overview", systemPrompt: "你是项目经理助手。仅基于受信资料和确认项给出不超过五条的结构化摘要。不得编造事实。只输出 JSON {summary:string}。", userPrompt: `<overview_json>${JSON.stringify({ items: current.items, questions: current.questions })}</overview_json>` });
    let summary = "";
    try { const value = JSON.parse(result.text) as { summary?: unknown }; summary = typeof value.summary === "string" ? value.summary.slice(0, 4000) : ""; } catch { /* fixed Markdown remains valid without an optional summary */ }
    const access = await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
    const markdown = overviewMarkdown(access.name, current, summary);
    const [updated] = await getDb().update(guidedRequirementOverview).set({ status: "generated", markdown, generationModelId: scenario.modelRecordId, actualModel: result.actualModel, failureCode: null, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, current.id)).returning();
    return publicOverview(input, updated);
  } catch (error) {
    const code = error instanceof ProjectAssistantError ? "REQUIREMENT_PROVIDER_FAILED" : "REQUIREMENT_GENERATION_FAILED";
    await getDb().update(guidedRequirementOverview).set({ status: "failed", failureCode: code, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, current.id));
    throw error;
  }
}

export async function saveRequirementOverviewToProject(input: { principal: AuthenticatedPrincipal; projectId: string; overviewId: string; requestHeaders: Headers }) {
  await requireProjectRole(input.principal, input.projectId, ["project_manager"], input.requestHeaders);
  const [overview] = await getDb().select().from(guidedRequirementOverview).where(and(eq(guidedRequirementOverview.id, input.overviewId), eq(guidedRequirementOverview.projectId, input.projectId), eq(guidedRequirementOverview.status, "generated"))).limit(1);
  if (!overview) throw new ProjectManagementError(409, "REQUIREMENT_NOT_READY", "请先生成需求概览");
  const access = await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const saved = await syncRequirementSource({ principal: input.principal, projectId: input.projectId, requestHeaders: input.requestHeaders, requirementId: overview.id, projectName: access.name, markdown: overview.markdown, linkedDocumentId: overview.savedDocumentId });
  const [updated] = await getDb().update(guidedRequirementOverview).set({ savedDocumentId: saved.document.id, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, overview.id)).returning();
  return publicOverview(input, updated);
}

export async function getRequirementOverviewMarkdown(input: { principal: AuthenticatedPrincipal; projectId: string; overviewId: string; requestHeaders: Headers }) {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const [overview] = await getDb().select().from(guidedRequirementOverview).where(and(eq(guidedRequirementOverview.id, input.overviewId), eq(guidedRequirementOverview.projectId, input.projectId), eq(guidedRequirementOverview.status, "generated"))).limit(1);
  if (!overview) throw new ProjectManagementError(404, "REQUIREMENT_NOT_FOUND", "需求概览不存在");
  return overview;
}

async function publicOverview(input: { principal: AuthenticatedPrincipal; projectId: string; requestHeaders: Headers }, overview: typeof guidedRequirementOverview.$inferSelect) {
  const citations = await getDb().select().from(guidedRequirementOverviewCitation).where(eq(guidedRequirementOverviewCitation.overviewId, overview.id));
  return { ...overview, createdAt: overview.createdAt.toISOString(), updatedAt: overview.updatedAt.toISOString(), sourceSnapshotAt: overview.sourceSnapshotAt.toISOString(), citations };
}
