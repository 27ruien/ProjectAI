import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { AuthorizedProjectRecord } from "@/lib/db/repositories/project-repository";
import { projectDocument } from "@/lib/db/schema";
import {
  createRagflowClient,
  type RagflowClient,
  type RagflowEvidence,
} from "@/lib/ragflow";
import {
  getProjectTimeline,
  ProjectTimelineAccessError,
  type ProjectTimelineContext,
  type StructuredTimelineRepository,
} from "@/lib/timeline";
import {
  WEEKLY_REPORT_LIMITS,
  type DailyReportFact,
  type ProjectWeeklyReportContext,
  type WeeklyReportEvidence,
} from "./contracts";

export type ContextDocument = {
  projectId: string;
  ragflowDocumentId: string;
  displayName: string;
  contextKind: string;
};

const timelineNamePattern = /timeline|time[\s_-]*line|schedule|milestone|排期|里程碑|时间线|项目计划/iu;

export function projectStatusLabel(
  project: Pick<AuthorizedProjectRecord, "status" | "stage">,
): string {
  if (project.status === "paused") return "暂停";
  if (project.status === "cancelled") return "取消";
  if (project.status === "archived") return "归档";
  if (project.status === "completed") return "已完成";
  const stageLabels: Record<AuthorizedProjectRecord["stage"], string> = {
    discovery: "需求评审",
    planning: "方案",
    design: "设计",
    development: "开发",
    testing: "测试",
    launch: "待上线",
    operation: "已上线",
  };
  const label = stageLabels[project.stage];
  return project.status === "at_risk" ? label + "（风险）" : label;
}

function isTimelineDocument(document: ContextDocument): boolean {
  return document.contextKind === "timeline" || timelineNamePattern.test(document.displayName);
}

function guardEvidence(input: {
  evidence: RagflowEvidence[];
  datasetId: string;
  allowedDocuments: Map<string, string>;
}): RagflowEvidence[] {
  return input.evidence
    .filter(
      (item) =>
        item.datasetId === input.datasetId &&
        input.allowedDocuments.has(item.documentId),
    )
    .map((item) => ({
      ...item,
      documentName: input.allowedDocuments.get(item.documentId)!,
    }));
}

function evidenceItems<Kind extends WeeklyReportEvidence["kind"]>(
  evidence: RagflowEvidence[],
  kind: Kind,
  prefix: "T" | "K",
  maximumItems: number,
  maximumCharacters: number,
): Array<WeeklyReportEvidence & { kind: Kind }> {
  const result: Array<WeeklyReportEvidence & { kind: Kind }> = [];
  let characters = 0;
  const seen = new Set<string>();
  for (const item of evidence) {
    if (result.length >= maximumItems || characters >= maximumCharacters) break;
    const identity = item.documentId + ":" + item.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const remaining = maximumCharacters - characters;
    const excerpt = item.content.slice(0, remaining).trim();
    if (!excerpt) continue;
    result.push({
      id: prefix + String(result.length + 1),
      kind,
      documentId: item.documentId,
      documentName: item.documentName,
      excerpt,
      similarity: item.similarity,
    });
    characters += excerpt.length;
  }
  return result;
}

async function retrieve(input: {
  client: RagflowClient;
  datasetId: string;
  question: string;
  documents: ContextDocument[];
}): Promise<RagflowEvidence[]> {
  if (input.documents.length === 0) return [];
  const allowedDocuments = new Map(
    input.documents.map((document) => [document.ragflowDocumentId, document.displayName]),
  );
  const result = await input.client.retrieve({
    question: input.question,
    datasetIds: [input.datasetId],
    limit: WEEKLY_REPORT_LIMITS.maximumContextItemsPerProject,
  });
  return guardEvidence({
    evidence: result.evidence,
    datasetId: input.datasetId,
    allowedDocuments,
  });
}

export async function loadContextDocuments(
  projectIds: string[],
): Promise<ContextDocument[]> {
  if (projectIds.length === 0) return [];
  const rows = await getDb()
    .select({
      projectId: projectDocument.projectId,
      ragflowDocumentId: projectDocument.ragflowDocumentId,
      displayName: projectDocument.displayName,
      contextKind: projectDocument.contextKind,
    })
    .from(projectDocument)
    .where(and(
      inArray(projectDocument.projectId, projectIds),
      eq(projectDocument.status, "active"),
      eq(projectDocument.ragflowParseStatus, "ready"),
      isNotNull(projectDocument.ragflowDocumentId),
    ));
  return rows.flatMap((row) => row.ragflowDocumentId ? [{
    ...row,
    ragflowDocumentId: row.ragflowDocumentId,
  }] : []);
}

export async function buildProjectWeeklyReportContext(input: {
  project: AuthorizedProjectRecord;
  authorizedProjectIds: ReadonlySet<string>;
  facts: DailyReportFact[];
  documents: ContextDocument[];
  weekStart: string;
  weekEnd: string;
  client?: RagflowClient;
  structuredTimelineRepository?: StructuredTimelineRepository;
}): Promise<ProjectWeeklyReportContext> {
  const warnings: string[] = [];
  const base = {
    project: {
      id: input.project.id,
      name: input.project.name,
      clientName: input.project.clientName,
      status: input.project.status,
      stage: input.project.stage,
      statusLabel: projectStatusLabel(input.project),
      health: input.project.health,
      targetLaunchDate: input.project.targetLaunchDate,
    },
    dailyReport: { facts: input.facts },
    dailyReportFacts: input.facts,
  };
  const timelineDocuments = input.documents.filter(isTimelineDocument);
  const knowledgeDocuments = input.documents.filter((document) => !isTimelineDocument(document));
  const knowledgeReady = Boolean(
    input.project.ragflowDatasetId && input.project.knowledgeStatus === "ready",
  );
  if (!knowledgeReady) {
    warnings.push("项目知识空间未就绪；Knowledge 与 Timeline 文档 fallback 不可用");
  } else if (knowledgeDocuments.length === 0) {
    warnings.push("未找到通用项目知识文档");
  }

  let clientPromise: Promise<RagflowClient> | null = null;
  const getClient = () => {
    clientPromise ??= input.client
      ? Promise.resolve(input.client)
      : createRagflowClient();
    return clientPromise;
  };

  const datasetId = input.project.ragflowDatasetId;
  const timelinePromise = getProjectTimeline({
    projectId: input.project.id,
    authorizedProjectIds: input.authorizedProjectIds,
    period: { weekStart: input.weekStart, weekEnd: input.weekEnd },
    structuredRepository: input.structuredTimelineRepository,
    documentFallback: {
      available: knowledgeReady && timelineDocuments.length > 0,
      async load() {
        if (!datasetId) return [];
        return evidenceItems(
          await retrieve({
            client: await getClient(),
            datasetId,
            question: "项目 Timeline 当前阶段 里程碑 排期 上线日期 下一节点",
            documents: timelineDocuments,
          }),
          "timeline",
          "T",
          4,
          6_000,
        );
      },
    },
  });

  const taskQuery = input.facts.map((fact) => fact.task).join("；").slice(0, 1_500);
  const knowledgePromise = (async () => {
    if (!knowledgeReady || !datasetId || knowledgeDocuments.length === 0) return [];
    return retrieve({
      client: await getClient(),
      datasetId,
      question: "项目本周进展 下周计划 当前状态 决策 待办 " + taskQuery,
      documents: knowledgeDocuments,
    });
  })();

  const [timelineResult, knowledgeResult] = await Promise.allSettled([
    timelinePromise,
    knowledgePromise,
  ]);
  let timeline: ProjectTimelineContext;
  if (timelineResult.status === "fulfilled") {
    timeline = timelineResult.value;
  } else {
    if (timelineResult.reason instanceof ProjectTimelineAccessError) {
      throw timelineResult.reason;
    }
    warnings.push("结构化 Timeline 暂不可用；为避免排期冲突，未启用文档 fallback");
    timeline = {
      projectId: input.project.id,
      source: "none",
      currentPhase: null,
      phases: [],
      tasks: [],
      plannedThisWeek: [],
      plannedNextWeek: [],
      currentMilestones: [],
      futureMilestones: [],
      milestones: [],
      documentEvidence: [],
    };
  }

  let knowledgeEvidence: WeeklyReportEvidence[] = [];
  if (knowledgeResult.status === "fulfilled") {
    knowledgeEvidence = evidenceItems(
      knowledgeResult.value,
      "knowledge",
      "K",
      4,
      WEEKLY_REPORT_LIMITS.maximumContextCharactersPerProject -
        timeline.documentEvidence.reduce((sum, item) => sum + item.excerpt.length, 0),
    );
  } else {
    warnings.push("项目知识检索暂不可用");
  }
  if (timeline.source === "none") {
    warnings.push("未找到 Timeline；里程碑必须输出 /");
  } else if (
    timeline.source === "document_fallback" &&
    timeline.documentEvidence.length === 0
  ) {
    warnings.push("Timeline 未检索到可用片段；里程碑必须输出 /");
  }
  const timelineAvailable = timeline.source !== "none";
  const contextAvailability = timelineAvailable && knowledgeEvidence.length > 0
    ? "available"
    : timelineAvailable || knowledgeEvidence.length > 0
      ? "partial"
      : "unavailable";
  const timelineEvidence = timeline.documentEvidence;
  return {
    ...base,
    timeline,
    knowledge: { evidence: knowledgeEvidence },
    timelineEvidence,
    knowledgeEvidence,
    contextAvailability,
    contextWarnings: [...new Set(warnings)],
  };
}
