import { pgEnum } from "drizzle-orm/pg-core";

export const systemRoleEnum = pgEnum("system_role", [
  "system_admin",
  "standard_user",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

export const projectRoleEnum = pgEnum("project_role", [
  "project_manager",
  "project_member",
  "viewer",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "active",
  "paused",
  "completed",
  "cancelled",
  "at_risk",
]);

export const projectStageEnum = pgEnum("project_stage", [
  "discovery",
  "planning",
  "design",
  "development",
  "testing",
  "launch",
  "operation",
]);

export const projectHealthEnum = pgEnum("project_health", [
  "healthy",
  "attention",
  "at_risk",
  "critical",
]);

export const auditResultEnum = pgEnum("audit_result", [
  "succeeded",
  "denied",
  "failed",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "active",
  "archived",
  "failed",
]);

export const documentStorageStatusEnum = pgEnum("document_storage_status", [
  "pending",
  "stored",
  "failed",
  "quarantined",
  "deleted",
]);

export const documentIngestionStatusEnum = pgEnum(
  "document_ingestion_status",
  ["pending", "running", "succeeded", "failed", "needs_ocr", "cancelled"],
);

export const documentEmbeddingJobStatusEnum = pgEnum(
  "document_embedding_job_status",
  ["pending", "running", "succeeded", "failed", "cancelled"],
);

export const documentEmbeddingStatusEnum = pgEnum(
  "document_embedding_status",
  ["current", "invalid"],
);

export const documentEmbeddingBatchStatusEnum = pgEnum(
  "document_embedding_batch_status",
  ["reserved", "calling", "succeeded", "failed", "unknown"],
);

export const documentEmbeddingProviderCallStatusEnum = pgEnum(
  "document_embedding_provider_call_status",
  [
    "reserved",
    "calling",
    "succeeded",
    "failed_confirmed_no_charge",
    "unknown",
  ],
);

export const aiThreadStatusEnum = pgEnum("ai_thread_status", [
  "active",
  "archived",
]);

export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
]);

export const aiMessageStatusEnum = pgEnum("ai_message_status", [
  "pending",
  "completed",
  "failed",
  "insufficient_evidence",
]);

export const aiExecutionStatusEnum = pgEnum("ai_execution_status", [
  "reserved",
  "retrieving",
  "calling_provider",
  "validating",
  "succeeded",
  "failed",
  "insufficient_evidence",
]);

export const aiRetrievalModeEnum = pgEnum("ai_retrieval_mode", [
  "lexical",
  "shadow",
  "hybrid",
]);

export const aiRetrievalRunStatusEnum = pgEnum("ai_retrieval_run_status", [
  "running",
  "succeeded",
  "fallback_lexical",
  "failed",
  "insufficient_evidence",
]);

export const aiRetrievalCandidateSourceEnum = pgEnum(
  "ai_retrieval_candidate_source",
  ["lexical", "vector", "both"],
);

export const aiRetrievalQueryEmbeddingCallStatusEnum = pgEnum(
  "ai_retrieval_query_embedding_call_status",
  [
    "reserved",
    "calling",
    "succeeded",
    "failed_confirmed_no_charge",
    "unknown",
  ],
);

export const organizationRoleEnum = pgEnum("organization_role", [
  "organization_admin",
  "organization_member",
]);

export const departmentRoleEnum = pgEnum("department_role", [
  "department_admin",
  "department_member",
]);

export const knowledgeSpaceTypeEnum = pgEnum("knowledge_space_type", [
  "organization",
  "department",
  "project",
  "restricted",
]);

export const knowledgeVisibilityEnum = pgEnum("knowledge_visibility", [
  "private",
  "organization_shared",
  "department_shared",
  "restricted",
]);

export const knowledgeSpaceMemberRoleEnum = pgEnum(
  "knowledge_space_member_role",
  ["manager", "editor", "viewer"],
);

export const knowledgePermissionEnum = pgEnum("knowledge_permission", [
  "view",
  "download",
  "upload",
  "edit_metadata",
  "manage_versions",
  "archive",
  "manage_permissions",
  "manage_members",
]);

export const grantEffectEnum = pgEnum("grant_effect", ["allow", "deny"]);

export const grantSubjectTypeEnum = pgEnum("grant_subject_type", [
  "organization",
  "department",
  "project",
  "role",
  "user",
]);

export const projectKnowledgeSourceTypeEnum = pgEnum(
  "project_knowledge_source_type",
  ["knowledge_space", "document"],
);

export const requirementExtractionStatusEnum = pgEnum(
  "requirement_extraction_status",
  ["running", "awaiting_review", "failed"],
);

export const requirementDraftStatusEnum = pgEnum("requirement_draft_status", [
  "pending_review",
  "accepted",
  "rejected",
]);

export const requirementTypeEnum = pgEnum("requirement_type", [
  "functional",
  "non_functional",
  "business_rule",
  "constraint",
  "compliance",
]);

export const workPriorityEnum = pgEnum("work_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const requirementStatusEnum = pgEnum("requirement_status", [
  "approved",
  "in_progress",
  "done",
  "cancelled",
]);

export const reviewDecisionEnum = pgEnum("review_decision", [
  "accept",
  "edit_accept",
  "reject",
]);

export const scopeVersionStatusEnum = pgEnum("scope_version_status", [
  "draft",
  "approved",
  "superseded",
]);

export const scopeComparisonStatusEnum = pgEnum("scope_comparison_status", [
  "running",
  "awaiting_review",
  "completed",
  "failed",
]);

export const scopeDiffTypeEnum = pgEnum("scope_diff_type", [
  "added",
  "removed",
  "modified",
  "unchanged",
  "potentially_out_of_scope",
  "not_mentioned",
  "ambiguous",
]);

export const scopeReviewStatusEnum = pgEnum("scope_review_status", [
  "pending",
  "confirmed",
  "dismissed",
]);

export type SystemRole = (typeof systemRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ProjectStage = (typeof projectStageEnum.enumValues)[number];
export type ProjectHealth = (typeof projectHealthEnum.enumValues)[number];
export type AuditResult = (typeof auditResultEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];
export type DocumentStorageStatus =
  (typeof documentStorageStatusEnum.enumValues)[number];
export type DocumentIngestionStatus =
  (typeof documentIngestionStatusEnum.enumValues)[number];
export type DocumentEmbeddingJobStatus =
  (typeof documentEmbeddingJobStatusEnum.enumValues)[number];
export type DocumentEmbeddingStatus =
  (typeof documentEmbeddingStatusEnum.enumValues)[number];
export type DocumentEmbeddingBatchStatus =
  (typeof documentEmbeddingBatchStatusEnum.enumValues)[number];
export type DocumentEmbeddingProviderCallStatus =
  (typeof documentEmbeddingProviderCallStatusEnum.enumValues)[number];
export type AiThreadStatus = (typeof aiThreadStatusEnum.enumValues)[number];
export type AiMessageRole = (typeof aiMessageRoleEnum.enumValues)[number];
export type AiMessageStatus = (typeof aiMessageStatusEnum.enumValues)[number];
export type AiExecutionStatus =
  (typeof aiExecutionStatusEnum.enumValues)[number];
export type AiRetrievalMode =
  (typeof aiRetrievalModeEnum.enumValues)[number];
export type AiRetrievalRunStatus =
  (typeof aiRetrievalRunStatusEnum.enumValues)[number];
export type AiRetrievalCandidateSource =
  (typeof aiRetrievalCandidateSourceEnum.enumValues)[number];
export type AiRetrievalQueryEmbeddingCallStatus =
  (typeof aiRetrievalQueryEmbeddingCallStatusEnum.enumValues)[number];
export type OrganizationRole =
  (typeof organizationRoleEnum.enumValues)[number];
export type DepartmentRole = (typeof departmentRoleEnum.enumValues)[number];
export type KnowledgeSpaceType =
  (typeof knowledgeSpaceTypeEnum.enumValues)[number];
export type KnowledgeVisibility =
  (typeof knowledgeVisibilityEnum.enumValues)[number];
export type KnowledgeSpaceMemberRole =
  (typeof knowledgeSpaceMemberRoleEnum.enumValues)[number];
export type KnowledgePermission =
  (typeof knowledgePermissionEnum.enumValues)[number];
export type GrantEffect = (typeof grantEffectEnum.enumValues)[number];
export type GrantSubjectType =
  (typeof grantSubjectTypeEnum.enumValues)[number];
export type ProjectKnowledgeSourceType =
  (typeof projectKnowledgeSourceTypeEnum.enumValues)[number];
export type RequirementExtractionStatus =
  (typeof requirementExtractionStatusEnum.enumValues)[number];
export type RequirementDraftStatus =
  (typeof requirementDraftStatusEnum.enumValues)[number];
export type RequirementType = (typeof requirementTypeEnum.enumValues)[number];
export type WorkPriority = (typeof workPriorityEnum.enumValues)[number];
export type RequirementStatus =
  (typeof requirementStatusEnum.enumValues)[number];
export type ReviewDecision = (typeof reviewDecisionEnum.enumValues)[number];
export type ScopeVersionStatus =
  (typeof scopeVersionStatusEnum.enumValues)[number];
export type ScopeComparisonStatus =
  (typeof scopeComparisonStatusEnum.enumValues)[number];
export type ScopeDiffType = (typeof scopeDiffTypeEnum.enumValues)[number];
export type ScopeReviewStatus =
  (typeof scopeReviewStatusEnum.enumValues)[number];
