import type {
  EntityAudit,
  EntityId,
  ISODateString,
  PersonReference,
} from "./common";

export type ProjectStatus =
  | "planning"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "atRisk";

export type ProjectHealthStatus =
  | "healthy"
  | "attention"
  | "atRisk"
  | "critical";

export type ProjectPhase =
  | "discovery"
  | "planning"
  | "design"
  | "development"
  | "testing"
  | "launch"
  | "operation";

export type ProjectType =
  | "website"
  | "campaign"
  | "platform"
  | "data"
  | "ai"
  | "ar"
  | "h5";

export type ProjectRole =
  | "projectManager"
  | "productManager"
  | "designer"
  | "frontendEngineer"
  | "backendEngineer"
  | "qaEngineer"
  | "stakeholder";

export interface ProjectMember extends PersonReference {
  projectId: EntityId;
  role: ProjectRole;
  department: string;
  joinedAt: ISODateString;
}

export interface ProjectMilestone {
  id: EntityId;
  projectId: EntityId;
  name: string;
  dueDate: ISODateString;
  status: "pending" | "inProgress" | "completed" | "delayed";
  progress: number;
}

export interface Project extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  version: number;
  sourceIds: EntityId[];
  name: string;
  clientName: string;
  manager: ProjectMember;
  members: ProjectMember[];
  type: ProjectType;
  goal: string;
  summary: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  health: ProjectHealthStatus;
  healthReason: string;
  targetLaunchDate: ISODateString;
  progress: number;
  currentScopeVersionId?: EntityId;
  incompleteActionCount: number;
  pendingReviewCount: number;
  riskCount: number;
  milestones: ProjectMilestone[];
  tags: string[];
  notes?: string;
}

export type ProjectActivityType =
  | "documentUploaded"
  | "aiExecuted"
  | "reviewUpdated"
  | "requirementUpdated"
  | "scopeUpdated"
  | "actionUpdated"
  | "riskUpdated";

export interface ProjectActivity extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  version: number;
  sourceIds: EntityId[];
  type: ProjectActivityType;
  title: string;
  description: string;
  actor: PersonReference;
  occurredAt: ISODateString;
  relatedEntityId?: EntityId;
  relatedEntityType?: string;
}
