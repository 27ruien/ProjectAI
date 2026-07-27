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

function normalizeCitationLabels(value: unknown): unknown {
  const values = typeof value === "string" ? [value] : value;
  if (values === null || values === undefined) return [];
  if (!Array.isArray(values) || !values.every((item) => typeof item === "string")) return value;
  const normalized = values.flatMap((item) => {
    const parts = item.split(/[\s,，、;；]+/).filter(Boolean);
    return parts.length > 1 && parts.every((part) => /^E[1-9][0-9]?$/.test(part)) ? parts : [item];
  });
  return [...new Set(normalized)];
}

function normalizeRequirementClassification(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, "fact" | "assumption" | "advice" | "pending"> = {
    fact: "fact",
    "事实": "fact",
    assumption: "assumption",
    "假设": "assumption",
    advice: "advice",
    suggestion: "advice",
    "建议": "advice",
    pending: "pending",
    tbd: "pending",
    "待确认": "pending",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (/(?:^|[^a-z])fact(?:[^a-z]|$)|事实|已确认/.test(normalized)) return "fact";
  if (/assumption|inference|假设|推测|推断/.test(normalized)) return "assumption";
  if (/advice|suggestion|recommend|建议/.test(normalized)) return "advice";
  if (/pending|tbd|unknown|待确认|未确认|未知/.test(normalized)) return "pending";
  return value;
}

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
        body: Array.isArray(item.body) && item.body.every((part) => typeof part === "string")
          ? item.body.join("\n")
          : item.body,
        classification: normalizeRequirementClassification(item.classification),
        citations: normalizeCitationLabels(item.citations),
      };
    }),
    acceptanceCriteria: typeof record.acceptanceCriteria === "string"
      ? [record.acceptanceCriteria]
      : Array.isArray(record.acceptanceCriteria)
        ? record.acceptanceCriteria
        : [],
  };
}

export function describeRequirementsBatchSchemaFailure(value: unknown): string {
  const parsed = requirementsDocumentBatchSchema.safeParse(value);
  if (parsed.success) return "WORKFLOW_REQUIREMENTS_BATCH_SCHEMA_INVALID";
  const issue = parsed.error.issues[0];
  const path = issue?.path.map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "_")).join("_") || "root";
  return `WORKFLOW_REQ_SCHEMA_${path}`.slice(0, 80);
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
  requirementEventCoverage: z.array(z.object({ requirement: z.string().trim().min(1).max(500), eventId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), status: z.enum(["covered", "gap", "pending"]) }).strict()).max(1_000),
  pageEventMatrix: z.array(z.object({ page: z.string().trim().min(1).max(500), eventId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), status: z.enum(["covered", "gap", "pending"]) }).strict()).max(1_000),
}).strict().superRefine((value, context) => {
  const ids = value.events.map((event) => event.eventId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duplicate event id" });
  const eventIds = new Set(ids);
  for (const entry of [...value.requirementEventCoverage, ...value.pageEventMatrix]) {
    if (!eventIds.has(entry.eventId)) context.addIssue({ code: "custom", message: `coverage references unknown event: ${entry.eventId}` });
  }
  if (value.overview.measurementId !== "TBD" && !/^G-[A-Z0-9]+$/.test(value.overview.measurementId)) {
    context.addIssue({ code: "custom", message: "measurement id must be TBD or a GA4 id" });
  }
});

function normalizeGa4Identifier(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (/^[a-z][a-z0-9_]{0,39}$/.test(normalized)) return normalized;
  if (!value.trim()) return value;

  // GA4 limits event and parameter identifiers to 40 characters. Preserve a
  // readable prefix and add a deterministic suffix so provider wording drift
  // cannot silently collapse two long identifiers into the same value.
  let hash = 0x811c9dc5;
  const hashInput = normalized || value.trim();
  for (const character of hashInput) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const suffix = hash.toString(16).padStart(8, "0");
  const safeBase = /^[a-z]/.test(normalized) ? normalized : `x_${normalized}`;
  const prefix = safeBase.slice(0, 31).replace(/_+$/g, "") || "x";
  return `${prefix}_${suffix}`;
}

function normalizeGa4Boolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "是", "核心"].includes(normalized)) return true;
  if (["false", "no", "n", "否", "非核心"].includes(normalized)) return false;
  return value;
}

function normalizeGa4ValueType(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? normalizeGa4ValueType(value[0]) : value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of ["valueType", "type", "name"] as const) {
      if (item[key] !== undefined) return normalizeGa4ValueType(item[key]);
    }
    return value;
  }
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["string", "text", "enum", "enumeration", "string(enum)", "enum(string)", "string/enum", "enum/string", "字符串", "文本", "枚举"].includes(normalized)) return "string";
  if (["number", "integer", "float", "double", "decimal", "numeric", "数字", "数值", "整数", "浮点数"].includes(normalized)) return "number";
  if (["boolean", "bool", "布尔"].includes(normalized)) return "boolean";
  if (["date", "datetime", "timestamp", "iso_date", "iso8601", "日期", "时间"].includes(normalized)) return "date";
  if (["array", "list", "string[]", "string array", "数组", "列表"].includes(normalized)) return "array";
  return value;
}

function normalizeGa4EventType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = String(normalizeGa4Identifier(value));
  const aliases: Record<string, "page_view" | "click" | "select" | "permission" | "ai" | "result" | "error" | "custom"> = {
    page_view: "page_view", exposure: "page_view", impression: "page_view",
    click: "click", tap: "click",
    select: "select", choice: "select",
    permission: "permission", authorization: "permission",
    ai: "ai", model: "ai",
    result: "result", recommendation: "result",
    error: "error", failure: "error",
    custom: "custom",
  };
  return aliases[normalized] ?? value;
}

function normalizeCoverageStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["covered", "complete", "completed", "已覆盖", "完成"].includes(normalized)) return "covered";
  if (["gap", "missing", "未覆盖", "缺口"].includes(normalized)) return "gap";
  if (["pending", "tbd", "待确认", "待定"].includes(normalized)) return "pending";
  return value;
}

function normalizeCoverageLabels(value: unknown, firstKey: "requirement" | "page", depth = 0): unknown[] {
  if (depth > 2) return [value];
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > 20) return [value];
    return value.flatMap((item) => normalizeCoverageLabels(item, firstKey, depth + 1));
  }
  if (typeof value === "string") return [value.trim()];
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (!value || typeof value !== "object") return [value];
  const item = value as Record<string, unknown>;
  const keys = firstKey === "requirement"
    ? ["requirement", "requirementId", "id", "number", "name", "title", "requirements"]
    : ["page", "pageId", "id", "path", "name", "title", "pages"];
  for (const key of keys) {
    const candidate = item[key];
    if (candidate !== undefined) return normalizeCoverageLabels(candidate, firstKey, depth + 1);
  }
  return [value];
}

function normalizeCoverageEventIds(value: unknown, depth = 0): unknown[] {
  if (depth > 2) return [value];
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > 20) return [value];
    return value.flatMap((item) => normalizeCoverageEventIds(item, depth + 1));
  }
  if (typeof value === "string") {
    const parts = value.split(/[,，、;；|]+/).map((part) => part.trim()).filter(Boolean);
    return (parts.length > 1 ? parts : [value]).map(normalizeGa4Identifier);
  }
  if (!value || typeof value !== "object") return [value];
  const item = value as Record<string, unknown>;
  for (const key of ["eventId", "id", "eventName", "name", "eventIds", "eventNames", "events"] as const) {
    if (item[key] !== undefined) return normalizeCoverageEventIds(item[key], depth + 1);
  }
  return [value];
}

export function normalizeGa4MeasurementPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const overview = record.overview && typeof record.overview === "object" && !Array.isArray(record.overview)
    ? record.overview as Record<string, unknown>
    : null;
  const normalizeParameter = (parameter: unknown) => {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) return parameter;
    const item = parameter as Record<string, unknown>;
    return {
      name: item.name,
      description: item.description,
      key: normalizeGa4Identifier(item.key),
      valueRule: item.valueRule,
      valueType: normalizeGa4ValueType(item.valueType),
      note: item.note ?? "",
      citations: normalizeCitationLabels(item.citations),
    };
  };
  const normalizedEvents = Array.isArray(record.events) ? record.events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return event;
    const item = event as Record<string, unknown>;
    return {
      eventName: normalizeGa4Identifier(item.eventName),
      coreEvent: normalizeGa4Boolean(item.coreEvent),
      eventType: normalizeGa4EventType(item.eventType),
      description: item.description,
      eventId: normalizeGa4Identifier(item.eventId),
      parameterName: item.parameterName ?? "",
      parameterDescription: item.parameterDescription ?? "",
      parameterKey: normalizeGa4Identifier(item.parameterKey),
      parameterValueRule: item.parameterValueRule ?? "",
      parameterValueType: normalizeGa4ValueType(item.parameterValueType),
      note: item.note ?? "",
      developerFeedback: item.developerFeedback ?? "",
      citations: normalizeCitationLabels(item.citations),
    };
  }) : record.events;
  const eventAliases = new Map<string, string | null>();
  if (Array.isArray(normalizedEvents)) {
    for (const event of normalizedEvents) {
      if (!event || typeof event !== "object" || Array.isArray(event)) continue;
      const item = event as Record<string, unknown>;
      if (typeof item.eventId !== "string") continue;
      for (const alias of [item.eventId, item.eventName]) {
        if (typeof alias !== "string") continue;
        const existing = eventAliases.get(alias);
        eventAliases.set(alias, existing === undefined || existing === item.eventId ? item.eventId : null);
      }
    }
  }
  const normalizeMatrix = (entry: unknown, firstKey: "requirement" | "page"): unknown[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [entry];
    const item = entry as Record<string, unknown>;
    const rawEventReference = item.eventId ?? item.eventIds ?? item.events;
    const rawLabel = item[firstKey] ?? item[`${firstKey}s`];
    const normalizedLabels = [...new Set(normalizeCoverageLabels(rawLabel, firstKey))];
    const normalizedEventIds = [...new Set(normalizeCoverageEventIds(rawEventReference))];
    return normalizedLabels.flatMap((label) => normalizedEventIds.map((normalizedEventId) => {
      const eventId = typeof normalizedEventId === "string" && eventAliases.get(normalizedEventId)
        ? eventAliases.get(normalizedEventId)
        : normalizedEventId;
      return { [firstKey]: label, eventId, status: normalizeCoverageStatus(item.status) };
    }));
  };
  return {
    overview: overview ? {
      platform: overview.platform,
      measurementId: typeof overview.measurementId === "string" && /^(?:tbd|待确认|未知|未配置)$/i.test(overview.measurementId.trim()) ? "TBD" : overview.measurementId,
      validationStatus: overview.validationStatus,
      projectName: overview.projectName,
      projectLink: overview.projectLink,
      citations: normalizeCitationLabels(overview.citations),
    } : record.overview,
    publicParameters: Array.isArray(record.publicParameters) ? record.publicParameters.map(normalizeParameter) : record.publicParameters,
    events: normalizedEvents,
    requirementEventCoverage: Array.isArray(record.requirementEventCoverage)
      ? record.requirementEventCoverage.flatMap((entry) => normalizeMatrix(entry, "requirement"))
      : record.requirementEventCoverage,
    pageEventMatrix: Array.isArray(record.pageEventMatrix)
      ? record.pageEventMatrix.flatMap((entry) => normalizeMatrix(entry, "page"))
      : record.pageEventMatrix,
  };
}

export function validateGa4MeasurementIdGrounding(value: unknown, evidenceContent: string[]): boolean {
  const parsed = ga4MeasurementPlanSchema.safeParse(value);
  if (!parsed.success || parsed.data.overview.measurementId === "TBD") return parsed.success;
  return evidenceContent.some((content) => content.includes(parsed.data.overview.measurementId));
}

const dateOrTbd = z.string().refine((value) => value === "TBD" || /^\d{4}-\d{2}-\d{2}$/.test(value), "date must be YYYY-MM-DD or TBD");

function normalizeActionDate(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return "TBD";
  if (typeof value !== "string") return value;
  return /^(?:tbd|待确认|待定|未知|未确认)$/i.test(value.trim()) ? "TBD" : value.trim();
}

function normalizeActionBoolean(value: unknown, fallback: boolean): unknown {
  if (value === null || value === undefined || value === "") return fallback;
  return normalizeGa4Boolean(value);
}

function normalizeActionStatus(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return "pending_confirmation";
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, "not_started" | "in_progress" | "blocked" | "completed" | "pending_confirmation"> = {
    not_started: "not_started", "未开始": "not_started",
    in_progress: "in_progress", "进行中": "in_progress",
    blocked: "blocked", "阻塞": "blocked", "受阻": "blocked",
    completed: "completed", complete: "completed", "已完成": "completed",
    pending_confirmation: "pending_confirmation", pending: "pending_confirmation", tbd: "pending_confirmation", "待确认": "pending_confirmation",
  };
  return aliases[normalized] ?? value;
}

export function normalizeActionPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return {
    tasks: Array.isArray(record.tasks) ? record.tasks.map((task) => {
      if (!task || typeof task !== "object" || Array.isArray(task)) return task;
      const item = task as Record<string, unknown>;
      const progress = typeof item.progress === "string" && /^\d{1,3}%?$/.test(item.progress.trim())
        ? Number(item.progress.trim().replace("%", ""))
        : item.progress ?? 0;
      const parentTask = typeof item.parentTask === "string" && /^(?:|none|null|无|tbd|待确认)$/i.test(item.parentTask.trim())
        ? null
        : item.parentTask ?? null;
      const sourceCitation = Array.isArray(item.sourceCitation) && item.sourceCitation.length === 1
        ? item.sourceCitation[0]
        : typeof item.sourceCitation === "string" && /^(?:tbd|无|待确认)$/i.test(item.sourceCitation.trim())
          ? "待确认"
          : item.sourceCitation ?? "待确认";
      return {
        taskCn: item.taskCn,
        taskEn: item.taskEn ?? "",
        owner: item.owner ?? "TBD",
        stakeholder: item.stakeholder ?? "TBD",
        startDate: normalizeActionDate(item.startDate),
        endDate: normalizeActionDate(item.endDate),
        progress,
        milestone: normalizeActionBoolean(item.milestone, false),
        meeting: item.meeting ?? "",
        parentTask,
        dependency: typeof item.dependency === "string" ? [item.dependency] : item.dependency ?? [],
        confirmationOwner: item.confirmationOwner ?? "TBD",
        latestConfirmationDate: normalizeActionDate(item.latestConfirmationDate),
        delayImpact: item.delayImpact ?? "待确认",
        criticalPath: normalizeActionBoolean(item.criticalPath, false),
        sourceCitation,
        assumption: item.assumption ?? "",
        status: normalizeActionStatus(item.status),
      };
    }) : record.tasks,
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
  };
}

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

export function validateActionPlanDateGrounding(value: unknown, evidenceContent: string[]): boolean {
  const parsed = actionPlanSchema.safeParse(value);
  if (!parsed.success) return false;
  return parsed.data.tasks.every((task) => [task.startDate, task.endDate, task.latestConfirmationDate].every((date) => {
    if (date === "TBD" || evidenceContent.some((content) => content.includes(date))) return true;
    return task.sourceCitation === "AI 建议" && /AI 建议/.test(task.assumption);
  }));
}

export const artifactSchemas = {
  project_overview: overviewArtifactSchema,
  requirements_document: requirementsDocumentSchema,
  ga4_measurement_plan: ga4MeasurementPlanSchema,
  action_plan: actionPlanSchema,
} as const;

export function describeArtifactSchemaFailure(kind: RequirementArtifactKind, value: unknown): string {
  const parsed = artifactSchemas[kind].safeParse(value);
  if (parsed.success) return "WORKFLOW_ARTIFACT_SCHEMA_INVALID";
  const issue = parsed.error.issues[0];
  const path = issue?.path.map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "_")).join("_") || "root";
  return `WORKFLOW_${kind === "ga4_measurement_plan" ? "GA4" : "ARTIFACT"}_SCHEMA_${path}`.slice(0, 80);
}

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
