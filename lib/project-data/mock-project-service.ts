import "server-only";

import type {
  ProjectMockPayload,
  SerializableRecord,
  WorkspaceMockPayload,
} from "@/lib/auth/ui-types";
import {
  actions,
  activities,
  aiExecutionLogs,
  citations,
  decisions,
  documents,
  meetings,
  modelProfiles,
  models,
  projects,
  providers,
  requirements,
  reviews,
  risks,
  scopeChanges,
  scopes,
  skills,
  workflows,
} from "@/data/mock";
import {
  applyReviewProjectPermissions,
  type AuthorizedReviewProject,
} from "./review-permissions";

function serialize<T>(record: T): SerializableRecord {
  return JSON.parse(JSON.stringify(record)) as SerializableRecord;
}

function serializeMany<T>(records: readonly T[]): SerializableRecord[] {
  return records.map(serialize);
}

function exactProject<T extends { projectId: string }>(
  records: readonly T[],
  projectId: string,
): SerializableRecord[] {
  return records
    .filter((record) => record.projectId === projectId)
    .map(serialize);
}

export function getAuthorizedMockProjectPayload(
  authorizedProjectId: string,
): ProjectMockPayload {
  const projectRecord = projects.find(
    (item) => item.projectId === authorizedProjectId,
  );
  return {
    projectId: authorizedProjectId,
    project: projectRecord ? serialize(projectRecord) : null,
    documents: exactProject(documents, authorizedProjectId),
    citations: exactProject(citations, authorizedProjectId),
    requirements: exactProject(requirements, authorizedProjectId),
    scopes: exactProject(scopes, authorizedProjectId),
    scopeChanges: exactProject(scopeChanges, authorizedProjectId),
    actions: exactProject(actions, authorizedProjectId),
    activities: exactProject(activities, authorizedProjectId),
    decisions: exactProject(decisions, authorizedProjectId),
    reviews: exactProject(reviews, authorizedProjectId),
    risks: exactProject(risks, authorizedProjectId),
    meetings: exactProject(meetings, authorizedProjectId),
  };
}

export function getAuthorizedWorkspaceMockPayload(
  authorizedProjects: readonly AuthorizedReviewProject[],
): WorkspaceMockPayload {
  const authorized = new Set(authorizedProjects.map((project) => project.id));
  const isAuthorized = (record: { projectId?: string }) =>
    Boolean(record.projectId && authorized.has(record.projectId));

  return {
    skills: serializeMany(skills),
    workflows: serializeMany(workflows),
    aiProviders: serializeMany(providers),
    aiModels: serializeMany(models),
    aiModelProfiles: serializeMany(modelProfiles),
    reviews: applyReviewProjectPermissions(reviews, authorizedProjects),
    citations: serializeMany(citations.filter(isAuthorized)),
    aiExecutions: serializeMany(aiExecutionLogs.filter(isAuthorized)),
  };
}
