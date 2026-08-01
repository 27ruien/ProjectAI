import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  guidedRequirementOverview,
  guidedRequirementOverviewCitation,
  type RequirementOverviewItem,
  type RequirementOverviewQuestion,
} from "@/lib/db/schema";
import { ProjectManagementError } from "@/lib/project-management/errors";
import {
  collectRequirementEvidence,
  requirementSha256,
  syncRequirementSource,
  type RequirementEvidence,
} from "./requirement-documents";

export const REQUIREMENT_OVERVIEW_SKILL_ID = "generate_requirement_overview";
export type OverviewStatus = "confirmed" | "user_confirmed" | "inferred" | "missing" | "conflict" | "not_applicable";

export type RequirementOverviewFieldDefinition = {
  key: string;
  section: "项目背景" | "需求概览";
  order: number;
  exactLabel: string;
  templateGuidance: string;
  required: true;
  allowedStatus: readonly OverviewStatus[];
};

const allStatuses: readonly OverviewStatus[] = ["confirmed", "user_confirmed", "inferred", "missing", "conflict", "not_applicable"];
const backgroundFields = [
  ["timeline", "时间", "项目关键时间节点、活动期或维护期。"],
  ["platform_type", "平台类型", "仅记录本项目涉及的具体业务平台，如微信小程序、淘宝 H5。"],
  ["adaptation_type", "适配类型", "记录屏幕方向、沉浸式、客户端或平板等适配要求。"],
  ["interaction_type", "交互类型", "记录项目需要的交互形式。"],
  ["distribution_channel", "投放渠道", "记录入口、落地页、分享和线下等投放渠道。"],
  ["project_region", "项目地区", "记录国内、海外或具体国家/地区。"],
  ["project_architecture", "项目整体架构（弥知、客户、三方等）", "记录弥知、客户、三方及其责任边界。"],
  ["special_support", "特殊支持", "记录 POC、DEMO、提案等特殊支持。"],
  ["maintenance_type", "项目维护类型", "记录活动期或长期维护安排。"],
  ["onsite_event_support", "线下活动支持", "记录线下活动现场支持需求。"],
  ["installation_support", "搭建支持", "记录线下搭建与硬件支持需求。"],
  ["deployment_type", "上线类型", "记录具体平台的域名、主体、部署或白名单要求。"],
  ["privacy_and_compliance", "隐私政策与数据合规", "记录隐私政策、数据处理和合规要求。"],
  ["traffic_and_access", "流量与访问情况", "记录访问量预测和访问特征。"],
  ["project_special_support", "项目特殊支持", "记录安全、兼容性、性能、弱网及其他配合。"],
] as const;
const requirementFields = [
  ["development_resources", "研发资源", "是否动用研发资源。"],
  ["third_party_resources", "三方资源", "是否动用由弥知负责的三方资源。"],
  ["operation_resources", "运营资源", "是否动用运营资源及需求概述。"],
  ["business_operations", "项目业务运维", "是否需要项目业务运维。"],
  ["server_or_cloud_development", "服务器或云开发", "是否需要服务器或云开发。"],
  ["feasibility_analysis", "可行性分析", "记录可行性结论、局限、风险或替代方案。"],
  ["mvp_requirements", "MVP需求", "本期必须交付的最小可行需求。"],
  ["interaction_flow_overview", "整体交互流程概览", "记录整体交互流程概览。"],
  ["available_assets", "可用物料", "记录可直接使用的文案、设计、素材或接口物料。"],
] as const;

function registry(section: RequirementOverviewFieldDefinition["section"], rows: readonly (readonly [string, string, string])[]) {
  return rows.map(([key, exactLabel, templateGuidance], index) => ({
    key,
    section,
    order: index + 1,
    exactLabel,
    templateGuidance,
    required: true as const,
    allowedStatus: allStatuses,
  }));
}

export const REQUIREMENT_OVERVIEW_FIELD_REGISTRY: readonly RequirementOverviewFieldDefinition[] = [
  ...registry("项目背景", backgroundFields),
  ...registry("需求概览", requirementFields),
];

const fieldKeys = new Set(REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => field.key));
const requiredConfirmationFieldKeys = [
  "timeline",
  "platform_type",
  "project_architecture",
  "deployment_type",
  "privacy_and_compliance",
  "feasibility_analysis",
  "mvp_requirements",
] as const;

const updateSchema = z.object({
  answers: z.array(z.object({ id: z.string().min(1).max(100), answer: z.string().max(5000), notApplicable: z.boolean().optional() })).max(50),
}).strict();

function digest(evidence: RequirementEvidence[]) {
  return requirementSha256(evidence.map((item) => `${item.documentId}:${item.versionId}:${item.chunkId}:${item.contentSha256}`).join("\n"));
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function firstEvidenceMatch(evidence: RequirementEvidence[], expressions: RegExp[]) {
  for (const item of evidence.filter((entry) => entry.sourceScope === "project")) {
    for (const expression of expressions) {
      const match = expression.exec(item.content);
      if (match?.[1]) return { value: compact(match[1]), label: item.label };
    }
  }
  return null;
}

const evidencePatterns: Partial<Record<string, RegExp[]>> = {
  timeline: [/(?:时间|上线时间|计划(?:上线|完成)?)[：:]\s*([^\n。；]+)/i],
  platform_type: [/(?:平台(?:类型)?|平台)[：:]\s*([^\n。；]+)/i],
  project_region: [/(?:项目地区|地区)[：:]\s*([^\n。；]+)/i],
  mvp_requirements: [/(?:MVP(?:需求)?|最小可行(?:需求|产品))[：:]\s*([^\n。；]+)/i],
};

function initialItems(evidence: RequirementEvidence[]): RequirementOverviewItem[] {
  return REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => {
    const matched = firstEvidenceMatch(evidence, evidencePatterns[field.key] ?? []);
    return {
      id: field.key,
      label: field.exactLabel,
      status: matched ? "confirmed" : "missing",
      value: matched?.value ?? "",
      citationLabels: matched ? [matched.label] : [],
    };
  });
}

function initialQuestions(items: RequirementOverviewItem[]): RequirementOverviewQuestion[] {
  return requiredConfirmationFieldKeys.map((fieldKey) => {
    const field = REQUIREMENT_OVERVIEW_FIELD_REGISTRY.find((entry) => entry.key === fieldKey)!;
    const item = items.find((entry) => entry.id === fieldKey);
    return {
      id: `confirm_${fieldKey}`,
      group: field.exactLabel,
      prompt: `请逐项确认“${field.exactLabel}”。${item?.value ? `当前资料提取为：${item.value}` : "当前资料未能确认该字段。"}`,
      required: true,
      answer: "",
      status: "pending",
      citationLabels: item?.citationLabels ?? [],
      targetFieldKeys: [fieldKey],
      reason: "模板关键字段需由项目经理逐项确认。",
      highRisk: true,
    };
  });
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>").trim();
}

function evidenceReferences(labels: string[], lead: "来源" | "依据" = "来源") {
  return labels.length ? `<br>${lead}：${labels.map((label) => `[${label}]`).join(" ")}` : "";
}

function renderDescription(item: RequirementOverviewItem) {
  const value = escapeTableCell(item.value);
  if (item.status === "missing") return "TBD（待项目经理确认）";
  if (item.status === "not_applicable") return `不适用。<br>确认依据：${value || "项目经理确认"}`;
  if (item.status === "inferred") return `AI 推断（待确认）：${value || "TBD（待项目经理确认）"}${evidenceReferences(item.citationLabels, "依据")}`;
  if (item.status === "conflict") {
    const alternatives = item.alternatives ?? [];
    return alternatives.length >= 2
      ? `存在冲突，待项目经理确认：${alternatives.map((alternative) => `<br>- ${escapeTableCell(alternative.value)}${evidenceReferences(alternative.citationLabels)}`).join("")}`
      : "存在冲突，待项目经理确认：<br>- TBD（待项目经理确认）";
  }
  const confirmation = item.status === "user_confirmed" ? "<br>状态：项目经理已确认。" : "";
  return `${value || "TBD（待项目经理确认）"}${confirmation}${evidenceReferences(item.citationLabels)}`;
}

function canonicalItems(items: RequirementOverviewItem[]) {
  const byKey = new Map(items.filter((item) => fieldKeys.has(item.id)).map((item) => [item.id, item]));
  return REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => byKey.get(field.key) ?? {
    id: field.key,
    label: field.exactLabel,
    status: "missing" as const,
    value: "",
    citationLabels: [],
  });
}

export function renderRequirementOverviewMarkdown(projectName: string, items: RequirementOverviewItem[]) {
  const renderSection = (section: RequirementOverviewFieldDefinition["section"]) => {
    const fields = REQUIREMENT_OVERVIEW_FIELD_REGISTRY.filter((field) => field.section === section);
    const byKey = new Map(canonicalItems(items).map((item) => [item.id, item]));
    const header = section === "项目背景" ? "|名称|描述|" : "|序号|名称|描述|";
    const divider = section === "项目背景" ? "|---|---|" : "|---|---|---|";
    const rows = fields.map((field) => {
      const item = byKey.get(field.key)!;
      return section === "项目背景"
        ? `|${field.exactLabel}|${renderDescription(item)}|`
        : `|${field.order}|${field.exactLabel}|${renderDescription(item)}|`;
    });
    return [`## ${section}`, "", header, divider, ...rows, ""];
  };
  return [`# ${projectName} 需求概览`, "", ...renderSection("项目背景"), ...renderSection("需求概览")].join("\n");
}

function statusFor(questions: RequirementOverviewQuestion[]) {
  return questions.some((question) => question.required && question.status === "pending") ? "needs_confirmation" : "ready" as const;
}

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
  const items = canonicalItems(current.items).map((item) => {
    const question = questions.find((entry) => (entry.targetFieldKeys ?? [entry.id]).includes(item.id));
    return question?.status === "answered"
      ? { ...item, status: "user_confirmed" as const, value: question.answer }
      : question?.status === "not_applicable"
        ? { ...item, status: "not_applicable" as const, value: "项目经理确认" }
        : item;
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
    const access = await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
    const markdown = renderRequirementOverviewMarkdown(access.name, canonicalItems(current.items));
    const [updated] = await getDb().update(guidedRequirementOverview).set({ status: "generated", markdown, generationModelId: null, actualModel: null, failureCode: null, updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, current.id)).returning();
    return publicOverview(input, updated);
  } catch (error) {
    await getDb().update(guidedRequirementOverview).set({ status: "failed", failureCode: "REQUIREMENT_GENERATION_FAILED", updatedBy: input.principal.user.id, updatedAt: new Date() }).where(eq(guidedRequirementOverview.id, current.id));
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
