import { z } from "zod";

export const WORKFLOW_TYPES = ["requirement_framework", "meeting_minutes"] as const;
export const GA4_SCHEMA_VERSION = "projectai-ga4-v1" as const;
export const ACTION_PLAN_SCHEMA_VERSION = "projectai-action-plan-v1" as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export const REQUIREMENT_ARTIFACT_KINDS = [
  "project_overview",
  "requirements_document",
  "ga4_measurement_plan",
  "action_plan",
] as const;
export type RequirementArtifactKind = (typeof REQUIREMENT_ARTIFACT_KINDS)[number];

export const OVERVIEW_FIELDS = [
  "核心时间", "平台类型", "适配类型", "交互类型", "投放渠道", "项目地区",
  "项目整体架构与各方责任", "特殊支持", "项目维护类型", "线下活动支持",
  "搭建支持", "上线类型", "隐私政策与数据合规", "流量与访问情况",
  "项目特殊支持", "项目核心指标", "研发资源", "三方资源", "运营资源",
  "项目业务运维", "服务器或云开发", "可行性分析", "MVP 需求",
  "整体交互流程概览", "可用物料",
] as const;

export const REQUIREMENTS_SECTION_TITLES = [
  "文档信息与版本记录", "项目背景", "业务目标", "用户和角色", "使用场景",
  "产品范围", "Out of Scope", "用户旅程", "信息架构", "功能需求",
  "页面和交互要求", "平台与兼容性要求", "权限要求", "数据模型和业务状态",
  "外部系统和 API 依赖", "异常、降级和兜底", "非功能需求", "性能和并发",
  "隐私与数据合规", "数据统计与埋点需求", "验收标准", "依赖关系", "风险",
  "时间线和里程碑", "待确认事项", "附录和来源",
] as const;

const classificationSchema = z.enum(["fact", "assumption", "advice", "pending"]);
const citationLabelsSchema = z.array(z.string().regex(/^E[1-9][0-9]?$/)).max(20);

export const overviewArtifactSchema = z.object({
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    fields: z.array(z.object({
      name: z.string().trim().min(1).max(120),
      value: z.string().trim().min(1).max(4_000),
      classification: classificationSchema,
      citations: citationLabelsSchema,
    }).strict()).min(1).max(40),
  }).strict()).min(2).max(10),
  pendingQuestions: z.array(z.string().trim().min(1).max(500)).max(80),
}).strict().superRefine((value, context) => {
  const names = new Set(value.sections.flatMap((section) => section.fields.map((field) => field.name)));
  for (const required of OVERVIEW_FIELDS) {
    if (!names.has(required)) context.addIssue({ code: "custom", message: `missing overview field: ${required}` });
  }
  for (const field of value.sections.flatMap((section) => section.fields)) {
    if (field.classification === "fact" && field.citations.length === 0) {
      context.addIssue({ code: "custom", message: `fact without citation: ${field.name}` });
    }
  }
});

export const requirementsDocumentSectionSchema = z.object({
  number: z.number().int().min(1).max(26),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(12_000),
  classification: classificationSchema,
  citations: citationLabelsSchema,
}).strict();

export const requirementsDocumentBatchSchema = z.object({
  sections: z.array(requirementsDocumentSectionSchema).min(1).max(5),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(100),
}).strict();

export function normalizeRequirementsDocumentBatch(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.sections)) return value;
  return {
    sections: record.sections.map((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)) return section;
      const item = section as Record<string, unknown>;
      const number = typeof item.number === "string" && /^\d{1,2}$/.test(item.number)
        ? Number(item.number)
        : item.number;
      return {
        number,
        title: typeof number === "number" && Number.isInteger(number) && number >= 1 && number <= 26
          ? REQUIREMENTS_SECTION_TITLES[number - 1]
          : item.title,
        body: item.body,
        classification: item.classification,
        citations: typeof item.citations === "string" ? [item.citations] : item.citations,
      };
    }),
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria
      : [],
  };
}

export const requirementsDocumentSchema = z.object({
  sections: z.array(requirementsDocumentSectionSchema).length(26),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).min(1).max(100),
}).strict().superRefine((value, context) => {
  for (let index = 0; index < REQUIREMENTS_SECTION_TITLES.length; index += 1) {
    const section = value.sections[index];
    if (section.number !== index + 1 || section.title !== REQUIREMENTS_SECTION_TITLES[index]) {
      context.addIssue({ code: "custom", message: `section ${index + 1} must be ${REQUIREMENTS_SECTION_TITLES[index]}` });
    }
    if (section.classification === "fact" && section.citations.length === 0) {
      context.addIssue({ code: "custom", message: `fact section without citation: ${section.title}` });
    }
  }
});

const parameterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  valueRule: z.string().trim().min(1).max(1_000),
  valueType: z.enum(["string", "number", "boolean", "date", "array"]),
  note: z.string().max(1_000),
  citations: citationLabelsSchema,
}).strict();

export const ga4MeasurementPlanSchema = z.object({
  overview: z.object({
    platform: z.string().trim().min(1).max(80),
    measurementId: z.string().trim().min(1).max(120),
    validationStatus: z.string().trim().min(1).max(120),
    projectName: z.string().trim().min(1).max(240),
    projectLink: z.string().trim().min(1).max(500),
    citations: citationLabelsSchema,
  }).strict(),
  publicParameters: z.array(parameterSchema).max(100),
  events: z.array(z.object({
    eventName: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    coreEvent: z.boolean(),
    eventType: z.enum(["page_view", "click", "select", "permission", "ai", "result", "error", "custom"]),
    description: z.string().trim().min(1).max(500),
    eventId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    parameterName: z.string().max(120),
    parameterDescription: z.string().max(500),
    parameterKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    parameterValueRule: z.string().max(1_000),
    parameterValueType: z.enum(["string", "number", "boolean", "date", "array"]),
    note: z.string().max(1_000),
    developerFeedback: z.string().max(1_000),
    citations: citationLabelsSchema,
  }).strict()).min(1).max(500),
  requirementEventCoverage: z.array(z.object({ requirement: z.string().min(1), eventId: z.string().min(1), status: z.enum(["covered", "gap", "pending"]) }).strict()).max(1_000),
  pageEventMatrix: z.array(z.object({ page: z.string().min(1), eventId: z.string().min(1), status: z.enum(["covered", "gap", "pending"]) }).strict()).max(1_000),
}).strict().superRefine((value, context) => {
  const ids = value.events.map((event) => event.eventId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duplicate event id" });
  if (value.overview.measurementId !== "TBD" && !/^G-[A-Z0-9]+$/.test(value.overview.measurementId)) {
    context.addIssue({ code: "custom", message: "measurement id must be TBD or a GA4 id" });
  }
});

const dateOrTbd = z.string().refine((value) => value === "TBD" || /^\d{4}-\d{2}-\d{2}$/.test(value), "date must be YYYY-MM-DD or TBD");

export const actionPlanSchema = z.object({
  tasks: z.array(z.object({
    taskCn: z.string().trim().min(1).max(500),
    taskEn: z.string().max(500),
    owner: z.string().trim().min(1).max(160),
    stakeholder: z.string().trim().min(1).max(160),
    startDate: dateOrTbd,
    endDate: dateOrTbd,
    progress: z.number().int().min(0).max(100),
    milestone: z.boolean(),
    meeting: z.string().max(500),
    parentTask: z.string().nullable(),
    dependency: z.array(z.string().trim().min(1).max(500)).max(50),
    confirmationOwner: z.string().max(160),
    latestConfirmationDate: dateOrTbd,
    delayImpact: z.string().trim().min(1).max(2_000),
    criticalPath: z.boolean(),
    sourceCitation: z.string().regex(/^(E[1-9][0-9]?|AI 建议|待确认)$/),
    assumption: z.string().max(2_000),
    status: z.enum(["not_started", "in_progress", "blocked", "completed", "pending_confirmation"]),
  }).strict()).min(1).max(1_000),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(200),
}).strict().superRefine((value, context) => {
  const taskNames = new Set(value.tasks.map((task) => task.taskCn));
  for (const task of value.tasks) {
    if (task.parentTask && !taskNames.has(task.parentTask)) context.addIssue({ code: "custom", message: `unknown parent task: ${task.parentTask}` });
    for (const dependency of task.dependency) if (!taskNames.has(dependency)) context.addIssue({ code: "custom", message: `unknown dependency: ${dependency}` });
    if (task.startDate !== "TBD" && task.endDate !== "TBD" && task.startDate > task.endDate) context.addIssue({ code: "custom", message: `invalid date range: ${task.taskCn}` });
  }
  const graph = new Map(value.tasks.map((task) => [task.taskCn, task.dependency]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: string): boolean => {
    if (visiting.has(task)) return true;
    if (visited.has(task)) return false;
    visiting.add(task);
    for (const dependency of graph.get(task) ?? []) if (visit(dependency)) return true;
    visiting.delete(task);
    visited.add(task);
    return false;
  };
  for (const task of graph.keys()) if (visit(task)) context.addIssue({ code: "custom", message: "action plan contains a dependency cycle" });
});

export const artifactSchemas = {
  project_overview: overviewArtifactSchema,
  requirements_document: requirementsDocumentSchema,
  ga4_measurement_plan: ga4MeasurementPlanSchema,
  action_plan: actionPlanSchema,
} as const;

export const meetingSummarySchema = z.object({
  background: z.string().max(10_000),
  topics: z.array(z.string().min(1).max(500)).max(100),
  keyPoints: z.array(z.object({ text: z.string().min(1).max(2_000), segmentIds: z.array(z.string()).min(1).max(50) }).strict()).max(200),
  decisions: z.array(z.object({ text: z.string().min(1).max(2_000), segmentIds: z.array(z.string()).min(1).max(50), confirmed: z.literal(true) }).strict()).max(100),
  proposals: z.array(z.object({ text: z.string().min(1).max(2_000), segmentIds: z.array(z.string()).min(1).max(50) }).strict()).max(100),
  openQuestions: z.array(z.string().min(1).max(2_000)).max(100),
  risks: z.array(z.object({ text: z.string().min(1).max(2_000), segmentIds: z.array(z.string()).min(1).max(50) }).strict()).max(100),
  actions: z.array(z.object({ text: z.string().min(1).max(2_000), owner: z.string().min(1).max(160), deadline: dateOrTbd, dependencies: z.array(z.string().max(500)).max(50), segmentIds: z.array(z.string()).min(1).max(50) }).strict()).max(200),
}).strict();

export const meetingTranscriptSchema = z.object({
  durationMs: z.number().int().nonnegative().nullable(),
  speakers: z.array(z.object({
    id: z.string().uuid(),
    speakerKey: z.string().regex(/^speaker-[1-9][0-9]*$/),
    displayName: z.string().trim().min(1).max(160),
  }).strict()).min(1).max(100),
  segments: z.array(z.object({
    id: z.string().uuid(),
    label: z.string().regex(/^S[1-9][0-9]*$/),
    sequence: z.number().int().positive(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    speakerId: z.string().uuid(),
    speakerName: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(20_000),
    confidenceBps: z.number().int().min(0).max(10_000).nullable(),
    language: z.string().trim().min(1).max(24),
  }).strict()).min(1).max(100_000),
}).strict().superRefine((value, context) => {
  const speakerIds = new Set(value.speakers.map((speaker) => speaker.id));
  const labels = new Set<string>();
  for (const segment of value.segments) {
    if (!speakerIds.has(segment.speakerId)) context.addIssue({ code: "custom", message: `unknown speaker: ${segment.speakerId}` });
    if (segment.endMs <= segment.startMs) context.addIssue({ code: "custom", message: `invalid segment range: ${segment.label}` });
    if (labels.has(segment.label)) context.addIssue({ code: "custom", message: `duplicate segment label: ${segment.label}` });
    labels.add(segment.label);
  }
});

export const meetingActionsSchema = z.object({ actions: meetingSummarySchema.shape.actions }).strict();

export const workflowArtifactSchemas = {
  ...artifactSchemas,
  meeting_transcript: meetingTranscriptSchema,
  meeting_minutes: meetingSummarySchema,
  meeting_actions: meetingActionsSchema,
} as const;

export type WorkflowArtifactKind = keyof typeof workflowArtifactSchemas;

export function parseWorkflowArtifact(kind: string, value: unknown): Record<string, unknown> {
  const schema = workflowArtifactSchemas[kind as WorkflowArtifactKind];
  if (!schema) throw new Error(`Unsupported workflow artifact kind: ${kind}`);
  return schema.parse(value) as Record<string, unknown>;
}

export function validateCitationLabels(value: unknown, allowedLabels: Set<string>): boolean {
  if (Array.isArray(value)) return value.every((item) => validateCitationLabels(item, allowedLabels));
  if (!value || typeof value !== "object") return true;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "citations" || key === "segmentIds") && Array.isArray(child)) {
      if (!child.every((label) => typeof label === "string" && allowedLabels.has(label))) return false;
    } else if ((key === "sourceCitation" || key === "sourceLabel") && typeof child === "string" && /^E\d+$/.test(child) && !allowedLabels.has(child)) {
      return false;
    } else if (!validateCitationLabels(child, allowedLabels)) return false;
  }
  return true;
}
