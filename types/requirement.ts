import type {
  EntityId,
  Priority,
  ProjectScopedEntity,
  ReviewStatus,
} from "./common";

export type RequirementStatus =
  | "draft"
  | "pendingReview"
  | "confirmed"
  | "rejected"
  | "deprecated";

export type RequirementType =
  | "functional"
  | "nonFunctional"
  | "businessRule"
  | "technicalConstraint"
  | "compliance"
  | "content"
  | "design"
  | "integration";

export type RequirementAcceptanceStatus =
  | "notDefined"
  | "pending"
  | "accepted"
  | "rejected";

export interface RequirementHistory extends ProjectScopedEntity {
  requirementId: EntityId;
  revision: number;
  changedBy: string;
  changeType: "created" | "edited" | "reviewed" | "statusChanged";
  changeSummary: string;
  previousValue?: Record<string, unknown>;
  nextValue: Record<string, unknown>;
}

export interface Requirement extends ProjectScopedEntity {
  requirementId: string;
  title: string;
  description: string;
  type: RequirementType;
  source: string;
  priority: Priority;
  status: RequirementStatus;
  inOriginalScope: boolean;
  owner: string;
  acceptanceStatus: RequirementAcceptanceStatus;
  acceptanceCriteria: string[];
  aiUnderstanding: string;
  originalQuote: string;
  exceptionStates: string[];
  nonFunctionalRequirements: string[];
  relatedPageIds: EntityId[];
  relatedTaskIds: EntityId[];
  relatedScopeIds: EntityId[];
  citationIds: EntityId[];
  confidence: number;
  reviewStatus: ReviewStatus;
  duplicateOf?: EntityId;
  conflictsWith: EntityId[];
  history: RequirementHistory[];
}
