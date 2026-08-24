import { z } from "zod";
import {
  timelineWorkbenchDataSchema,
  type TimelineWorkbenchData,
} from "@/lib/timeline/persistence";

export const TIMELINE_MAKER_SKILL_ID = "project-timeline-maker";
export const TIMELINE_MAKER_SKILL_VERSION = "0.1.0";
export const TIMELINE_MAKER_DRAFT_SCHEMA_VERSION =
  "projectai-timeline-maker-draft-v1";

export const timelineMakerRequirementStatusSchema = z.enum([
  "CONFIRMED",
  "MISSING",
  "UNCLEAR",
  "NOT_APPLICABLE",
]);

export const timelineMakerRequirementDomainSchema = z.enum([
  "campaign_event",
  "personal_information",
  "photo_face_biometric",
  "visual_design",
  "development_integration",
  "launch_uat",
  "hardware",
]);

export const timelineMakerBasisSchema = z.enum([
  "confirmed",
  "requirement_gap",
  "inferred",
]);

const dateOrEmptySchema = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
]);

export const timelineMakerRequirementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(120),
    domain: timelineMakerRequirementDomainSchema,
    label: z.string().trim().min(1).max(200),
    status: timelineMakerRequirementStatusSchema,
    evidence: z.string().trim().min(1).max(2_000).nullable(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (
      (requirement.status === "CONFIRMED" ||
        requirement.status === "NOT_APPLICABLE") &&
      !requirement.evidence
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: `${requirement.status} requirement needs supplied evidence`,
      });
    }
  });

export const timelineMakerPhaseSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    basis: timelineMakerBasisSchema,
    basisDetail: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const timelineMakerAssumptionSchema = z
  .object({
    id: z.string().regex(/^assumption-[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(120),
    statement: z.string().trim().min(1).max(1_000),
    affectedTaskIds: z.array(z.string().trim().min(1).max(120)).max(100),
  })
  .strict();

export const timelineMakerTaskSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    stage: z.string().trim().max(200),
    name: z.string().trim().min(1).max(500),
    owners: z.array(z.string().trim().min(1).max(200)).max(8),
    status: z.enum(["incomplete", "done"]),
    start: dateOrEmptySchema,
    end: dateOrEmptySchema,
    basis: timelineMakerBasisSchema,
    basisDetail: z.string().trim().min(1).max(1_000),
    requirementIds: z.array(z.string().trim().min(1).max(120)).max(20),
    assumptionId: z.string().trim().min(1).max(120).nullable(),
  })
  .strict()
  .superRefine((task, context) => {
    if (task.start && task.end && task.start > task.end) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Task end date cannot precede start date",
      });
    }
    if (task.basis === "requirement_gap" && task.requirementIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["requirementIds"],
        message: "Requirement-gap task must reference a requirement",
      });
    }
    if (task.basis === "inferred" && !task.assumptionId) {
      context.addIssue({
        code: "custom",
        path: ["assumptionId"],
        message: "Inferred task must reference a planning assumption",
      });
    }
    if (task.basis !== "inferred" && task.assumptionId) {
      context.addIssue({
        code: "custom",
        path: ["assumptionId"],
        message: "Only inferred tasks may reference a planning assumption",
      });
    }
  });

export const timelineMakerDraftSchema = z
  .object({
    schemaVersion: z.literal(TIMELINE_MAKER_DRAFT_SCHEMA_VERSION),
    skillId: z.literal(TIMELINE_MAKER_SKILL_ID),
    skillVersion: z.literal(TIMELINE_MAKER_SKILL_VERSION),
    title: z.string().trim().min(1).max(200),
    mode: z.enum(["create_draft", "propose_update"]),
    existingTimelineVersion: z.number().int().positive().nullable(),
    language: z.enum(["zh", "en"]),
    requirements: z.array(timelineMakerRequirementSchema).max(200),
    phases: z.array(timelineMakerPhaseSchema).min(1).max(50),
    tasks: z.array(timelineMakerTaskSchema).min(1).max(500),
    assumptions: z.array(timelineMakerAssumptionSchema).max(100),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.mode === "create_draft" && draft.existingTimelineVersion !== null) {
      context.addIssue({
        code: "custom",
        path: ["existingTimelineVersion"],
        message: "A new draft cannot target an existing Timeline version",
      });
    }
    if (draft.mode === "propose_update" && draft.existingTimelineVersion === null) {
      context.addIssue({
        code: "custom",
        path: ["existingTimelineVersion"],
        message: "A proposed update must identify the reviewed Timeline version",
      });
    }

    const phaseNames = new Set<string>();
    for (const [index, phase] of draft.phases.entries()) {
      if (phaseNames.has(phase.name)) {
        context.addIssue({
          code: "custom",
          path: ["phases", index, "name"],
          message: "Phase names must be unique",
        });
      }
      phaseNames.add(phase.name);
    }
    const taskIds = new Set<string>();
    const tasksById = new Map<string, TimelineMakerTask>();
    const requirementsById = new Map<string, TimelineMakerRequirement>();
    for (const [index, requirement] of draft.requirements.entries()) {
      if (requirementsById.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirements", index, "id"],
          message: "Requirement IDs must be unique",
        });
      }
      requirementsById.set(requirement.id, requirement);
    }
    const assumptionsById = new Map(
      draft.assumptions.map((item) => [item.id, item] as const),
    );
    if (assumptionsById.size !== draft.assumptions.length) {
      context.addIssue({
        code: "custom",
        path: ["assumptions"],
        message: "Planning Assumption IDs must be unique",
      });
    }
    for (const [index, task] of draft.tasks.entries()) {
      if (taskIds.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: "Task IDs must be unique",
        });
      }
      taskIds.add(task.id);
      tasksById.set(task.id, task);
      if (task.stage && !phaseNames.has(task.stage)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "stage"],
          message: "Task stage must reference a declared phase",
        });
      }
      for (const requirementId of task.requirementIds) {
        const requirement = requirementsById.get(requirementId);
        if (!requirement) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "requirementIds"],
            message: "Task references an unknown requirement",
          });
        } else if (
          task.basis === "requirement_gap" &&
          requirement.status !== "MISSING" &&
          requirement.status !== "UNCLEAR"
        ) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "requirementIds"],
            message: "Requirement-gap task must reference a missing or unclear requirement",
          });
        }
      }
      if (task.assumptionId) {
        const assumption = assumptionsById.get(task.assumptionId);
        if (!assumption) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "assumptionId"],
            message: "Task references an unknown planning assumption",
          });
        } else if (!assumption.affectedTaskIds.includes(task.id)) {
          context.addIssue({
            code: "custom",
            path: ["tasks", index, "assumptionId"],
            message: "Planning Assumption must list every inferred task it affects",
          });
        }
      }
    }
    for (const [index, assumption] of draft.assumptions.entries()) {
      for (const taskId of assumption.affectedTaskIds) {
        const task = tasksById.get(taskId);
        if (!task) {
          context.addIssue({
            code: "custom",
            path: ["assumptions", index, "affectedTaskIds"],
            message: "Planning assumption references an unknown task",
          });
        } else if (task.basis !== "inferred" || task.assumptionId !== assumption.id) {
          context.addIssue({
            code: "custom",
            path: ["assumptions", index, "affectedTaskIds"],
            message: "Planning Assumption may list only tasks that reference it",
          });
        }
      }
    }
  });

export const TIMELINE_MAKER_TOOL_CAPABILITIES = [
  "get_project_timeline",
  "create_timeline_draft",
  "propose_timeline_update",
] as const;

export const timelineMakerCapabilityRequestSchema = z
  .object({
    capability: z.enum([
      "create_timeline_draft",
      "propose_timeline_update",
    ]),
    projectId: z.string().trim().min(1).max(200),
    expectedTimelineVersion: z.number().int().positive().nullable(),
    draft: timelineMakerDraftSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.capability === "create_timeline_draft" &&
      (request.expectedTimelineVersion !== null || request.draft.mode !== "create_draft")
    ) {
      context.addIssue({
        code: "custom",
        path: ["capability"],
        message: "Create capability only accepts a new draft without an existing version",
      });
    }
    if (
      request.capability === "propose_timeline_update" &&
      (
        request.expectedTimelineVersion === null ||
        request.draft.mode !== "propose_update" ||
        request.expectedTimelineVersion !== request.draft.existingTimelineVersion
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["capability"],
        message: "Update proposals must target the reviewed existing Timeline version",
      });
    }
  });

export type TimelineMakerRequirementStatus = z.infer<
  typeof timelineMakerRequirementStatusSchema
>;
export type TimelineMakerRequirementDomain = z.infer<
  typeof timelineMakerRequirementDomainSchema
>;
export type TimelineMakerBasis = z.infer<typeof timelineMakerBasisSchema>;
export type TimelineMakerRequirement = z.infer<typeof timelineMakerRequirementSchema>;
export type TimelineMakerDraft = z.infer<typeof timelineMakerDraftSchema>;
export type TimelineMakerTask = z.infer<typeof timelineMakerTaskSchema>;
export type TimelineMakerCapabilityRequest = z.infer<
  typeof timelineMakerCapabilityRequestSchema
>;

export function timelineMakerDraftToWorkbenchData(
  input: TimelineMakerDraft,
): TimelineWorkbenchData {
  const draft = timelineMakerDraftSchema.parse(input);
  return timelineWorkbenchDataSchema.parse({
    schemaVersion: 1,
    language: draft.language,
    includeStatus: true,
    tasks: draft.tasks.map((task) => ({
      id: task.id,
      stage: task.stage,
      name: task.name,
      owners: task.owners,
      status: task.status,
      start: task.start,
      end: task.end,
    })),
  });
}
