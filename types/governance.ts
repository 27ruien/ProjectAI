import type {
  EntityAudit,
  EntityId,
  ISODateString,
  ProjectScopedEntity,
  ReviewStatus,
} from "./common";

export type MeetingType =
  | "clientWorkshop"
  | "weeklySync"
  | "internalReview"
  | "kickoff"
  | "acceptance"
  | "riskReview";

export interface Meeting extends ProjectScopedEntity {
  title: string;
  startAt: ISODateString;
  durationMinutes: number;
  participants: string[];
  type: MeetingType;
  rawNotes: string;
  aiSummary: string;
  decisionIds: EntityId[];
  requirementIds: EntityId[];
  scopeChangeIds: EntityId[];
  actionItemIds: EntityId[];
  riskIds: EntityId[];
  openQuestions: string[];
  reviewStatus: ReviewStatus;
}

export interface Decision extends ProjectScopedEntity {
  decisionId: string;
  meetingId: EntityId;
  title: string;
  content: string;
  rationale: string;
  decidedBy: string[];
  decidedAt: ISODateString;
  status: "proposed" | "confirmed" | "superseded" | "reverted";
  relatedRequirementIds: EntityId[];
  relatedScopeIds: EntityId[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskStatus = "open" | "monitoring" | "resolved" | "accepted" | "closed";
export type RiskType =
  | "schedule"
  | "scope"
  | "quality"
  | "technical"
  | "resource"
  | "commercial"
  | "compliance"
  | "communication";

export interface Risk extends ProjectScopedEntity {
  riskId: string;
  name: string;
  level: RiskLevel;
  type: RiskType;
  impact: string;
  evidence: string;
  recommendedAction: string;
  owner: string;
  dueDate: ISODateString;
  status: RiskStatus;
  source: string;
}

export type ReviewTaskType =
  | "requirementExtraction"
  | "scopeChange"
  | "actionPlan"
  | "projectRisk"
  | "meetingMinutes"
  | "weeklyReport"
  | "projectSummary";

export interface ReviewTask extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  version: number;
  sourceIds: EntityId[];
  type: ReviewTaskType;
  title: string;
  status: ReviewStatus;
  generatedContent: string;
  editableContent: string;
  changeSummary: string[];
  citationIds: EntityId[];
  skillId: EntityId;
  modelProfileId: EntityId;
  aiExecutionId: EntityId;
  confidence: number;
  assignee: string;
  reviewNote?: string;
  reviewedAt?: ISODateString;
  reviewedBy?: string;
}
