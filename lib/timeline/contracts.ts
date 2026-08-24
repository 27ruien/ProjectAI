export type ProjectTimelineSource =
  | "structured"
  | "document_fallback"
  | "none";

export type StructuredTimelineMarker =
  | "milestone"
  | "phase_node"
  | "key_task";

/**
 * Provider-neutral shape aligned with the existing Timeline Workbench task
 * model: stage, task name, owners, date range, and optional status. A future
 * persistence adapter may also map an existing explicit marker when one is
 * available; the Weekly Report module never reads storage rows directly.
 */
export type StructuredTimelineTask = {
  id?: string;
  stage: string | null;
  name: string;
  owners: string[];
  startDate: string;
  endDate: string;
  status: string | null;
  marker?: StructuredTimelineMarker | null;
};

export type StructuredProjectTimeline = {
  projectId: string;
  tasks: StructuredTimelineTask[];
};

export type ProjectTimelineTask = StructuredTimelineTask;

export type ProjectTimelinePhase = {
  name: string;
  startsOn: string;
  endsOn: string;
  taskCount: number;
};

export type ProjectTimelineMilestone = {
  name: string;
  date: string;
  stage: string | null;
  status: string | null;
  basis: "timeline_marker" | "phase_or_key_task" | "name_rule";
};

export type ProjectTimelineDocumentEvidence = {
  id: string;
  kind: "timeline";
  documentId: string;
  documentName: string;
  excerpt: string;
  similarity: number | null;
};

export type ProjectTimelineContext = {
  projectId: string;
  source: ProjectTimelineSource;
  currentPhase: string | null;
  phases: ProjectTimelinePhase[];
  /** Bounded union of this-week and next-week tasks; never the full Timeline. */
  tasks: ProjectTimelineTask[];
  plannedThisWeek: ProjectTimelineTask[];
  plannedNextWeek: ProjectTimelineTask[];
  currentMilestones: ProjectTimelineMilestone[];
  futureMilestones: ProjectTimelineMilestone[];
  milestones: ProjectTimelineMilestone[];
  documentEvidence: ProjectTimelineDocumentEvidence[];
};

export interface StructuredTimelineRepository {
  findProjectTimeline(projectId: string): Promise<StructuredProjectTimeline | null>;
}

export type TimelineDocumentFallback = {
  available: boolean;
  load(): Promise<ProjectTimelineDocumentEvidence[]>;
};
