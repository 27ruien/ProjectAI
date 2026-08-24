import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { resolveProjectPermissions } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { databaseStructuredTimelineRepository } from "@/lib/db/repositories/project-timeline-repository";
import {
  listProjectAliases,
  saveProjectAlias,
} from "@/lib/db/repositories/project-alias-repository";
import {
  listAuthorizedProjects,
  type AuthorizedProjectRecord,
} from "@/lib/db/repositories/project-repository";
import { auditEvent } from "@/lib/db/schema";
import type { RagflowClient } from "@/lib/ragflow";
import type { StructuredTimelineRepository } from "@/lib/timeline";
import {
  WEEKLY_REPORT_CONTEXT_SCHEMA_VERSION,
  WEEKLY_REPORT_LIMITS,
  WEEKLY_REPORT_SKILL_ID,
  type DailyReportFact,
  type ProjectMatch,
  type WeeklyReportBuildResult,
  type WeeklyReportExecutionPackage,
  type WeeklyReportNeedsConfirmation,
} from "./contracts";
import { parseDailyReportFile } from "./daily-report";
import { WeeklyReportError } from "./errors";
import { matchProjects, normalizeProjectName } from "./project-matcher";
import {
  buildProjectWeeklyReportContext,
  loadContextDocuments,
} from "./project-context";
import { loadWeeklyReportSkill } from "./skill";

export type MatchOverrideInput = {
  sourceProjectName: string;
  projectId: string;
  saveAlias: boolean;
};

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function validateReportingPeriod(weekStart: string, weekEnd: string): void {
  const start = parseIsoDate(weekStart);
  const end = parseIsoDate(weekEnd);
  const durationDays = start && end
    ? Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1
    : 0;
  if (!start || !end || durationDays < 1 || durationDays > 7) {
    throw new WeeklyReportError(400, "INVALID_REPORTING_PERIOD", "周报日期范围必须为 1 至 7 天");
  }
}

function currentShanghaiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function recentProjectIds(
  principal: AuthenticatedPrincipal,
  authorizedProjectIds: string[],
): Promise<Set<string>> {
  if (authorizedProjectIds.length === 0) return new Set();
  const since = new Date(Date.now() - 90 * 86_400_000);
  const rows = await getDb()
    .select({ projectId: auditEvent.projectId })
    .from(auditEvent)
    .where(and(
      eq(auditEvent.actorUserId, principal.user.id),
      eq(auditEvent.eventType, "project_viewed"),
      gte(auditEvent.createdAt, since),
      isNotNull(auditEvent.projectId),
      inArray(auditEvent.projectId, authorizedProjectIds),
    ));
  return new Set(rows.flatMap((row) => row.projectId ? [row.projectId] : []));
}

export function resolveMatchOverrides(input: {
  overrides: MatchOverrideInput[];
  projectsById: Map<string, AuthorizedProjectRecord>;
  sourceNames: Set<string>;
}): Map<string, string> {
  const result = new Map<string, string>();
  for (const override of input.overrides) {
    const source = normalizeProjectName(override.sourceProjectName);
    if (!source || !input.sourceNames.has(source)) {
      throw new WeeklyReportError(400, "INVALID_MATCH_OVERRIDE", "项目确认项不在本次日报中");
    }
    if (!input.projectsById.has(override.projectId)) {
      throw new WeeklyReportError(404, "PROJECT_NOT_FOUND", "项目不存在");
    }
    if (result.has(source)) {
      throw new WeeklyReportError(400, "DUPLICATE_MATCH_OVERRIDE", "同一日报项目只能确认一次");
    }
    result.set(source, override.projectId);
  }
  return result;
}

export function matchConfirmationRequired(
  matches: ProjectMatch[],
): WeeklyReportNeedsConfirmation | null {
  const unresolvedMatches = matches.filter(
    (match) => match.status === "needs_confirmation",
  );
  return unresolvedMatches.length > 0
    ? {
        status: "needs_confirmation",
        confirmationRequired: true,
        unresolvedMatches,
      }
    : null;
}

export function confirmationRequiredAuditEvent(input: {
  actorUserId: string;
  filename: string;
  sourceSizeBytes: number;
  parsedFactCount: number;
  unresolvedMatches: ProjectMatch[];
}) {
  return {
    actorUserId: input.actorUserId,
    eventType: "weekly_report_match_confirmation_required",
    entityType: "skill_execution_package",
    result: "denied" as const,
    metadata: {
      skillId: WEEKLY_REPORT_SKILL_ID,
      sourceNameHash: createHash("sha256").update(input.filename).digest("hex"),
      sourceSizeBytes: input.sourceSizeBytes,
      parsedFactCount: input.parsedFactCount,
      unresolvedMatchCount: input.unresolvedMatches.length,
      candidateCount: input.unresolvedMatches.reduce(
        (sum, match) => sum + match.candidates.length,
        0,
      ),
    },
  };
}

async function saveConfirmedAliases(input: {
  overrides: MatchOverrideInput[];
  projectsById: Map<string, AuthorizedProjectRecord>;
  principal: AuthenticatedPrincipal;
}): Promise<void> {
  const aliasesToSave = input.overrides.filter((item) => item.saveAlias);
  for (const override of aliasesToSave) {
    const project = input.projectsById.get(override.projectId)!;
    if (!resolveProjectPermissions(input.principal, project).canEditProject) {
      throw new WeeklyReportError(403, "PROJECT_ALIAS_WRITE_FORBIDDEN", "无权保存此项目别名");
    }
    const normalizedAlias = normalizeProjectName(override.sourceProjectName);
    if (!normalizedAlias) {
      throw new WeeklyReportError(400, "INVALID_PROJECT_ALIAS", "项目别名无效");
    }
  }
  for (const override of aliasesToSave) {
    const project = input.projectsById.get(override.projectId)!;
    const normalizedAlias = normalizeProjectName(override.sourceProjectName);
    await saveProjectAlias({
      projectId: project.id,
      alias: override.sourceProjectName.trim(),
      normalizedAlias,
      actorUserId: input.principal.user.id,
    });
  }
}

export function groupFactsByMatchedProject(input: {
  facts: DailyReportFact[];
  projectIdBySource: Map<string, string>;
}): { byProject: Map<string, DailyReportFact[]>; unmatched: DailyReportFact[] } {
  const byProject = new Map<string, DailyReportFact[]>();
  const unmatched: DailyReportFact[] = [];
  for (const fact of input.facts) {
    const projectId = fact.projectName
      ? input.projectIdBySource.get(normalizeProjectName(fact.projectName))
      : null;
    if (!projectId) {
      unmatched.push(fact);
      continue;
    }
    byProject.set(projectId, [...(byProject.get(projectId) ?? []), fact]);
  }
  return { byProject, unmatched };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

export async function buildWeeklyReportExecutionPackage(input: {
  principal: AuthenticatedPrincipal;
  file: File;
  weekStart: string;
  weekEnd: string;
  matchOverrides?: MatchOverrideInput[];
  ragflowClient?: RagflowClient;
  structuredTimelineRepository?: StructuredTimelineRepository;
}): Promise<WeeklyReportBuildResult> {
  validateReportingPeriod(input.weekStart, input.weekEnd);
  const parsed = await parseDailyReportFile({
    file: input.file,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
  });
  const sourceProjectNames = parsed.facts.flatMap((fact) => fact.projectName ? [fact.projectName] : []);
  const normalizedSourceNames = new Set(sourceProjectNames.map(normalizeProjectName));
  if (normalizedSourceNames.size > WEEKLY_REPORT_LIMITS.maximumProjects) {
    throw new WeeklyReportError(413, "DAILY_REPORT_TOO_MANY_PROJECTS", "单次周报最多支持 30 个项目");
  }

  const projects = await listAuthorizedProjects(
    input.principal.user.id,
    input.principal.user.productRole,
  );
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const projectIds = projects.map((project) => project.id);
  const [aliases, recent] = await Promise.all([
    listProjectAliases(projectIds),
    recentProjectIds(input.principal, projectIds),
  ]);
  const matchOverrides = input.matchOverrides ?? [];
  const overrideMap = resolveMatchOverrides({
    overrides: matchOverrides,
    projectsById,
    sourceNames: normalizedSourceNames,
  });
  const matches = matchProjects({
    sourceProjectNames,
    authorizedProjects: projects,
    aliases,
    overrides: overrideMap,
    recentProjectIds: recent,
  });
  const confirmation = matchConfirmationRequired(matches);
  if (confirmation) {
    await writeAuditEvent(confirmationRequiredAuditEvent({
      actorUserId: input.principal.user.id,
      filename: input.file.name,
      sourceSizeBytes: input.file.size,
      parsedFactCount: parsed.facts.length,
      unresolvedMatches: confirmation.unresolvedMatches,
    }));
    return confirmation;
  }
  await saveConfirmedAliases({
    overrides: matchOverrides,
    projectsById,
    principal: input.principal,
  });

  const projectIdBySource = new Map(
    matches.flatMap((match) => match.status === "matched" && match.projectId
      ? [[normalizeProjectName(match.sourceProjectName), match.projectId] as const]
      : []),
  );
  const grouped = groupFactsByMatchedProject({ facts: parsed.facts, projectIdBySource });
  const matchedProjects = [...grouped.byProject.keys()].map((projectId) => projectsById.get(projectId)!);
  const authorizedProjectIds = new Set(projectIds);
  const [documents, skill] = await Promise.all([
    loadContextDocuments(matchedProjects.map((project) => project.id)),
    loadWeeklyReportSkill(),
  ]);
  const structuredTimelineRepository =
    input.structuredTimelineRepository ?? databaseStructuredTimelineRepository;
  const contexts = await mapWithConcurrency(matchedProjects, 4, (project) =>
    buildProjectWeeklyReportContext({
      project,
      authorizedProjectIds,
      facts: grouped.byProject.get(project.id) ?? [],
      documents: documents.filter((document) => document.projectId === project.id),
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      client: input.ragflowClient,
      structuredTimelineRepository,
    }),
  );
  const executionId = "weekly-report-" + crypto.randomUUID();
  await writeAuditEvent({
    actorUserId: input.principal.user.id,
    eventType: "weekly_report_context_built",
    entityType: "skill_execution_package",
    entityId: executionId,
    result: "succeeded",
    metadata: {
      skillId: skill.id,
      skillVersion: skill.version,
      sourceNameHash: createHash("sha256").update(input.file.name).digest("hex"),
      sourceSizeBytes: input.file.size,
      parsedFactCount: parsed.facts.length,
      matchedProjectCount: contexts.length,
      unmatchedFactCount: grouped.unmatched.length,
      contextItemCount: contexts.reduce(
        (sum, context) =>
          sum +
          context.timeline.tasks.length +
          context.timeline.milestones.length +
          context.timelineEvidence.length +
          context.knowledgeEvidence.length,
        0,
      ),
    },
  });
  const executionPackage: WeeklyReportExecutionPackage = {
    schemaVersion: WEEKLY_REPORT_CONTEXT_SCHEMA_VERSION,
    executionId,
    generatedAt: new Date().toISOString(),
    currentDate: currentShanghaiDate(),
    reportingPeriod: { weekStart: input.weekStart, weekEnd: input.weekEnd },
    skill: {
      id: skill.id,
      version: skill.version,
      sha256: skill.sha256,
      content: skill.content,
      files: skill.files,
    },
    source: {
      filename: parsed.filename,
      parsedFactCount: parsed.facts.length,
      skippedOutsideWeek: parsed.skippedOutsideWeek,
      warnings: parsed.warnings,
    },
    projects: contexts,
    matches,
    unmatchedItems: grouped.unmatched,
    output: {
      format: "markdown",
      filename: "weekly-report-" + input.weekEnd + ".md",
    },
  };
  return { status: "finalized", executionPackage };
}
