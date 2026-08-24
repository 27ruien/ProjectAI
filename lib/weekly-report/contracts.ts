import { z } from "zod";
import type { ProjectTimelineContext } from "@/lib/timeline";

export const WEEKLY_REPORT_SKILL_ID = "project-weekly-report";
export const WEEKLY_REPORT_SKILL_VERSION = "1.2.0";
export const WEEKLY_REPORT_CONTEXT_SCHEMA_VERSION =
  "projectai-weekly-report-context-v1";

export const DAILY_REPORT_FIELD_ALIASES = {
  project: ["project", "project name", "项目", "项目名称", "所属项目"],
  task: ["task", "work", "content", "description", "日报", "工作内容", "任务描述", "任务", "事项"],
  date: ["date", "work date", "日期", "工作日期", "开始预计时间"],
  status: ["status", "状态", "完成状态"],
  progress: ["progress", "进展", "进度", "完成度"],
  owner: ["owner", "reporter", "member", "负责人", "汇报人", "成员"],
} as const;

export const WEEKLY_REPORT_MATCHER = {
  autoMatchThreshold: 85,
  confirmationThreshold: 70,
  ambiguityMargin: 8,
  maximumCandidates: 3,
  weights: {
    name: 60,
    membership: 20,
    active: 10,
    recentUsage: 10,
  },
} as const;

export const WEEKLY_REPORT_LIMITS = {
  maximumFileBytes: 10 * 1024 * 1024,
  maximumRows: 5_000,
  maximumCellCharacters: 2_000,
  maximumProjects: 30,
  maximumContextItemsPerProject: 8,
  maximumContextCharactersPerProject: 12_000,
} as const;

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "日期必须使用 YYYY-MM-DD");

export const matchOverrideSchema = z
  .object({
    sourceProjectName: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    saveAlias: z.boolean().optional().default(false),
  })
  .strict();

export const matchOverridesSchema = z
  .array(matchOverrideSchema)
  .max(WEEKLY_REPORT_LIMITS.maximumProjects);

export type DailyReportFact = {
  sourceRow: number;
  sourceSheet: string;
  projectName: string | null;
  task: string;
  date: string | null;
  status: string | null;
  progress: string | null;
  owner: string | null;
};

export type ParsedDailyReport = {
  filename: string;
  facts: DailyReportFact[];
  skippedOutsideWeek: number;
  warnings: string[];
};

export type ProjectMatchCandidate = {
  projectId: string;
  projectName: string;
  score: number;
  nameScore: number;
  reasons: string[];
};

export type ProjectMatch = {
  sourceProjectName: string;
  status: "matched" | "needs_confirmation" | "unmatched";
  method: "official_exact" | "alias_exact" | "override" | "fuzzy" | "none";
  projectId: string | null;
  projectName: string | null;
  candidates: ProjectMatchCandidate[];
};

export type WeeklyReportEvidence = {
  id: string;
  kind: "timeline" | "knowledge";
  documentId: string;
  documentName: string;
  excerpt: string;
  similarity: number | null;
};

export type ProjectWeeklyReportContext = {
  project: {
    id: string;
    name: string;
    clientName: string;
    status: string;
    stage: string;
    statusLabel: string;
    health: string;
    targetLaunchDate: string | null;
  };
  dailyReport: {
    facts: DailyReportFact[];
  };
  timeline: ProjectTimelineContext;
  knowledge: {
    evidence: WeeklyReportEvidence[];
  };
  /** Backward-compatible aliases retained for existing adapters. */
  dailyReportFacts: DailyReportFact[];
  timelineEvidence: WeeklyReportEvidence[];
  knowledgeEvidence: WeeklyReportEvidence[];
  contextAvailability: "available" | "partial" | "unavailable";
  contextWarnings: string[];
};

export type WeeklyReportExecutionPackage = {
  schemaVersion: typeof WEEKLY_REPORT_CONTEXT_SCHEMA_VERSION;
  executionId: string;
  generatedAt: string;
  currentDate: string;
  reportingPeriod: { weekStart: string; weekEnd: string };
  skill: {
    id: typeof WEEKLY_REPORT_SKILL_ID;
    version: typeof WEEKLY_REPORT_SKILL_VERSION;
    sha256: string;
    content: string;
    files: Record<string, string>;
  };
  source: {
    filename: string;
    parsedFactCount: number;
    skippedOutsideWeek: number;
    warnings: string[];
  };
  projects: ProjectWeeklyReportContext[];
  matches: ProjectMatch[];
  unmatchedItems: DailyReportFact[];
  output: {
    format: "markdown";
    filename: string;
  };
};

export type WeeklyReportNeedsConfirmation = {
  status: "needs_confirmation";
  confirmationRequired: true;
  unresolvedMatches: ProjectMatch[];
};

export type WeeklyReportFinalized = {
  status: "finalized";
  executionPackage: WeeklyReportExecutionPackage;
};

export type WeeklyReportBuildResult =
  | WeeklyReportNeedsConfirmation
  | WeeklyReportFinalized;
