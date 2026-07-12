import type {
  EntityId,
  ISODateString,
  Priority,
  ProjectScopedEntity,
} from "./common";

export type ScopeStatus =
  | "draft"
  | "pendingReview"
  | "approved"
  | "active"
  | "superseded"
  | "rejected";

export interface ScopeVersion extends ProjectScopedEntity {
  versionLabel: string;
  name: string;
  status: ScopeStatus;
  summary: string;
  content: string[];
  requirementIds: EntityId[];
  approvedBy?: string;
  approvedAt?: ISODateString;
  effectiveFrom?: ISODateString;
  supersedes?: EntityId;
  estimatedPersonDays: number;
}

export type ScopeChangeType = "added" | "removed" | "modified" | "pending";

export interface ScopeChange extends ProjectScopedEntity {
  fromScopeVersionId: EntityId;
  toScopeVersionId: EntityId;
  type: ScopeChangeType;
  title: string;
  description: string;
  before?: string;
  after?: string;
  impactDays: number;
  requirementIds: EntityId[];
  affectedTaskIds: EntityId[];
  affectedMilestoneIds: EntityId[];
  affectsLaunchDate: boolean;
  pendingQuestions: string[];
  riskSuggestion?: string;
  status: "identified" | "pendingReview" | "confirmed" | "rejected";
}

export type ActionItemStatus =
  | "todo"
  | "inProgress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "overdue";

export interface ActionItem extends ProjectScopedEntity {
  actionId: string;
  title: string;
  description: string;
  source: string;
  owner: string;
  dueDate: ISODateString;
  status: ActionItemStatus;
  priority: Priority;
  requirementIds: EntityId[];
  meetingIds: EntityId[];
  riskIds: EntityId[];
  blockerIds: EntityId[];
  completedAt?: ISODateString;
}
