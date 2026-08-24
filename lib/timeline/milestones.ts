import type {
  ProjectTimelineMilestone,
  StructuredTimelineTask,
} from "./contracts";

/** Central, deterministic allow-list. Do not duplicate these rules in Skills. */
export const TIMELINE_MILESTONE_NAME_RULES = [
  /确认/iu,
  /\bapproval\b/iu,
  /\bsign[\s-]*off\b/iu,
  /\buat\b/iu,
  /上线/iu,
  /\blaunch\b/iu,
  /\bgo[\s-]*live\b/iu,
  /测试完成/iu,
  /\bdesign\s+confirmation\b/iu,
] as const;

export function milestoneFromTask(
  task: StructuredTimelineTask,
): ProjectTimelineMilestone | null {
  const basis = task.marker === "milestone"
    ? "timeline_marker"
    : task.marker === "phase_node" || task.marker === "key_task"
      ? "phase_or_key_task"
      : TIMELINE_MILESTONE_NAME_RULES.some((pattern) => pattern.test(task.name))
        ? "name_rule"
        : null;
  if (!basis) return null;
  return {
    name: task.name,
    date: task.endDate,
    stage: task.stage,
    status: task.status,
    basis,
  };
}
