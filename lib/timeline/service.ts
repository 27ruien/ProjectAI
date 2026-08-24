import {
  isIsoDate,
  nextReportingPeriod,
  overlapsPeriod,
  type ReportingPeriod,
} from "./dates";
import { milestoneFromTask } from "./milestones";
import type {
  ProjectTimelineContext,
  ProjectTimelineMilestone,
  ProjectTimelinePhase,
  ProjectTimelineTask,
  StructuredProjectTimeline,
  StructuredTimelineRepository,
  TimelineDocumentFallback,
} from "./contracts";

export const PROJECT_TIMELINE_LIMITS = {
  maximumTasksPerPeriod: 16,
  maximumMilestones: 8,
} as const;

export class ProjectTimelineAccessError extends Error {
  constructor() {
    super("Project Timeline access requires an authorized Project ID");
    this.name = "ProjectTimelineAccessError";
  }
}

export const unavailableStructuredTimelineRepository: StructuredTimelineRepository = {
  async findProjectTimeline() {
    return null;
  },
};

function emptyContext(projectId: string): ProjectTimelineContext {
  return {
    projectId,
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

function validTasks(timeline: StructuredProjectTimeline): ProjectTimelineTask[] {
  return timeline.tasks.filter((task) =>
    task.name.trim().length > 0 &&
    isIsoDate(task.startDate) &&
    isIsoDate(task.endDate) &&
    task.startDate <= task.endDate,
  );
}

function uniqueTasks(tasks: ProjectTimelineTask[]): ProjectTimelineTask[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = task.id ?? [task.stage, task.name, task.startDate, task.endDate].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phasesFromTasks(tasks: ProjectTimelineTask[]): ProjectTimelinePhase[] {
  const phases = new Map<string, ProjectTimelinePhase>();
  for (const task of tasks) {
    const name = task.stage?.trim();
    if (!name) continue;
    const existing = phases.get(name);
    if (!existing) {
      phases.set(name, {
        name,
        startsOn: task.startDate,
        endsOn: task.endDate,
        taskCount: 1,
      });
      continue;
    }
    existing.startsOn = existing.startsOn < task.startDate
      ? existing.startsOn
      : task.startDate;
    existing.endsOn = existing.endsOn > task.endDate
      ? existing.endsOn
      : task.endDate;
    existing.taskCount += 1;
  }
  return [...phases.values()];
}

function milestoneKey(milestone: ProjectTimelineMilestone): string {
  return milestone.name + "\u0000" + milestone.date;
}

function structuredContext(input: {
  projectId: string;
  timeline: StructuredProjectTimeline;
  period: ReportingPeriod;
}): ProjectTimelineContext {
  const allTasks = validTasks(input.timeline);
  const nextPeriod = nextReportingPeriod(input.period);
  const plannedThisWeek = allTasks
    .filter((task) => overlapsPeriod(task, input.period))
    .slice(0, PROJECT_TIMELINE_LIMITS.maximumTasksPerPeriod);
  const plannedNextWeek = allTasks
    .filter((task) => overlapsPeriod(task, nextPeriod))
    .slice(0, PROJECT_TIMELINE_LIMITS.maximumTasksPerPeriod);
  const tasks = uniqueTasks([...plannedThisWeek, ...plannedNextWeek]);
  const currentPhaseTask = [...plannedThisWeek]
    .filter((task) => task.stage?.trim())
    .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];

  const milestoneByKey = new Map<string, ProjectTimelineMilestone>();
  for (const task of allTasks) {
    const milestone = milestoneFromTask(task);
    if (milestone && milestone.date >= input.period.weekStart) {
      milestoneByKey.set(milestoneKey(milestone), milestone);
    }
  }
  const milestones = [...milestoneByKey.values()]
    .sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name))
    .slice(0, PROJECT_TIMELINE_LIMITS.maximumMilestones);
  const currentMilestones = milestones.filter(
    (milestone) =>
      milestone.date >= input.period.weekStart &&
      milestone.date <= input.period.weekEnd,
  );
  const futureMilestones = milestones.filter(
    (milestone) => milestone.date > input.period.weekEnd,
  );
  const milestoneTasks = allTasks.filter((task) =>
    milestones.some(
      (milestone) =>
        milestone.name === task.name && milestone.date === task.endDate,
    ),
  );

  return {
    projectId: input.projectId,
    source: "structured",
    currentPhase: currentPhaseTask?.stage?.trim() || null,
    phases: phasesFromTasks(uniqueTasks([...tasks, ...milestoneTasks])),
    tasks,
    plannedThisWeek,
    plannedNextWeek,
    currentMilestones,
    futureMilestones,
    milestones,
    documentEvidence: [],
  };
}

export async function getProjectTimeline(input: {
  projectId: string;
  authorizedProjectIds: ReadonlySet<string>;
  period: ReportingPeriod;
  structuredRepository?: StructuredTimelineRepository;
  documentFallback?: TimelineDocumentFallback;
}): Promise<ProjectTimelineContext> {
  if (!input.authorizedProjectIds.has(input.projectId)) {
    throw new ProjectTimelineAccessError();
  }
  const repository = input.structuredRepository ?? unavailableStructuredTimelineRepository;
  const structured = await repository.findProjectTimeline(input.projectId);
  if (structured) {
    if (structured.projectId !== input.projectId) {
      throw new ProjectTimelineAccessError();
    }
    return structuredContext({
      projectId: input.projectId,
      timeline: structured,
      period: input.period,
    });
  }
  if (input.documentFallback?.available) {
    const documentEvidence = await input.documentFallback.load();
    return {
      ...emptyContext(input.projectId),
      source: "document_fallback",
      documentEvidence,
    };
  }
  return emptyContext(input.projectId);
}
