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
