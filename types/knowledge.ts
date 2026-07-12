import type {
  EntityAudit,
  EntityId,
  ISODateString,
  PermissionScope,
  ProjectScopedEntity,
  TrustLevel,
} from "./common";

export type ProjectDocumentType =
  | "contract"
  | "scope"
  | "clientRequirement"
  | "meetingMinutes"
  | "schedule"
  | "technicalSolution"
  | "testReport"
  | "clientFeedback"
  | "email"
  | "attachment";

export type ProjectDocumentStatus =
  | "original"
  | "aiParsed"
  | "pendingConfirmation"
  | "confirmed"
  | "invalid"
  | "superseded";

export type DocumentParseStatus =
  | "waiting"
  | "processing"
  | "parsed"
  | "failed";

export interface DocumentVersion extends ProjectScopedEntity {
  documentId: EntityId;
  versionLabel: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  status: ProjectDocumentStatus;
  parseStatus: DocumentParseStatus;
  uploadedBy: string;
  uploadedAt: ISODateString;
  effectiveFrom?: ISODateString;
  supersedes?: EntityId;
  isCurrent: boolean;
}

export interface ProjectDocument extends ProjectScopedEntity {
  name: string;
  fileName: string;
  documentType: ProjectDocumentType;
  category: string;
  folderPath: string;
  status: ProjectDocumentStatus;
  parseStatus: DocumentParseStatus;
  permissionScope: PermissionScope;
  summary: string;
  aiExtractedFacts: string[];
  currentVersionId: EntityId;
  versions: DocumentVersion[];
  isEffective: boolean;
  sourceDate: ISODateString;
  relatedRequirementIds: EntityId[];
  relatedScopeIds: EntityId[];
  relatedActionIds: EntityId[];
  relatedMeetingIds: EntityId[];
  relatedRiskIds: EntityId[];
  tags: string[];
}

export type KnowledgeLayer =
  | "projectDocument"
  | "confirmedFact"
  | "requirement"
  | "scope"
  | "meetingDecision"
  | "actionPlan"
  | "risk"
  | "companyRule"
  | "historicalCase";

export interface KnowledgeChunk extends ProjectScopedEntity {
  documentId: EntityId;
  chunkId: EntityId;
  documentType: ProjectDocumentType;
  layer: KnowledgeLayer;
  content: string;
  section: string;
  pageNumber?: number;
  versionLabel: string;
  sourceDate: ISODateString;
  effectiveFrom?: ISODateString;
  supersedes?: EntityId;
  trustLevel: TrustLevel;
  permissionScope: PermissionScope;
  status: "active" | "pending" | "superseded" | "invalid";
  citationText: string;
  keywords: string[];
}

export interface KnowledgeFact extends ProjectScopedEntity {
  layer: KnowledgeLayer;
  title: string;
  value: string;
  status: "pending" | "confirmed" | "superseded" | "rejected";
  trustLevel: TrustLevel;
  effectiveFrom?: ISODateString;
  supersedes?: EntityId;
  citationIds: EntityId[];
}

export interface SourceCitation extends EntityAudit {
  id: EntityId;
  projectId: EntityId;
  documentId: EntityId;
  chunkId: EntityId;
  documentName: string;
  documentType: ProjectDocumentType;
  section: string;
  pageNumber?: number;
  version: string;
  sourceDate: ISODateString;
  effectiveFrom?: ISODateString;
  supersedes?: EntityId;
  trustLevel: TrustLevel;
  permissionScope: PermissionScope;
  sourceStatus: ProjectDocumentStatus;
  isEffective: boolean;
  citationText: string;
  url?: string;
}

export interface ProjectKnowledgeFilters {
  documentTypes?: ProjectDocumentType[];
  layers?: KnowledgeLayer[];
  permissionScopes?: PermissionScope[];
  effectiveOnly?: boolean;
  status?: KnowledgeChunk["status"][];
}

export interface ProjectKnowledgeSearchInput {
  projectId: EntityId;
  query: string;
  filters?: ProjectKnowledgeFilters;
  limit?: number;
}

export interface ProjectKnowledgeMatch {
  chunk: KnowledgeChunk;
  score: number;
  citation: SourceCitation;
}

export interface ProjectKnowledgeSearchResult {
  query: string;
  matches: ProjectKnowledgeMatch[];
  total: number;
  executionId: EntityId;
  latency: number;
}

export interface ProjectQuestionInput {
  projectId: EntityId;
  question: string;
  conversationId?: EntityId;
  filters?: ProjectKnowledgeFilters;
}

export interface MatchedKnowledgeDocument {
  documentId: EntityId;
  documentName: string;
  score: number;
  isEffective: boolean;
}

export interface ProjectQuestionResult {
  answer: string;
  citations: SourceCitation[];
  confidence: number;
  matchedDocuments: MatchedKnowledgeDocument[];
  effectiveVersionUsed: string;
  executionId: EntityId;
  modelProfileId: EntityId;
  latency: number;
  mockCost: number;
}
