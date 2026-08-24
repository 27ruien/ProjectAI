import { fuzzy } from "fast-fuzzy";
import type { AuthorizedProjectRecord } from "@/lib/db/repositories/project-repository";
import type { ProjectAliasRecord } from "@/lib/db/schema";
import {
  WEEKLY_REPORT_MATCHER,
  type ProjectMatch,
  type ProjectMatchCandidate,
} from "./contracts";

export function normalizeProjectName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-—–·.,，。/\\:：()（）\[\]【】]+/gu, "")
    .replace(/(?:项目|project)$/u, "");
}

function activeProject(status: AuthorizedProjectRecord["status"]): boolean {
  return status === "planning" || status === "active" || status === "at_risk";
}

function candidate(input: {
  source: string;
  project: AuthorizedProjectRecord;
  recentProjectIds: ReadonlySet<string>;
}): ProjectMatchCandidate {
  const similarity = fuzzy(
    normalizeProjectName(input.source),
    normalizeProjectName(input.project.name),
  );
  const nameScore = Math.round(similarity * WEEKLY_REPORT_MATCHER.weights.name);
  const reasons: string[] = ["名称相似度 " + Math.round(similarity * 100) + "%"];
  let score = nameScore;
  if (input.project.projectRole !== null) {
    score += WEEKLY_REPORT_MATCHER.weights.membership;
    reasons.push("当前用户具备项目访问关系");
  }
  if (activeProject(input.project.status)) {
    score += WEEKLY_REPORT_MATCHER.weights.active;
    reasons.push("项目处于活动状态");
  }
  if (input.recentProjectIds.has(input.project.id)) {
    score += WEEKLY_REPORT_MATCHER.weights.recentUsage;
    reasons.push("近期访问过项目");
  }
  return {
    projectId: input.project.id,
    projectName: input.project.name,
    score: Math.min(100, score),
    nameScore,
    reasons,
  };
}

function matched(
  sourceProjectName: string,
  method: ProjectMatch["method"],
  project: AuthorizedProjectRecord,
): ProjectMatch {
  return {
    sourceProjectName,
    status: "matched",
    method,
    projectId: project.id,
    projectName: project.name,
    candidates: [{
      projectId: project.id,
      projectName: project.name,
      score: 100,
      nameScore: WEEKLY_REPORT_MATCHER.weights.name,
      reasons: [method === "override" ? "用户明确确认" : "名称确定匹配"],
    }],
  };
}

export function matchProjects(input: {
  sourceProjectNames: string[];
  authorizedProjects: AuthorizedProjectRecord[];
  aliases?: ProjectAliasRecord[];
  overrides?: ReadonlyMap<string, string>;
  recentProjectIds?: ReadonlySet<string>;
}): ProjectMatch[] {
  const projectsById = new Map(input.authorizedProjects.map((project) => [project.id, project]));
  const official = new Map<string, AuthorizedProjectRecord[]>();
  for (const project of input.authorizedProjects) {
    const key = normalizeProjectName(project.name);
    official.set(key, [...(official.get(key) ?? []), project]);
  }
  const aliases = new Map<string, AuthorizedProjectRecord[]>();
  for (const alias of input.aliases ?? []) {
    const project = projectsById.get(alias.projectId);
    if (!project) continue;
    const key = normalizeProjectName(alias.normalizedAlias || alias.alias);
    aliases.set(key, [...(aliases.get(key) ?? []), project]);
  }
  const recentProjectIds = input.recentProjectIds ?? new Set<string>();
  const uniqueNames = [...new Map(
    input.sourceProjectNames
      .filter((value) => value.trim())
      .map((value) => [normalizeProjectName(value), value.trim()]),
  ).entries()]
    .filter(([normalized]) => normalized)
    .map(([, value]) => value);

  return uniqueNames.map((sourceProjectName) => {
    const normalized = normalizeProjectName(sourceProjectName);
    const override = input.overrides?.get(normalized);
    if (override) {
      const project = projectsById.get(override);
      if (project) return matched(sourceProjectName, "override", project);
    }
    const officialMatches = official.get(normalized) ?? [];
    if (officialMatches.length === 1) {
      return matched(sourceProjectName, "official_exact", officialMatches[0]);
    }
    if (officialMatches.length > 1) {
      return {
        sourceProjectName,
        status: "needs_confirmation",
        method: "official_exact",
        projectId: null,
        projectName: null,
        candidates: officialMatches
          .slice(0, WEEKLY_REPORT_MATCHER.maximumCandidates)
          .map((project) => ({
            projectId: project.id,
            projectName: project.name,
            score: 100,
            nameScore: WEEKLY_REPORT_MATCHER.weights.name,
            reasons: ["多个项目具有相同的标准化正式名称"],
          })),
      };
    }
    const aliasMatches = aliases.get(normalized) ?? [];
    if (aliasMatches.length === 1) {
      return matched(sourceProjectName, "alias_exact", aliasMatches[0]);
    }
    if (aliasMatches.length > 1) {
      return {
        sourceProjectName,
        status: "needs_confirmation",
        method: "alias_exact",
        projectId: null,
        projectName: null,
        candidates: aliasMatches
          .slice(0, WEEKLY_REPORT_MATCHER.maximumCandidates)
          .map((project) => ({
            projectId: project.id,
            projectName: project.name,
            score: 100,
            nameScore: WEEKLY_REPORT_MATCHER.weights.name,
            reasons: ["多个项目保存了相同别名"],
          })),
      };
    }

    const candidates = input.authorizedProjects
      .map((project) => candidate({ source: sourceProjectName, project, recentProjectIds }))
      .sort((left, right) => right.score - left.score || right.nameScore - left.nameScore)
      .slice(0, WEEKLY_REPORT_MATCHER.maximumCandidates);
    const top = candidates[0];
    const runnerUp = candidates[1];
    const ambiguous = Boolean(
      runnerUp && top && top.score - runnerUp.score < WEEKLY_REPORT_MATCHER.ambiguityMargin,
    );
    if (
      top &&
      top.score >= WEEKLY_REPORT_MATCHER.autoMatchThreshold &&
      !ambiguous
    ) {
      const project = projectsById.get(top.projectId)!;
      return {
        sourceProjectName,
        status: "matched",
        method: "fuzzy",
        projectId: project.id,
        projectName: project.name,
        candidates,
      };
    }
    if (top && top.score >= WEEKLY_REPORT_MATCHER.confirmationThreshold) {
      return {
        sourceProjectName,
        status: "needs_confirmation",
        method: "fuzzy",
        projectId: null,
        projectName: null,
        candidates,
      };
    }
    return {
      sourceProjectName,
      status: "unmatched",
      method: "none",
      projectId: null,
      projectName: null,
      candidates,
    };
  });
}
