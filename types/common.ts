export type ISODateString = string;

export type EntityId = string;

export type Priority = "P0" | "P1" | "P2" | "P3";

export type PermissionScope =
  | "project"
  | "projectManagers"
  | "projectTeam"
  | "management"
  | "company";

export type TrustLevel = "low" | "medium" | "high" | "verified";

export type ReviewStatus =
  | "generated"
  | "pendingReview"
  | "approved"
  | "approvedWithChanges"
  | "rejected"
  | "superseded";

export interface EntityAudit {
  createdAt: ISODateString;
  updatedAt: ISODateString;
  createdBy: string;
}

export interface ProjectScopedEntity extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  version: number;
  sourceIds: EntityId[];
}

export interface PersonReference {
  id: EntityId;
  name: string;
  avatarUrl?: string;
  email?: string;
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}
