import type { EntityAudit, EntityId } from "./common";

export type SkillStatus = "active" | "inactive" | "deprecated" | "draft";

export interface SkillStep {
  id: EntityId;
  name: string;
  description: string;
  order: number;
}

export interface SkillValidator {
  id: EntityId;
  name: string;
  rule: string;
  severity: "warning" | "error";
}

export interface Skill extends EntityAudit {
  id: EntityId;
  name: string;
  displayName: string;
  version: string;
  owner: string;
  module: string;
  status: SkillStatus;
  description: string;
  useCases: string[];
  excludedUseCases: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  steps: SkillStep[];
  validators: SkillValidator[];
  modelProfileId: EntityId;
  fallbackModelProfileId: EntityId;
  approvalRequired: boolean;
  averageDurationMs: number;
  averageCost: number;
  usageCount: number;
  approvalRate: number;
  manualEditRate: number;
  versionHistory: Array<{
    version: string;
    updatedAt: string;
    summary: string;
  }>;
}

export type WorkflowStatus = "active" | "inactive" | "draft" | "deprecated";
export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface WorkflowStep {
  id: EntityId;
  name: string;
  description: string;
  order: number;
  skillId?: EntityId;
  status?: WorkflowStepStatus;
}

export interface Workflow extends EntityAudit {
  id: EntityId;
  name: string;
  displayName: string;
  description: string;
  status: WorkflowStatus;
  skillIds: EntityId[];
  steps: WorkflowStep[];
  approvalRequired: boolean;
}

export interface WorkflowExecution extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  version: number;
  sourceIds: EntityId[];
  workflowId: EntityId;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  steps: WorkflowStep[];
  currentStepId?: EntityId;
  inputDocumentIds: EntityId[];
  processedDocumentIds: EntityId[];
  extractedRequirementCount: number;
  duplicateCount: number;
  conflictCount: number;
  pendingQuestionCount: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  modelProfileId: EntityId;
  skillIds: EntityId[];
  executionLogIds: EntityId[];
}
